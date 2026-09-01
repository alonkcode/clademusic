import { useMemo, useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { usePlayer } from './PlayerContext';
import { Volume2, VolumeX, Maximize2, X, ChevronDown, ChevronUp, Play, Pause, SkipBack, SkipForward, ListMusic, RefreshCcw, Repeat, Sparkles, ArrowLeftRight } from 'lucide-react';
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
import { ChordBadge } from '@/components/ChordBadge';
import { UniversalPlayerHost } from '@/player/universal/UniversalPlayerHost';
import { HarmonicHUD } from '@/components/HarmonicHUD';
import type { SongSection } from '@/types';
import { buildProviderDeepLink } from '@/player/universal/buildEmbedSrc';

const providerMeta = {
  spotify: { label: 'Spotify', badge: '🎧', color: 'bg-black/90', Icon: SpotifyIcon },
  youtube: { label: 'YouTube', badge: '▶', color: 'bg-black/90', Icon: YouTubeIcon },
  apple_music: { label: 'Apple Music', badge: '', color: 'bg-neutral-900/90', Icon: AppleMusicIcon },
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
  const isTestEnv =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test') ||
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');
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
  }, [isPlaying, durationMs, isTestEnv]);

  return displayMs;
}

export function EmbeddedPlayerDrawer({ onNext, onPrev, canNext, canPrev }: EmbeddedPlayerDrawerProps) {
  const isTestEnv =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test') ||
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');
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
    isMinimized,
    isMini,
    isCinema,
    miniPosition,
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
    collapseToMini,
    restoreFromMini,
    setMiniPosition,
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
  const [videoScale, setVideoScale] = useState(0.9); // slightly larger, cleaner default for the main player
  const [isScrubbing, setIsScrubbing] = useState(false);
  // The expanded video view now docks small by default - roughly a third of
  // its old ~720px width - rather than opening at full size over whatever
  // the listener was looking at. Still a uniform CSS scale (see the style
  // block below), so every control shrinks proportionally with it instead of
  // wrapping or overflowing; the resize handles can take it back up to full
  // size (or down further) at any time.
  const DEFAULT_PLAYER_SCALE = 0.45;
  const [playerScale, setPlayerScale] = useState(DEFAULT_PLAYER_SCALE);
  const clampPlayerScale = useCallback((scale: number) => Math.min(Math.max(scale, 0.35), 1.3), []);
  const playerWrapperRef = useRef<HTMLDivElement | null>(null);
  const miniContainerRef = useRef<HTMLDivElement | null>(null);
  // Vertical centering for the expanded view needs the panel's own height,
  // kept as a plain number (not a CSS `calc(-50% + ...)` string) precisely so
  // it can share the `y` motion value with drag: framer-motion adds the
  // pointer delta straight to that value's current number while dragging,
  // and has no notion of incrementing a CSS string - a calc() there rendered
  // fine at rest but produced no movement at all once an actual drag
  // started. offsetHeight (not the transform-scaled getBoundingClientRect)
  // because transform-origin is this element's own center: scaling never
  // moves that center point, so centering only has to account for the
  // unscaled layout size, not however large the panel currently renders.
  const [mainPanelHeight, setMainPanelHeight] = useState(0);
  useLayoutEffect(() => {
    const node = playerWrapperRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    // The observer itself reacts to every future size change (mode
    // switches, video showing/hiding, content loading in) without needing
    // any of those listed as effect dependencies - it only needs setting up
    // once, against this stable ref. Layout (not passive) effect so the
    // first measurement lands before paint, not one frame of y=0 after it.
    const observer = new ResizeObserver(() => setMainPanelHeight(node.offsetHeight));
    observer.observe(node);
    setMainPanelHeight(node.offsetHeight);
    return () => observer.disconnect();
  }, []);
  const miniMargin = 8;
  const getDefaultMiniPosition = useCallback(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    // place bottom-right with margin
    return { x: window.innerWidth / 2 - miniMargin - 130, y: -(window.innerHeight / 2 - miniMargin - 90) };
  }, [miniMargin]);
  // Defaults to the compact, bottom-docked bar rather than the big video
  // view. compactPosition already resolves to bottom-right (see
  // getDefaultCompactPosition below); starting expanded instead put a
  // 720px-wide video overlay top-center on every track open, directly over
  // the feed - the "getting in the way" bug. Expanding to video stays an
  // explicit, deliberate action (the "Show video" button).
  const [isCompact, setIsCompact] = useState(true);
  const getDefaultCompactPosition = useCallback(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    const margin = 12;
    const width = 420;
    const height = 180;
    return { x: window.innerWidth - width - margin, y: window.innerHeight - height - margin };
  }, [miniMargin]);
  const [mainPosition, setMainPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [compactPosition, setCompactPosition] = useState<{ x: number; y: number }>(() => getDefaultCompactPosition());
  const [dragBounds, setDragBounds] = useState({ left: -1000, right: 1000, top: -1000, bottom: 1000 });
  const layoutStorageKey = 'player_layout_v1';
  const cookieKey = 'player_positions_v1';
  const readCookie = useCallback((key: string) => {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${key.replace(/[-[\]{}()*+?.,\\^$|#\\s]/g, '\\$&')}=([^;]*)`)
    );
    return match ? decodeURIComponent(match[1]) : null;
  }, []);
  const writeCookie = useCallback((key: string, value: string) => {
    if (typeof document === 'undefined') return;
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
  }, []);
  const clampPositionToBounds = useCallback(
    (pos: { x: number; y: number }) => {
      return {
        x: Math.min(Math.max(pos.x, dragBounds.left), dragBounds.right),
        y: Math.min(Math.max(pos.y, dragBounds.top), dragBounds.bottom),
      };
    },
    [dragBounds]
  );

  const clampScale = useCallback((scale: number) => Math.min(Math.max(scale, 0.3), 1.6), []);
  const commitSeek = useCallback(
    (sec: number) => {
      if (!Number.isFinite(sec)) return;
      seekToMs(sec * 1000);
      setScrubSec(null);
    },
    [seekToMs]
  );

  const restoreToDocked = useCallback(() => {
    // Restore to the small docked bar, not the big video view - "hide" and
    // "redisplay" should be symmetric. Video stays reachable via its own
    // explicit "Show video" action once redisplayed.
    setIsCompact(true);
    setMainPosition({ x: 0, y: 0 });
    restoreFromMini();
  }, [restoreFromMini]);

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
    const el = playerWrapperRef.current;
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

  // Hydrate persisted layout (compact flag + scales)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(layoutStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{ isCompact: boolean; videoScale: number; playerScale: number }>;
      if (typeof parsed.isCompact === 'boolean') setIsCompact(parsed.isCompact);
      if (Number.isFinite(parsed.videoScale)) setVideoScale(clampScale(parsed.videoScale!));
      if (Number.isFinite(parsed.playerScale)) setPlayerScale(clampPlayerScale(parsed.playerScale!));
    } catch (err) {
      console.warn('Failed to hydrate player layout', err);
    }
  }, [clampPlayerScale, clampScale]);

  // Persist layout whenever it changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload = JSON.stringify({ isCompact, videoScale, playerScale });
    try {
      localStorage.setItem(layoutStorageKey, payload);
    } catch (err) {
      console.warn('Failed to persist player layout', err);
    }
  }, [isCompact, videoScale, playerScale]);

  const clampCompactPosition = useCallback(
    (pos: { x: number; y: number }) => {
      if (typeof window === 'undefined') return pos;
      const rect = playerWrapperRef.current?.getBoundingClientRect();
      const width = rect?.width ?? 420;
      const height = rect?.height ?? 180;
      const margin = 12;
      const maxX = Math.max(margin, window.innerWidth - width - margin);
      const maxY = Math.max(margin, window.innerHeight - height - margin);
      return {
        x: Math.min(Math.max(pos.x, margin), maxX),
        y: Math.min(Math.max(pos.y, margin), maxY),
      };
    },
    []
  );

  const clampMiniPosition = useCallback(
    (pos: { x: number; y: number }) => {
      if (typeof window === 'undefined') return pos;
      const rect = miniContainerRef.current?.getBoundingClientRect();
      const width = rect?.width ?? 260;
      const height = rect?.height ?? 120;
      const minX = -(window.innerWidth - width - miniMargin);
      const maxX = window.innerWidth - miniMargin;
      const minY = -(window.innerHeight - height - miniMargin);
      const maxY = window.innerHeight - miniMargin;
      return {
        x: Math.min(Math.max(pos.x, minX), maxX),
        y: Math.min(Math.max(pos.y, minY), maxY),
      };
    },
    [miniMargin]
  );

  // Hydrate positions from cookie
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = readCookie(cookieKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        mainPosition: { x: number; y: number };
        compactPosition: { x: number; y: number };
        miniPosition: { x: number; y: number };
      }>;
      if (parsed.mainPosition) {
        const p = parsed.mainPosition;
        // Main/video position is anchored bottom-center, not top-left, so it
        // cannot be viewport-clamped the same simple way; a value this far out
        // can only be corrupt or from a very different screen, so drop it.
        setMainPosition(Math.abs(p.x) > 2000 || Math.abs(p.y) > 2000 ? { x: 0, y: 0 } : p);
      }
      if (parsed.compactPosition) setCompactPosition(clampCompactPosition(parsed.compactPosition));
      if (parsed.miniPosition) setMiniPosition(clampMiniPosition(parsed.miniPosition));
    } catch (err) {
      console.warn('Failed to hydrate player positions', err);
    }
  }, [readCookie, clampCompactPosition, clampMiniPosition]);

  // Persist positions to cookie
  useEffect(() => {
    const payload = JSON.stringify({ mainPosition, compactPosition, miniPosition });
    writeCookie(cookieKey, payload);
  }, [compactPosition, mainPosition, miniPosition, writeCookie]);

  useEffect(() => {
    setScrubSec(null);
  }, [provider, trackId]);

  const computeDragBounds = useCallback(() => {
    if (typeof window === 'undefined') {
      return { left: -1000, right: 1000, top: -1000, bottom: 1000 };
    }
    const node = playerWrapperRef.current;
    if (!node) return { left: -1000, right: 1000, top: -1000, bottom: 1000 };
    const rect = node.getBoundingClientRect();
    const margin = 8;
    return {
      left: -rect.left + margin,
      right: window.innerWidth - rect.right - margin,
      top: -rect.top + margin,
      bottom: window.innerHeight - rect.bottom - margin,
    };
  }, []);

  const setDragBoundsIfChanged = useCallback(() => {
    const next = computeDragBounds();
    setDragBounds((prev) => {
      if (
        prev.left === next.left &&
        prev.right === next.right &&
        prev.top === next.top &&
        prev.bottom === next.bottom
      ) {
        return prev;
      }
      return next;
    });
  }, [computeDragBounds]);

  // Recenter positions when viewport changes
  useEffect(() => {
    const onResize = () => {
      setDragBoundsIfChanged();
      setCompactPosition((prev) => clampCompactPosition(prev));
      if (!isCompact && !isMini) {
        setMainPosition((prev) => clampPositionToBounds(prev));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampCompactPosition, clampPositionToBounds, isCompact, isMini, setDragBoundsIfChanged]);

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
    const isTestEnv =
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test') ||
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');
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
    const isTestEnv =
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test') ||
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');
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

  useLayoutEffect(() => {
    setDragBoundsIfChanged();
  }, [isMini, isCompact, mainPosition, compactPosition, miniPosition, playerScale, setDragBoundsIfChanged, videoScale]);

  useEffect(() => {
    if (isMini) {
      setMiniPosition((prev) => clampMiniPosition(prev));
      return;
    }
    if (isCompact) {
      setCompactPosition((prev) => clampCompactPosition(prev));
      return;
    }
    // Deliberately not clamping mainPosition here (the expanded/main view).
    // dragBounds is derived from the panel's own measured rect, and right at
    // this transition that rect can still reflect the previous mode's
    // transform for a frame - framer-motion applies x/y/scale outside
    // React's own commit, so this effect (which runs the instant the mode
    // flips) can read a rect that mixes the NEW css classes with the OLD
    // transform. That stale reading is what threw mainPosition hundreds of
    // pixels off and pushed the expanded panel almost entirely off-screen.
    // Unlike compact/mini, expanded's anchor (top-1/2 right-4) is valid on
    // its own at the default {x:0,y:0} regardless of viewport size, so
    // clamping on this specific transition was never actually needed - only
    // the real resize handler (below) has to correct it, and that fires from
    // a stable, already-settled layout.
  }, [clampCompactPosition, clampMiniPosition, isCompact, isMini]);

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

  // Player shell resize: 8 handles, uniform scale.
  //
  // Driven by pointer events with explicit pointer capture, not the previous
  // window-level mousemove/mouseup pair. The player's body is almost entirely
  // a Spotify/YouTube iframe, and once the cursor crosses into it during a
  // drag, the PARENT page stops receiving mouse events at all - they belong to
  // the iframe's own document now. The old listeners never saw the eventual
  // mouseup, so playerResizeActiveRef stayed stuck true and any later mouse
  // movement (button up or not - it was never checked) kept resizing. Pointer
  // capture routes every event for this gesture straight to the handle
  // regardless of what is visually underneath it, which is exactly what a
  // drag that sweeps across an iframe needs.
  // Whole-panel drag is opt-in per gesture (dragListener: false on PlayerRoot
  // below), started only from the header. Framer-motion's own drag-start
  // listener attaches directly to PlayerRoot's DOM node and can fire before
  // React's synthetic events on a descendant even get a chance to run
  // (let alone call stopPropagation in time) - no amount of stopPropagation
  // on the resize handles or the seekbar reliably kept it from also engaging
  // on every one of their pointerdowns, which is what made a resize
  // occasionally also drag the whole player, or the transform reset
  // outright mid-gesture. Restricting where a drag can even start removes
  // the race instead of trying to out-run it.
  const dragControls = useDragControls();
  const resizeGestureRef = useRef<{ startScale: number; startDist: number; cx: number; cy: number } | null>(null);

  const beginPlayerResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = playerWrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Pointer capture isn't universal (missing in some embedded WebViews,
      // and in jsdom) - fall back to plain event handlers rather than throw.
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      resizeGestureRef.current = {
        startScale: playerScale,
        startDist: Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy)),
        cx,
        cy,
      };
    },
    [playerScale]
  );

  const movePlayerResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const gesture = resizeGestureRef.current;
      if (!gesture) return;
      // Scale from distance-to-center rather than the handle's own axis, so
      // every handle - corner or edge - answers to "drag away from the
      // player to grow it, toward it to shrink it," regardless of which side
      // it sits on.
      const dist = Math.max(1, Math.hypot(e.clientX - gesture.cx, e.clientY - gesture.cy));
      setPlayerScale(clampPlayerScale(gesture.startScale * (dist / gesture.startDist)));
    },
    [clampPlayerScale]
  );

  const endPlayerResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    resizeGestureRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
  }, []);

  type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  const RESIZE_HANDLES: { pos: HandlePos; cursor: string; hit: string; mark: string; label: string }[] = [
    { pos: 'nw', cursor: 'nwse-resize', hit: 'top-0 left-0 h-5 w-5', mark: 'top-1 left-1 h-2.5 w-2.5 rounded-tl', label: 'top left' },
    { pos: 'n', cursor: 'ns-resize', hit: 'top-0 left-1/2 -translate-x-1/2 h-3 w-12', mark: 'top-1 inset-x-2 h-1 rounded-full', label: 'top' },
    { pos: 'ne', cursor: 'nesw-resize', hit: 'top-0 right-0 h-5 w-5', mark: 'top-1 right-1 h-2.5 w-2.5 rounded-tr', label: 'top right' },
    { pos: 'e', cursor: 'ew-resize', hit: 'top-1/2 right-0 -translate-y-1/2 h-12 w-3', mark: 'right-1 inset-y-2 w-1 rounded-full', label: 'right' },
    { pos: 'se', cursor: 'nwse-resize', hit: 'bottom-0 right-0 h-5 w-5', mark: 'bottom-1 right-1 h-2.5 w-2.5 rounded-br', label: 'bottom right' },
    { pos: 's', cursor: 'ns-resize', hit: 'bottom-0 left-1/2 -translate-x-1/2 h-3 w-12', mark: 'bottom-1 inset-x-2 h-1 rounded-full', label: 'bottom' },
    { pos: 'sw', cursor: 'nesw-resize', hit: 'bottom-0 left-0 h-5 w-5', mark: 'bottom-1 left-1 h-2.5 w-2.5 rounded-bl', label: 'bottom left' },
    { pos: 'w', cursor: 'ew-resize', hit: 'top-1/2 left-0 -translate-y-1/2 h-12 w-3', mark: 'left-1 inset-y-2 w-1 rounded-full', label: 'left' },
  ];

  const snapCompactToCorner = useCallback(() => {
    if (typeof window === 'undefined') return;
    const rect = playerWrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 12;
    const targets = [
      { x: margin, y: margin }, // top-left (kept for completeness)
      { x: window.innerWidth - rect.width - margin, y: margin }, // top-right
      { x: margin, y: window.innerHeight - rect.height - margin }, // bottom-left
      { x: window.innerWidth - rect.width - margin, y: window.innerHeight - rect.height - margin }, // bottom-right
    ];
    let best = targets[0];
    let bestDist = Infinity;
    const current = { x: rect.left, y: rect.top };
    for (const t of targets) {
      const d = (t.x - current.x) ** 2 + (t.y - current.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    setCompactPosition(best);
  }, []);

  useEffect(() => {
    if (isMini) {
      setIsCompact(false);
    }
  }, [provider]);

  const PlayerRoot: any = isTestEnv ? 'div' : motion.div;
  const VideoPanel: any = isTestEnv ? 'div' : motion.div;

  return (
    <>
      {/* Single Interchangeable Player - stays mounted for compact & mini so playback never stops */}
      <PlayerRoot
        ref={(node) => {
          playerWrapperRef.current = node;
          miniContainerRef.current = node;
          cinemaRef.current = node;
        }}
        {...(isTestEnv
          ? {}
          : {
              drag: isMini || !isScrubbing,
              // Only the header (badge/title area, not its buttons) can
              // start a drag now - see the comment on dragControls above.
              dragListener: false,
              dragControls,
              dragConstraints: dragBounds,
              dragElastic: 0.15,
              // No `y` here (it used to be a same-value 0->0 pair, doing
              // nothing animation-wise): framer-motion gives an `animate`
              // target ownership of a motion value over a plain `style`
              // value for the same key, so a y ever mentioned here - even at
              // 0 - silently overrode the real centering value below,
              // collapsing it to nothing on every mode change.
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              exit: { opacity: 0 },
              transition: { duration: 0.2, ease: 'easeOut' },
            })}
        onDragEnd={(_, info) => {
          if (isMini) {
            const next = { x: miniPosition.x + info.offset.x, y: miniPosition.y + info.offset.y };
            setMiniPosition(clampMiniPosition(next));
          } else if (isCompact) {
            const next = { x: compactPosition.x + info.offset.x, y: compactPosition.y + info.offset.y };
            setCompactPosition(clampCompactPosition(next));
            requestAnimationFrame(snapCompactToCorner);
          } else {
            const next = { x: mainPosition.x + info.offset.x, y: mainPosition.y + info.offset.y };
            setMainPosition(next);
          }
        }}
        data-player="universal"
        aria-hidden={isMini}
        className={`fixed z-[110] ${isMini ? 'pointer-events-none opacity-0' : 'pointer-events-auto'} ${
          isMini
            ? 'top-0 left-1/2 -translate-x-1/2 w-[min(720px,calc(100vw-32px))]'
            : isCompact
              ? 'top-0 left-0 translate-x-0 w-[min(460px,90vw)]'
              // Docked to the right edge, vertically centered, rather than
              // spanning bottom-center: expanding to watch the video stays
              // available, but it no longer sits over the feed header/content
              // (bottom-center) or the harmonic/chords readout on the card
              // beneath it (which the old full-width overlay could reach).
              //
              // No -translate-y-1/2 utility here: framer-motion writes x/y/
              // scale as one inline `transform`, which completely replaces
              // (not merges with) a transform coming from a Tailwind class
              // on the same element - the -50% centering was silently
              // discarded, and the panel rendered with its TOP edge at
              // vertical-center instead of being centered there, pushing
              // most of a fairly tall panel below the fold. The centering
              // travels inside the y value itself instead (below) - as a
              // plain number derived from the panel's own measured height,
              // not a CSS calc() string, since framer-motion's drag needs a
              // number it can add pixels to live.
              : 'top-1/2 right-4 w-[92vw] max-w-[720px] max-h-[calc(100dvh-6rem)] overflow-y-auto'
        }`}
        style={{
          scale: isMini ? 0.9 : isCompact ? 0.7 : playerScale,
          // Scaling from the right edge keeps that edge docked in place at
          // any size - shrinking (or the resize handles growing it back)
          // reads as "the right side stays put," not "it drifts around."
          transformOrigin: isMini ? 'center' : isCompact ? 'top left' : 'center right',
          x: isMini ? -2000 : isCompact ? compactPosition.x : mainPosition.x,
          y: isMini
            ? -2000
            : isCompact
              ? compactPosition.y
              : mainPosition.y - mainPanelHeight / 2,
          visibility: isMini ? 'hidden' : 'visible',
        }}
      >
        <div className={`relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br ${meta.color} shadow-[0_18px_60px_-30px_rgba(0,0,0,0.75)] backdrop-blur-xl`}>
          {/* Header - Always visible, compact on mobile. The badge/title area
              (not the button row after it) is the drag handle: with
              dragListener off, only an explicit dragControls.start() call
              can begin moving the panel, so its own controls - and every
              other interactive element in the panel - can never accidentally
              trigger a drag just by being pressed. */}
          <div className="flex items-center gap-3 px-3 py-2.5 md:px-5 md:py-3 bg-background/80 backdrop-blur">
            <div
              className="flex items-center gap-3 flex-1 min-w-0 cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={(e) => dragControls.start(e)}
            >
              {/* The provider's real logo, not the old emoji badge: YouTube's
                  was a bare "▶" in a circular tile - indistinguishable from
                  an actual play button, and the only provider indicator
                  visible at all below the sm breakpoint, where the labelled
                  icon+text badge just beneath this is hidden. */}
              <span className="flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-full bg-background/80 text-lg md:text-xl shadow-inner">
                {meta.Icon ? <meta.Icon className="h-4 w-4 md:h-5 md:w-5" /> : meta.badge}
              </span>
              {meta.Icon && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 text-white text-[10px] md:text-xs shadow-inner">
                  <meta.Icon className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  <span className="font-semibold tracking-tight">{meta.label}</span>
                </span>
              )}
              <div className="flex flex-col leading-tight flex-1 min-w-0">
                <span className="text-[9px] md:text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80 font-medium">Now Playing</span>
                {resolvedTitle && (
                  <span className="text-xs md:text-sm font-bold text-foreground truncate" aria-label="Track title">{resolvedTitle}</span>
                )}
                {resolvedArtist && (
                  <span className="text-[11px] md:text-xs text-muted-foreground truncate" aria-label="Artist name">{resolvedArtist}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setQueueOpen(true)}
                className="inline-flex h-9 w-9 md:h-9 md:w-9 touch-manipulation items-center justify-center rounded-full border border-border/70 bg-muted/60 text-muted-foreground transition hover:border-border hover:bg-background hover:text-foreground"
                aria-label="Show queue"
                title="Show queue"
              >
                <ListMusic className="h-3.5 w-3.5 md:h-4 md:w-4" />
              </button>
              <button
                type="button"
                onClick={() => (effectiveCanPrev ? handlePrev() : null)}
                disabled={!effectiveCanPrev}
                className="inline-flex h-10 w-10 md:h-10 md:w-10 touch-manipulation items-center justify-center rounded-full border border-border/70 bg-muted/60 text-muted-foreground transition hover:border-border hover:bg-background hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Previous track"
                title="Previous track"
              >
                <SkipBack className="h-4 w-4 md:h-5 md:w-5" />
              </button>
              <button
                type="button"
                onClick={togglePlayPause}
                className="inline-flex h-10 w-10 md:h-10 md:w-10 touch-manipulation items-center justify-center rounded-full border-2 border-primary/70 bg-primary/20 text-primary transition hover:border-primary hover:bg-primary hover:text-white"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="h-4 w-4 md:h-5 md:w-5" /> : <Play className="h-4 w-4 md:h-5 md:w-5" />}
              </button>
              {isCompact && (
                <button
                  type="button"
                  onClick={() => {
                    setIsCompact(false);
                  }}
                  className="inline-flex h-9 w-9 md:h-9 md:w-9 touch-manipulation items-center justify-center rounded-full border border-border/70 bg-muted/60 text-muted-foreground transition hover:border-border hover:bg-background hover:text-foreground"
                  aria-label="Show video and expand player"
                  title="Show video"
                >
                  <ChevronUp className="h-3 w-3 md:h-4 md:w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => (effectiveCanNext ? handleNext() : null)}
                disabled={!effectiveCanNext}
                className="inline-flex h-10 w-10 md:h-10 md:w-10 touch-manipulation items-center justify-center rounded-full border border-border/70 bg-muted/60 text-muted-foreground transition hover:border-border hover:bg-background hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Next track"
                title="Next track"
              >
                <SkipForward className="h-4 w-4 md:h-5 md:w-5" />
              </button>
              {!isCompact && (
                <button
                  type="button"
                  onClick={() => {
                    setIsCompact(true);
                  }}
                  className="inline-flex h-9 w-9 md:h-9 md:w-9 touch-manipulation items-center justify-center rounded-full border border-border/70 bg-muted/60 text-muted-foreground transition hover:border-border hover:bg-background hover:text-foreground"
                  aria-label="Compact player and hide video"
                  title="Compact (hide video)"
                >
                  <ChevronDown className="h-3 w-3 md:h-4 md:w-4" />
                </button>
              )}
              {/* Nothing to fullscreen while the video panel itself is hidden
                  in compact mode - decluttering the docked bar's icon row. */}
              {!isCompact && (
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="inline-flex h-9 w-9 md:h-9 md:w-9 touch-manipulation items-center justify-center rounded-full border border-border/70 bg-muted/60 text-muted-foreground transition hover:border-border hover:bg-background hover:text-foreground"
                  aria-label={isCinema ? 'Exit full screen' : 'Enter full screen'}
                  title={isCinema ? 'Exit full screen' : 'Enter full screen'}
                >
                  <Maximize2 className="h-3 w-3 md:h-4 md:w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  // Hide to the small mini pill, but keep playback alive.
                  // Leaves the docked bar as the state underneath, so if
                  // anything renders mid-transition it's the small bar, not
                  // the big video view.
                  setIsCompact(true);
                  const targetPos = clampMiniPosition(getDefaultMiniPosition());
                  setMiniPosition(targetPos);
                  collapseToMini();
                }}
                className="inline-flex h-9 w-9 md:h-9 md:w-9 touch-manipulation items-center justify-center rounded-full border border-border/70 bg-muted/60 text-muted-foreground transition hover:border-border hover:bg-background hover:text-foreground"
                aria-label="Hide player"
                title="Hide player"
              >
                <X className="h-3 w-3 md:h-4 md:w-4" />
              </button>
            </div>
          </div>

          {/* Rotating chord readout - available on whatever page the
              listener is on, not just the feed, since this player is what's
              mounted everywhere. Skipped in the default compact bar, which
              is deliberately kept small; expanding (one tap, always
              available) has the room for it. Renders nothing on its own
              when there's no stored progression for this track. */}
          {!isCompact && !isMini && (
            <div className="px-3 pt-3 md:px-4">
              <HarmonicHUD
                trackId={canonicalTrackId ?? ''}
                progression={harmony.progression}
                detectedKey={harmony.detectedKey ?? undefined}
                detectedMode={harmony.detectedMode ?? undefined}
                bpm={harmony.bpm}
                sections={hudSections}
              />
            </div>
          )}

          {/* Embedded playback surface (singleton universal iframe) */}
          <VideoPanel
            initial={isTestEnv ? undefined : false}
            {...(isTestEnv
              ? {}
              : {
                  animate: {
                    height: provider && trackId && !isCompact ? 'auto' : 0,
                    opacity: provider && trackId && !isCompact ? 1 : 0,
                  },
                  transition: { duration: 0.25, ease: 'easeOut' },
                })}
            className="overflow-hidden bg-black/80"
            aria-hidden={!provider || !trackId || isCompact}
          >
            <div className="relative flex justify-center px-2 py-2">
              <div
                className="w-full sm:w-auto relative"
                style={{
                  width:
                    provider === 'youtube'
                      ? `${Math.min(Math.max(videoScale * 100, 30), 160)}%`
                      : '100%',
                  maxWidth: '100%',
                  transition: 'width 120ms ease',
                }}
              >
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
          </VideoPanel>

          {/* Compact Controls Row: Seekbar + Volume inline */}
          <div className="flex items-center gap-2 px-3 pb-3 md:px-4 md:pb-4 text-white">
            <span className="text-[10px] md:text-xs tabular-nums w-12 text-right" aria-label="Elapsed time">{formatTime(positionSec)}</span>
            <div className="relative flex-1 min-w-[80px]">
              {!isMini && sections.length > 1 && durationMsSafe > 0 && (
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
                onMouseDownCapture={(e) => e.stopPropagation()}
                onTouchStartCapture={(e) => e.stopPropagation()}
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
                onPointerDown={(e) => {
                  // Stopping propagation here (not in a separate
                  // onPointerDownCapture on this same node) matters: React
                  // short-circuits its whole dispatch list once
                  // stopPropagation is called, so a capture-phase handler on
                  // this exact element previously skipped this bubble-phase
                  // one entirely - the drag-start (setIsScrubbing) below
                  // never ran, and the seek thumb was fighting the whole
                  // player panel's own drag-to-reposition gesture on every
                  // scrub. This still shields that ancestor gesture (the
                  // underlying native event's own stopPropagation is what
                  // framer-motion's listener respects), while also actually
                  // running.
                  e.stopPropagation();
                  if (!canSeekInEmbed) return;
                  const target = e.currentTarget as HTMLInputElement;
                  const nextSec = Number(target.value);
                  if (!Number.isFinite(nextSec)) return;
                  setScrubSec(nextSec);
                  setIsScrubbing(true);
                }}
                onPointerUp={(e) => {
                  if (!canSeekInEmbed) return;
                  const target = e.currentTarget as HTMLInputElement;
                  const nextSec = Number(target.value);
                  if (!Number.isFinite(nextSec)) return;
                  commitSeek(nextSec);
                  setIsScrubbing(false);
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
            <span className="text-[10px] md:text-xs tabular-nums w-12 text-left" aria-label="Total duration">{formatTime(durationSec)}</span>

            <button
              onClick={toggleMute}
              className="inline-flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white/95 transition hover:border-white/50 hover:bg-white/20"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="h-5 w-5 md:h-6 md:w-6" /> : <Volume2 className="h-5 w-5 md:h-6 md:w-6" />}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={volumePercent}
              onPointerDownCapture={(e) => e.stopPropagation()}
              onMouseDownCapture={(e) => e.stopPropagation()}
              onTouchStartCapture={(e) => e.stopPropagation()}
              onChange={(e) => setVolumeLevel(Number(e.target.value) / 100)}
              aria-valuetext={`${volumePercent}%`}
              className="w-20 md:w-28 h-1 bg-white/20 rounded-full appearance-none cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 
                       [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full 
                       [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
              aria-label="Volume"
            />

            {provider === 'spotify' && isSpotifyConnected !== true && (
              <button
                type="button"
                onClick={handleReconnectSpotify}
                className="rounded-full border border-white/30 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/90 transition hover:border-white/60 hover:bg-white/20"
                aria-label="Reconnect Spotify"
                title="Reconnect Spotify"
              >
                Reconnect Spotify
              </button>
            )}

            {provider === 'youtube' && (
              <>
                <button
                  onClick={() => setVideoScale(1)}
                  className="p-1.5 text-white/80 hover:text-white transition-colors rounded"
                  aria-label="Reset video size"
                  title="Reset video size"
                >
                  <RefreshCcw className="w-3.5 h-3.5 md:w-4 md:h-4" />
                </button>
              </>
            )}
          </div>

          {!isMini && !isCompact && sections.length > 0 && (
            <div className="px-3 pb-3 md:px-4 md:pb-4">
              <div className="flex items-center gap-2">
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
                            : 'bg-white/10 text-white/85 border-white/15 hover:bg-white/15',
                        ].join(' ')}
                        aria-label={`Jump to ${getSectionDisplayLabel(section.label)}`}
                        title={`Jump to ${getSectionDisplayLabel(section.label)}`}
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
                        ? 'border-primary/50 bg-primary/20 text-primary-foreground'
                        : 'border-white/20 bg-white/10 text-white/90 hover:bg-white/15 hover:border-white/35',
                    ].join(' ')}
                    aria-label={loopSectionId === activeSection.id ? 'Disable section loop' : 'Loop section'}
                    title={loopSectionId === activeSection.id ? 'Disable section loop' : 'Loop section'}
                  >
                    <Repeat className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}
          {/* Resize handles on all four corners and edges, not just the one
              corner - dragging any of them grows or shrinks the player by
              scale, toward or away from its center. */}
          {!isMini && !isCompact && RESIZE_HANDLES.map((h) => (
            <div
              key={h.pos}
              className={`group absolute z-20 touch-none outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${h.hit}`}
              style={{ cursor: h.cursor }}
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault();
                // Stop the whole-player drag (framer-motion's own native
                // pointerdown listener on an ancestor) from also starting.
                // This has to happen inside the SAME bubble-phase handler
                // that begins the resize, not a separate capture-phase one on
                // this node - React short-circuits its own dispatch once
                // stopPropagation is called, so an earlier capture listener
                // here previously skipped this handler entirely.
                e.stopPropagation();
                beginPlayerResize(e);
              }}
              onPointerMove={movePlayerResize}
              onPointerUp={endPlayerResize}
              onPointerCancel={endPlayerResize}
              onLostPointerCapture={endPlayerResize}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setPlayerScale(1);
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  setPlayerScale((prev) => clampPlayerScale(prev + 0.05));
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setPlayerScale((prev) => clampPlayerScale(prev - 0.05));
                }
              }}
              title={`Drag to resize (${h.label}) - Enter to reset`}
              aria-label={`Resize player from the ${h.label}`}
            >
              {/* Visible affordance for an otherwise invisible hit target -
                  faint at rest, brighter on hover/focus so the handle reads
                  as grabbable before the cursor even changes. */}
              <div
                className={`pointer-events-none absolute bg-white/40 transition-colors group-hover:bg-white/80 group-focus-visible:bg-white/80 ${h.mark}`}
              />
            </div>
          ))}
        </div>
      </PlayerRoot>

      {isMini && (
        <motion.div
          drag
          dragElastic={0.2}
          dragConstraints={{ left: -1000, right: 1000, top: -1000, bottom: 1000 }}
          onDragEnd={(_, info) => {
            const next = { x: miniPosition.x + info.offset.x, y: miniPosition.y + info.offset.y };
            setMiniPosition(clampMiniPosition(next));
          }}
          style={{ x: miniPosition.x, y: miniPosition.y }}
          role="region"
          aria-label="Mini player"
          aria-live="polite"
          className="pointer-events-auto fixed bottom-4 right-4 z-[110] w-[260px] max-w-[85vw] rounded-xl border border-border/60 bg-neutral-900/90 shadow-2xl backdrop-blur-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        >
          <div className="flex items-center justify-between px-3 pt-2 gap-2">
            <div className="flex flex-col min-w-0">
              {resolvedTitle && <span className="text-sm font-semibold text-white truncate" aria-label="Mini player track title">{resolvedTitle}</span>}
              {resolvedArtist && <span className="text-xs text-white/70 truncate" aria-label="Mini player artist">{resolvedArtist}</span>}
            </div>
            <button
              type="button"
              onClick={restoreToDocked}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label="Show player"
              title="Show player"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>

          {/* The mini pill is the fallback for "player is off-screen or in the
              way" - it needs the same easy transport as the docked bar, not
              just play/pause, or a listener who collapses to it loses control
              of the track entirely. */}
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-2.5">
            <button
              type="button"
              onClick={() => (effectiveCanPrev ? handlePrev() : null)}
              disabled={!effectiveCanPrev}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous track"
              title="Previous track"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={togglePlayPause}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-primary/60 bg-primary/25 text-white hover:bg-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => (effectiveCanNext ? handleNext() : null)}
              disabled={!effectiveCanNext}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next track"
              title="Next track"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={toggleMute}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={volumePercent}
              onChange={(e) => setVolumeLevel(Number(e.target.value) / 100)}
              onPointerDownCapture={(e) => e.stopPropagation()}
              className="flex-1 h-1 min-w-[40px] accent-primary cursor-pointer"
              aria-label="Volume"
            />
          </div>
        </motion.div>
      )}

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
