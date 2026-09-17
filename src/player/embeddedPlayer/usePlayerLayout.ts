import { useCallback, useEffect, useRef, useState } from 'react';

const LAYOUT_STORAGE_KEY = 'player_layout_v2';

export interface UsePlayerLayoutOptions {
  isCinema: boolean;
  enterCinema: () => void;
  exitCinema: () => void;
}

/**
 * The video/details panel's open state and the chord-readout collapse state
 * (both persisted across sessions), plus the cinema/fullscreen plumbing. The
 * bar itself is always docked full-width to the bottom edge - there's no
 * position/size state left to remember beyond what was left open or collapsed.
 */
export function usePlayerLayout({ isCinema, enterCinema, exitCinema }: UsePlayerLayoutOptions) {
  const cinemaRef = useRef<HTMLDivElement | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  // The chord readout above the bar can be collapsed to reclaim the vertical
  // space it takes (200-350px); the choice sticks across sessions.
  const [hudCollapsed, setHudCollapsed] = useState(false);

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

  // Hydrate/persist whether the details panel was left open and whether the
  // chord readout was left collapsed.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{ showVideo: boolean; hudCollapsed: boolean }>;
      if (typeof parsed.showVideo === 'boolean') setShowVideo(parsed.showVideo);
      if (typeof parsed.hudCollapsed === 'boolean') setHudCollapsed(parsed.hudCollapsed);
    } catch (err) {
      console.warn('Failed to hydrate player layout', err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ showVideo, hudCollapsed }));
    } catch (err) {
      console.warn('Failed to persist player layout', err);
    }
  }, [showVideo, hudCollapsed]);

  useEffect(() => {
    if (!isCinema) return;
    const node = cinemaRef.current;
    if (!node) return;
    if (document.fullscreenElement) return;
    node.requestFullscreen?.().catch(() => {
      exitCinema();
    });
  }, [isCinema, exitCinema]);

  return { cinemaRef, showVideo, setShowVideo, toggleFullscreen, hudCollapsed, setHudCollapsed };
}
