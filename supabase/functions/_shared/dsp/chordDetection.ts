/**
 * Real-time chord estimation from a live audio signal (chroma + template
 * matching). This is genuine DSP over captured audio - not a placeholder and
 * not derived from any pre-analyzed track data - but it is a basic technique:
 * no key detection, no bass-note/inversion handling, no 7th/9th recognition.
 * Treat its output as a live estimate, not analysis-grade data.
 *
 * Pipeline: FFT magnitudes -> 12-bin chroma vector -> cosine similarity
 * against major/minor triad templates in all 12 roots -> best match, or
 * "no chord" when the signal is too quiet to trust. For chords, the chroma is
 * taken with the lead line removed first (harmonyChroma), so a loud voice or
 * melody does not decide the chord.
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

/**
 * Chroma of the accompaniment, with the lead line taken out: what the chord
 * matcher should hear.
 *
 * chromaFromMagnitudes folds in everything, and in a mix the loudest thing is
 * usually the voice or a lead instrument. Its note, plus the overtones that
 * land on that note's fifth and third, outweigh a pad or a guitar underneath,
 * so the chord followed the tune: a verse over one G chord read as G, Bm, D, Em
 * as the singer moved.
 *
 * This is not stem separation. No audio is produced, kept, or put through a
 * model. It works on the same spectrum the detector already reads:
 *   1. keep only spectral peaks, so window leakage around a loud partial does
 *      not smear onto the neighbouring pitch classes;
 *   2. find the most salient pitch in the melody register (200-1100 Hz), scored
 *      by how much energy sits on its whole harmonic series, which is what makes
 *      a sung note stand out from the individual notes of a chord;
 *   3. drop that pitch and its harmonics, and fold what is left into chroma.
 *
 * With no melody (a bare pad or arpeggio), step 2 picks a chord tone, and losing
 * it costs the triad one of its three notes. ChordDecoder's key pass makes up
 * for that over time. A single frame has no such help, which is why the live
 * readout also scores the whole mix (see chordChromas and matchChordTemplate).
 * If removing the line would leave almost nothing, as with a voice or
 * instrument on its own, the line IS the harmony, so it is kept.
 *
 * Returns a unit-normalized 12-bin vector, or all zeros for silence, like
 * chromaFromMagnitudes. Use chromaEnergy, not this vector, for the silence gate.
 */
export function harmonyChroma(
  magnitudes: Float32Array | number[],
  sampleRate: number,
  fftSize: number
): number[] {
  return chordChromas(magnitudes, sampleRate, fftSize).harmony;
}

/**
 * Both readings of one spectrum, from a single peak pass: `harmony` with the
 * lead line removed (harmonyChroma), and `mix` with everything that sounds.
 * Both unit-normalized, or all zeros for silence.
 */
export function chordChromas(
  magnitudes: Float32Array | number[],
  sampleRate: number,
  fftSize: number
): { harmony: number[]; mix: number[] } {
  const peaks = findPeaks(magnitudes, sampleRate / fftSize);
  const f0 = predominantPitch(peaks);
  const kept = f0 === null ? peaks : peaks.filter((p) => !isHarmonicOf(p.hz, f0));

  const all = foldPeaks(peaks);
  const accompaniment = foldPeaks(kept);
  const total = all.reduce((sum, v) => sum + v, 0);
  const remaining = accompaniment.reduce((sum, v) => sum + v, 0);
  const mix = normalize(all);
  return {
    harmony: remaining >= MIN_ACCOMPANIMENT_SHARE * total ? normalize(accompaniment) : mix,
    mix,
  };
}

interface SpectralPeak {
  hz: number;
  magnitude: number;
}

/** Melody register searched for a lead line: roughly the range of a singing voice's fundamental. */
const MELODY_MIN_HZ = 200;
const MELODY_MAX_HZ = 1100;
/** Harmonics credited to (and removed with) a melody note. */
const MELODY_HARMONICS = 8;
/** Each higher harmonic counts for less when scoring a candidate pitch. */
const HARMONIC_ROLLOFF = 0.85;
/**
 * How far a peak may sit from an exact harmonic and still belong to it. Wide
 * enough for vibrato (a singer's is typically 30-60 cents either side), narrow
 * enough not to reach the neighbouring semitone.
 */
const HARMONIC_TOLERANCE_CENTS = 50;
/** Only the loudest few peaks in the register are tried as the melody's pitch. */
const MELODY_CANDIDATES = 6;
/**
 * Below this share of the in-band power left after removing the line, keep the
 * line: nothing but leakage and noise is left, so the line was playing alone.
 * It has to be small, because chroma weighs power: a voice at four times the
 * amplitude of each note of the chord under it already holds ~94% of the power.
 */
const MIN_ACCOMPANIMENT_SHARE = 0.02;
const PEAK_MAX_HZ = Math.max(MAX_FREQ_HZ, MELODY_MAX_HZ * MELODY_HARMONICS);

/**
 * Local maxima of the magnitude spectrum, with frequency and height refined by
 * fitting a parabola to the log magnitudes of the peak bin and its neighbours.
 * At 8192 points a bin is ~5.4 Hz wide, wider than a semitone below ~90 Hz, so
 * the raw bin centre would put low notes on the wrong pitch class.
 */
function findPeaks(magnitudes: Float32Array | number[], binHz: number): SpectralPeak[] {
  const peaks: SpectralPeak[] = [];
  const first = Math.max(1, Math.floor(MIN_FREQ_HZ / binHz));
  const last = Math.min(magnitudes.length - 2, Math.ceil(PEAK_MAX_HZ / binHz));
  for (let i = first; i <= last; i++) {
    const m = magnitudes[i];
    if (!(m > magnitudes[i - 1]) || m < magnitudes[i + 1]) continue;
    const a = Math.log(magnitudes[i - 1] + 1e-12);
    const b = Math.log(m + 1e-12);
    const c = Math.log(magnitudes[i + 1] + 1e-12);
    const curvature = a - 2 * b + c;
    const offset = curvature < 0 ? (0.5 * (a - c)) / curvature : 0;
    peaks.push({ hz: (i + offset) * binHz, magnitude: Math.exp(b - 0.25 * (a - c) * offset) });
  }
  return peaks;
}

const centsBetween = (hz: number, targetHz: number) => Math.abs(1200 * Math.log2(hz / targetHz));

function isHarmonicOf(hz: number, f0: number): boolean {
  const n = Math.round(hz / f0);
  return n >= 1 && n <= MELODY_HARMONICS && centsBetween(hz, n * f0) < HARMONIC_TOLERANCE_CENTS;
}

/**
 * The pitch in the melody register whose harmonic series carries the most
 * energy, or null when nothing is sounding there.
 */
function predominantPitch(peaks: SpectralPeak[]): number | null {
  const candidates = peaks
    .filter((p) => p.hz >= MELODY_MIN_HZ && p.hz <= MELODY_MAX_HZ)
    .sort((x, y) => y.magnitude - x.magnitude)
    .slice(0, MELODY_CANDIDATES);

  let best: number | null = null;
  let bestSalience = 0;
  for (const candidate of candidates) {
    let salience = 0;
    for (let h = 1; h <= MELODY_HARMONICS; h++) {
      const target = candidate.hz * h;
      let strongest = 0;
      for (const p of peaks) {
        if (p.magnitude > strongest && centsBetween(p.hz, target) < HARMONIC_TOLERANCE_CENTS) strongest = p.magnitude;
      }
      salience += strongest * Math.pow(HARMONIC_ROLLOFF, h - 1);
    }
    if (salience > bestSalience) {
      bestSalience = salience;
      best = candidate.hz;
    }
  }
  return best;
}

/** Power per pitch class over the chord band, as foldToChroma weighs bins. */
function foldPeaks(peaks: SpectralPeak[]): number[] {
  const chroma = new Array(12).fill(0);
  for (const p of peaks) {
    if (p.hz < MIN_FREQ_HZ || p.hz > MAX_FREQ_HZ) continue;
    const midi = A4_MIDI + 12 * Math.log2(p.hz / A4_FREQ);
    chroma[((Math.round(midi) % 12) + 12) % 12] += p.magnitude * p.magnitude;
  }
  return chroma;
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

/**
 * Every chord the detector can name, in a fixed order: for each root 0-11, the
 * major triad and then the minor. Index into this to read `scoreChordTemplates`.
 */
export const CHORD_STATES: ReadonlyArray<{ root: number; quality: ChordQuality }> = Array.from(
  { length: 24 },
  (_, i) => ({ root: i >> 1, quality: i % 2 === 0 ? ('major' as const) : ('minor' as const) })
);

const CHORD_TEMPLATES: number[][] = CHORD_STATES.map(({ root, quality }) =>
  rotate(quality === 'major' ? MAJOR_TEMPLATE : MINOR_TEMPLATE, root)
);

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  if (normB < 1e-9) return 0;
  return dot / normB; // `a` (chroma) is already unit-normalised.
}

/**
 * Below this raw (pre-normalization) energy, treat the input as silence
 * rather than force a guess.
 *
 * Calibrated against a real AnalyserNode (Chromium, fftSize 8192, smoothing
 * 0.4 - what useLiveChordDetection uses), not against the unit-scale fixtures
 * the tests use. Two facts make the numbers small:
 *
 *   - The analyser reports |X[k]|/N after a Blackman window, so a full-scale
 *     sine shows up at only about -13.5 dB, and a chord spread over many
 *     partials puts its strongest bin at around -30 to -40 dB.
 *   - `energy` is the norm of the chroma of squared magnitudes, so it goes as
 *     the square of a bin's magnitude: 8 dB less signal is 16 dB less energy
 *     (see the table below).
 *
 * Measured energy for a rich four-note chord mix, by loudness of the whole mix:
 *
 *     -6 dBFS RMS   3.8e-3     (louder than nearly all music)
 *     -14 dBFS RMS  6.1e-4     (typical mastered track)
 *     -26 dBFS RMS  3.9e-5
 *     -40 dBFS RMS  1.5e-6
 *     -50 dBFS RMS  1.5e-7
 *
 * and for the floor: digital silence is exactly 0, white noise at -50 dBFS is
 * 3e-8, at -30 dBFS 3e-6. This used to be 0.02, which is above the loudest row
 * of that table - every real capture was called silence, so no chord was ever
 * detected, no key, no analysis, while the tempo (which does not depend on
 * level) kept working. 2e-7 sits at a mix around -48 dBFS RMS: below anything
 * meaningfully audible, above silence and quiet hiss, with the headroom that
 * lets a listener turn the player down.
 */
const SILENCE_ENERGY_THRESHOLD = 2e-7;

/**
 * Cosine similarity of a chroma vector to each of the 24 triad templates, in
 * `CHORD_STATES` order. `energy` is the chroma's pre-normalization magnitude
 * (see chromaEnergy) - chroma itself is always unit-normalized (or all-zero),
 * so it alone can't tell a quiet passage from a loud one. Returns null when
 * there isn't enough signal to trust any of them (silence, or between chords).
 */
export function scoreChordTemplates(chroma: number[], energy: number): number[] | null {
  if (energy < SILENCE_ENERGY_THRESHOLD) return null;
  return CHORD_TEMPLATES.map((template) => cosineSimilarity(chroma, template));
}

/**
 * The single best-matching triad for one chroma vector, or null when there
 * isn't enough signal to trust a match rather than a low-confidence guess.
 *
 * This is one frame's opinion, right for a live "what is sounding now" readout
 * and wrong as the record of a song's harmony - see ChordDecoder, which weighs
 * every frame.
 *
 * `mix`, when given, is a second reading of the same frame (chordChromas): each
 * triad is then scored by whichever of the two explains it better. Pass the
 * lead-removed chroma as `chroma` and the whole mix as `mix`, so a loud melody
 * cannot drag the readout off the chord, and a bare pad, whose top note
 * harmonyChroma mistakes for a melody, still reads as its full triad.
 */
export function matchChordTemplate(chroma: number[], energy: number, mix?: number[]): DetectedChord | null {
  const scores = scoreChordTemplates(chroma, energy);
  if (!scores) return null;
  if (mix) {
    const mixScores = scoreChordTemplates(mix, energy) as number[];
    for (let i = 0; i < scores.length; i++) scores[i] = Math.max(scores[i], mixScores[i]);
  }

  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;

  return { ...CHORD_STATES[best], score: scores[best] };
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
