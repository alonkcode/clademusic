/**
 * Tempo from the audio itself.
 *
 * The rest of the live pipeline tells you WHAT is playing (chords, key,
 * sections) but nothing measures HOW FAST: tempoFromAnalysis.ts only infers a
 * BPM after the fact from chord timings that already exist, so a track nobody
 * has analysed has no tempo at all. This measures it from the captured audio.
 *
 * The method is the standard one:
 *
 *   1. Onset strength: how much new energy arrives in each short frame
 *      (half-wave-rectified spectral flux). Drums and chord attacks show up as
 *      spikes, sustained notes as nothing.
 *   2. Autocorrelate that envelope. A steady pulse makes it correlate with
 *      itself one beat later, so the strongest repeat lag is the beat period.
 *   3. Choose between a tempo and its double/half. Autocorrelation alone cannot
 *      tell 60 from 120 from 240, so lags that are multiples of a candidate
 *      reinforce it (a real beat also repeats every two and four beats) and a
 *      mild preference for the range people actually tap in breaks what is left.
 *
 * Everything here is a pure function of timestamped samples so it can be
 * tested on synthetic pulse trains. Timestamps come from the audio clock, not
 * from setInterval: timers drift and get throttled, and a jittery timestamp is
 * indistinguishable from a tempo change.
 *
 * What it is NOT: a beat tracker. It reports one steady tempo for the stretch
 * it was given, which is what a track-level BPM is. A song that changes tempo
 * gets the tempo of its most recent minute.
 */

export interface OnsetSample {
  /** Audio-clock seconds. */
  timeSec: number;
  /** Onset strength for the frame ending at `timeSec`. */
  flux: number;
}

export interface TempoReading {
  bpm: number;
  /** 0-1: how clearly periodic the audio was. Low for ambient or rubato music. */
  confidence: number;
}

/** Search range. Wider than this and the answer is more likely an octave error than a real tempo. */
export const TEMPO_SEARCH_MIN_BPM = 60;
export const TEMPO_SEARCH_MAX_BPM = 200;

/** Uniform grid the irregular samples are resampled onto before correlating. */
const GRID_HZ = 100;
/** Most recent audio used. Long enough for a steady estimate, short enough to follow a tempo change. */
const MAX_WINDOW_SEC = 60;
/** Below this there are not enough beats to correlate against each other. */
const MIN_SPAN_SEC = 12;
/** A background tab throttles timers to ~1 Hz; a sparse envelope cannot show a beat. */
const MIN_SAMPLE_RATE_HZ = 15;
/** A gap this long in the samples is missing data, not a slow ramp to interpolate across. */
const MAX_GAP_SEC = 0.25;
/** Local-mean window subtracted from the envelope so peaks stand out from the baseline. */
const BASELINE_WINDOW_SEC = 0.5;
/** People tap around here; used only to break octave ties. */
const PRIOR_CENTER_BPM = 120;
const PRIOR_SIGMA_OCTAVES = 1.0;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** dBFS -> 0..1. getFloatFrequencyData reports -Infinity for digital silence. */
function dbToUnit(db: number): number {
  return Number.isFinite(db) ? clamp01((db + 100) / 100) : 0;
}

/**
 * Onset strength between two consecutive analyser frames: the total amount by
 * which bins got LOUDER. Falling energy is ignored on purpose - a note dying
 * away is not an onset.
 *
 * `minBin`/`maxBin` bound the bins used. Below the lowest bins is rumble and
 * DC; above a few kHz is cymbal wash that smears across frames.
 */
export function spectralFlux(
  prevDb: ArrayLike<number>,
  currDb: ArrayLike<number>,
  minBin = 1,
  maxBin = Infinity
): number {
  const hi = Math.min(maxBin, currDb.length, prevDb.length);
  let sum = 0;
  for (let k = minBin; k < hi; k++) {
    const rise = dbToUnit(currDb[k]) - dbToUnit(prevDb[k]);
    if (rise > 0) sum += rise;
  }
  return sum;
}

/**
 * Recent onset samples, bounded. The capture can run for a whole song and
 * nothing here needs more than the last minute or so.
 */
export class OnsetBuffer {
  private samples_: OnsetSample[] = [];
  private start = 0;

  constructor(private readonly maxSpanSec = MAX_WINDOW_SEC * 1.5) {}

  push(timeSec: number, flux: number): void {
    const n = this.samples_.length;
    // Audio-clock time only moves forward; a repeat or step back is a duplicate read.
    if (n > this.start && timeSec <= this.samples_[n - 1].timeSec) return;
    this.samples_.push({ timeSec, flux: Number.isFinite(flux) ? flux : 0 });

    while (
      this.start < this.samples_.length - 1 &&
      timeSec - this.samples_[this.start].timeSec > this.maxSpanSec
    ) {
      this.start++;
    }
    // Drop the trimmed prefix now and then rather than on every push.
    if (this.start > 2048) {
      this.samples_ = this.samples_.slice(this.start);
      this.start = 0;
    }
  }

  samples(): OnsetSample[] {
    return this.start === 0 ? this.samples_ : this.samples_.slice(this.start);
  }

  reset(): void {
    this.samples_ = [];
    this.start = 0;
  }
}

/** Linear-interpolate the irregular samples onto a uniform GRID_HZ grid; gaps become 0. */
function resampleToGrid(win: readonly OnsetSample[]): Float64Array {
  const t0 = win[0].timeSec;
  const span = win[win.length - 1].timeSec - t0;
  const n = Math.floor(span * GRID_HZ) + 1;
  const out = new Float64Array(n);

  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / GRID_HZ;
    while (j < win.length - 2 && win[j + 1].timeSec < t) j++;
    const a = win[j];
    const b = win[j + 1];
    const dt = b.timeSec - a.timeSec;
    if (dt > MAX_GAP_SEC || t < a.timeSec || t > b.timeSec) {
      out[i] = 0;
      continue;
    }
    out[i] = dt <= 0 ? a.flux : a.flux + ((b.flux - a.flux) * (t - a.timeSec)) / dt;
  }
  return out;
}

/** x minus its local mean, half-wave rectified, then zero-mean overall. */
function onsetEnvelope(grid: Float64Array): Float64Array {
  const n = grid.length;
  const w = Math.max(1, Math.round(BASELINE_WINDOW_SEC * GRID_HZ));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + grid[i];

  const env = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w);
    const hi = Math.min(n, i + w + 1);
    const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
    const v = Math.max(0, grid[i] - mean);
    env[i] = v;
    total += v;
  }
  const overall = total / n;
  for (let i = 0; i < n; i++) env[i] -= overall;
  return env;
}

/** Unbiased autocorrelation for lags 0..maxLag, normalised so lag 0 is 1. Null for a flat signal. */
function autocorrelation(z: Float64Array, maxLag: number): Float64Array | null {
  const n = z.length;
  const r = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += z[i] * z[i + lag];
    r[lag] = sum / (n - lag);
  }
  if (!(r[0] > 1e-12)) return null;
  for (let lag = maxLag; lag >= 0; lag--) r[lag] /= r[0];
  return r;
}

/** Highest neighbour within one lag: a multiple of a non-integer period lands between grid points. */
const around = (r: Float64Array, lag: number) => {
  const i = Math.round(lag);
  return Math.max(r[Math.max(0, i - 1)] ?? 0, r[i] ?? 0, r[i + 1] ?? 0);
};

/** Sub-sample position and height of the local maximum near `center`, by a parabola through 3 points. */
function refinePeak(r: Float64Array, center: number, radius: number): { pos: number; value: number } {
  const lo = Math.max(1, Math.round(center) - radius);
  const hi = Math.min(r.length - 2, Math.round(center) + radius);
  // Past the end of what was correlated: nothing to find, and reporting the
  // centre with no height makes the caller drop it.
  if (lo > hi) return { pos: center, value: 0 };
  let best = lo;
  for (let i = lo; i <= hi; i++) if (r[i] > r[best]) best = i;

  const y0 = r[best - 1];
  const y1 = r[best];
  const y2 = r[best + 1];
  const denom = y0 - 2 * y1 + y2;
  const delta = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;
  return { pos: best + delta, value: y1 };
}

const priorWeight = (bpm: number) =>
  Math.exp(-0.5 * Math.pow(Math.log2(bpm / PRIOR_CENTER_BPM) / PRIOR_SIGMA_OCTAVES, 2));

/**
 * The steady tempo of the most recent stretch of audio, or null when there is
 * not enough clean signal to say. Returning null is the normal answer to
 * silence, a paused track, or a background-throttled tab - a wrong BPM is
 * worse than none.
 */
export function estimateTempo(samples: readonly OnsetSample[]): TempoReading | null {
  if (samples.length < 2) return null;

  const lastT = samples[samples.length - 1].timeSec;
  const cutoff = lastT - MAX_WINDOW_SEC;
  const win = samples.filter((s) => s.timeSec >= cutoff);
  if (win.length < 2) return null;

  const span = lastT - win[0].timeSec;
  if (span < MIN_SPAN_SEC) return null;
  if (win.length / span < MIN_SAMPLE_RATE_HZ) return null;

  const z = onsetEnvelope(resampleToGrid(win));

  const minLag = Math.floor((GRID_HZ * 60) / TEMPO_SEARCH_MAX_BPM);
  const maxLag = Math.ceil((GRID_HZ * 60) / TEMPO_SEARCH_MIN_BPM);
  // Reach out to four beats for the reinforcement below, plus a lag of slack
  // for the neighbour lookup and the parabola.
  const r = autocorrelation(z, maxLag * 4 + 2);
  if (!r) return null;

  let bestLag = -1;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (GRID_HZ * 60) / lag;
    // A beat also repeats every two and four beats, so those lags vouch for
    // this one. That is what separates a tempo from its half: 60 BPM has a
    // peak at the 120 BPM lag too, but 120 has no peak at the 60 BPM lag's
    // half-beat unless the music really subdivides that way.
    const score =
      (Math.max(0, r[lag]) + 0.5 * Math.max(0, around(r, lag * 2)) + 0.25 * Math.max(0, around(r, lag * 4))) *
      priorWeight(bpm);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || !(bestScore > 0)) return null;

  // The fundamental, then its 2x and 4x repeats: each is a peak at a multiple
  // of the same period, so measuring the far one and dividing gives the period
  // to a fraction of a sample. It only helps for a tempo that holds steady, so
  // a repeat that has faded is left out rather than trusted.
  //
  // A weighted mean of the per-beat period estimates pos/m, weighting each by
  // m (the farther peak pins the period down m times more tightly), which
  // reduces to summing the peak positions and dividing by the summed weights.
  const p1 = refinePeak(r, bestLag, 2);
  let posSum = p1.pos;
  let weightSum = 1;
  for (const m of [2, 4]) {
    const p = refinePeak(r, p1.pos * m, 2 + m);
    if (p.value >= 0.25 * p1.value && Math.abs(p.pos / m - p1.pos) < 1.5) {
      posSum += p.pos;
      weightSum += m;
    }
  }
  const periodSamples = posSum / weightSum;
  const bpm = (GRID_HZ * 60) / periodSamples;
  if (!Number.isFinite(bpm) || bpm < TEMPO_SEARCH_MIN_BPM - 1 || bpm > TEMPO_SEARCH_MAX_BPM + 1) return null;

  // Confidence: the beat lag has to correlate strongly AND stand out from the
  // lags around it. A drone or a rubato passage does neither.
  const peak = p1.value;
  let meanR = 0;
  for (let lag = minLag; lag <= maxLag; lag++) meanR += Math.max(0, r[lag]);
  meanR /= maxLag - minLag + 1;
  const contrast = peak > 1e-9 ? (peak - meanR) / peak : 0;
  const confidence = clamp01((peak - 0.1) / 0.5) * clamp01(contrast);

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.round(confidence * 1000) / 1000,
  };
}
