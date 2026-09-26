/**
 * Chords, key and tempo from decoded audio, without a browser.
 *
 * The live pipeline (useLiveChordDetection) reads an AnalyserNode. This is the
 * same pipeline fed from a buffer of samples instead, so a server that has
 * decoded a preview clip gets the numbers the browser would have got from
 * hearing it: the chord detector's silence threshold is calibrated against what
 * a real AnalyserNode reports, so feeding it anything else - a different window,
 * a different scale - would quietly turn real music into "silence".
 *
 * What an AnalyserNode does, and therefore what SpectrumAnalyser reproduces:
 *   - takes the latest `fftSize` samples, ending "now", zero-padded at the start;
 *   - applies a Blackman window (alpha 0.16);
 *   - reports |X[k]| / fftSize;
 *   - smooths each bin against the previous reading: s = tau * s + (1 - tau) * |X|.
 *
 * The tick rates and sizes below mirror useLiveChordDetection. They are copied
 * rather than shared because that hook cannot be imported from here; keep the
 * two in step.
 *
 * Pure and dependency-free (no DOM, no Deno APIs) so it runs in the edge
 * function and under Vitest alike.
 */

import { ChordSmoother, chromaEnergy, chromaFromMagnitudes, matchChordTemplate } from './chordDetection.ts';
import type { ChordQuality } from './chordDetection.ts';
import { ChordTimeline } from './chordTimeline.ts';
import { estimateKey } from './keyEstimation.ts';
import type { KeyEstimate } from './keyEstimation.ts';
import { OnsetBuffer, estimateTempo, spectralFlux } from './tempoDetection.ts';
import type { TempoReading } from './tempoDetection.ts';

/** Chord analyser: high resolution for clean low-note bins, smoothed. */
const CHORD_FFT_SIZE = 8192;
const CHORD_SMOOTHING = 0.4;
const CHORD_TICK_MS = 120;
/** Onset analyser: fast and unsmoothed, so a drum hit is not blurred into its neighbours. */
const ONSET_FFT_SIZE = 1024;
const ONSET_TICK_MS = 20;
const ONSET_MAX_HZ = 8000;
/** How often the running key and tempo are re-derived, as the browser does. */
const SNAPSHOT_MS = 3000;
/** Bounds the work per request; a preview is 30 s, nothing here needs more. */
export const MAX_ANALYSIS_SEC = 45;

const CHORD_TICKS_PER_ONSET_TICK = CHORD_TICK_MS / ONSET_TICK_MS;
const ONSET_TICKS_PER_SNAPSHOT = SNAPSHOT_MS / ONSET_TICK_MS;

/** In-place radix-2 FFT of one fixed power-of-two size. */
export class Fft {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reversed: Uint32Array;

  constructor(readonly size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
    const half = size >> 1;
    this.cos = new Float64Array(half);
    this.sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    const bits = Math.log2(size);
    this.reversed = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reversed[i] = r;
    }
  }

  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.reversed[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = this.cos[t];
          const wi = -this.sin[t];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

/** What an AnalyserNode would report for a buffer, read at successive instants. */
export class SpectrumAnalyser {
  private readonly fft: Fft;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly smoothed: Float32Array;
  private readonly decibels: Float32Array;

  constructor(
    private readonly samples: Float32Array,
    readonly fftSize: number,
    private readonly smoothing: number
  ) {
    this.fft = new Fft(fftSize);
    this.window = new Float64Array(fftSize);
    const alpha = 0.16;
    for (let n = 0; n < fftSize; n++) {
      const x = (2 * Math.PI * n) / fftSize;
      this.window[n] = (1 - alpha) / 2 - 0.5 * Math.cos(x) + (alpha / 2) * Math.cos(2 * x);
    }
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
    this.smoothed = new Float32Array(fftSize / 2);
    this.decibels = new Float32Array(fftSize / 2);
  }

  /**
   * Linear magnitudes for the `fftSize` samples ending just before `endSample`.
   * The returned array is reused by the next call.
   */
  read(endSample: number): Float32Array {
    const n = this.fftSize;
    const first = endSample - n;
    for (let i = 0; i < n; i++) {
      const idx = first + i;
      this.re[i] = idx >= 0 && idx < this.samples.length ? this.samples[idx] * this.window[i] : 0;
      this.im[i] = 0;
    }
    this.fft.transform(this.re, this.im);
    const tau = this.smoothing;
    for (let k = 0; k < this.smoothed.length; k++) {
      const magnitude = Math.hypot(this.re[k], this.im[k]) / n;
      this.smoothed[k] = tau * this.smoothed[k] + (1 - tau) * magnitude;
    }
    return this.smoothed;
  }

  /** The same reading in dBFS, which is what getFloatFrequencyData returns. */
  readDecibels(endSample: number): Float32Array {
    const linear = this.read(endSample);
    for (let k = 0; k < linear.length; k++) this.decibels[k] = 20 * Math.log10(linear[k]);
    return this.decibels;
  }
}

export interface PreviewChord {
  root: number;
  quality: ChordQuality;
  startMs: number;
  endMs: number;
}

/** The key and tempo as they stood `atMs` into the clip - what a live listener would have seen. */
export interface PreviewSnapshot {
  atMs: number;
  key: KeyEstimate | null;
  tempo: TempoReading | null;
}

export interface PreviewAnalysis {
  durationMs: number;
  /** Chords in time order, on the clip's own clock (0 = first sample). */
  chords: PreviewChord[];
  /** Ascending in time; the last one is the whole-clip result. */
  snapshots: PreviewSnapshot[];
}

/** Average the channels, which is how an AnalyserNode sees a stereo input. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = Math.min(...channels.map((c) => c.length));
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i];
  }
  const scale = 1 / channels.length;
  for (let i = 0; i < length; i++) mono[i] *= scale;
  return mono;
}

/**
 * Run the live pipeline over `samples` (mono) as if they were being played
 * back in real time, but as fast as the CPU allows.
 */
export function analyzePcm(samples: Float32Array, sampleRate: number): PreviewAnalysis {
  if (!(sampleRate >= 8000 && sampleRate <= 192000)) throw new Error('Unsupported sample rate');

  const usable = samples.length > MAX_ANALYSIS_SEC * sampleRate
    ? samples.subarray(0, Math.floor(MAX_ANALYSIS_SEC * sampleRate))
    : samples;
  const durationMs = Math.round((usable.length / sampleRate) * 1000);

  const chordAnalyser = new SpectrumAnalyser(usable, CHORD_FFT_SIZE, CHORD_SMOOTHING);
  const onsetAnalyser = new SpectrumAnalyser(usable, ONSET_FFT_SIZE, 0);
  const onsetBinHz = sampleRate / ONSET_FFT_SIZE;
  const onsetMaxBin = Math.min(ONSET_FFT_SIZE / 2, Math.floor(ONSET_MAX_HZ / onsetBinHz));

  const smoother = new ChordSmoother();
  const timeline = new ChordTimeline();
  const onsets = new OnsetBuffer();
  const snapshots: PreviewSnapshot[] = [];
  let tempo: TempoReading | null = null;
  let previousOnsetDb: Float32Array | null = null;

  const snapshot = (atMs: number) => {
    // A null reading means "not enough clear beats right now", not "the tempo
    // went away" - keep the last good one, as the live hook does.
    tempo = estimateTempo(onsets.samples()) ?? tempo;
    snapshots.push({ atMs, key: estimateKey(timeline.toSpans()), tempo });
  };

  for (let tick = 1; ; tick++) {
    const endSample = Math.round((tick * ONSET_TICK_MS * sampleRate) / 1000);
    if (endSample > usable.length) break;
    const timeSec = endSample / sampleRate;

    const currentDb = onsetAnalyser.readDecibels(endSample);
    if (previousOnsetDb) {
      onsets.push(timeSec, spectralFlux(previousOnsetDb, currentDb, 1, onsetMaxBin));
    }
    // The analyser reuses its buffer, so keep a copy to compare the next tick against.
    previousOnsetDb = Float32Array.from(currentDb);

    if (tick % CHORD_TICKS_PER_ONSET_TICK === 0) {
      const linear = chordAnalyser.read(endSample);
      const chroma = chromaFromMagnitudes(linear, sampleRate, CHORD_FFT_SIZE);
      const energy = chromaEnergy(linear, sampleRate, CHORD_FFT_SIZE);
      timeline.push(smoother.push(matchChordTemplate(chroma, energy)), timeSec);
    }

    if (tick % ONSET_TICKS_PER_SNAPSHOT === 0) snapshot(Math.round(timeSec * 1000));
  }

  // The live hook recomputes once more on stop, so the tail is not lost.
  if (snapshots.length === 0 || snapshots[snapshots.length - 1].atMs < durationMs) snapshot(durationMs);

  return {
    durationMs,
    chords: timeline.toSpans().map((s) => ({
      root: s.root,
      quality: s.quality,
      startMs: Math.round(s.startSec * 1000),
      endMs: Math.round(s.endSec * 1000),
    })),
    snapshots,
  };
}
