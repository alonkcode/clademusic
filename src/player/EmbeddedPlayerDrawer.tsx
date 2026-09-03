import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { usePlayer } from './PlayerContext';
import { Volume2, VolumeX, Maximize2, X, ChevronDown, ChevronUp, Play, Pause, SkipBack, SkipForward, ListMusic, Repeat } from 'lucide-react';
import { QueueSheet } from './QueueSheet';
import { SpotifyIcon, YouTubeIcon, AppleMusicIcon } from '@/components/QuickStreamButtons';
import { useConnectSpotify } from '@/hooks/api/useSpotifyConnect';
import { useSpotifyConnected } from '@/hooks/api/useSpotifyUser';
import { useTrackSections } from '@/hooks/api/useTrackSections';
import { getSectionDisplayLabel } from '@/lib/sections';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useTrack } from '@/hooks/api/useTracks';
import { useHarmonicFingerprint } from '@/hooks/api/useHarmonicFingerprint';
import { UniversalPlayerHost } from '@/player/universal/UniversalPlayerHost';
import { HarmonicHUD } from '@/components/HarmonicHUD';
import type { SongSection } from '@/types';
import { buildProviderDeepLink } from '@/player/universal/buildEmbedSrc';
import { isTestEnv } from '@/lib/env';

const providerMeta = {
  spotify: { label: 'Spotify', badge: '🎧', color: 'bg-black/90', Icon: SpotifyIcon },
  youtube: { label: 'YouTube', badge: '▶', color: 'bg-black/90', Icon: YouTubeIcon },
  apple_music: { label: 'Apple Music', badge: '', color: 'bg-neutral-900/90', Icon: AppleMusicIcon },
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string | null | undefined) => Boolean(value && UUID_RE.test(value));

const getCadenceLabel = (cadence: string | null | undefined) => {
  if (!cadence) return null;
  if (cadence === 'none') return null;
  return cadence.replace(/_/g, ' ');
};

const describeSectionWhy = (params: {
  sectionLabel: string;
  cadenceType?: string | null;
  isLooping?: boolean;
}) => {
  const { sectionLabel, cadenceType, isLooping } = params;
  const base: Record<string, string> = {
    intro: 'Sets the tonal center and groove.',
    verse: 'Builds tension and sets up the hook.',
    'pre-chorus': 'Ramps into the release.',
    chorus: 'Main hook — usually the most stable resolution.',
    bridge: 'Contrast section — often shifts harmonic color.',
    breakdown: 'Pulls back texture to build anticipation.',
    drop: 'Peak energy release.',
    outro: 'Closure and release.',
  };

  const cadence: Record<string, string> = {
    authentic: 'Strong resolution (authentic cadence).',
    plagal: 'Warm resolution (plagal cadence).',
    deceptive: 'Fake-out resolution (deceptive cadence).',
    half: 'Unresolved — hangs on dominant (half cadence).',
    loop: 'Circular loop — no final cadence.',
    modal: 'Modal harmony — color over functional resolution.',
  };

  const parts: string[] = [];
  if (isLooping) parts.push('Looping enabled.');
  parts.push(base[sectionLabel] ?? 'Section context.');
  if (cadenceType && cadence[cadenceType]) parts.push(cadence[cadenceType]);
  return parts.join(' ');
};

type EmbeddedPlayerDrawerProps = {
  onNext?: () => void;
  onPrev?: () => void;
  canNext?: boolean;
  canPrev?: boolean;
};

/**
 * Hook to animate the seekbar smoothly between provider updates.
 * Syncs to authoritative positionMs on each update while animating locally via RAF.
 */
function useAnimatedSeekbar(
  positionMs: number,
  durationMs: number,
  isPlaying: boolean
): number {
  const [displayMs, setDisplayMs] = useState(positionMs);
  const rafIdRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const lastAuthorityMsRef = useRef<number>(positionMs);
  const durationRef = useRef<number>(durationMs);

  // Re-anchor on the provider's position whenever the bar has drifted away
  // from it. Comparing the new reading against the PREVIOUS READING instead of
  // against what is drawn meant a stalled provider - a YouTube ad, a buffering
  // stall - reported the same position every tick, the comparison saw no
  // change, and the local animation ran away from the real playhead with
  // nothing to pull it back.
  useEffect(() => {
    setDisplayMs((prev) => (Math.abs(positionMs - prev) > 250 ? positionMs : prev));
    lastAuthorityMsRef.current = positionMs;
    lastFrameTimeRef.current = performance.now();
  }, [positionMs]);

  // Clamp display to duration changes to avoid drift beyond track end.
  useEffect(() => {
    durationRef.current = durationMs;
    if (durationMs > 0) {
      setDisplayMs((prev) => Math.min(prev, durationMs));
    }
  }, [durationMs]);

  // When playback stops, snap to authoritative position to stay in sync.
  useEffect(() => {
    if (!isPlaying) {
      setDisplayMs(positionMs);
    }
  }, [isPlaying, positionMs]);

  // Animate forward during playback using RAF
  useEffect(() => {
    if (isTestEnv) return;
    if (!isPlaying) {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return;
    }

    const animate = (now: number) => {
      const elapsed = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      setDisplayMs((prev) => {
        const next = prev + elapsed;
        const limit = durationRef.current;
        return limit > 0 ? Math.min(next, limit) : next;
      });

      rafIdRef.current = requestAnimationFrame(animate);
    };

    lastFrameTimeRef.current = performance.now();
    rafIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isPlaying, durationMs]);

  return displayMs;
}

export function EmbeddedPlayerDrawer({ onNext, onPrev, canNext, canPrev }: EmbeddedPlayerDrawerProps) {
  const {
    provider,
    trackId,
    canonicalTrackId,
    trackTitle,
    trackArtist,
    lastKnownTitle,
    lastKnownArtist,
    positionMs,
    durationMs,
    volume,
    isMuted,
    isOpen,
    isCinema,
    enterCinema,
    exitCinema,
    isPlaying,
    togglePlayPause,
    setVolumeLevel,
    toggleMute,
    seekToMs,
    currentSectionId,
    loopSectionId,
    setCurrentSection,
    setLoopSection,
    closePlayer,
    queue,
    queueIndex,
    playFromQueue,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    shuffleQueue,
    nextTrack,
    previousTrack,
  } = usePlayer();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: isSpotifyConnected } = useSpotifyConnected();
  const connectSpotify = useConnectSpotify();

  const analysisTrackId = !isTestEnv && isUuid(canonicalTrackId) ? canonicalTrackId : undefined;
  const sectionsQuery = useTrackSections(analysisTrackId);
  const sections = useMemo(() => {
    const raw = sectionsQuery.data;
    if (!Array.isArray(raw)) return [];
    return [...raw].sort((a, b) => a.start_ms - b.start_ms);
  }, [sectionsQuery.data]);

  const trackQuery = useTrack(analysisTrackId, !!analysisTrackId);
  const fingerprintQuery = useHarmonicFingerprint(analysisTrackId);
  const harmony = useMemo(() => {
    const track = trackQuery.data ?? null;
    const fingerprint = fingerprintQuery.data ?? null;

    const detectedKey = (fingerprint as any)?.detected_key ?? (track as any)?.detected_key ?? null;
    const detectedMode = (fingerprint as any)?.detected_mode ?? (track as any)?.detected_mode ?? null;
    const cadenceType = (fingerprint as any)?.cadence_type ?? (track as any)?.cadence_type ?? null;
    const confidenceScore =
      typeof (fingerprint as any)?.confidence_score === 'number'
        ? (fingerprint as any).confidence_score
        : typeof (track as any)?.confidence_score === 'number'
          ? (track as any).confidence_score
          : null;

    const fromTrack: string[] = Array.isArray((track as any)?.progression_roman) ? (track as any).progression_roman : [];
    const fromFingerprint: string[] = Array.isArray((fingerprint as any)?.roman_progression)
      ? (fingerprint as any).roman_progression.map((c: any) => c?.numeral).filter(Boolean)
      : [];

    const progression = fromTrack.length ? fromTrack : fromFingerprint;

    return {
      detectedKey,
      detectedMode,
      cadenceType,
      confidenceScore,
      progression,
      bpm: typeof track?.tempo === 'number' ? track.tempo : undefined,
    };
  }, [fingerprintQuery.data, trackQuery.data]);

  // HarmonicHUD - the rotating chord readout - already existed and already
  // does exactly this (chords that advance with real playback position), but
  // only ever got mounted inside the feed's TrackCard. The player itself
  // stays mounted across every route, so that was the whole reason chords
  // never showed up anywhere except the feed. sections needs converting: HUD
  // takes seconds (SongSection), this component's own sections are
  // milliseconds (TrackSection, from track_sections).
  const hudSections: SongSection[] = useMemo(
    () => sections.map((s) => ({ type: s.label, start_time: s.start_ms / 1000, end_time: s.end_ms / 1000 })),
    [sections]
  );

  const safeQueue = Array.isArray(queue) ? queue : [];
  const safeQueueIndex = typeof queueIndex === 'number' ? queueIndex : -1;
  const cinemaRef = useRef<HTMLDivElement | null>(null);
  const autoplay = isPlaying;
  const canSeekInEmbed = true; // Enable seekbar - commit seek immediately to sync positionMs and provider
  const [queueOpen, setQueueOpen] = useState(false);
  const [scrubSec, setScrubSec] = useState<number | null>(null);
  // Docked to the bottom edge, full width, like Spotify's own desktop
  // player - always there while a track is loaded, never dragged or
  // resized around the screen. "Show video" reveals a compact panel above
  // the bar (the "miniplayer") rather than taking over the screen.
  const [showVideo, setShowVideo] = useState(false);
  const layoutStorageKey = 'player_layout_v2';

  const commitSeek = useCallback(
    (sec: number) => {
      if (!Number.isFinite(sec)) return;
      seekToMs(sec * 1000);
      setScrubSec(null);
    },
    [seekToMs]
  );

  const resolvedTitle = trackTitle ?? lastKnownTitle ?? '';
  const resolvedArtist = trackArtist ?? lastKnownArtist ?? '';
  const safeMs = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
  const durationMsSafe = safeMs(durationMs);

  // Use animated seekbar for smooth visual updates
  const animatedPositionMs = useAnimatedSeekbar(safeMs(positionMs), durationMsSafe, isPlaying);
  const positionSec = Math.max(0, animatedPositionMs / 1000);
  const effectivePositionSec = scrubSec ?? positionSec;
  const durationSec = Math.max(0, durationMsSafe / 1000);
  // Until the provider reports a duration there is no scale to draw on. The
  // old fallback (max = the current position) made value equal max, which
  // parked the thumb at the far right of an empty bar the moment playback
  // started anywhere but 0:00.
  const hasDuration = Number.isFinite(durationSec) && durationSec > 0;
  const seekMaxSec = hasDuration ? durationSec : 1;
  const seekStepSec = Math.max(0.01, seekMaxSec / 1200); // finer granularity: ~1200 steps across track
  const seekValueSecRaw = hasDuration ? Math.min(effectivePositionSec, seekMaxSec) : 0;
  const seekValueSec = Number.isFinite(seekValueSecRaw) ? seekValueSecRaw : 0;

  const safeVolume = Number.isFinite(volume) ? volume : 0;
  // Show 0 while muted so the slider matches what is audible, but keep the
  // stored level so unmuting restores it.
  const volumePercent = Math.round((isMuted ? 0 : safeVolume) * 100);
  const isIdle = !isOpen || !provider || !trackId;
  // A queue of >1 does not mean a next track exists - at the last index there
  // is nothing to advance to, which left the button enabled but inert.
  const hasQueueNext =
    (safeQueueIndex >= 0 && safeQueueIndex < safeQueue.length - 1) ||
    (safeQueueIndex === -1 && safeQueue.length > 0);
  const effectiveCanNext = canNext ?? (!isIdle && (hasQueueNext || Boolean(onNext)));
  // Previous is available whenever it can do something: step back, restart the
  // current track, or defer to the host page.
  const effectiveCanPrev = canPrev ?? !isIdle;
  const authoritativePositionMs = safeMs(positionMs);

  const activeSection = useMemo(() => {
    if (!sections.length) return null;
    return sections.find((s) => authoritativePositionMs >= s.start_ms && authoritativePositionMs < s.end_ms) ?? null;
  }, [authoritativePositionMs, sections]);

  const loopSection = useMemo(() => {
    if (!loopSectionId) return null;
    return sections.find((s) => s.id === loopSectionId) ?? null;
  }, [loopSectionId, sections]);

  useEffect(() => {
    if (typeof setCurrentSection !== 'function') return;
    const nextId = activeSection?.id ?? null;
    if (nextId !== currentSectionId) {
      setCurrentSection(nextId);
    }
  }, [activeSection?.id, currentSectionId, setCurrentSection]);

  const lastLoopSeekAtRef = useRef<number>(0);
  useEffect(() => {
    if (!loopSection) return;
    const ms = authoritativePositionMs;
    const thresholdMs = 200;
    if (ms >= loopSection.end_ms - thresholdMs) {
      const now = performance.now();
      if (now - lastLoopSeekAtRef.current > 800) {
        lastLoopSeekAtRef.current = now;
        seekToMs(loopSection.start_ms);
      }
    }
  }, [authoritativePositionMs, loopSection, seekToMs]);

  const meta = useMemo(() => {
    const fallback = { label: 'Now Playing', badge: '♪', color: 'bg-neutral-900/90', Icon: null as React.ComponentType<{ className?: string }> | null };
    return provider ? providerMeta[provider as keyof typeof providerMeta] ?? fallback : fallback;
  }, [provider]);

  const sectionWhy = useMemo(() => {
    if (!activeSection) return null;
    return describeSectionWhy({
      sectionLabel: activeSection.label,
      cadenceType: harmony.cadenceType,
      isLooping: loopSectionId === activeSection.id,
    });
  }, [activeSection, harmony.cadenceType, loopSectionId]);

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleReconnectSpotify = useCallback(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    void connectSpotify.mutateAsync();
  }, [connectSpotify, navigate, user]);

  const toggleFullscreen = useCallback(() => {
    const el = cinemaRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      exitCinema();
    } else {
      el.requestFullscreen?.()
        .then(() => enterCinema())
        .catch(() => {});
    }
  }, [enterCinema, exitCinema]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = !!document.fullscreenElement;
      if (!active) {
        exitCinema();
      } else {
        enterCinema();
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [enterCinema, exitCinema]);

  // Hydrate/persist just whether the details panel was left open - there is
  // no position/size state left to remember now that the bar is always
  // docked full-width to the bottom.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(layoutStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{ showVideo: boolean }>;
      if (typeof parsed.showVideo === 'boolean') setShowVideo(parsed.showVideo);
    } catch (err) {
      console.warn('Failed to hydrate player layout', err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(layoutStorageKey, JSON.stringify({ showVideo }));
    } catch (err) {
      console.warn('Failed to persist player layout', err);
    }
  }, [showVideo]);

  useEffect(() => {
    setScrubSec(null);
  }, [provider, trackId]);

  useEffect(() => {
    if (!isCinema) return;
    const node = cinemaRef.current;
    if (!node) return;
    if (document.fullscreenElement) return;
    node.requestFullscreen?.().catch(() => {
      exitCinema();
    });
  }, [isCinema, exitCinema]);

  // Dev-only assertion: never allow more than one universal player mounted.
  // Skip in tests (React 18 StrictMode can mount/unmount twice in jsdom harness).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isTestEnv) return;
    if (process.env.NODE_ENV === 'production') return;
    const players = document.querySelectorAll('[data-player="universal"]');
    if (players.length > 1) {
      // Prefer not to crash the whole app in dev; log loudly.
      // This typically indicates the player host was mounted twice due to layout/route wiring.
      console.error('Invariant violated: more than one universal player mounted.');
    }
  }, []);

  // Dev guard: ensure only one iframe/provider instance and metadata present
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isTestEnv) return;
    if (process.env.NODE_ENV === 'production') return;
    const frames = document.querySelectorAll('iframe[src*="spotify"], iframe[src*="youtube"]');
    if (frames.length > 1) {
      console.error('Invariant violated: multiple provider iframes detected.');
    }
    if (isOpen && !resolvedTitle) {
      console.error('Invariant violated: player rendered without title.');
    }
  }, [isOpen, resolvedTitle]);

  const handlePrev = useCallback(() => {
    if (isIdle) return;
    if (positionMs > 3000) {
      seekToMs(0);
      return;
    }
    if (safeQueueIndex > 0 && safeQueue.length) {
      playFromQueue(safeQueueIndex - 1);
      return;
    }
    if (safeQueueIndex === -1 && safeQueue.length > 0) {
      playFromQueue(0);
      return;
    }
    if (onPrev) {
      onPrev();
      return;
    }
    seekToMs(0);
  }, [isIdle, positionMs, safeQueueIndex, safeQueue.length, playFromQueue, seekToMs, onPrev]);

  const handleNext = useCallback(() => {
    if (isIdle) return;
    if (safeQueueIndex >= 0 && safeQueueIndex < safeQueue.length - 1) {
      playFromQueue(safeQueueIndex + 1);
      return;
    }
    if (safeQueueIndex === -1 && safeQueue.length > 0) {
      playFromQueue(0);
      return;
    }
    if (onNext) {
      onNext();
    }
  }, [isIdle, safeQueueIndex, safeQueue.length, playFromQueue, onNext]);

  // NOT an early return on isIdle: UniversalPlayerHost mounts a single,
  // persistent <iframe id="universal-player"> that every provider switch
  // reuses via postMessage rather than remounting - CI's own E2E test
  // (tests/universal-player.spec.ts) asserts that iframe exists the moment
  // the page loads, before anything has ever played. Returning null here
  // while idle unmounted it entirely until the first track started, which
  // broke that invariant (every CI run since this file's rewrite failed on
  // exactly that assertion). The visible bar chrome below is still hidden
  // while idle - see `{!isIdle && (...)}` - so there is nothing to look at,
  // same as before; only the always-on iframe host stays mounted.
  const DetailsPanel: any = isTestEnv ? 'div' : motion.div;

  return (
    <>
      {/* Single Interchangeable Player - fixed full-width to the bottom edge,
          like Spotify's own desktop bar: always in the same place, never
          dragged or resized, so it can never end up off-screen or on top of
          whatever the listener was looking at. */}
      <div
        ref={cinemaRef}
        data-player="universal"
        className={`fixed inset-x-0 bottom-0 z-[110] border-t border-border/60 bg-gradient-to-t ${meta.color} shadow-[0_-18px_60px_-30px_rgba(0,0,0,0.75)] backdrop-blur-xl`}
      >
        {/* Details panel: the rotating chord readout, sections, and - for a
            video-capable provider - a small fixed-size "miniplayer" video,
            never full width or full screen. Slides up above the bar; the
            bar itself never moves. */}
        <DetailsPanel
          initial={isTestEnv ? undefined : false}
          {...(isTestEnv
            ? {}
            : {
                animate: { height: showVideo ? 'auto' : 0, opacity: showVideo ? 1 : 0 },
                transition: { duration: 0.2, ease: 'easeOut' },
              })}
          className="overflow-hidden"
          aria-hidden={!showVideo}
        >
          <div className="max-h-[70vh] overflow-y-auto border-b border-border/60 bg-background/95 px-3 py-3 md:px-4">
            <HarmonicHUD
              trackId={canonicalTrackId ?? ''}
              progression={harmony.progression}
              detectedKey={harmony.detectedKey ?? undefined}
              detectedMode={harmony.detectedMode ?? undefined}
              bpm={harmony.bpm}
              sections={hudSections}
            />

            {/* The miniplayer itself: a small, fixed-aspect video box, not a
                resizable/draggable panel - Spotify's bar has no equivalent,
                since it never plays video, but a YouTube track needs
                somewhere to actually show the picture. */}
            <div className="mt-3 flex justify-center">
              <div className="relative w-full max-w-sm overflow-hidden rounded-xl bg-black/80 aspect-video">
                <UniversalPlayerHost
                  request={
                    provider && trackId
                      ? {
                          provider,
                          id: trackId,
                          title: resolvedTitle,
                          artist: resolvedArtist,
                          autoplay,
                        }
                      : null
                  }
                />
              </div>
            </div>

            {sections.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                  {sections.map((section) => {
                    const isActive = currentSectionId === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => {
                          if (typeof setCurrentSection === 'function') {
                            setCurrentSection(section.id);
                          }
                          if (canSeekInEmbed) {
                            seekToMs(section.start_ms);
                            return;
                          }
                          if (provider && trackId) {
                            const url = buildProviderDeepLink(provider, trackId, { startSec: Math.floor(section.start_ms / 1000) });
                            window.open(url, '_blank', 'noopener,noreferrer');
                          }
                        }}
                        className={[
                          'flex-shrink-0 rounded-full px-3 py-1 text-[11px] md:text-xs font-semibold transition border',
                          isActive
                            ? 'bg-primary text-primary-foreground border-primary/50'
                            : 'bg-muted/60 text-muted-foreground border-border/60 hover:bg-muted',
                        ].join(' ')}
                        aria-label={`Jump to ${getSectionDisplayLabel(section.label)}`}
                        title={`Jump to ${getSectionDisplayLabel(section.label)}${sectionWhy && isActive ? ` — ${sectionWhy}` : ''}`}
                      >
                        {getSectionDisplayLabel(section.label)}
                      </button>
                    );
                  })}
                </div>

                {activeSection && (
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof setLoopSection !== 'function') return;
                      const next = loopSectionId === activeSection.id ? null : activeSection.id;
                      setLoopSection(next);
                    }}
                    className={[
                      'inline-flex h-8 w-8 items-center justify-center rounded-full border transition',
                      loopSectionId === activeSection.id
                        ? 'border-primary/50 bg-primary/20 text-primary'
                        : 'border-border/60 bg-muted/60 text-muted-foreground hover:bg-muted',
                    ].join(' ')}
                    aria-label={loopSectionId === activeSection.id ? 'Disable section loop' : 'Loop section'}
                    title={loopSectionId === activeSection.id ? 'Disable section loop' : 'Loop section'}
                  >
                    <Repeat className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </DetailsPanel>

        {/* Bar row - visible whenever a track is loaded. Absent (not just
            visually hidden) while idle, so there's no empty-looking strip
            reserved at the bottom of every page before anything has played;
            the iframe host above keeps mounting regardless (see isIdle
            comment above the DetailsPanel setup). */}
        {!isIdle && (
        <div className="flex items-center gap-2 px-3 py-2 md:gap-3 md:px-4 md:py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/80 text-lg shadow-inner md:h-10 md:w-10">
            {meta.Icon ? <meta.Icon className="h-4 w-4 md:h-5 md:w-5" /> : meta.badge}
          </span>
          <div className="flex min-w-0 flex-col leading-tight" style={{ flexBasis: '9rem' }}>
            {resolvedTitle && (
              <span className="truncate text-xs font-bold text-foreground md:text-sm" aria-label="Track title">{resolvedTitle}</span>
            )}
            {resolvedArtist && (
              <span className="truncate text-[11px] text-muted-foreground md:text-xs" aria-label="Artist name">{resolvedArtist}</span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Previous/next hide below sm - on a narrow phone width there is
                not enough room for badge + title + prev + play + next + seek
                + expand + close all in one non-wrapping row without things
                overlapping; Spotify's own mobile bar drops to just
                play/pause too, leaving prev/next to the expanded view. */}
            <button
              type="button"
              onClick={() => (effectiveCanPrev ? handlePrev() : null)}
              disabled={!effectiveCanPrev}
              className="hidden h-9 w-9 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed sm:inline-flex"
              aria-label="Previous track"
              title="Previous track"
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={togglePlayPause}
              className="inline-flex h-10 w-10 touch-manipulation items-center justify-center rounded-full border-2 border-primary/70 bg-primary/20 text-primary transition hover:border-primary hover:bg-primary hover:text-white"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-4 w-4 md:h-5 md:w-5" /> : <Play className="h-4 w-4 md:h-5 md:w-5" />}
            </button>
            <button
              type="button"
              onClick={() => (effectiveCanNext ? handleNext() : null)}
              disabled={!effectiveCanNext}
              className="hidden h-9 w-9 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed sm:inline-flex"
              aria-label="Next track"
              title="Next track"
            >
              <SkipForward className="h-4 w-4" />
            </button>
          </div>

          {/* Seekbar - takes the remaining space, like Spotify's own bar.
              min-w-[130px] is a real floor (time label + seek track + time
              label at their own minimums), not just min-w-0: a flex-1 item
              with flex-basis 0 gets shrunk before items with an explicit
              basis (the title block) do, so without this floor the seekbar
              - not the title - was the one collapsing, and its own children
              (which never got the memo) kept their size and visually spilled
              into the icon buttons after it. */}
          <div className="flex min-w-[130px] flex-1 items-center gap-2 text-white">
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums md:w-10 md:text-xs" aria-label="Elapsed time">{formatTime(positionSec)}</span>
            <div className="relative min-w-[40px] flex-1">
              {sections.length > 1 && durationMsSafe > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center">
                  {sections.slice(1).map((section) => {
                    const left = Math.min(100, Math.max(0, (section.start_ms / durationMsSafe) * 100));
                    return (
                      <span
                        key={`marker-${section.id}`}
                        className="absolute top-1/2 -translate-y-1/2 h-2 w-px bg-white/40"
                        style={{ left: `${left}%` }}
                        aria-hidden="true"
                      />
                    );
                  })}
                </div>
              )}
              <input
                key={`${provider ?? 'none'}-${trackId ?? 'none'}-seek`}
                type="range"
                min="0"
                max={seekMaxSec}
                step={seekStepSec}
                value={seekValueSec}
                // One commit point, on release - not one per drag tick. Every
                // intermediate `input` event during a drag used to call
                // commitSeek too, and onPointerUp/onMouseUp/onTouchEnd/onClick
                // all fired a second (or third, or fourth) commit for the same
                // physical release, so a single drag issued a burst of
                // overlapping seeks to the embedded player - each one
                // interrupting the last, which is what made this feel
                // laggy/uncontrollable rather than a clean single seek.
                onChange={(e) => {
                  if (!canSeekInEmbed) return;
                  const nextSec = Number(e.target.value);
                  if (!Number.isFinite(nextSec)) return;
                  setScrubSec(nextSec); // visual feedback only while dragging
                }}
                onPointerUp={(e) => {
                  if (!canSeekInEmbed) return;
                  const target = e.currentTarget as HTMLInputElement;
                  const nextSec = Number(target.value);
                  if (!Number.isFinite(nextSec)) return;
                  commitSeek(nextSec);
                }}
                onKeyUp={(e) => {
                  // Arrow-key/Home/End seeking generates no pointer events, so
                  // this is the commit path for keyboard users.
                  if (!canSeekInEmbed) return;
                  const target = e.currentTarget as HTMLInputElement;
                  const nextSec = Number(target.value);
                  if (!Number.isFinite(nextSec)) return;
                  commitSeek(nextSec);
                }}
                disabled={isIdle || !canSeekInEmbed || !hasDuration}
                className="relative z-10 w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5
                         [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full
                         [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
                aria-label="Seek"
              />
            </div>
            <span className="w-9 shrink-0 text-left text-[10px] tabular-nums md:w-10 md:text-xs" aria-label="Total duration">{formatTime(durationSec)}</span>
          </div>

          {/* Secondary controls - collapse on narrow viewports rather than
              wrapping the bar to a second row. */}
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            <button
              onClick={toggleMute}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={volumePercent}
              onChange={(e) => setVolumeLevel(Number(e.target.value) / 100)}
              aria-valuetext={`${volumePercent}%`}
              className="hidden w-20 h-1 bg-white/20 rounded-full appearance-none cursor-pointer md:block
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5
                       [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full
                       [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
              aria-label="Volume"
            />

            {provider === 'spotify' && isSpotifyConnected !== true && (
              <button
                type="button"
                onClick={handleReconnectSpotify}
                className="rounded-full border border-border/60 bg-muted/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:bg-muted"
                aria-label="Reconnect Spotify"
                title="Reconnect Spotify"
              >
                Reconnect
              </button>
            )}

            {showVideo && (
              <button
                type="button"
                onClick={toggleFullscreen}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
                aria-label={isCinema ? 'Exit full screen' : 'Enter full screen'}
                title={isCinema ? 'Exit full screen' : 'Enter full screen'}
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            className="hidden h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground sm:inline-flex"
            aria-label="Show queue"
            title="Show queue"
          >
            <ListMusic className="h-4 w-4" />
          </button>

          {showVideo ? (
            <button
              type="button"
              onClick={() => setShowVideo(false)}
              className="inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
              aria-label="Compact player and hide video"
              title="Hide details"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowVideo(true)}
              className="inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
              aria-label="Show video and expand player"
              title="Show details"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={closePlayer}
            className="inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
            aria-label="Close player"
            title="Close player"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        )}
      </div>

      {/* Queue sheet */}
      <QueueSheet
        open={queueOpen}
        onOpenChange={setQueueOpen}
        queue={safeQueue}
        currentIndex={safeQueueIndex}
        onPlayTrack={(idx) => playFromQueue(idx)}
        onRemoveTrack={(idx) => removeFromQueue(idx)}
        onReorderQueue={reorderQueue}
        onClearQueue={clearQueue}
        onShuffleQueue={shuffleQueue}
      />
    </>
  );
}
