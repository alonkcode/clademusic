import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayer } from '../PlayerContext';
import { useAuth } from '@/hooks/useAuth';
import { forceRefreshAccessToken, getValidAccessToken } from '@/services/spotifyAuthService';
import { isTestEnv } from '@/lib/env';
import { SpotifyPlaybackSession, stateHasTrack, type PlayOutcome } from './spotifyPlayback';

// How long after a track request the poll may ignore a device that still
// reports some other track. Past this, whatever the device says is reality.
const TRACK_SWITCH_GRACE_MS = 6000;

interface SpotifyWebPlayerProps {
  providerTrackId: string | null;
  autoplay?: boolean;
  /** Called once when SDK playback can't proceed (no session, not Premium,
   *  device/auth error, ...) so the caller can swap in the plain embed
   *  player instead - kept as one visible "spotify iframe" mechanism
   *  (UniversalPlayerHost's singleton) rather than this component also
   *  mounting a second, competing Spotify iframe of its own. */
  onFallback?: (reason: string) => void;
  /** Something the listener should be told that is NOT a reason to leave full
   *  playback: a start that did not take, or a browser that blocked autoplay.
   *  This component renders inside the collapsed video panel, so it cannot show
   *  these itself. */
  onNotice?: (message: string) => void;
}

interface LatestValues {
  /** `${playRequestId}:${trackId}` of the request currently being asked for. */
  key: string | null;
  uri: string | null;
  trackId: string | null;
  shouldAutoplay: boolean;
  seekToSec: number | null;
  volume: number;
  isMuted: boolean;
  onNotice?: (message: string) => void;
}

/**
 * Spotify full-track playback via Web Playback SDK (requires Spotify Premium).
 * Calls onFallback when SDK/auth/device isn't available so the caller can
 * switch to the embed player.
 *
 * All of the device handling - connecting, retrying, confirming that a start
 * took - lives in SpotifyPlaybackSession. This component only decides WHEN a
 * start is wanted, and mirrors the device's state into the player context.
 */
export function SpotifyWebPlayer({ providerTrackId, autoplay, onFallback, onNotice }: SpotifyWebPlayerProps) {
  const { user } = useAuth();
  const {
    provider,
    autoplaySpotify,
    playRequestId,
    seekToSec,
    clearSeek,
    volume,
    isMuted,
    isStarting,
    registerProviderControls,
    updatePlaybackState,
  } = usePlayer();
  const userId = user?.id ?? null;

  const [error, setError] = useState<string | null>(null);
  // True once the SDK itself has reported that the browser's autoplay policy
  // blocked the automatic /play call - a hard platform limit, not a bug:
  // browsers deliberately refuse to start audio with zero preceding user
  // interaction on the page, and a JS-synthesized click doesn't count as one
  // either, specifically to prevent working around exactly this. Pressing play
  // (a real gesture) resumes the track the device already has loaded.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  // State so the effects that need a session run when it appears; the ref is for
  // callbacks that must reach the current one without re-registering.
  const [session, setSession] = useState<SpotifyPlaybackSession | null>(null);
  const sessionRef = useRef<SpotifyPlaybackSession | null>(null);

  const shouldAutoplay = autoplay ?? autoplaySpotify ?? true;
  const uri = providerTrackId ? `spotify:track:${providerTrackId}` : null;

  // Live values, read by async code and by effects that must NOT be re-run by
  // them. The context's isPlaying is rewritten by the poll below several times a
  // second, and mute/seek change at any moment; none of those is a reason to load
  // a track again. Declared first so it is current before any later effect of the
  // same commit reads it.
  const latest = useRef<LatestValues>({
    key: null,
    uri: null,
    trackId: null,
    shouldAutoplay,
    seekToSec,
    volume,
    isMuted,
    onNotice,
  });
  useEffect(() => {
    latest.current = {
      key: providerTrackId ? `${playRequestId}:${providerTrackId}` : null,
      uri,
      trackId: providerTrackId,
      shouldAutoplay,
      seekToSec,
      volume,
      isMuted,
      onNotice,
    };
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Which request a start is currently in flight for, if any.
  const startingKeyRef = useRef<string | null>(null);
  const lastTrackIdRef = useRef<string | null>(null);
  const lastTrackRequestedAtRef = useRef(0);

  // Reported via a ref-based dedupe rather than a plain dependency on
  // `error`: onFallback's identity can change across renders (it's an
  // inline arrow at the call site), and firing again on that alone would
  // re-trigger the parent's fallback state update mid-render-cycle for no
  // real change - only a genuinely new/changed error string should notify.
  const lastReportedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!error || error === lastReportedErrorRef.current) return;
    lastReportedErrorRef.current = error;
    onFallback?.(error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // A new track: forget the last one's error and hint, and show the new
  // request as underway. Keyed on the track alone - the request id changes on
  // every tap of the same track, which must not wipe anything.
  useEffect(() => {
    if (provider !== 'spotify' || !providerTrackId) return;
    setError(null);
    setAutoplayBlocked(false);
    lastTrackIdRef.current = providerTrackId;
    lastTrackRequestedAtRef.current = Date.now();
    updatePlaybackState({
      durationMs: 0,
      isPlaying: latest.current.shouldAutoplay,
    });
  }, [provider, providerTrackId, updatePlaybackState]);

  useEffect(() => {
    if (provider === 'spotify' && providerTrackId && !userId) {
      setError('Sign in to play full Spotify tracks.');
    }
  }, [provider, providerTrackId, userId]);

  // One session per signed-in listener, created as soon as there is a Spotify
  // track to play so the device is already connecting before the first click
  // has to wait on it, and shared by every request after that. Not tied to the
  // track: a session that came and went with each track was the source of
  // duplicate devices and of a fresh connect on every click.
  const wantsSession = provider === 'spotify' && !!providerTrackId && !!userId && !isTestEnv;
  useEffect(() => {
    if (!wantsSession || !userId) return;
    const next = new SpotifyPlaybackSession({
      getToken: (forceRefresh) => (forceRefresh ? forceRefreshAccessToken(userId) : getValidAccessToken(userId)),
      getVolume: () => (latest.current.isMuted ? 0 : latest.current.volume),
      onFatal: (failure) => setError(failure.message),
      onAutoplayBlocked: () => setAutoplayBlocked(true),
    });
    sessionRef.current = next;
    setSession(next);
    next.ensureDevice().catch(() => {
      // Surfaced by the first play request, which retries the connection.
    });
    return () => {
      next.dispose();
      if (sessionRef.current === next) sessionRef.current = null;
      setSession((current) => (current === next ? null : current));
    };
  }, [wantsSession, userId]);

  const applyOutcome = useCallback(
    (outcome: PlayOutcome, startSec: number | null) => {
      switch (outcome.status) {
        case 'started':
          if (startSec != null) clearSeek();
          updatePlaybackState({ isStarting: false });
          break;
        case 'blocked':
          updatePlaybackState({ isStarting: false });
          latest.current.onNotice?.('Your browser blocked autoplay. Press play to start Spotify.');
          break;
        case 'unavailable':
          // The transport must say what is true: nothing is playing.
          updatePlaybackState({ isStarting: false, isPlaying: false });
          latest.current.onNotice?.("Spotify didn't respond. Press play to try again.");
          break;
        case 'failed':
          updatePlaybackState({ isStarting: false, isPlaying: false });
          setError(outcome.failure.message);
          break;
        case 'superseded':
          // A newer request owns the transport state now.
          break;
      }
    },
    [clearSeek, updatePlaybackState]
  );

  // Asks the session to play the CURRENT request and applies whatever came of
  // it. Called when a track is opened already playing, and when the listener
  // presses play on a device that was never handed the track.
  const beginStart = useCallback(
    async (active: SpotifyPlaybackSession, startSec: number | null) => {
      const { key, uri: requestUri, trackId } = latest.current;
      if (!key || !requestUri || !trackId) return;
      // The same request is already being started (a double-invoked handler).
      if (startingKeyRef.current === key) return;

      startingKeyRef.current = key;
      lastTrackIdRef.current = trackId;
      lastTrackRequestedAtRef.current = Date.now();
      updatePlaybackState({ isStarting: true });

      let outcome: PlayOutcome;
      try {
        outcome = await active.play({
          uri: requestUri,
          trackId,
          // Start where the caller asked - tapping a chorus should land on the
          // chorus, not at 0:00 with a seek racing the SDK's connect.
          positionMs: startSec != null ? Math.max(0, Math.round(startSec * 1000)) : 0,
          isCurrent: () => latest.current.key === key,
          wantsPlaying: () => latest.current.shouldAutoplay,
        });
      } finally {
        if (startingKeyRef.current === key) startingKeyRef.current = null;
      }

      if (!mountedRef.current || latest.current.key !== key) return;
      applyOutcome(outcome, startSec);
    },
    [applyOutcome, updatePlaybackState]
  );

  // Register controls even if we end up falling back; PlayerContext expects these for seek/volume.
  useEffect(() => {
    if (provider !== 'spotify') return;
    registerProviderControls('spotify', {
      play: async (startSec) => {
        const active = sessionRef.current;
        if (!active) return;
        const seconds = typeof startSec === 'number' ? startSec : null;

        // resume() only continues a track the device already has loaded. If the
        // device was never handed this one - the /play request failed, or the
        // listener pressed play before the device was up - resume is a silent
        // no-op and the press looked like it did nothing at all. Detect that and
        // issue the real start instead.
        const state = await active.currentState();
        if (stateHasTrack(state, latest.current.trackId)) {
          if (seconds != null) await active.seek(seconds * 1000);
          await active.resume();
          return;
        }
        await beginStart(active, seconds);
      },
      pause: async () => {
        await sessionRef.current?.pause();
      },
      seekTo: async (seconds) => {
        await sessionRef.current?.seek(seconds * 1000);
      },
      setVolume: async (vol) => {
        await sessionRef.current?.setVolume(vol);
      },
      setMute: async (muted) => {
        await sessionRef.current?.setVolume(muted ? 0 : latest.current.volume);
      },
      // Disconnects the device but leaves the session able to build a new one.
      teardown: async () => {
        sessionRef.current?.release();
      },
    });
  }, [provider, registerProviderControls, beginStart]);

  // A track was opened (or opened again): start it. Keyed on the request, never
  // on isPlaying/mute/seek - see `latest` - so it cannot re-fire from the poll.
  useEffect(() => {
    if (!session || provider !== 'spotify' || !providerTrackId) return;
    // Opened paused: nothing to start until the listener presses play.
    if (!latest.current.shouldAutoplay) return;
    void beginStart(session, latest.current.seekToSec);
  }, [session, provider, providerTrackId, playRequestId, beginStart]);

  // Unlocks audio on the first real gesture if the browser ends up blocking
  // the automatic start - activateElement() is the SDK's own documented unlock
  // for this (see https://developer.spotify.com/documentation/web-playback-sdk).
  // It only unlocks: resuming here would run before the click has updated the
  // requested track, and could restart the previous song.
  useEffect(() => {
    if (provider !== 'spotify' || !providerTrackId || !shouldAutoplay) return;

    let unlocked = false;
    const unlock = () => {
      const active = sessionRef.current;
      if (!active || unlocked) return;
      unlocked = true;
      setAutoplayBlocked(false);
      void active.activateElement().catch(() => {});
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    };

    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    };
  }, [provider, providerTrackId, shouldAutoplay]);

  // Mirrors the device into the player context for the seekbar and the bar.
  useEffect(() => {
    if (!session) return;
    let polling = false;
    const id = window.setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const state = await session.currentState();
        if (!state) return;
        const track = state.track_window?.current_track;
        // The device keeps reporting the OUTGOING track for a moment after a
        // switch - the /play request that actually changes it is a real network
        // round trip, not instant. Relaying that overwrote the just-set new
        // title/artist/position with the track being replaced, which is what
        // made switching songs look like it "jumped back".
        //
        // Two ways this guard must NOT hold: Spotify relinks a track that isn't
        // available in the listener's market (stateHasTrack knows), and the
        // device may simply never land on the requested track. Either way an
        // unbounded guard drops every tick, so the seekbar, duration and play
        // state would freeze while audio plays on - hence the time limit.
        const requestedId = lastTrackIdRef.current;
        const isRequestedTrack = !track?.id || !requestedId || stateHasTrack(state, requestedId);
        const startInFlight = startingKeyRef.current !== null;
        const stillSwitching = startInFlight || Date.now() - lastTrackRequestedAtRef.current < TRACK_SWITCH_GRACE_MS;
        if (!isRequestedTrack && stillSwitching) return;
        const artistNames = Array.isArray(track?.artists)
          ? track.artists.map((a) => a?.name).filter(Boolean).join(', ')
          : null;
        updatePlaybackState({
          positionMs: state.position ?? 0,
          durationMs: state.duration ?? 0,
          // A device that has only just been handed a track reports `paused` for
          // a tick or two before audio starts. Relayed straight through, that
          // flipped the transport back to "play" a few hundred ms after the
          // listener asked for it. While a start is in flight only the start's
          // own outcome may say it failed; once it has settled, `paused` is
          // reality and is reported.
          isPlaying: startInFlight && state.paused ? undefined : !state.paused,
          trackTitle: track?.name ?? null,
          trackArtist: artistNames,
          trackAlbum: track?.album?.name ?? null,
        });
      } finally {
        polling = false;
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [session, updatePlaybackState]);

  // A start position that arrives without a start to carry it (opened paused,
  // or a seek while playing). While a start IS in flight it carries the
  // position itself, and seeking the device first would move whatever it is
  // still playing from before.
  useEffect(() => {
    if (provider !== 'spotify' || seekToSec == null) return;
    if (startingKeyRef.current) return;
    const active = sessionRef.current;
    if (active) void active.seek(seekToSec * 1000);
    clearSeek();
  }, [provider, seekToSec, clearSeek]);

  // Leaving with a start unconfirmed (dropped to the embed, provider switched)
  // must not leave the "starting" flag set for whatever plays next.
  useEffect(
    () => () => {
      if (startingKeyRef.current) updatePlaybackState({ isStarting: false });
    },
    [updatePlaybackState]
  );

  if (provider !== 'spotify' || !providerTrackId) return null;

  // When full playback can't start (auth/dev-mode/premium/device), the
  // caller falls back to the embed player - nothing to render here for
  // that case, the effect above already told it why.
  if (error) return null;

  // We don’t render an extra UI; playback is driven by the SDK + the universal seekbar.
  // Keep a tiny status line for debuggability.
  return (
    <div className="w-full">
      {autoplayBlocked ? (
        <div className="text-[11px] text-white/70">Tap anywhere to start playback (your browser blocked autoplay).</div>
      ) : (
        isStarting && <div className="text-[11px] text-white/50">Starting Spotify playback…</div>
      )}
    </div>
  );
}
