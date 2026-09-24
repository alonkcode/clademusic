import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from '@/player/PlayerContext';
import { useSectionSelection } from '@/hooks/useSectionSelection';
import { chordHoldBeats, chordIndexAt } from '@/lib/harmony/chordClock';
import { sectionVariant } from '@/lib/harmony/sectionVariant';
import { isTestEnv } from '@/lib/env';
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
  /** Beats each chord is held for, derived once here so the "Hear chords"
   *  preview can play at exactly the rate the live readout rotates at. */
  beatsPerChord: number;
  /** Tap a section marker to jump to it: seeks the player while this track is
   *  playing, otherwise previews that section's progression. */
  selectSection: (index: number) => void;
}

interface LivePlayhead {
  /** -1 when the track has no sections at all. */
  sectionIndex: number;
  chordIndex: number;
}

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

  const mode = detectedMode === 'minor' ? 'minor' : 'major';

  // A section that was actually analyzed/curated with its own chords takes
  // priority over the generic songwriting-convention variant below - that
  // variant exists ONLY because "Clade's analysis pipeline stores one
  // progression per track today" (see sectionVariant's own docstring); a
  // section that already has real per-section chords isn't in that boat.
  const sectionProgressions = useMemo(
    () =>
      orderedSections.map((section) =>
        section.chords && section.chords.length > 0
          ? section.chords
          : sectionVariant(progression, section.type, mode)
      ),
    [orderedSections, progression, mode]
  );

  // The progression cycles loopLengthBars worth of bars across its own length,
  // e.g. 4 chords over an 8-bar loop means each one holds for 2 bars (8 beats),
  // not the flat default of 4. Sized from the BASE progression on purpose: a
  // section variant (a breakdown's two-chord skeleton) changes which chords are
  // shown, not how long the song's harmonic rhythm holds each one.
  const effectiveBeatsPerChord = chordHoldBeats(progression.length, loopLengthBars, beatsPerChord);

  // Where playback is, as a section and a chord within it. Everything live is
  // derived through this one function - from the provider's last reported
  // position below, and from the extrapolated one in the frame loop - so the
  // two can never disagree about the rules.
  const resolveLive = useCallback(
    (posMs: number): LivePlayhead => {
      if (orderedSections.length === 0) {
        // No section list at all: the whole track is one stretch of the base
        // progression, counted from the start. Returning 0 here froze the
        // readout on the first chord for every track without curated sections.
        return {
          sectionIndex: -1,
          chordIndex: chordIndexAt({
            positionMs: posMs,
            sectionStartMs: 0,
            chordCount: progression.length,
            bpm,
            beatsPerChord: effectiveBeatsPerChord,
          }),
        };
      }
      const posSec = posMs / 1000;
      let sectionIndex = 0;
      for (let i = 0; i < orderedSections.length; i++) {
        if (posSec >= orderedSections[i].start_time) sectionIndex = i;
      }
      const section = orderedSections[sectionIndex];
      const chords = sectionProgressions[sectionIndex] ?? progression;
      return {
        sectionIndex,
        chordIndex: chordIndexAt({
          positionMs: posMs,
          sectionStartMs: section.start_time * 1000,
          chordCount: chords.length,
          timings: section.chord_timings,
          bpm,
          beatsPerChord: effectiveBeatsPerChord,
        }),
      };
    },
    [orderedSections, sectionProgressions, progression, bpm, effectiveBeatsPerChord]
  );

  const reported = useMemo(
    () => (isLiveSynced ? resolveLive(positionMs) : null),
    [isLiveSynced, resolveLive, positionMs]
  );

  // The provider's position reaches this hook in steps - every 250ms on the
  // Spotify embed path - while the beat dot beside the tempo readout advances
  // it every frame from the same reports. Reading only the reported value put
  // each chord change up to a quarter second behind the beat it belongs on.
  // Extrapolating between reports the same way closes that, and it only
  // touches React state when the chord or section actually changes, not on
  // every frame.
  const anchorRef = useRef({ positionMs, at: 0 });
  useEffect(() => {
    anchorRef.current = { positionMs, at: typeof performance !== 'undefined' ? performance.now() : 0 };
  }, [positionMs]);

  // The loop reads the resolver through a ref so it is only torn down by
  // play/pause, not by every change to the track's sections or tempo.
  const resolveRef = useRef(resolveLive);
  useEffect(() => {
    resolveRef.current = resolveLive;
  }, [resolveLive]);

  const [ticked, setTicked] = useState<{ resolver: typeof resolveLive; value: LivePlayhead } | null>(null);
  useEffect(() => {
    if (!isLiveSynced || isTestEnv || typeof requestAnimationFrame !== 'function') return;

    let last = resolveRef.current(anchorRef.current.positionMs);
    setTicked(null);
    let frame = requestAnimationFrame(function tick() {
      const { positionMs: anchorMs, at } = anchorRef.current;
      const resolver = resolveRef.current;
      const next = resolver(anchorMs + (performance.now() - at));
      if (next.sectionIndex !== last.sectionIndex || next.chordIndex !== last.chordIndex) {
        last = next;
        setTicked({ resolver, value: next });
      }
      frame = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(frame);
      setTicked(null);
    };
  }, [isLiveSynced]);

  // Only trust a ticked value computed by the resolver that is current now - a
  // track or tempo change swaps the resolver, and its stale output must not
  // outlive the frame it took the loop to notice.
  const live = ticked && ticked.resolver === resolveLive ? ticked.value : reported;

  const activeSectionIndex = live
    ? live.sectionIndex
    : Math.min(manualIndex, Math.max(orderedSections.length - 1, 0));

  const activeSection = orderedSections[activeSectionIndex] ?? null;
  const sectionProgression = sectionProgressions[activeSectionIndex] ?? progression;
  const liveChordIndex = live?.chordIndex ?? 0;

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
    beatsPerChord: effectiveBeatsPerChord,
    selectSection,
  };
}
