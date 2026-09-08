import { useEffect, useMemo, useRef } from 'react';
import type { TrackSection } from '@/types';
import { describeSectionWhy } from './constants';

export interface UseActiveSectionOptions {
  sections: TrackSection[];
  /** Real playback position in ms, already clamped non-negative. */
  positionMs: number;
  currentSectionId: string | null | undefined;
  setCurrentSection?: (id: string | null) => void;
  loopSectionId: string | null | undefined;
  seekToMs: (ms: number) => void;
  cadenceType?: string | null;
}

/**
 * Which section is currently playing, which one (if any) is looped - and,
 * while one is, auto-seeking back to its start just before it ends - plus
 * the "why does this section matter" tooltip copy for the active one.
 */
export function useActiveSection({
  sections,
  positionMs,
  currentSectionId,
  setCurrentSection,
  loopSectionId,
  seekToMs,
  cadenceType,
}: UseActiveSectionOptions) {
  const activeSection = useMemo(() => {
    if (!sections.length) return null;
    return sections.find((s) => positionMs >= s.start_ms && positionMs < s.end_ms) ?? null;
  }, [positionMs, sections]);

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
    const thresholdMs = 200;
    if (positionMs >= loopSection.end_ms - thresholdMs) {
      const now = performance.now();
      if (now - lastLoopSeekAtRef.current > 800) {
        lastLoopSeekAtRef.current = now;
        seekToMs(loopSection.start_ms);
      }
    }
  }, [positionMs, loopSection, seekToMs]);

  const sectionWhy = useMemo(() => {
    if (!activeSection) return null;
    return describeSectionWhy({
      sectionLabel: activeSection.label,
      cadenceType,
      isLooping: loopSectionId === activeSection.id,
    });
  }, [activeSection, cadenceType, loopSectionId]);

  return { activeSection, loopSection, sectionWhy };
}
