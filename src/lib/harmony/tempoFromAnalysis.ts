import type { TrackSection } from '@/types';

/**
 * Infers a track's tempo from the section/chord analysis already stored for
 * it, for the (currently very common) case where tracks.tempo is null.
 *
 * This is INFERENCE, not measurement. There is no audio to analyse - playback
 * runs through cross-origin YouTube/Spotify iframes, which expose no signal -
 * so the only timing evidence available is where the analysis says chords and
 * sections begin. Callers are expected to present the result as an estimate;
 * usePlayerHarmony flags it as such and the UI prefixes it with "~".
 *
 * The method: chord changes land on a beat grid, so the gap between
 * consecutive chord onsets is some whole number of beats - usually 2 or 4.
 * That whole number is the unknown, and guessing it wrong is exactly what
 * produces a half- or double-tempo answer. Rather than assume it, every
 * plausible value is tried and scored against a second, independent piece of
 * evidence: section boundaries, which fall on bar lines in almost all popular
 * music. The candidate whose beat grid also explains the section lengths as
 * whole bars wins.
 */

/** Inference is held to a musical range, narrower than the clock's own limits.
 *  Outside this a "tempo" is far more likely to be a bad chord grid than a
 *  real song, and a wrong flashing number is worse than none. */
export const INFER_MIN_BPM = 55;
export const INFER_MAX_BPM = 200;

/** Chord gaps outside this are structural gaps or analysis noise, not a beat
 *  multiple worth reasoning from. */
const MIN_CHORD_GAP_MS = 150;
const MAX_CHORD_GAP_MS = 12000;

/** How many beats a single chord might be held for. */
const BEATS_PER_CHORD_CANDIDATES = [1, 2, 4, 8];

/** Below this many usable chord gaps there is not enough evidence to be worth
 *  reporting a number from. */
const MIN_GAPS = 3;

/** Mean bar-alignment error above which the best candidate is still rejected:
 *  the sections simply do not line up as whole bars at any tested tempo. */
const MAX_MEAN_BAR_ERROR = 0.16;

/** Ties are broken towards this, the middle of the common pop/rock range. */
const TEMPO_CENTRE = 120;

export interface TempoEstimate {
  bpm: number;
  /** The whole number of beats per chord this reading assumed. */
  beatsPerChord: number;
  /** Mean distance of each section length from a whole number of bars, 0-0.5.
   *  Lower is better; it is the evidence the tempo is right rather than half
   *  or double it. */
  barError: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Distance from the nearest whole number, 0 (exact) to 0.5 (worst). */
function wholeNumberError(value: number): number {
  return Math.abs(value - Math.round(value));
}

/** Every gap between consecutive chord onsets, across all sections. */
export function chordGapsMs(sections: TrackSection[]): number[] {
  const gaps: number[] = [];
  for (const section of sections) {
    const timings = section.chord_timings;
    if (!Array.isArray(timings) || timings.length < 2) continue;
    const ordered = [...timings].sort((a, b) => a - b);
    for (let i = 1; i < ordered.length; i += 1) {
      const gap = ordered[i] - ordered[i - 1];
      if (gap >= MIN_CHORD_GAP_MS && gap <= MAX_CHORD_GAP_MS) gaps.push(gap);
    }
  }
  return gaps;
}

/**
 * Mean bar-alignment error for a given beat length: how close each section's
 * length comes to a whole number of 4-beat bars. This is what separates a
 * tempo from its own half and double, which fit the chord gaps equally well.
 */
export function barAlignmentError(sections: TrackSection[], beatMs: number): number {
  const errors: number[] = [];
  for (const section of sections) {
    const duration = section.end_ms - section.start_ms;
    if (!Number.isFinite(duration) || duration <= 0) continue;
    const bars = duration / (beatMs * 4);
    // A section shorter than a bar, or absurdly long, says nothing useful.
    if (bars < 0.5 || bars > 512) continue;
    errors.push(wholeNumberError(bars));
  }
  if (!errors.length) return 0.5;
  return errors.reduce((sum, e) => sum + e, 0) / errors.length;
}

export function estimateTempoFromSections(sections: TrackSection[] | null | undefined): TempoEstimate | null {
  if (!Array.isArray(sections) || !sections.length) return null;

  const gaps = chordGapsMs(sections);
  if (gaps.length < MIN_GAPS) return null;

  // Median rather than mean: a handful of chords held twice as long as the
  // rest is normal writing, and would drag a mean off the actual grid.
  const typicalGap = median(gaps);
  if (!Number.isFinite(typicalGap) || typicalGap <= 0) return null;

  let best: TempoEstimate | null = null;

  for (const beatsPerChord of BEATS_PER_CHORD_CANDIDATES) {
    const beatMs = typicalGap / beatsPerChord;
    const bpm = 60000 / beatMs;
    if (bpm < INFER_MIN_BPM || bpm > INFER_MAX_BPM) continue;

    const barError = barAlignmentError(sections, beatMs);
    const candidate: TempoEstimate = { bpm, beatsPerChord, barError };

    if (!best) {
      best = candidate;
      continue;
    }
    // Clearly better bar alignment wins outright. When two candidates explain
    // the sections about equally well - which is exactly the half/double case
    // - prefer the one nearer the middle of the usual range.
    const improvement = best.barError - candidate.barError;
    if (improvement > 0.02) {
      best = candidate;
    } else if (Math.abs(improvement) <= 0.02) {
      const bestDistance = Math.abs(Math.log2(best.bpm / TEMPO_CENTRE));
      const candidateDistance = Math.abs(Math.log2(candidate.bpm / TEMPO_CENTRE));
      if (candidateDistance < bestDistance) best = candidate;
    }
  }

  if (!best || best.barError > MAX_MEAN_BAR_ERROR) return null;
  return { ...best, bpm: Math.round(best.bpm * 10) / 10 };
}
