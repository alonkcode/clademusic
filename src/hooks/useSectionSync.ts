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
  /** Beats per chord in the base loop. Matches useHarmonicLoop's default.
   *  Ignored whenever loopLengthBars is available - see there. */
  beatsPerChord?: number;
  /** Bars in one full cycle of `progression`, e.g. 4 chords over a 4-bar
   *  loop = 1 bar (4 beats in 4/4) per chord, but an 8-bar loop with the
   *  same 4 chords means each one actually holds for 2 bars (8 beats) - a
   *  fixed beatsPerChord guess can't tell those apart. */
  loopLengthBars?: number;
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
  /** Tap a section marker to jump to it: seeks the player while this track is
   *  playing, otherwise previews that section's progression. */
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
  loopLengthBars,
}: UseSectionSyncOptions): UseSectionSyncResult {
  const { canonicalTrackId, isPlaying, positionMs, seekTo } = usePlayer();
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

  // A section that was actually analyzed/curated with its own chords takes
  // priority over the generic songwriting-convention variant below - that
  // variant exists ONLY because "Clade's analysis pipeline stores one
  // progression per track today" (see sectionVariant's own docstring); a
  // section that already has real per-section chords isn't in that boat.
  const sectionProgression = useMemo(() => {
    if (activeSection?.chords && activeSection.chords.length > 0) return activeSection.chords;
    if (!activeSection) return progression;
    return sectionVariant(progression, activeSection.type, detectedMode === 'minor' ? 'minor' : 'major');
  }, [progression, activeSection, detectedMode]);

  const liveChordIndex = useMemo(() => {
    if (!isLiveSynced || !activeSection || sectionProgression.length === 0) return 0;
    const elapsedMs = positionMs - activeSection.start_time * 1000;

    // Real per-chord timestamps, when this section was actually analyzed
    // with them - the last one whose timestamp has passed. Exact, not a
    // guess, and the only path that can never drift out of sync.
    const timings = activeSection.chord_timings;
    if (timings && timings.length === sectionProgression.length) {
      for (let i = timings.length - 1; i >= 0; i--) {
        if (elapsedMs >= timings[i]) return i;
      }
      return 0;
    }

    // No per-chord timing for this section: fall back to a fixed
    // beats-per-chord guess, at least sized correctly when the track's own
    // loop_length_bars is known - the progression cycles loopLengthBars
    // worth of bars across its own length, e.g. 4 chords over an 8-bar loop
    // means each one holds for 2 bars (8 beats), not the flat default of 4.
    const effectiveBeatsPerChord =
      loopLengthBars && progression.length > 0 ? (loopLengthBars * 4) / progression.length : beatsPerChord;
    const secondsPerChord = (60 / (bpm || DEFAULT_BPM)) * effectiveBeatsPerChord;
    const elapsed = elapsedMs / 1000;
    return Math.floor(Math.max(elapsed, 0) / secondsPerChord) % sectionProgression.length;
  }, [isLiveSynced, activeSection, sectionProgression, bpm, beatsPerChord, loopLengthBars, progression.length, positionMs]);

  const selectSection = (index: number) => {
    const clamped = Math.max(0, Math.min(index, orderedSections.length - 1));
    if (isLiveSynced) {
      // Playback position is the source of truth while this track is playing,
      // so move the playhead rather than the label: seek there and the rest
      // follows. Works the same on Spotify and YouTube.
      const target = orderedSections[clamped];
      if (target) seekTo(target.start_time);
      return;
    }
    setManualIndex(clamped);
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
