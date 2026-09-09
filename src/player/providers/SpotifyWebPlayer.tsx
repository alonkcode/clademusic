import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from '../PlayerContext';
import { useAuth } from '@/hooks/useAuth';
import { getValidAccessToken } from '@/services/spotifyAuthService';
import { isTestEnv } from '@/lib/env';

declare global {
  interface Window {
    Spotify?: any;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

type SpotifyPlayerInstance = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  getCurrentState: () => Promise<any>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  addListener: (event: string, cb: (data: any) => void) => boolean;
  removeListener: (event: string, cb?: (data: any) => void) => boolean;
  /** Unlocks audio after the browser's autoplay policy blocks a /play call
   *  with no preceding user gesture. Newer SDK versions only. */
  activateElement?: () => Promise<void>;
};

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
let sdkPromise: Promise<void> | null = null;

function loadSpotifyWebPlaybackSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.Spotify?.Player) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SDK_URL}"]`);
    if (existing) {
      // If script is already present, wait for readiness.
      const check = () => {
        if (window.Spotify?.Player) return resolve();
        setTimeout(check, 50);
      };
      check();
      return;
    }

    const timeout = setTimeout(() => reject(new Error('Spotify Web Playback SDK load timeout')), 15000);
    window.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timeout);
      resolve();
    };

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load Spotify Web Playback SDK'));
    document.body.appendChild(script);
  });

  return sdkPromise;
}

async function spotifyApiFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return res;
}

interface SpotifyWebPlayerProps {
  providerTrackId: string | null;
  autoplay?: boolean;
  /** Called once when SDK playback can't proceed (no session, not Premium,
   *  device/auth error, ...) so the caller can swap in the plain embed
   *  player instead - kept as one visible "spotify iframe" mechanism
   *  (UniversalPlayerHost's singleton) rather than this component also
   *  mounting a second, competing Spotify iframe of its own. */
  onFallback?: (reason: string) => void;
}

/**
 * Spotify full-track playback via Web Playback SDK (requires Spotify Premium).
 * Calls onFallback when SDK/auth/device isn't available so the caller can
 * switch to the embed player.
 */
export function SpotifyWebPlayer({ providerTrackId, autoplay, onFallback }: SpotifyWebPlayerProps) {
  const { user } = useAuth();
  const {
    provider,
    autoplaySpotify,
    playRequestId,
    seekToSec,
    clearSeek,
    volume,
    isMuted,
    registerProviderControls,
    updatePlaybackState,
  } = usePlayer();

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // True once the SDK itself has reported that the browser's autoplay policy
  // blocked the automatic /play call - a hard platform limit, not a bug:
  // browsers deliberately refuse to start audio with zero preceding user
  // interaction on the page, and a JS-synthesized click doesn't count as one
  // either, specifically to prevent working around exactly this. Waiting for
  // the next REAL interaction and resuming from it then is the actual fix,
  // not pretending true unattended autoplay is achievable.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const playerRef = useRef<SpotifyPlayerInstance | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const lastTrackIdRef = useRef<string | null>(null);
  // Which `${playRequestId}:${trackId}` has already been handed to
  // `PUT /me/player/play`, so a re-run of the setup effect never replays a
  // track the listener is already partway through.
  const startedPlayKeyRef = useRef<string | null>(null);
  const volumeRef = useRef<number>(volume);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

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

  const shouldAutoplay = useMemo(() => autoplay ?? autoplaySpotify ?? true, [autoplay, autoplaySpotify]);
  const uri = useMemo(() => (providerTrackId ? `spotify:track:${providerTrackId}` : null), [providerTrackId]);

  // Live transport values, mirrored into refs so the setup effect below can
  // READ them without being RE-RUN by them. The caller passes
  // autoplay={isPlaying} and the 500ms poll further down writes the SDK's
  // real paused-state back into that same isPlaying, so every one of these
  // changes several times a second during ordinary playback. Having them as
  // effect dependencies meant a full re-setup - transfer playback, then
  // `PUT /me/player/play` at position_ms - on every such change, which is
  // what restarted the track from 0:00 over and over. Whether the listener
  // is currently playing, muted, or has just sought is not a reason to load
  // a track again; the registered ProviderControls handle all three on the
  // already-connected player.
  const shouldAutoplayRef = useRef(shouldAutoplay);
  const seekToSecRef = useRef(seekToSec);
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    shouldAutoplayRef.current = shouldAutoplay;
    seekToSecRef.current = seekToSec;
    isMutedRef.current = isMuted;
  }, [shouldAutoplay, seekToSec, isMuted]);

  // Register controls even if we end up falling back; PlayerContext expects these for seek/volume.
  useEffect(() => {
    if (provider !== 'spotify') return;
    registerProviderControls('spotify', {
      play: async (startSec) => {
        const player = playerRef.current;
        if (!player) return;
        if (typeof startSec === 'number') await player.seek(Math.max(0, startSec * 1000));
        await player.resume();
      },
      pause: async () => {
        const player = playerRef.current;
        if (!player) return;
        await player.pause();
      },
      seekTo: async (seconds) => {
        const player = playerRef.current;
        if (!player) return;
        await player.seek(Math.max(0, seconds * 1000));
      },
      setVolume: async (vol) => {
        const player = playerRef.current;
        if (!player) return;
        await player.setVolume(Math.max(0, Math.min(1, vol)));
      },
      setMute: async (muted) => {
        const player = playerRef.current;
        if (!player) return;
        await player.setVolume(muted ? 0 : Math.max(0, Math.min(1, volumeRef.current)));
      },
      teardown: async () => {
        try {
          playerRef.current?.disconnect();
        } catch {
          // ignore
        } finally {
          playerRef.current = null;
          deviceIdRef.current = null;
        }
      },
    });
  }, [provider, registerProviderControls]);

  // Keyed on the track alone. With shouldAutoplay in the dependency list this
  // ran on every play/pause and on every poll tick that changed isPlaying:
  // each run called setReady(false), and the SDK's `ready` event only fires
  // once per device, so nothing ever set it back - "Starting Spotify
  // playback…" latched on permanently even though playback was connected.
  // The same runs also reset durationMs to 0, collapsing the seekbar until
  // the next poll refilled it 500ms later.
  useEffect(() => {
    if (provider !== 'spotify' || !providerTrackId) return;
    setError(null);
    setReady(false);
    setAutoplayBlocked(false);
    updatePlaybackState({
      durationMs: 0,
      isPlaying: shouldAutoplayRef.current,
    });
  }, [provider, providerTrackId, updatePlaybackState]);

  // Once the browser has blocked the automatic /play call, resume from the
  // very next real interaction anywhere on the page rather than requiring
  // the listener to specifically find and press the transport bar's play
  // button - activateElement() is the SDK's own documented unlock for this
  // (see https://developer.spotify.com/documentation/web-playback-sdk),
  // separate from and in addition to the actual resume() call.
  useEffect(() => {
    if (!autoplayBlocked) return;

    const resume = () => {
      setAutoplayBlocked(false);
      const player = playerRef.current;
      void player?.activateElement?.();
      void player?.resume();
    };

    window.addEventListener('pointerdown', resume, { once: true, capture: true });
    window.addEventListener('keydown', resume, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', resume, { capture: true });
      window.removeEventListener('keydown', resume, { capture: true });
    };
  }, [autoplayBlocked]);

  // Starts the CURRENT play request on the connected device, at most once.
  // Two callers funnel through it: the setup effect below (the ordinary path,
  // where a track is opened already playing) and the deferred effect after it
  // (the listener pressed play before the device was ready, or the track was
  // opened paused). Both share startedPlayKeyRef, so a track the listener is
  // already partway through is never yanked back to its start.
  const startPlaybackOnce = useCallback(
    async (token: string, deviceId: string) => {
      if (!uri || !providerTrackId) return;
      const playKey = `${playRequestId}:${providerTrackId}`;
      if (startedPlayKeyRef.current === playKey) return;
      startedPlayKeyRef.current = playKey;
      lastTrackIdRef.current = providerTrackId;

      // Start where the caller asked - tapping a chorus should land on the
      // chorus, not at 0:00 with a seek racing the SDK's connect.
      const seekAtStartSec = seekToSecRef.current;
      const startMs = seekAtStartSec != null ? Math.max(0, Math.round(seekAtStartSec * 1000)) : 0;
      const playRes = await spotifyApiFetch(token, `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [uri], position_ms: startMs }),
      });

      if (!playRes.ok && playRes.status !== 204) {
        const details = await playRes.json().catch(() => null);
        console.warn('[Spotify Web Player] play failed', playRes.status, details);
        // Release the key so a later attempt can retry: this request never
        // actually started, so treating it as started would strand the track.
        startedPlayKeyRef.current = null;
        // A 403 here is almost always the app's Spotify Developer Dashboard
        // being in Development Mode, which restricts the API to an explicit
        // allow-list of accounts regardless of whether the listener actually
        // has Premium - surface that concretely rather than a bare status
        // code, since "Using preview mode" alone gives the listener nothing
        // they can act on.
        if (playRes.status === 403) {
          setError(
            'Spotify playback not permitted (403). Using preview mode. If this account should have full access, add it under the Spotify Developer Dashboard → your app → Users and Access.'
          );
        }
        return;
      }

      if (seekAtStartSec != null) {
        // The start position was applied by the play call itself.
        clearSeek();
      }
    },
    [uri, providerTrackId, playRequestId, clearSeek]
  );

  useEffect(() => {
    if (provider !== 'spotify' || !providerTrackId) return;
    if (!user) {
      setError('Sign in to play full Spotify tracks.');
      return;
    }
    if (isTestEnv) return;

    let cancelled = false;

    const start = async () => {
      try {
        await loadSpotifyWebPlaybackSdk();
        if (cancelled) return;

        const getToken = async () => {
          const token = await getValidAccessToken(user.id);
          return token;
        };

        const token = await getToken();
        if (!token) {
          setError('Spotify connection missing or expired. Reconnect Spotify.');
          return;
        }

        // Create player once.
        if (!playerRef.current) {
          const PlayerCtor = window.Spotify?.Player;
          if (!PlayerCtor) throw new Error('Spotify SDK not available');

          const instance: SpotifyPlayerInstance = new PlayerCtor({
            name: 'Clade Player',
            volume: isMutedRef.current ? 0 : volumeRef.current,
            getOAuthToken: async (cb: (t: string) => void) => {
              const next = await getToken();
              if (next) cb(next);
            },
          });

          instance.addListener('ready', ({ device_id }: any) => {
            deviceIdRef.current = device_id;
            setReady(true);
          });

          instance.addListener('not_ready', () => {
            setReady(false);
          });

          instance.addListener('initialization_error', (e: any) => {
            console.error('[Spotify Web Player] init error', e);
            setError('Spotify player failed to initialize.');
          });

          instance.addListener('authentication_error', (e: any) => {
            console.error('[Spotify Web Player] auth error', e);
            setError('Spotify authentication failed. Reconnect Spotify.');
          });

          // Common: non-premium accounts cannot use Web Playback SDK.
          instance.addListener('account_error', (e: any) => {
            console.error('[Spotify Web Player] account error', e);
            setError('Spotify Premium is required for full-track playback. Using preview mode.');
          });

          instance.addListener('playback_error', (e: any) => {
            console.error('[Spotify Web Player] playback error', e);
            // Don’t hard-fail; allow fallback/polling to drive UI.
            setError((prev) => prev ?? 'Spotify playback error. Using preview mode.');
          });

          // Not an error - the browser's own autoplay policy refused the
          // /play call below because it didn't originate from a fresh user
          // gesture (e.g. the track was opened by a deep link or navigation,
          // not a click). See the resume-on-next-interaction listener set up
          // where this fires, further down.
          instance.addListener('autoplay_failed', () => {
            setAutoplayBlocked(true);
          });

          const ok = await instance.connect();
          if (!ok) {
            setError('Failed to connect Spotify player. Using preview mode.');
            return;
          }

          playerRef.current = instance;
        }

        // Wait for device id before controlling playback.
        const waitForDevice = async () => {
          const start = Date.now();
          while (!deviceIdRef.current && Date.now() - start < 8000) {
            await new Promise((r) => setTimeout(r, 50));
          }
          return deviceIdRef.current;
        };

        const deviceId = await waitForDevice();
        if (cancelled) return;
        if (!deviceId) {
          setError('Spotify device not ready. Using preview mode.');
          return;
        }
        // The SDK's own `ready` event fires once per player instance, and the
        // player is only constructed for the FIRST track (see `if
        // (!playerRef.current)` above). Every later track therefore had its
        // ready flag cleared by the reset effect with no event left to raise
        // it again, latching "Starting Spotify playback…" on for the rest of
        // the session while playback was in fact fine. Having a live device
        // id in hand is the same fact that event reports, so report it here.
        setReady(true);

        // Transfer playback to this device (required before play calls work reliably).
        const transfer = await spotifyApiFetch(token, '/me/player', {
          method: 'PUT',
          body: JSON.stringify({ device_ids: [deviceId], play: false }),
        });
        if (cancelled) return;
        if (!transfer.ok && transfer.status !== 204) {
          const details = await transfer.json().catch(() => null);
          console.warn('[Spotify Web Player] transfer failed', transfer.status, details);
        }

        // Play the requested track, if the listener actually wants it playing
        // right now. startPlaybackOnce is what keeps a re-run of this effect
        // from replaying a track that is already partway through.
        if (shouldAutoplayRef.current) {
          await startPlaybackOnce(token, deviceId);
          if (cancelled) return;
        }

        // Poll playback state for seekbar sync.
        if (pollRef.current == null) {
          pollRef.current = window.setInterval(async () => {
            const player = playerRef.current;
            if (!player) return;
            const state = await player.getCurrentState().catch(() => null);
            if (!state) return;
            const track = state.track_window?.current_track;
            const artistNames = Array.isArray(track?.artists)
              ? track.artists.map((a: any) => a?.name).filter(Boolean).join(', ')
              : null;
            updatePlaybackState({
              positionMs: state.position ?? 0,
              durationMs: state.duration ?? 0,
              isPlaying: !state.paused,
              trackTitle: track?.name ?? null,
              trackArtist: artistNames,
              trackAlbum: track?.album?.name ?? null,
            });
          }, 500) as unknown as number;
        }
      } catch (e) {
        console.error('[Spotify Web Player] setup failed', e);
        setError('Spotify full playback failed to start. Using preview mode.');
      }
    };

    void start();

    return () => {
      cancelled = true;
    };
    // Deliberately narrow: only a different track, a new play request, a
    // different signed-in user, or a provider switch is a reason to tear down
    // and set the SDK up again. Mute/seek/isPlaying are read from the refs
    // above instead - see the comment where they're declared. `user` is keyed
    // by id rather than by object identity so a background token refresh,
    // which hands back an equal-but-new User object, doesn't restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playRequestId, provider, providerTrackId, uri, user?.id, updatePlaybackState, startPlaybackOnce]);

  // A play press that arrived before the device was ready, and the case of a
  // track opened paused. ProviderControls.play() calls player.resume(), which
  // does nothing on a device that has never been handed this track, and the
  // setup effect above deliberately no longer re-runs when shouldAutoplay
  // flips (that re-run WAS the restart loop). So the first real start for a
  // given play request lands here instead - once, behind the same
  // startedPlayKeyRef, and only while the listener still wants it playing.
  useEffect(() => {
    if (provider !== 'spotify' || !providerTrackId || !uri || !user) return;
    if (isTestEnv) return;
    if (!shouldAutoplay || !ready) return;
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;

    let cancelled = false;
    void (async () => {
      const token = await getValidAccessToken(user.id);
      if (cancelled || !token) return;
      await startPlaybackOnce(token, deviceId);
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, providerTrackId, uri, user, shouldAutoplay, ready, startPlaybackOnce]);

  useEffect(() => {
    if (provider !== 'spotify') return;
    if (seekToSec == null) return;
    // If we're in full playback mode, ProviderControls will handle seek; this is just belt-and-suspenders.
    const player = playerRef.current;
    if (player) {
      void player.seek(Math.max(0, seekToSec * 1000));
    }
    clearSeek();
  }, [provider, seekToSec, clearSeek]);

  useEffect(() => {
    return () => {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      try {
        playerRef.current?.disconnect();
      } catch {
        // ignore
      }
      playerRef.current = null;
      deviceIdRef.current = null;
    };
  }, []);

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
        !ready && <div className="text-[11px] text-white/50">Starting Spotify playback…</div>
      )}
    </div>
  );
}

