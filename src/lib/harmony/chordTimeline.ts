/**
 * Turns the live chord detector's frame-by-frame output into timed chord
 * spans, and slices those spans up by detected section.
 *
 * `useLiveChordDetection` estimates a chord roughly every 120ms and, until
 * this existed, simply overwrote a single "what is sounding now" value - so
 * nothing in the app ever held a chord SEQUENCE, let alone one with
 * timestamps, and per-section progressions were impossible to derive. Section
 * detection and chord detection were two pipelines that never met.
 *
 * Everything here is derived from real captured audio. It inherits the
 * detector's limits (major/minor triads only, no inversions, no extensions),
 * so treat spans as a live estimate rather than analysis-grade data.
 */

import type { ChordQuality, DetectedChord } from './chordDetection';
import type { DetectedSection } from './sectionDetection';

/** One chord, held over a continuous stretch of time. */
export interface ChordSpan {
  /** Pitch class of the root, 0 = C. */
  root: number;
  quality: ChordQuality;
  startSec: number;
  endSec: number;
  /** Mean template-match score over the frames in this span, 0-1. */
  confidence: number;
}

/** A chord identity without timing - what a progression is actually made of. */
export interface ChordRef {
  root: number;
  quality: ChordQuality;
}

export interface SectionProgression {
  section: DetectedSection;
  /** Every span overlapping the section, clipped to its bounds. */
  chords: ChordSpan[];
  /** The shortest repeating unit of `chords`, i.e. the section's loop. */
  loop: ChordRef[];
}

/**
 * Shorter than this and a span is detector noise rather than a chord - a
 * transient mid-change, or a moment where the signal briefly matched a
 * neighbouring triad. ChordSmoother's own 6-frame window already suppresses
 * most of these; this catches what survives it.
 */
const MIN_SPAN_SEC = 0.3;

/**
 * A jump larger than this in the frame clock means the listener seeked, not
 * that time passed - frames are timed against the player's real position, so
 * scrubbing moves the clock arbitrarily, backwards included.
 */
const SEEK_DISCONTINUITY_SEC = 2;

function sameChord(a: ChordRef | null, b: ChordRef | null): boolean {
  if (!a || !b) return a === b;
  return a.root === b.root && a.quality === b.quality;
}

/**
 * Accumulates per-frame chord estimates into spans.
 *
 * Feed it every frame; it extends the current span while the chord holds and
 * closes it when the chord changes, goes silent, or the clock jumps. Spans are
 * kept in time order, and a re-listened stretch overwrites what was there
 * before - seeking back over a chorus should refine it, not duplicate it.
 */
export class ChordTimeline {
  private spans: ChordSpan[] = [];
  private open: { root: number; quality: ChordQuality; startSec: number; scores: number[] } | null = null;
  private lastTimeSec: number | null = null;

  /**
   * @param chord   Smoothed estimate for this frame, or null for "no chord".
   * @param timeSec Frame time on the timeline being built against.
   */
  push(chord: DetectedChord | null, timeSec: number): void {
    if (!Number.isFinite(timeSec)) return;

    const last = this.lastTimeSec;
    const discontinuous =
      last !== null && (timeSec < last || timeSec - last > SEEK_DISCONTINUITY_SEC);
    if (discontinuous) this.closeOpen(last as number);
    this.lastTimeSec = timeSec;

    if (!chord) {
      this.closeOpen(timeSec);
      return;
    }

    if (this.open && sameChord(this.open, chord)) {
      this.open.scores.push(chord.score);
      return;
    }

    this.closeOpen(timeSec);
    this.open = { root: chord.root, quality: chord.quality, startSec: timeSec, scores: [chord.score] };
  }

  /**
   * Every span so far, in time order, including the one still open (ending at
   * the latest frame seen). Spans too short to be credible are left out.
   *
   * The open span goes through the same overlap resolution as a closed one:
   * after a seek backwards it can start earlier than spans already recorded,
   * so simply appending it left the result unordered and overlapping.
   */
  toSpans(): ChordSpan[] {
    const openSpan = this.openAsSpan(this.lastTimeSec ?? 0);
    const all = openSpan ? insertSpan(this.spans, openSpan) : [...this.spans];
    return all.filter((s) => s.endSec - s.startSec >= MIN_SPAN_SEC);
  }

  reset(): void {
    this.spans = [];
    this.open = null;
    this.lastTimeSec = null;
  }

  private openAsSpan(endSec: number): ChordSpan | null {
    const open = this.open;
    if (!open || endSec <= open.startSec) return null;
    const mean = open.scores.reduce((a, b) => a + b, 0) / open.scores.length;
    return { root: open.root, quality: open.quality, startSec: open.startSec, endSec, confidence: mean };
  }

  private closeOpen(endSec: number): void {
    const span = this.openAsSpan(endSec);
    this.open = null;
    if (span) this.insert(span);
  }

  private insert(span: ChordSpan): void {
    this.spans = insertSpan(this.spans, span);
  }
}

/**
 * Insert in time order, letting the new span win any overlap. Listening to the
 * same stretch twice - which is what seeking back does - should replace the
 * older reading rather than interleave two versions of the same bar.
 */
function insertSpan(spans: ChordSpan[], span: ChordSpan): ChordSpan[] {
  // Fast path. Spans almost always arrive one after the last, in which case
  // the overlap scan and the re-sort below are pure waste - and they are not
  // cheap, since this runs on every chord change and the array only grows.
  // Only seeking backwards makes the general case necessary.
  const last = spans[spans.length - 1];
  if (!last || span.startSec >= last.endSec) {
    return span.endSec > span.startSec ? [...spans, span] : [...spans];
  }

  const kept: ChordSpan[] = [];
  for (const existing of spans) {
    if (existing.endSec <= span.startSec || existing.startSec >= span.endSec) {
      kept.push(existing);
      continue;
    }
    // Trim whatever sticks out either side; drop it if fully covered.
    if (existing.startSec < span.startSec) {
      kept.push({ ...existing, endSec: span.startSec });
    }
    if (existing.endSec > span.endSec) {
      kept.push({ ...existing, startSec: span.endSec });
    }
  }
  kept.push(span);
  kept.sort((a, b) => a.startSec - b.startSec);
  return kept.filter((s) => s.endSec > s.startSec);
}

/** The spans overlapping a time window, clipped to it. */
export function chordsInWindow(spans: ChordSpan[], startSec: number, endSec: number): ChordSpan[] {
  return spans
    .filter((s) => s.endSec > startSec && s.startSec < endSec)
    .map((s) => ({
      ...s,
      startSec: Math.max(s.startSec, startSec),
      endSec: Math.min(s.endSec, endSec),
    }))
    .filter((s) => s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec);
}

/**
 * The shortest repeating unit of a chord sequence.
 *
 * A verse that plays I-V-vi-IV four times is a four-chord loop, not a
 * sixteen-chord progression, and that distinction is what loop_length_bars and
 * every progression comparison in the app are built on. The final cycle is
 * allowed to be partial - a section rarely ends exactly on a loop boundary.
 * Returns the sequence unchanged when nothing repeats.
 */
export function reduceToLoop(chords: ChordRef[]): ChordRef[] {
  const n = chords.length;
  if (n < 2) return chords.map((c) => ({ root: c.root, quality: c.quality }));

  for (let period = 1; period <= Math.floor(n / 2); period++) {
    let repeats = true;
    for (let i = period; i < n; i++) {
      if (!sameChord(chords[i], chords[i % period])) {
        repeats = false;
        break;
      }
    }
    if (repeats) return chords.slice(0, period).map((c) => ({ root: c.root, quality: c.quality }));
  }
  return chords.map((c) => ({ root: c.root, quality: c.quality }));
}

/**
 * Pair each detected section with the chords actually heard inside it.
 *
 * This is the join the two detection pipelines never had: section boundaries
 * come from chroma self-similarity, chord spans from template matching, and
 * only together do they answer "what does the chorus play, as opposed to the
 * verse".
 */
export function sectionProgressions(
  sections: DetectedSection[],
  spans: ChordSpan[]
): SectionProgression[] {
  return sections.map((section) => {
    const chords = chordsInWindow(spans, section.startSec, section.endSec);
    return { section, chords, loop: reduceToLoop(chords) };
  });
}
