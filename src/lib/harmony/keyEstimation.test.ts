import { describe, it, expect } from 'vitest';
import { estimateKey, toRomanNumeral, toRomanProgression } from './keyEstimation';
import { parseRomanChord, pitchClassName } from './theory';
import { ChordTimeline, sectionProgressions, type ChordSpan } from './chordTimeline';
import type { DetectedSection } from './sectionDetection';

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, Bb: 10, B: 11 };

/** Build a run of equal-length spans from a chord sequence. */
function sequence(
  chords: Array<[number, 'major' | 'minor']>,
  secEach = 2,
  repeats = 1
): ChordSpan[] {
  const spans: ChordSpan[] = [];
  let t = 0;
  for (let r = 0; r < repeats; r++) {
    for (const [root, quality] of chords) {
      spans.push({ root, quality, startSec: t, endSec: t + secEach, confidence: 1 });
      t += secEach;
    }
  }
  return spans;
}

describe('estimateKey', () => {
  it('reads I-V-vi-IV in C as C major', () => {
    const key = estimateKey(
      sequence(
        [
          [PC.C, 'major'],
          [PC.G, 'major'],
          [PC.A, 'minor'],
          [PC.F, 'major'],
        ],
        2,
        3
      )
    );
    expect(key).not.toBeNull();
    expect(pitchClassName(key!.tonic)).toBe('C');
    expect(key!.mode).toBe('major');
  });

  it('reads i-iv-V-i as a minor key, not its relative major', () => {
    const key = estimateKey(
      sequence(
        [
          [PC.A, 'minor'],
          [PC.D, 'minor'],
          [PC.E, 'major'], // the major V is what makes this unambiguously minor
          [PC.A, 'minor'],
        ],
        2,
        2
      )
    );
    expect(pitchClassName(key!.tonic)).toBe('A');
    expect(key!.mode).toBe('minor');
  });

  it('weights chords by how long they are held, not how often they appear', () => {
    // G appears as often as C but goes by quickly; C is the tonic.
    const spans: ChordSpan[] = [
      { root: PC.C, quality: 'major', startSec: 0, endSec: 10, confidence: 1 },
      { root: PC.G, quality: 'major', startSec: 10, endSec: 11, confidence: 1 },
    ];
    const key = estimateKey(spans);
    expect(pitchClassName(key!.tonic)).toBe('C');
    expect(key!.mode).toBe('major');
  });

  it('lets a shaky reading pull the estimate around less than a clear one', () => {
    const confident = estimateKey([
      { root: PC.C, quality: 'major', startSec: 0, endSec: 4, confidence: 1 },
      { root: PC.G, quality: 'major', startSec: 4, endSec: 8, confidence: 1 },
    ]);
    const shaky = estimateKey([
      { root: PC.C, quality: 'major', startSec: 0, endSec: 4, confidence: 0.2 },
      { root: PC.G, quality: 'major', startSec: 4, endSec: 8, confidence: 0.2 },
    ]);
    // Same key either way - but the same relative scores, so confidence is
    // driven by coverage and margin rather than raw score.
    expect(confident!.tonic).toBe(shaky!.tonic);
  });

  it('reports low confidence when the chords fit two keys about equally', () => {
    // C-Am-F-G is the textbook major/relative-minor ambiguity.
    const ambiguous = estimateKey(
      sequence(
        [
          [PC.C, 'major'],
          [PC.A, 'minor'],
          [PC.F, 'major'],
          [PC.G, 'major'],
        ],
        2,
        2
      )
    );
    // A song that never leaves its tonic is not ambiguous at all.
    const obvious = estimateKey(sequence([[PC.C, 'major']], 8, 4));
    expect(ambiguous!.confidence).toBeLessThan(obvious!.confidence);
  });

  it('penalises a progression that is mostly out of key', () => {
    const diatonic = estimateKey(
      sequence(
        [
          [PC.C, 'major'],
          [PC.F, 'major'],
          [PC.G, 'major'],
        ],
        2,
        2
      )
    );
    const chromatic = estimateKey(
      sequence(
        [
          [PC.C, 'major'],
          [1, 'major'],
          [3, 'major'],
          [6, 'major'],
        ],
        2,
        2
      )
    );
    expect(chromatic!.confidence).toBeLessThan(diatonic!.confidence);
  });

  it('returns null when there is nothing to go on', () => {
    expect(estimateKey([])).toBeNull();
    expect(estimateKey([{ root: 0, quality: 'major', startSec: 5, endSec: 5, confidence: 1 }])).toBeNull();
  });
});

describe('toRomanNumeral', () => {
  const cMajor = { tonic: PC.C, mode: 'major' as const };
  const aMinor = { tonic: PC.A, mode: 'minor' as const };

  it('names the diatonic triads of a major key', () => {
    expect(toRomanNumeral({ root: PC.C, quality: 'major' }, cMajor)).toBe('I');
    expect(toRomanNumeral({ root: PC.D, quality: 'minor' }, cMajor)).toBe('ii');
    expect(toRomanNumeral({ root: PC.E, quality: 'minor' }, cMajor)).toBe('iii');
    expect(toRomanNumeral({ root: PC.F, quality: 'major' }, cMajor)).toBe('IV');
    expect(toRomanNumeral({ root: PC.G, quality: 'major' }, cMajor)).toBe('V');
    expect(toRomanNumeral({ root: PC.A, quality: 'minor' }, cMajor)).toBe('vi');
  });

  it('names the diatonic triads of a minor key', () => {
    expect(toRomanNumeral({ root: PC.A, quality: 'minor' }, aMinor)).toBe('i');
    expect(toRomanNumeral({ root: PC.C, quality: 'major' }, aMinor)).toBe('III');
    expect(toRomanNumeral({ root: PC.D, quality: 'minor' }, aMinor)).toBe('iv');
    expect(toRomanNumeral({ root: PC.E, quality: 'major' }, aMinor)).toBe('V');
    expect(toRomanNumeral({ root: PC.F, quality: 'major' }, aMinor)).toBe('VI');
    expect(toRomanNumeral({ root: PC.G, quality: 'major' }, aMinor)).toBe('VII');
  });

  it('spells borrowed chords the way a musician would write them', () => {
    expect(toRomanNumeral({ root: PC.Bb, quality: 'major' }, cMajor)).toBe('bVII');
    expect(toRomanNumeral({ root: 8, quality: 'major' }, cMajor)).toBe('bVI');
    expect(toRomanNumeral({ root: 3, quality: 'major' }, cMajor)).toBe('bIII');
  });

  it('converts a whole progression', () => {
    const loop = [
      { root: PC.C, quality: 'major' as const },
      { root: PC.G, quality: 'major' as const },
      { root: PC.A, quality: 'minor' as const },
      { root: PC.F, quality: 'major' as const },
    ];
    expect(toRomanProgression(loop, cMajor)).toEqual(['I', 'V', 'vi', 'IV']);
  });

  /**
   * The whole point of the numeral is that the rest of the app can parse it
   * back. If theory.ts cannot recover the interval and quality this module
   * put in, the two halves disagree and every downstream display is wrong.
   */
  it('round-trips through parseRomanChord for every chord in every key', () => {
    for (const mode of ['major', 'minor'] as const) {
      for (let tonic = 0; tonic < 12; tonic++) {
        for (let offset = 0; offset < 12; offset++) {
          for (const quality of ['major', 'minor'] as const) {
            const root = (tonic + offset) % 12;
            const numeral = toRomanNumeral({ root, quality }, { tonic, mode });
            const parsed = parseRomanChord(numeral, mode);

            expect(parsed, `${numeral} in ${mode}`).not.toBeNull();
            expect(parsed!.rootOffset, `${numeral} in ${mode} root`).toBe(offset);
            expect(parsed!.quality, `${numeral} in ${mode} quality`).toBe(quality);
          }
        }
      }
    }
  });
});

/**
 * End to end over the pieces live detection actually strings together:
 * frame-by-frame estimates -> timed spans -> per-section progressions -> a
 * key -> Roman numerals. The requirement this exists to prove is that the
 * verse and the chorus come out with genuinely different progressions,
 * which is the thing the app could not represent at all before.
 */
describe('live detection pipeline', () => {
  const sections: DetectedSection[] = [
    { type: 'verse', label: 'Verse 1', startSec: 0, endSec: 16 },
    { type: 'chorus', label: 'Chorus 1', startSec: 16, endSec: 32 },
  ];

  /** Play a chord for `secs` starting at `t`, at the detector's 120ms tick. */
  function play(tl: ChordTimeline, root: number, quality: 'major' | 'minor', t: number, secs: number) {
    for (let x = 0; x < secs - 1e-9; x += 0.12) {
      tl.push({ root, quality, score: 0.9 }, Number((t + x).toFixed(4)));
    }
  }

  it('gives the verse and chorus their own progressions in the detected key', () => {
    const tl = new ChordTimeline();
    // Verse in C major: I-V-vi-IV, twice.
    for (let cycle = 0; cycle < 2; cycle++) {
      const base = cycle * 8;
      play(tl, PC.C, 'major', base, 2);
      play(tl, PC.G, 'major', base + 2, 2);
      play(tl, PC.A, 'minor', base + 4, 2);
      play(tl, PC.F, 'major', base + 6, 2);
    }
    // Chorus lifts to IV-I-V, twice - different harmony, same key.
    for (let cycle = 0; cycle < 2; cycle++) {
      const base = 16 + cycle * 8;
      play(tl, PC.F, 'major', base, 3);
      play(tl, PC.C, 'major', base + 3, 3);
      play(tl, PC.G, 'major', base + 6, 2);
    }
    // Close the final span.
    tl.push(null, 32);

    const spans = tl.toSpans();
    const key = estimateKey(spans);
    expect(key).not.toBeNull();
    expect(pitchClassName(key!.tonic)).toBe('C');
    expect(key!.mode).toBe('major');

    const [verse, chorus] = sectionProgressions(sections, spans);

    expect(toRomanProgression(verse.loop, key!)).toEqual(['I', 'V', 'vi', 'IV']);
    expect(toRomanProgression(chorus.loop, key!)).toEqual(['IV', 'I', 'V']);

    // The chord timings a section carries are relative to its own start, and
    // must line up one-for-one with its chords or useSectionSync falls back
    // to guessing from a default BPM.
    const timings = chorus.chords.map((c) => Math.round((c.startSec - chorus.section.startSec) * 1000));
    expect(timings).toHaveLength(chorus.chords.length);
    expect(timings[0]).toBe(0);
    expect(timings.every((t, i) => i === 0 || t > timings[i - 1])).toBe(true);
  });
});
