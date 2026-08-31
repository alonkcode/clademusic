import { describe, expect, it } from 'vitest';
import { ChordSmoother, chromaFromMagnitudes, matchChordTemplate } from './chordDetection';

/** Build a chroma vector with energy at the given pitch classes, rest at zero. */
function chromaAt(...pitchClasses: number[]): number[] {
  const v = new Array(12).fill(0);
  for (const pc of pitchClasses) v[pc] = 1;
  return v;
}

describe('matchChordTemplate', () => {
  it('identifies a clean C major triad (C, E, G)', () => {
    const result = matchChordTemplate(chromaAt(0, 4, 7));
    expect(result?.root).toBe(0);
    expect(result?.quality).toBe('major');
  });

  it('identifies a clean G minor triad (G, Bb, D)', () => {
    const result = matchChordTemplate(chromaAt(7, 10, 2));
    expect(result?.root).toBe(7);
    expect(result?.quality).toBe('minor');
  });

  it('distinguishes major from minor by the third alone', () => {
    const major = matchChordTemplate(chromaAt(0, 4, 7)); // C E G
    const minor = matchChordTemplate(chromaAt(0, 3, 7)); // C Eb G
    expect(major?.quality).toBe('major');
    expect(minor?.quality).toBe('minor');
  });

  it('returns null for silence rather than forcing a guess', () => {
    expect(matchChordTemplate(new Array(12).fill(0))).toBeNull();
    expect(matchChordTemplate(new Array(12).fill(0.001))).toBeNull();
  });

  it('tolerates a 7th layered on top of the triad', () => {
    // Cmaj7: C E G B - still a clean major triad match on C.
    const result = matchChordTemplate(chromaAt(0, 4, 7, 11));
    expect(result?.root).toBe(0);
    expect(result?.quality).toBe('major');
  });
});

describe('chromaFromMagnitudes', () => {
  it('folds a pure tone into the correct pitch class', () => {
    // A4 = 440Hz. With fftSize=2048 at 44100Hz, bin width ~21.5Hz, so bin 20 ~ 430Hz.
    const sampleRate = 44100;
    const fftSize = 2048;
    const mags = new Array(fftSize / 2).fill(0);
    const binForA4 = Math.round(440 / (sampleRate / fftSize));
    mags[binForA4] = 1;

    const chroma = chromaFromMagnitudes(mags, sampleRate, fftSize);
    const loudest = chroma.indexOf(Math.max(...chroma));
    expect(loudest).toBe(9); // A = pitch class 9
  });

  it('produces a unit-normalised vector when there is signal', () => {
    const chroma = chromaFromMagnitudes([0, 1, 0, 0, 0, 1], 44100, 2048);
    const norm = Math.sqrt(chroma.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('returns an all-zero vector for silence rather than dividing by zero', () => {
    const chroma = chromaFromMagnitudes(new Array(1024).fill(0), 44100, 2048);
    expect(chroma.every((v) => v === 0)).toBe(true);
    expect(chroma.some((v) => Number.isNaN(v))).toBe(false);
  });
});

describe('ChordSmoother', () => {
  it('holds a chord steady against a single differing frame', () => {
    const smoother = new ChordSmoother(5);
    const c = { root: 0, quality: 'major' as const, score: 0.9 };
    const other = { root: 5, quality: 'minor' as const, score: 0.5 };

    smoother.push(c);
    smoother.push(c);
    smoother.push(c);
    const result = smoother.push(other); // a single transient blip
    expect(result?.root).toBe(0);
    expect(result?.quality).toBe('major');
  });

  it('follows a sustained change once it dominates the window', () => {
    const smoother = new ChordSmoother(4);
    const c = { root: 0, quality: 'major' as const, score: 0.9 };
    const next = { root: 7, quality: 'major' as const, score: 0.9 };

    smoother.push(c);
    smoother.push(c);
    smoother.push(next);
    smoother.push(next);
    const result = smoother.push(next);
    expect(result?.root).toBe(7);
  });

  it('treats null (silence) as its own stable state', () => {
    const smoother = new ChordSmoother(3);
    smoother.push(null);
    smoother.push(null);
    expect(smoother.push(null)).toBeNull();
  });
});
