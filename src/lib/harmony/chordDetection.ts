/**
 * Real-time chord estimation from a live audio signal (chroma + template
 * matching). This is genuine DSP over captured audio - not a placeholder and
 * not derived from any pre-analyzed track data - but it is a basic technique:
 * no key detection, no bass-note/inversion handling, no 7th/9th recognition.
 * Treat its output as a live estimate, not analysis-grade data.
 *
 * Pipeline: FFT magnitudes -> 12-bin chroma vector -> cosine similarity
 * against major/minor triad templates in all 12 roots -> best match, or
 * "no chord" when the signal is too quiet to trust.
 */

export type ChordQuality = 'major' | 'minor';

export interface DetectedChord {
  /** Pitch class of the root, 0 = C. */
  root: number;
  quality: ChordQuality;
  /** Cosine similarity of the winning template, 0-1. Not a statistical confidence. */
  score: number;
}

const A4_FREQ = 440;
const A4_MIDI = 69;

/** Ignore bins outside the range where a triad's root/third/fifth actually live. */
const MIN_FREQ_HZ = 55; // ~A1
const MAX_FREQ_HZ = 4000;

/**
 * Fold FFT magnitude bins into a 12-bin pitch-class (chroma) vector.
 *
 * @param magnitudes Linear magnitude per FFT bin (index 0 = DC).
 * @param sampleRate Audio context sample rate.
 * @param fftSize    Size of the FFT that produced `magnitudes` (bin count * 2).
 */
function foldToChroma(
  magnitudes: Float32Array | number[],
  sampleRate: number,
  fftSize: number
): number[] {
  const chroma = new Array(12).fill(0);
  const binHz = sampleRate / fftSize;

  for (let i = 1; i < magnitudes.length; i++) {
    const freq = i * binHz;
    if (freq < MIN_FREQ_HZ || freq > MAX_FREQ_HZ) continue;

    const midi = A4_MIDI + 12 * Math.log2(freq / A4_FREQ);
    const pitchClass = ((Math.round(midi) % 12) + 12) % 12;

    // Power rather than raw magnitude: emphasises strong tones over noise.
    const mag = magnitudes[i];
    chroma[pitchClass] += mag * mag;
  }

  return chroma;
}

export function chromaFromMagnitudes(
  magnitudes: Float32Array | number[],
  sampleRate: number,
  fftSize: number
): number[] {
  return normalize(foldToChroma(magnitudes, sampleRate, fftSize));
}

/**
 * In-band energy BEFORE normalization - chromaFromMagnitudes' own output is
 * always unit-normalized (or all-zero), so its norm can never distinguish a
 * quiet passage from a loud one; this can. Pass this alongside the chroma
 * vector to matchChordTemplate so "is there enough signal to trust a match"
 * is decided from the real signal, not from a vector that was rescaled to
 * length 1 for every non-silent input.
 */
export function chromaEnergy(
  magnitudes: Float32Array | number[],
  sampleRate: number,
  fftSize: number
): number {
  const raw = foldToChroma(magnitudes, sampleRate, fftSize);
  return Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0));
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm < 1e-9) return vector.map(() => 0);
  return vector.map((v) => v / norm);
}

/**
 * Chord templates: root always at index 0 of the pattern, rotated per root.
 * Weighted rather than binary so the match tolerates 7ths/9ths/octave doubling
 * layered on top of a plain triad, without those extra tones dominating.
 */
const MAJOR_TEMPLATE = [1, 0, 0, 0, 0.8, 0, 0, 0.9, 0, 0, 0, 0]; // root, maj3rd, 5th
const MINOR_TEMPLATE = [1, 0, 0, 0.8, 0, 0, 0, 0.9, 0, 0, 0, 0]; // root, min3rd, 5th

function rotate(template: number[], root: number): number[] {
  return template.map((_, i) => template[((i - root) % 12 + 12) % 12]);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  if (normB < 1e-9) return 0;
  return dot / normB; // `a` (chroma) is already unit-normalised.
}

/**
 * Below this raw (pre-normalization) energy, treat the input as silence/noise
 * rather than force a guess. A rough heuristic, not a calibrated noise
 * floor: getFloatFrequencyData's dBFS values (typically -100..-30) are
 * converted back to linear before folding into chroma, so a mostly-quiet
 * signal across the ~55-4000Hz band stays under this while a few genuinely
 * audible tonal bins push over it. Tune here if live captures prove too
 * eager or too reluctant to call something silence.
 */
const SILENCE_ENERGY_THRESHOLD = 0.02;

/**
 * Match a chroma vector against all 24 major/minor triad templates.
 * `energy` is the chroma's pre-normalization magnitude (see chromaEnergy) -
 * chroma itself is always unit-normalized (or all-zero), so it alone can't
 * tell a quiet passage from a loud one. Returns null when there isn't
 * enough signal to trust a match (silence, or between chords) rather than
 * returning a low-confidence guess.
 */
export function matchChordTemplate(chroma: number[], energy: number): DetectedChord | null {
  if (energy < SILENCE_ENERGY_THRESHOLD) return null;

  let best: DetectedChord | null = null;

  for (let root = 0; root < 12; root++) {
    const majorScore = cosineSimilarity(chroma, rotate(MAJOR_TEMPLATE, root));
    const minorScore = cosineSimilarity(chroma, rotate(MINOR_TEMPLATE, root));

    if (!best || majorScore > best.score) best = { root, quality: 'major', score: majorScore };
    if (!best || minorScore > best.score) best = { root, quality: 'minor', score: minorScore };
  }

  return best;
}

/**
 * Smooths a stream of per-frame estimates by majority vote over a short
 * rolling window, so the displayed chord doesn't flicker between adjacent
 * frames during a transient (a strum, a drum hit) rather than a real change.
 */
export class ChordSmoother {
  private window: (DetectedChord | null)[] = [];
  constructor(private size = 6) {}

  push(chord: DetectedChord | null): DetectedChord | null {
    this.window.push(chord);
    if (this.window.length > this.size) this.window.shift();

    const counts = new Map<string, { chord: DetectedChord | null; count: number }>();
    for (const c of this.window) {
      const key = c ? `${c.root}-${c.quality}` : 'silence';
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { chord: c, count: 1 });
    }

    let winner = counts.get('silence') ?? { chord: null, count: 0 };
    for (const entry of counts.values()) {
      if (entry.count > winner.count) winner = entry;
    }
    return winner.chord;
  }

  reset(): void {
    this.window = [];
  }
}
