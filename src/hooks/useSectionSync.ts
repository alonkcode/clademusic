import { useEffect, useMemo, useState } from 'react';
import { usePlayer } from '@/player/PlayerContext';
import { useSectionSelection } from '@/hooks/useSectionSelection';
import { sectionVariant } from '@/lib/harmony/sectionVariant';
import type { SongSection } from '@/types';

export interface UseSectionSyncOptions {
  trackId: string;
  progression: string[];
  sections?: SongSection[];
  detectedMode?: 'major' | 'minor' | 'unknown';
  bpm?: number;
  /** Beats per chord in the base loop. Matches useHarmonicLoop's default. */
  beatsPerChord?: number;
}

export interface UseSectionSyncResult {
  /** The section currently shown, or null when the track has none. */
  activeSection: SongSection | null;
  activeSectionIndex: number;
  /** The progression for the active section (heuristic variant of the base). */
  progression: string[];
  /** True while this exact track is the one actually playing through the app player. */
  isLiveSynced: boolean;
  /** Chord index within `progression`, ticking in time with real playback. Only
   *  meaningful while isLiveSynced is true; useHarmonicLoop drives its own
   *  index otherwise. */
  liveChordIndex: number;
  /** Tap a section marker to preview it. Ignored while live-synced, since real
   *  playback position is the source of truth then. */
  selectSection: (index: number) => void;
}

const DEFAULT_BPM = 96;

/**
 * Bridges two ways a listener explores a track's harmony:
 *
 * 1. LIVE: the track is actually playing through the app's Spotify/YouTube
 *    player right now. Section and chord timing follow real playback position
 *    (PlayerContext.positionMs) rather than anything running independently -
 *    the whole point of "sync the player to the chord changes".
 *
 * 2. MANUAL: nothing is playing (or a different track is). Tapping a section
 *    marker previews that section's progression on the standalone loop engine.
 */
export function useSectionSync({
  trackId,
  progression,
  sections,
  detectedMode,
  bpm,
  beatsPerChord = 4,
}: UseSectionSyncOptions): UseSectionSyncResult {
  const { canonicalTrackId, isPlaying, positionMs } = usePlayer();
  // The section chips above the card and this readout must agree, so the
  // selection lives in a shared context when one is mounted. Local state is
  // the fallback for standalone use.
  const shared = useSectionSelection();
  const [localIndex, setLocalIndex] = useState(0);
  const manualIndex = shared ? shared.index : localIndex;
  const setManualIndex = shared ? shared.select : setLocalIndex;

  const orderedSections = useMemo(
    () => [...(sections ?? [])].sort((a, b) => a.start_time - b.start_time),
    [sections]
  );

  const isLiveSynced = isPlaying && !!canonicalTrackId && canonicalTrackId === trackId;

  // Reset manual selection when the track itself changes underneath us.
  // The provider does the same for the shared case.
  useEffect(() => {
    if (!shared) setLocalIndex(0);
  }, [trackId, shared]);

  const liveSectionIndex = useMemo(() => {
    if (!isLiveSynced || orderedSections.length === 0) return -1;
    const posSec = positionMs / 1000;
    let idx = 0;
    for (let i = 0; i < orderedSections.length; i++) {
      if (posSec >= orderedSections[i].start_time) idx = i;
    }
    return idx;
  }, [isLiveSynced, orderedSections, positionMs]);

  const activeSectionIndex = isLiveSynced
    ? liveSectionIndex
    : Math.min(manualIndex, Math.max(orderedSections.length - 1, 0));

  const activeSection = orderedSections[activeSectionIndex] ?? null;

  const sectionProgression = useMemo(() => {
    if (!activeSection) return progression;
    return sectionVariant(progression, activeSection.type, detectedMode === 'minor' ? 'minor' : 'major');
  }, [progression, activeSection, detectedMode]);

  const liveChordIndex = useMemo(() => {
    if (!isLiveSynced || !activeSection || sectionProgression.length === 0) return 0;
    const secondsPerChord = (60 / (bpm || DEFAULT_BPM)) * beatsPerChord;
    const elapsed = positionMs / 1000 - activeSection.start_time;
    const idx = Math.floor(Math.max(elapsed, 0) / secondsPerChord) % sectionProgression.length;
    return idx;
  }, [isLiveSynced, activeSection, sectionProgression, bpm, beatsPerChord, positionMs]);

  const selectSection = (index: number) => {
    if (isLiveSynced) return; // real playback position is authoritative
    setManualIndex(Math.max(0, Math.min(index, orderedSections.length - 1)));
  };

  return {
    activeSection,
    activeSectionIndex,
    progression: sectionProgression,
    isLiveSynced,
    liveChordIndex,
    selectSection,
  };
}
