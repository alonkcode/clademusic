import { describe, it, expect } from 'vitest';
import {
  Fft,
  MAX_ANALYSIS_SEC,
  SpectrumAnalyser,
  analyzePcm,
  mixToMono,
} from '../../../supabase/functions/_shared/dsp/previewAnalysis';

/**
 * Real PCM in, the live pipeline's answers out. Nothing here fakes a spectrum:
 * the audio is synthesized sample by sample, so the FFT, the analyser scaling
 * and the detectors' thresholds are all exercised together - the thresholds
 * are calibrated against a browser AnalyserNode, so a scaling slip here is
 * exactly what would make every clip read as silence.
 */

const SAMPLE_RATE = 44100;
const midiHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** C, G, Am, F. */
const PROGRESSION = [
  [48, 52, 55],
  [43, 47, 50],
  [45, 48, 52],
  [41, 45, 48],
];

/** Small deterministic PRNG so the noise in the fixture is the same every run. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000 - 0.5;
  };
}

interface SynthOptions {
  seconds: number;
  sampleRate?: number;
  /** Peak level of each partial. 0.1 puts a four-note mix near -17 dBFS RMS, like a mastered track. */
  partialLevel?: number;
  /** Seconds each chord lasts. */
  chordSec?: number;
  /** Beats per minute of the percussive click, or 0 for none. */
  bpm?: number;
}

function synth({ seconds, sampleRate = SAMPLE_RATE, partialLevel = 0.1, chordSec = 2, bpm = 120 }: SynthOptions) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const noise = lcg(7);
  const beatSec = bpm > 0 ? 60 / bpm : 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const chord = PROGRESSION[Math.floor(t / chordSec) % PROGRESSION.length];
    let v = 0;
    for (const midi of chord) {
      for (const harmonic of [1, 2, 3, 4]) {
        v += (partialLevel / harmonic) * Math.sin(2 * Math.PI * midiHz(midi) * harmonic * t);
      }
    }
    if (beatSec > 0) {
      const sinceBeat = t % beatSec;
      // A short broadband burst on each beat: an onset with no pitch to speak of.
      if (sinceBeat < 0.05) v += 0.25 * noise() * Math.exp(-sinceBeat / 0.012);
    }
    out[i] = v;
  }
  return out;
}

const dbfsRms = (samples: Float32Array) => {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return 10 * Math.log10(sum / samples.length);
};

describe('Fft', () => {
  it('puts a bin-centred cosine in exactly that bin', () => {
    const n = 64;
    const fft = new Fft(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    fft.transform(re, im);
    expect(Math.hypot(re[5], im[5])).toBeCloseTo(n / 2, 6);
    expect(Math.hypot(re[6], im[6])).toBeLessThan(1e-9);
  });

  it('refuses a size that is not a power of two', () => {
    expect(() => new Fft(1000)).toThrow();
  });
});

describe('SpectrumAnalyser', () => {
  it('reports a full-scale sine at about -13.5 dB, as a browser AnalyserNode does', () => {
    const fftSize = 8192;
    const bin = 200;
    const hz = (bin * SAMPLE_RATE) / fftSize;
    const samples = new Float32Array(fftSize * 2);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);

    const db = new SpectrumAnalyser(samples, fftSize, 0).readDecibels(fftSize * 2);
    let peak = 0;
    for (let k = 1; k < db.length; k++) if (db[k] > db[peak]) peak = k;

    expect(peak).toBe(bin);
    // The comment on SILENCE_ENERGY_THRESHOLD is calibrated to this figure.
    expect(db[peak]).toBeGreaterThan(-14);
    expect(db[peak]).toBeLessThan(-13);
  });

  it('smooths each bin against the previous reading', () => {
    const fftSize = 1024;
    const samples = new Float32Array(fftSize * 2);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 100 * i) / fftSize);
    const analyser = new SpectrumAnalyser(samples, fftSize, 0.4);
    const first = analyser.read(fftSize)[100];
    const second = analyser.read(fftSize)[100];
    // The same input twice: 0.6x, then 0.4 * 0.6x + 0.6x = 0.84x.
    expect(second / first).toBeCloseTo(1.4, 3);
  });
});

describe('mixToMono', () => {
  it('averages the channels', () => {
    const mono = mixToMono([Float32Array.of(1, 0, 0.5), Float32Array.of(0, 1, 0.5)]);
    expect(Array.from(mono)).toEqual([0.5, 0.5, 0.5]);
  });

  it('passes a mono channel through and copes with none', () => {
    const one = Float32Array.of(0.1, 0.2);
    expect(mixToMono([one])).toBe(one);
    expect(mixToMono([]).length).toBe(0);
  });
});

describe('analyzePcm', () => {
  const clip = synth({ seconds: 30 });
  const result = analyzePcm(clip, SAMPLE_RATE);

  it('is a realistically loud fixture, not a trivially loud one', () => {
    expect(dbfsRms(clip)).toBeGreaterThan(-20);
    expect(dbfsRms(clip)).toBeLessThan(-8);
  });

  it('hears the progression, in order, on the clip clock', () => {
    // Each chord lasts 2 s; allow for the detector's smoothing lag at the edges.
    const heard = result.chords.filter((c) => c.endMs - c.startMs >= 1000);
    const names = heard.slice(0, 8).map((c) => `${c.root}${c.quality === 'minor' ? 'm' : ''}`);
    expect(names).toEqual(['0', '7', '9m', '5', '0', '7', '9m', '5']);

    // C should start near 0 s, G near 2 s...
    expect(heard[0].startMs).toBeLessThan(600);
    expect(Math.abs(heard[1].startMs - 2000)).toBeLessThan(600);
  });

  it('keeps its chords ordered, disjoint and inside the clip', () => {
    expect(result.durationMs).toBe(30000);
    for (let i = 0; i < result.chords.length; i++) {
      const c = result.chords[i];
      expect(c.startMs).toBeGreaterThanOrEqual(0);
      expect(c.endMs).toBeLessThanOrEqual(result.durationMs);
      expect(c.endMs).toBeGreaterThan(c.startMs);
      if (i > 0) expect(c.startMs).toBeGreaterThanOrEqual(result.chords[i - 1].endMs);
    }
  });

  it('finds the key, and the key is C major', () => {
    const final = result.snapshots[result.snapshots.length - 1];
    expect(final.key).not.toBeNull();
    expect(final.key?.tonic).toBe(0);
    expect(final.key?.mode).toBe('major');
  });

  it('finds the tempo', () => {
    const final = result.snapshots[result.snapshots.length - 1];
    expect(final.tempo).not.toBeNull();
    expect(Math.abs((final.tempo?.bpm ?? 0) - 120)).toBeLessThan(3);
  });

  it('reports the running key and tempo every few seconds, ending at the clip end', () => {
    const times = result.snapshots.map((s) => s.atMs);
    expect(times[0]).toBe(3000);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[times.length - 1]).toBe(30000);
    // Early on there is not enough of the song to say; a later snapshot knows more.
    expect(result.snapshots[0].tempo).toBeNull();
  });

  it('still hears the chords when the track is turned well down', () => {
    const quiet = analyzePcm(synth({ seconds: 20, partialLevel: 0.008 }), SAMPLE_RATE);
    expect(dbfsRms(synth({ seconds: 4, partialLevel: 0.008 }))).toBeLessThan(-28);
    expect(quiet.chords.length).toBeGreaterThanOrEqual(6);
    expect(quiet.chords[0].root).toBe(0);
  });

  it('hears nothing in silence: no chords, no key, no tempo', () => {
    const silent = analyzePcm(new Float32Array(SAMPLE_RATE * 15), SAMPLE_RATE);
    expect(silent.chords).toEqual([]);
    const final = silent.snapshots[silent.snapshots.length - 1];
    expect(final.key).toBeNull();
    expect(final.tempo).toBeNull();
  });

  it('gives a clip with no percussion chords and a key but no tempo', () => {
    const drumless = analyzePcm(synth({ seconds: 20, bpm: 0 }), SAMPLE_RATE);
    const final = drumless.snapshots[drumless.snapshots.length - 1];
    expect(drumless.chords.length).toBeGreaterThan(5);
    expect(final.key?.tonic).toBe(0);
    expect(final.tempo).toBeNull();
  });

  it('analyses at most MAX_ANALYSIS_SEC of a longer input', () => {
    const rate = 8000; // keeps the fixture small; the cap is in seconds, not samples
    const long = analyzePcm(new Float32Array((MAX_ANALYSIS_SEC + 15) * rate), rate);
    expect(long.durationMs).toBe(MAX_ANALYSIS_SEC * 1000);
  });

  it('rejects a sample rate that cannot be right', () => {
    expect(() => analyzePcm(new Float32Array(1000), 0)).toThrow();
    expect(() => analyzePcm(new Float32Array(1000), Number.NaN)).toThrow();
  });

  it('copes with a clip shorter than one analysis window', () => {
    const tiny = analyzePcm(new Float32Array(500), SAMPLE_RATE);
    expect(tiny.chords).toEqual([]);
    expect(tiny.snapshots).toHaveLength(1);
  });
});
