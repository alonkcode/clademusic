import { useEffect, useMemo, useRef } from 'react';
import type { MusicProvider } from '@/types';
import { usePlayer } from '../PlayerContext';
import { buildEmbedSrc, buildProviderDeepLink } from './buildEmbedSrc';
import { createDebouncedScheduler, sameTarget, type PlayTarget } from './switching';

export type UniversalPlayRequest = {
  provider: MusicProvider;
  id: string;
  title?: string | null;
  artist?: string | null;
  autoplay?: boolean;
  startSec?: number;
};

type UniversalPlayerHostProps = {
  request: UniversalPlayRequest | null;
  className?: string;
};

const IFRAME_ID = 'universal-player';

export function focusUniversalPlayerFrame() {
  try {
    const el = document.getElementById(IFRAME_ID);
    if (el && 'focus' in el) (el as HTMLIFrameElement).focus();
  } catch {
    // ignore
  }
}

export function UniversalPlayerHost({ request, className }: UniversalPlayerHostProps) {
  const { registerProviderControls, updatePlaybackState, clearSeek } = usePlayer();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const seqRef = useRef(0);
  const lastScheduledRef = useRef<PlayTarget>(null);

  const baseUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || '/';
  const iframeSrc = useMemo(() => `${baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'}universal-player.html`, [baseUrl]);

  // The embed URL is the identity of a LOAD, so it may only depend on WHICH
  // track is wanted - never on live transport state. autoplay/startSec say how
  // to *start* a load, so they're captured once per track and not read again.
  //
  // The caller passes autoplay={isPlaying}, and universal-player.html relays
  // YouTube's real player state back up into that same isPlaying (see the
  // state-relay effect below). Reading autoplay live therefore closed a loop:
  // YouTube reports buffering -> isPlaying goes false -> autoplay=1 drops out
  // of the URL -> the src differs -> the frame (which dedupes by exact src and
  // hard-unloads to about:blank on any difference) reloads -> it buffers ->
  // repeat. Playback stuttered and restarted from 0:00 continuously, and an
  // ordinary pause reloaded the iframe instead of pausing it. Transport after
  // load doesn't need the URL at all: play/pause/seek go through the
  // postMessage commands registered below, with no reload.
  const trackKey = request ? `${request.provider}:${request.id}` : null;
  const loadIntentRef = useRef<{ key: string | null; autoplay: boolean; startSec?: number }>({
    key: null,
    autoplay: false,
    startSec: undefined,
  });
  if (loadIntentRef.current.key !== trackKey) {
    loadIntentRef.current = {
      key: trackKey,
      autoplay: request?.autoplay === true,
      startSec: request?.startSec,
    };
  }
  const { autoplay: loadAutoplay, startSec: loadStartSec } = loadIntentRef.current;

  const provider = request?.provider ?? null;
  const providerTrackId = request?.id ?? null;

  const target = useMemo<PlayTarget>(() => {
    if (!provider || !providerTrackId) return null;
    const src = buildEmbedSrc(provider, providerTrackId, {
      autoplay: loadAutoplay,
      startSec: loadStartSec,
      youtubeNoCookie: true,
    });
    return { provider, id: providerTrackId, src: src || '' };
  }, [provider, providerTrackId, loadAutoplay, loadStartSec]);

  const deepLink = useMemo(() => {
    if (!provider || !providerTrackId) return null;
    return buildProviderDeepLink(provider, providerTrackId, { startSec: loadStartSec });
  }, [provider, providerTrackId, loadStartSec]);

  const schedulerRef = useRef<ReturnType<typeof createDebouncedScheduler> | null>(null);
  if (!schedulerRef.current && typeof window !== 'undefined') {
    schedulerRef.current = createDebouncedScheduler(200, (payload: any) => {
      const frame = iframeRef.current;
      if (!frame?.contentWindow) return;
      frame.contentWindow.postMessage(payload, window.location.origin);
    });
  }

  useEffect(() => {
    if (!target || !request) return;
    if (!schedulerRef.current) return;

    // If provider has no supported embed, don't attempt to load.
    if (!target.src) return;

    const next = target;
    if (sameTarget(lastScheduledRef.current, next)) return;
    lastScheduledRef.current = next;

    const requestId = ++seqRef.current;
    schedulerRef.current.request({
      type: 'universal-player:play',
      payload: {
        provider: request.provider,
        id: request.id,
        src: next.src,
        deepLink,
        title: request.title ?? null,
        artist: request.artist ?? null,
        requestId,
      },
    });
  }, [request, target, deepLink]);

  // Transport control for whichever provider is loaded in the embed. Without
  // this, seekTo()/togglePlayPause() (e.g. clicking a chorus/verse chip) had
  // nowhere to go for the embed path - there was no registered controller at
  // all, so they silently did nothing. YouTube's embed accepts these once
  // buildEmbedSrc adds enablejsapi=1; Spotify's plain iframe embed has no
  // equivalent public control channel (Premium playback uses the separate
  // Web Playback SDK instead, which registers its own real controls), so
  // seeking there is a deliberate, disclosed no-op rather than a crash.
  useEffect(() => {
    if (!request) return;
    const sendCommand = (command: string, extra?: Record<string, unknown>) => {
      const frame = iframeRef.current;
      if (!frame?.contentWindow) return;
      frame.contentWindow.postMessage({ type: 'universal-player:command', payload: { command, ...extra } }, window.location.origin);
    };
    registerProviderControls(request.provider, {
      play: (startSec) => {
        // Consume the pending seek. PlayerContext hands play() whatever
        // seekToSec still holds, and nothing on this path ever cleared it
        // (only the Spotify providers did), so it stayed set to the last
        // section chip that was tapped for the rest of the track: pause and
        // press play again anywhere later and playback jumped back to that
        // chip instead of resuming where it stopped.
        if (typeof startSec === 'number') {
          sendCommand('seek', { seconds: startSec });
          clearSeek();
        }
        sendCommand('play');
      },
      pause: () => sendCommand('pause'),
      seekTo: (seconds: number) => sendCommand('seek', { seconds }),
      setVolume: (volume: number) => sendCommand('setVolume', { volume }),
      setMute: (muted: boolean) => sendCommand('setMute', { muted }),
      teardown: () => {},
    });
    // Deliberately keyed on request?.provider, not the whole request object:
    // request is a fresh object literal from the caller on every render, and
    // sendCommand always reads the current provider frame through refs, not
    // a captured id/src - re-registering on every unrelated parent re-render
    // would be pure churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.provider, registerProviderControls, clearSeek]);

  // Real state coming back UP from the embed - universal-player.html relays
  // YouTube's own postMessage position/duration/playing-state here (see its
  // "YouTube state relay" comment). Without this, positionMs/durationMs in
  // PlayerContext never moved for any track played through this iframe: the
  // seekbar's apparent motion came entirely from the app's own optimistic
  // RAF extrapolation (useAnimatedSeekbar), which had nothing real to
  // correct against, so duration stayed frozen at 0:00 and the harmonic
  // chord readout never advanced past whatever chord it started on. Guarded
  // by event.source, not just origin: the iframe is same-origin (it's our
  // own static file) but its embedded YouTube child is not the source of
  // same-origin app messages either, so this only reacts to its own relay.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.type !== 'universal-player:state') return;
      const payload = data.payload ?? {};
      updatePlaybackState({
        positionMs: typeof payload.positionMs === 'number' ? payload.positionMs : undefined,
        durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
        isPlaying: typeof payload.isPlaying === 'boolean' ? payload.isPlaying : undefined,
      });
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [updatePlaybackState]);

  const showFallback = Boolean(request && target && !target.src);

  // Nothing loaded yet. The iframe still has to stay mounted - it is a
  // singleton reused across every provider switch, and CI asserts it exists
  // from page load - but it must not paint anything: an empty 16:9 black
  // rectangle sitting on the page before playback is what read as "half a
  // screen black".
  const idle = !request || !target?.src;

  // Only YouTube actually has a picture. Spotify's embed is an audio widget
  // roughly 152px tall; forcing 16:9 on it framed it in tall black letterbox
  // bars above and below the controls, which is the other half of the same
  // complaint.
  const isVideo = request?.provider === 'youtube';
  const frameBox = isVideo ? 'w-full aspect-video' : 'w-full h-[152px]';

  return (
    <div className={[className, idle ? 'h-0 overflow-hidden opacity-0 pointer-events-none' : ''].filter(Boolean).join(' ')}>
      <div className={['relative w-full overflow-hidden rounded-lg border border-white/10', isVideo ? 'bg-black/40' : ''].filter(Boolean).join(' ')}>
        <div className={frameBox}>
          <iframe
            ref={iframeRef}
            id={IFRAME_ID}
            title="Universal player"
            src={iframeSrc}
            className="w-full h-full"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
          />
        </div>
      </div>

      {showFallback && request && (
        <div className="mt-2 text-xs text-white/70 flex items-center justify-between gap-2">
          <span>Embedded playback not available for {request.provider}. Open in provider instead.</span>
          <a
            href={deepLink || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-white/15 bg-white/5 px-2 py-1 text-white/90 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label="Open in provider"
          >
            Open
          </a>
        </div>
      )}

      {/* A "confirm sign-in" hint used to render here unconditionally for
          every Spotify request through this fallback path - regardless of
          whether anything was actually wrong, and with no awareness of the
          app's own auth/connection state, so it showed identically for
          guests, signed-out users, and already-connected accounts alike.
          Removed rather than gated: this component has no real signal that
          playback is actually preview-only (that's a fact about the loaded
          iframe's own internal state, not observable from here), so there
          was no condition to attach that wouldn't just be "always" again.
          The genuine failure case (no embed at all) already has its own
          message just above, in showFallback. */}
    </div>
  );
}
