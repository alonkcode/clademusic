import { describe, expect, it } from 'vitest';
import {
  CHORD_STATES,
  ChordSmoother,
  chordChromas,
  chromaEnergy,
  chromaFromMagnitudes,
  harmonyChroma,
  matchChordTemplate,
  scoreChordTemplates,
} from './chordDetection';

/** Build a chroma vector with energy at the given pitch classes, rest at zero. */
function chromaAt(...pitchClasses: number[]): number[] {
  const v = new Array(12).fill(0);
  for (const pc of pitchClasses) v[pc] = 1;
  return v;
}

/** matchChordTemplate takes chroma and its pre-normalization energy
 *  separately; the fixtures above are already at unit-ish scale, so a
 *  comfortably-above-threshold constant stands in for "there is signal". */
const LOUD = 1;

describe('matchChordTemplate', () => {
  it('identifies a clean C major triad (C, E, G)', () => {
    const result = matchChordTemplate(chromaAt(0, 4, 7), LOUD);
    expect(result?.root).toBe(0);
    expect(result?.quality).toBe('major');
  });

  it('identifies a clean G minor triad (G, Bb, D)', () => {
    const result = matchChordTemplate(chromaAt(7, 10, 2), LOUD);
    expect(result?.root).toBe(7);
    expect(result?.quality).toBe('minor');
  });

  it('distinguishes major from minor by the third alone', () => {
    const major = matchChordTemplate(chromaAt(0, 4, 7), LOUD); // C E G
    const minor = matchChordTemplate(chromaAt(0, 3, 7), LOUD); // C Eb G
    expect(major?.quality).toBe('major');
    expect(minor?.quality).toBe('minor');
  });

  it('returns null for silence rather than forcing a guess, regardless of the (rescaled) chroma shape', () => {
    expect(matchChordTemplate(new Array(12).fill(0), 0)).toBeNull();
    // chromaFromMagnitudes always unit-normalizes non-silent input, so a
    // "clean triad" chroma shape at negligible real energy must still read as
    // silence - this is exactly the bug this signature split fixes. (1e-9 is
    // an inaudible hiss; see SILENCE_ENERGY_THRESHOLD for the real scale.)
    expect(matchChordTemplate(chromaAt(0, 4, 7), 1e-9)).toBeNull();
  });

  it('tolerates a 7th layered on top of the triad', () => {
    // Cmaj7: C E G B - still a clean major triad match on C.
    const result = matchChordTemplate(chromaAt(0, 4, 7, 11), LOUD);
    expect(result?.root).toBe(0);
    expect(result?.quality).toBe('major');
  });
});

describe('scoreChordTemplates', () => {
  it('scores all 24 triads in CHORD_STATES order, with the played chord on top', () => {
    const scores = scoreChordTemplates(chromaAt(9, 0, 4), LOUD); // A C E
    expect(scores).toHaveLength(CHORD_STATES.length);

    const best = scores!.indexOf(Math.max(...scores!));
    expect(CHORD_STATES[best]).toEqual({ root: 9, quality: 'minor' });
  });

  it('lists each root major first, then minor', () => {
    expect(CHORD_STATES).toHaveLength(24);
    expect(CHORD_STATES.slice(0, 4)).toEqual([
      { root: 0, quality: 'major' },
      { root: 0, quality: 'minor' },
      { root: 1, quality: 'major' },
      { root: 1, quality: 'minor' },
    ]);
  });

  it('returns null below the silence gate, like matchChordTemplate', () => {
    expect(scoreChordTemplates(chromaAt(0, 4, 7), 1e-9)).toBeNull();
    expect(scoreChordTemplates(chromaAt(0, 4, 7), LOUD)).not.toBeNull();
  });

  it('agrees with matchChordTemplate about the winner and its score', () => {
    const chroma = chromaAt(7, 10, 2);
    const scores = scoreChordTemplates(chroma, LOUD)!;
    const match = matchChordTemplate(chroma, LOUD)!;
    expect(CHORD_STATES[scores.indexOf(Math.max(...scores))]).toMatchObject({ root: match.root, quality: match.quality });
    expect(Math.max(...scores)).toBeCloseTo(match.score, 12);
  });
});

describe('chromaEnergy', () => {
  it('is zero for silence', () => {
    expect(chromaEnergy(new Array(1024).fill(0), 44100, 2048)).toBe(0);
  });

  it('grows with the input magnitude, unlike chromaFromMagnitudes\' own (always ~unit) norm', () => {
    const quiet = chromaEnergy([0, 0.01, 0, 0, 0, 0.01], 44100, 2048);
    const loud = chromaEnergy([0, 1, 0, 0, 0, 1], 44100, 2048);
    expect(loud).toBeGreaterThan(quiet);

    const quietChroma = chromaFromMagnitudes([0, 0.01, 0, 0, 0, 0.01], 44100, 2048);
    const loudChroma = chromaFromMagnitudes([0, 1, 0, 0, 0, 1], 44100, 2048);
    const quietNorm = Math.sqrt(quietChroma.reduce((s, v) => s + v * v, 0));
    const loudNorm = Math.sqrt(loudChroma.reduce((s, v) => s + v * v, 0));
    expect(quietNorm).toBeCloseTo(loudNorm, 5); // both ~1 - the chroma vector alone can't tell them apart
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

/**
 * The spectrum a mix of notes would give at the detector's real resolution:
 * each partial is a peak at its nearest bin with a little window leakage either
 * side. `cents` detunes a note, as vibrato does.
 */
const MIX_RATE = 44100;
const MIX_FFT = 8192;
interface Voice {
  midi: number;
  gain: number;
  partials: number[];
  cents?: number;
}
const PAD_PARTIALS = [1, 0.5, 0.33, 0.25, 0.2, 0.17];
/** A sung vowel: the 2nd-4th harmonics as strong as the fundamental. */
const VOICE_PARTIALS = [1, 1.3, 1.1, 0.8, 0.5, 0.35, 0.25, 0.18];

function mixSpectrum(voices: Voice[]): Float32Array {
  const mags = new Float32Array(MIX_FFT / 2);
  const binHz = MIX_RATE / MIX_FFT;
  for (const v of voices) {
    const f0 = 440 * Math.pow(2, (v.midi - 69 + (v.cents ?? 0) / 100) / 12);
    v.partials.forEach((g, i) => {
      const bin = Math.round((f0 * (i + 1)) / binHz);
      if (bin + 1 >= mags.length) return;
      mags[bin] += v.gain * g;
      mags[bin - 1] += 0.4 * v.gain * g;
      mags[bin + 1] += 0.4 * v.gain * g;
    });
  }
  return mags;
}

const C_MAJOR_PAD: Voice[] = [
  { midi: 36, gain: 1, partials: PAD_PARTIALS.slice(0, 4) }, // bass C2
  { midi: 60, gain: 1, partials: PAD_PARTIALS },
  { midi: 64, gain: 1, partials: PAD_PARTIALS },
  { midi: 67, gain: 1, partials: PAD_PARTIALS },
];
/** A D sung well over the C chord, a little sharp: a 9th, not a chord tone. */
const LOUD_SUNG_D: Voice = { midi: 74, gain: 4, partials: VOICE_PARTIALS, cents: 30 };

describe('harmonyChroma', () => {
  it('takes a loud sung line out, so the chord under it is what gets named', () => {
    const mags = mixSpectrum([...C_MAJOR_PAD, LOUD_SUNG_D]);

    // The whole mix follows the singer.
    expect(matchChordTemplate(chromaFromMagnitudes(mags, MIX_RATE, MIX_FFT), 1)).not.toMatchObject({ root: 0, quality: 'major' });
    // With the line removed, the pad and bass decide.
    expect(matchChordTemplate(harmonyChroma(mags, MIX_RATE, MIX_FFT), 1)).toMatchObject({ root: 0, quality: 'major' });
  });

  it('keeps the line when it is all there is, since then it is the harmony', () => {
    const mags = mixSpectrum([{ midi: 69, gain: 1, partials: VOICE_PARTIALS }]);
    const { harmony, mix } = chordChromas(mags, MIX_RATE, MIX_FFT);
    expect(harmony).toEqual(mix);
    expect(harmony.indexOf(Math.max(...harmony))).toBe(9); // A
  });

  it('returns unit-normalized chroma, and all zeros for silence', () => {
    const chroma = harmonyChroma(mixSpectrum(C_MAJOR_PAD), MIX_RATE, MIX_FFT);
    expect(Math.hypot(...chroma)).toBeCloseTo(1, 5);

    const silent = chordChromas(new Float32Array(MIX_FFT / 2), MIX_RATE, MIX_FFT);
    expect(silent.harmony.every((v) => v === 0)).toBe(true);
    expect(silent.mix.every((v) => v === 0)).toBe(true);
  });

  it('agrees with chordChromas', () => {
    const mags = mixSpectrum([...C_MAJOR_PAD, LOUD_SUNG_D]);
    expect(harmonyChroma(mags, MIX_RATE, MIX_FFT)).toEqual(chordChromas(mags, MIX_RATE, MIX_FFT).harmony);
  });
});

describe('matchChordTemplate with the whole mix as a second reading', () => {
  it('still names a bare pad, whose top note the lead-line removal takes for a melody', () => {
    const { harmony, mix } = chordChromas(mixSpectrum(C_MAJOR_PAD), MIX_RATE, MIX_FFT);
    expect(matchChordTemplate(harmony, 1, mix)).toMatchObject({ root: 0, quality: 'major' });
  });

  it('still names the chord under a loud sung line', () => {
    const { harmony, mix } = chordChromas(mixSpectrum([...C_MAJOR_PAD, LOUD_SUNG_D]), MIX_RATE, MIX_FFT);
    expect(matchChordTemplate(harmony, 1, mix)).toMatchObject({ root: 0, quality: 'major' });
  });

  it('keeps the silence gate', () => {
    const { harmony, mix } = chordChromas(mixSpectrum(C_MAJOR_PAD), MIX_RATE, MIX_FFT);
    expect(matchChordTemplate(harmony, 0, mix)).toBeNull();
  });
});

/**
 * Regression: the silence gate was 0.02, tuned against unit-scale fixtures. A
 * real AnalyserNode reports a chord's strongest bin around -30 to -40 dB (a
 * full-scale sine is only about -13.5 dB after its window), which is an energy
 * of roughly 1e-3 - twenty times under the gate. Every real capture was called
 * silence: no chord, no key, no saved analysis, while tempo detection (which
 * does not depend on level) carried on working.
 *
 * These build spectra the way getFloatFrequencyData reports them - in dB, with
 * a -100 dB floor - and convert back to linear exactly as the hook does.
 */
describe('against real analyser levels', () => {
  const SAMPLE_RATE = 48000;
  const FFT_SIZE = 8192;

  /** A chord's partials as the analyser would show them; `strongestDb` is the loudest bin. */
  function analyserSpectrum(midiNotes: number[], strongestDb: number): Float32Array {
    const db = new Float32Array(FFT_SIZE / 2).fill(-100);
    const binHz = SAMPLE_RATE / FFT_SIZE;
    for (const midi of midiNotes) {
      const fundamental = 440 * Math.pow(2, (midi - 69) / 12);
      for (const harmonic of [1, 2, 3, 4]) {
        const bin = Math.round((fundamental * harmonic) / binHz);
        if (bin < db.length) db[bin] = Math.max(db[bin], strongestDb - 6 * (harmonic - 1));
      }
    }
    const linear = new Float32Array(db.length);
    for (let i = 0; i < db.length; i++) linear[i] = Math.pow(10, db[i] / 20);
    return linear;
  }

  const detect = (linear: Float32Array) =>
    matchChordTemplate(
      chromaFromMagnitudes(linear, SAMPLE_RATE, FFT_SIZE),
      chromaEnergy(linear, SAMPLE_RATE, FFT_SIZE)
    );

  const C_MAJOR = [48, 52, 55];
  const A_MINOR = [45, 48, 52];

  it.each([
    ['a very loud mix (strongest bin -30 dB)', -30],
    ['a typical mastered track (-38 dB)', -38],
    ['a quiet passage (-50 dB)', -50],
    ['the player turned well down (-60 dB)', -60],
  ])('hears the chord in %s', (_label, strongestDb) => {
    expect(detect(analyserSpectrum(C_MAJOR, strongestDb))).toMatchObject({ root: 0, quality: 'major' });
    expect(detect(analyserSpectrum(A_MINOR, strongestDb))).toMatchObject({ root: 9, quality: 'minor' });
  });

  it('still calls digital silence silence', () => {
    // The analyser reports -Infinity for exact silence, which converts to 0.
    const silent = new Float32Array(FFT_SIZE / 2).fill(0);
    expect(detect(silent)).toBeNull();
  });

  it('still calls a spectrum at the analyser\'s -100 dB floor silence', () => {
    const floor = new Float32Array(FFT_SIZE / 2).fill(Math.pow(10, -100 / 20));
    expect(detect(floor)).toBeNull();
  });

  it('gives up on a chord too quiet to be worth trusting (-100 dB)', () => {
    expect(detect(analyserSpectrum(C_MAJOR, -100))).toBeNull();
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
