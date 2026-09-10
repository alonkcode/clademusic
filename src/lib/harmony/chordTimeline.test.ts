import { describe, it, expect } from 'vitest';
import {
  ChordTimeline,
  chordsInWindow,
  reduceToLoop,
  sectionProgressions,
  type ChordSpan,
} from './chordTimeline';
import type { DetectedChord } from './chordDetection';
import type { DetectedSection } from './sectionDetection';

const C: DetectedChord = { root: 0, quality: 'major', score: 0.9 };
const G: DetectedChord = { root: 7, quality: 'major', score: 0.8 };
const Am: DetectedChord = { root: 9, quality: 'minor', score: 0.7 };
const F: DetectedChord = { root: 5, quality: 'major', score: 0.85 };

/** Feed one chord across a stretch of frames at the detector's 120ms tick. */
function hold(tl: ChordTimeline, chord: DetectedChord | null, fromSec: number, toSec: number) {
  for (let t = fromSec; t < toSec - 1e-9; t += 0.12) tl.push(chord, Number(t.toFixed(4)));
}

function ref(root: number, quality: 'major' | 'minor') {
  return { root, quality };
}

function span(root: number, quality: 'major' | 'minor', startSec: number, endSec: number): ChordSpan {
  return { root, quality, startSec, endSec, confidence: 0.8 };
}

describe('ChordTimeline', () => {
  it('collapses a held chord into a single span', () => {
    const tl = new ChordTimeline();
    hold(tl, C, 0, 2);
    const spans = tl.toSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].root).toBe(0);
    expect(spans[0].startSec).toBe(0);
    expect(spans[0].endSec).toBeCloseTo(1.92, 1);
  });

  it('closes a span when the chord changes', () => {
    const tl = new ChordTimeline();
    hold(tl, C, 0, 2);
    hold(tl, G, 2, 4);
    const spans = tl.toSpans();
    expect(spans.map((s) => s.root)).toEqual([0, 7]);
    expect(spans[0].endSec).toBeCloseTo(2, 1);
  });

  it('distinguishes chords sharing a root but not a quality', () => {
    const tl = new ChordTimeline();
    hold(tl, { root: 9, quality: 'major', score: 0.8 }, 0, 1);
    hold(tl, Am, 1, 2);
    expect(tl.toSpans().map((s) => s.quality)).toEqual(['major', 'minor']);
  });

  it('averages the match score across the span', () => {
    const tl = new ChordTimeline();
    tl.push({ root: 0, quality: 'major', score: 1 }, 0);
    tl.push({ root: 0, quality: 'major', score: 0.5 }, 0.5);
    tl.push(null, 1);
    expect(tl.toSpans()[0].confidence).toBeCloseTo(0.75, 5);
  });

  it('ends a span on silence and does not bridge across it', () => {
    const tl = new ChordTimeline();
    hold(tl, C, 0, 1);
    hold(tl, null, 1, 2);
    hold(tl, C, 2, 3);
    const spans = tl.toSpans();
    expect(spans).toHaveLength(2);
    expect(spans[0].endSec).toBeCloseTo(1, 1);
    expect(spans[1].startSec).toBeCloseTo(2, 1);
  });

  it('drops spans too short to be credible', () => {
    const tl = new ChordTimeline();
    hold(tl, C, 0, 1);
    tl.push(G, 1); // a single stray frame
    hold(tl, C, 1.1, 2);
    expect(tl.toSpans().every((s) => s.root === 0)).toBe(true);
  });

  it('includes the span still in progress', () => {
    const tl = new ChordTimeline();
    hold(tl, C, 0, 1);
    hold(tl, G, 1, 2); // never closed
    expect(tl.toSpans().map((s) => s.root)).toEqual([0, 7]);
  });

  it('does not fabricate a span from a clock that never advanced', () => {
    const tl = new ChordTimeline();
    tl.push(C, 5);
    tl.push(C, 5);
    expect(tl.toSpans()).toEqual([]);
  });

  it('ignores a non-finite frame time', () => {
    const tl = new ChordTimeline();
    hold(tl, C, 0, 1);
    tl.push(C, Number.NaN);
    expect(tl.toSpans()).toHaveLength(1);
  });

  // Frames are timed against the player's real position, so scrubbing moves
  // the clock arbitrarily - forwards in a jump, or backwards outright.
  it('starts a new span when the listener skips forward', () => {
    const tl = new ChordTimeline();
    hold(tl, C, 0, 1);
    hold(tl, C, 60, 61);
    const spans = tl.toSpans();
    expect(spans).toHaveLength(2);
    expect(spans[1].startSec).toBe(60);
  });

  it('lets a re-listened stretch replace what was heard there before', () => {
    const tl = new ChordTimeline();
    hold(tl, C, 0, 4);
    hold(tl, G, 4, 8);
    // Seek back to 1s and hear it again, more clearly this time.
    hold(tl, F, 1, 3);
    const spans = tl.toSpans();
    // No overlaps, still ordered, and the re-listen won its window.
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].startSec).toBeGreaterThanOrEqual(spans[i - 1].endSec - 1e-6);
    }
    const atTwoSec = spans.find((s) => s.startSec <= 2 && s.endSec > 2);
    expect(atTwoSec?.root).toBe(5);
  });

  it('forgets everything on reset', () => {
    const tl = new ChordTimeline();
    hold(tl, C, 0, 2);
    tl.reset();
    expect(tl.toSpans()).toEqual([]);
  });
});

describe('chordsInWindow', () => {
  const spans = [span(0, 'major', 0, 4), span(7, 'major', 4, 8), span(9, 'minor', 8, 12)];

  it('clips spans to the window edges', () => {
    const got = chordsInWindow(spans, 2, 6);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ root: 0, startSec: 2, endSec: 4 });
    expect(got[1]).toMatchObject({ root: 7, startSec: 4, endSec: 6 });
  });

  it('excludes spans that only touch the boundary', () => {
    expect(chordsInWindow(spans, 4, 8).map((s) => s.root)).toEqual([7]);
  });

  it('returns nothing for a window with no chords in it', () => {
    expect(chordsInWindow(spans, 20, 30)).toEqual([]);
  });
});

describe('reduceToLoop', () => {
  it('reduces a repeated four-chord loop to one cycle', () => {
    const seq = [ref(0, 'major'), ref(7, 'major'), ref(9, 'minor'), ref(5, 'major')];
    expect(reduceToLoop([...seq, ...seq, ...seq])).toEqual(seq);
  });

  it('accepts a partial final cycle', () => {
    const seq = [ref(0, 'major'), ref(7, 'major'), ref(9, 'minor'), ref(5, 'major')];
    expect(reduceToLoop([...seq, ...seq, ref(0, 'major'), ref(7, 'major')])).toEqual(seq);
  });

  it('finds the shortest period, not just any period', () => {
    const two = [ref(0, 'major'), ref(7, 'major')];
    expect(reduceToLoop([...two, ...two, ...two, ...two])).toEqual(two);
  });

  it('leaves a non-repeating sequence alone', () => {
    const seq = [ref(0, 'major'), ref(7, 'major'), ref(9, 'minor'), ref(2, 'minor'), ref(4, 'major')];
    expect(reduceToLoop(seq)).toEqual(seq);
  });

  it('handles empty and single-chord sequences', () => {
    expect(reduceToLoop([])).toEqual([]);
    expect(reduceToLoop([ref(0, 'major')])).toEqual([ref(0, 'major')]);
  });
});

describe('sectionProgressions', () => {
  const sections: DetectedSection[] = [
    { type: 'verse', label: 'Verse 1', startSec: 0, endSec: 8 },
    { type: 'chorus', label: 'Chorus 1', startSec: 8, endSec: 16 },
  ];

  it('gives each section its own chords and its own loop', () => {
    // Verse cycles C-G; chorus cycles Am-F. Different harmony, as it should be.
    const spans = [
      span(0, 'major', 0, 2),
      span(7, 'major', 2, 4),
      span(0, 'major', 4, 6),
      span(7, 'major', 6, 8),
      span(9, 'minor', 8, 10),
      span(5, 'major', 10, 12),
      span(9, 'minor', 12, 14),
      span(5, 'major', 14, 16),
    ];

    const [verse, chorus] = sectionProgressions(sections, spans);

    expect(verse.section.label).toBe('Verse 1');
    expect(verse.chords).toHaveLength(4);
    expect(verse.loop).toEqual([ref(0, 'major'), ref(7, 'major')]);

    expect(chorus.section.label).toBe('Chorus 1');
    expect(chorus.loop).toEqual([ref(9, 'minor'), ref(5, 'major')]);
  });

  it('gives a section with no detected chords an empty progression', () => {
    const [verse, chorus] = sectionProgressions(sections, [span(0, 'major', 0, 8)]);
    expect(verse.loop).toEqual([ref(0, 'major')]);
    expect(chorus.chords).toEqual([]);
    expect(chorus.loop).toEqual([]);
  });
});
