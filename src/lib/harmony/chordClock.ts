import { beatIntervalMs, isUsableBpm } from '@/player/embeddedPlayer/beatClock';

/**
 * Pure timing rules for "which chord is sounding right now", kept apart from
 * the hooks that call them so they can be tested at exact positions.
 *
 * The catalog counts loops in bars (tracks.loop_length_bars) and assumes 4/4;
 * the beat dot next to the tempo readout counts beats from position 0 at the
 * same bpm. Everything here is arranged so a chord change lands ON one of
 * those beat flashes rather than at some unrelated instant near it.
 */

export const BEATS_PER_BAR = 4;
export const DEFAULT_BEATS_PER_CHORD = 4;

/** Only ever used to size the guess when the track has no usable tempo at all. */
export const FALLBACK_BPM = 96;

/**
 * How many beats each chord of the base progression is held for. A loop of N
 * chords spanning B bars holds each one B*4/N beats - 4 chords over 4 bars is
 * a bar apiece, 4 chords over 8 bars is two. Falls back to `fallback` when the
 * bar count is not known. The live readout and the "Hear chords" preview both
 * ask this, so they cannot disagree about the rate.
 */
export function chordHoldBeats(
  chordCount: number,
  loopLengthBars: number | null | undefined,
  fallback: number = DEFAULT_BEATS_PER_CHORD
): number {
  if (
    typeof loopLengthBars === 'number' &&
    Number.isFinite(loopLengthBars) &&
    loopLengthBars > 0 &&
    chordCount > 0
  ) {
    return (loopLengthBars * BEATS_PER_BAR) / chordCount;
  }
  return fallback;
}

/** The beat-grid position (multiple of one beat from 0) nearest `ms`. */
export function snapToBeat(ms: number, bpm: number): number {
  const beat = beatIntervalMs(bpm);
  return Math.round(ms / beat) * beat;
}

export interface ChordIndexInput {
  positionMs: number;
  /** Where this section starts, in track time. 0 for a track with no sections. */
  sectionStartMs: number;
  chordCount: number;
  /** Per-chord onsets in ms from the section start. Only honoured when there is
   *  exactly one per chord; otherwise the beat grid is used. */
  timings?: number[] | null;
  /** The track's tempo when known. Absent/unusable means the rate is a guess. */
  bpm?: number | null;
  beatsPerChord: number;
}

/**
 * Index into the section's progression that is sounding at `positionMs`.
 *
 * Real per-chord timestamps win outright: they were measured from the audio
 * and cannot drift. Without them the index comes from the tempo, and there the
 * section's start is snapped to the nearest beat of the global grid. Section
 * boundaries are curated to the whole second, which is not a beat line, so
 * counting chords from the raw value put every chord change at a fixed offset
 * from the beat flashes - different for every section, up to a full beat.
 * Snapped, the changes fall on the same beats the tempo readout is flashing.
 */
export function chordIndexAt({
  positionMs,
  sectionStartMs,
  chordCount,
  timings,
  bpm,
  beatsPerChord,
}: ChordIndexInput): number {
  if (chordCount <= 0) return 0;

  if (timings && timings.length === chordCount) {
    const elapsedMs = positionMs - sectionStartMs;
    for (let i = timings.length - 1; i >= 0; i--) {
      if (elapsedMs >= timings[i]) return i;
    }
    return 0;
  }

  const known = isUsableBpm(bpm);
  const effectiveBpm = known ? bpm : FALLBACK_BPM;
  // A guessed tempo has no beat grid worth aligning to, so only snap a real one.
  const anchorMs = known ? snapToBeat(sectionStartMs, effectiveBpm) : sectionStartMs;
  const msPerChord = beatIntervalMs(effectiveBpm) * Math.max(beatsPerChord, 0.25);
  const elapsedMs = Math.max(positionMs - anchorMs, 0);
  return Math.floor(elapsedMs / msPerChord) % chordCount;
}
