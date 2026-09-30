/**
 * Decides which chord is playing from ALL the notes heard, not from the loudest
 * note of each moment.
 *
 * matchChordTemplate scores one 120ms frame on its own. A single note is a
 * partial match for several triads, so whichever note is loudest in a frame -
 * a melody note, one string of an arpeggio - picks its own chord, and a bar
 * played over a moving melody came out as three or four chords. Majority-voting
 * those per-frame labels (ChordSmoother) only damps the flicker; the evidence
 * that the whole bar is one chord was never put together.
 *
 * This does with chords what estimateKey does with a key: it sums evidence over
 * time and lets the best explanation of everything heard win. Each frame scores
 * every one of the 24 triads, and the chord sequence chosen is the one with the
 * highest total similarity, where every change of chord costs
 * CHORD_SWITCH_COST. A melody note that only fits another chord for a beat
 * cannot pay for the switch; a chord that holds for a bar - or that the melody
 * merely decorates - easily does. That is Viterbi decoding, and because it sees
 * the frames on both sides of a change it also places the change where the
 * sound changed, instead of a majority-vote's half-second later.
 *
 * It is a re-derivation, not a stream: `toSpans` decodes everything recorded so
 * far, like the key and the sections do, so the tail of a live capture may be
 * revised as more of the song arrives. The decoded labels are replayed through
 * ChordTimeline, which keeps its rules for silence, seeking and overlap.
 */

import { CHORD_STATES, scoreChordTemplates } from './chordDetection.ts';
import type { DetectedChord } from './chordDetection.ts';
import { ChordTimeline, SEEK_DISCONTINUITY_SEC } from './chordTimeline.ts';
import type { ChordSpan } from './chordTimeline.ts';
import { estimateKey, fitsKey } from './keyEstimation.ts';

/**
 * What a change of chord costs, in the same units as the evidence: cosine
 * similarity summed over frames. A new chord has to outscore the one it replaces
 * by this much, cumulatively, before the path switches to it.
 *
 * Tuned against synthesized arrangements (arpeggios, a melody louder than the
 * accompaniment, half-bar chords, a borrowed bVII) scored by the share of time
 * the true chord was named. Below about 0.5 melody notes get through as chords
 * again; at 0.8 and above real half-bar changes are absorbed into their
 * neighbours. It assumes the 120ms frame the detector ticks at.
 */
export const CHORD_SWITCH_COST = 0.7;

/**
 * Extra evidence per frame for a chord that belongs to the song's key, on the
 * second decoding pass.
 *
 * Template matching alone has no idea what key it is in, so a frame that is a
 * near tie between the key's own chord and an outside one is a coin toss. Songs
 * mostly stay in key, so the tie should go to the chord that fits. The bonus is
 * small next to a clear match (the right triad scores ~0.9 against ~0.6 for its
 * neighbours), so a borrowed chord that is really there, like a bVII or a
 * secondary dominant, still wins on its own evidence.
 */
export const KEY_FIT_BONUS = 0.15;

/**
 * Voiced audio needed before the key is trusted enough to lean on. With less,
 * the estimate comes from a chord or two, and biasing toward it would only
 * repeat that guess back.
 */
const KEY_BIAS_MIN_SEC = 8;

interface RecordedFrame {
  timeSec: number;
  /** Similarity to each of CHORD_STATES, or null when the frame was silent. */
  scores: Float32Array | null;
}

const isSeek = (previousSec: number, sec: number) =>
  sec < previousSec || sec - previousSec > SEEK_DISCONTINUITY_SEC;

export class ChordDecoder {
  private frames: RecordedFrame[] = [];
  private cached: ChordSpan[] | null = null;

  /**
   * Record one analysis frame.
   *
   * @param chroma  Unit-normalized 12-bin chroma of the accompaniment (harmonyChroma).
   * @param energy  Its pre-normalization energy (chromaEnergy), which is what
   *                tells a quiet passage from silence.
   * @param timeSec Frame time on the timeline being built against.
   */
  push(chroma: number[], energy: number, timeSec: number): void {
    if (!Number.isFinite(timeSec)) return;
    const scores = scoreChordTemplates(chroma, energy);
    this.frames.push({ timeSec, scores: scores ? Float32Array.from(scores) : null });
    this.cached = null;
  }

  /**
   * Every chord heard so far, in time order, including the one still sounding.
   * Spans too short to be credible are left out (see ChordTimeline).
   */
  toSpans(): ChordSpan[] {
    if (!this.cached) this.cached = this.decode();
    return this.cached.slice();
  }

  reset(): void {
    this.frames = [];
    this.cached = null;
  }

  /**
   * Decode once with no idea of the key, estimate the key from that, then
   * decode again with KEY_FIT_BONUS for the chords that belong to it.
   */
  private decode(): ChordSpan[] {
    const firstPass = this.decodeWith(null);
    const heardSec = firstPass.reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
    if (heardSec < KEY_BIAS_MIN_SEC) return firstPass;

    const key = estimateKey(firstPass);
    if (!key) return firstPass;
    const bias = Float64Array.from(CHORD_STATES, (chord) => (fitsKey(chord, key) ? KEY_FIT_BONUS : 0));
    return this.decodeWith(bias);
  }

  /** `bias`, when given, is added to each chord's evidence in every frame (CHORD_STATES order). */
  private decodeWith(bias: Float64Array | null): ChordSpan[] {
    const frames = this.frames;
    const labels: Array<DetectedChord | null> = new Array(frames.length).fill(null);

    // Only voiced, time-continuous stretches are decoded together: silence is
    // not evidence for either neighbour, and a seek makes the frames on its two
    // sides unrelated audio that a switch cost must not be charged across.
    let runStart = -1;
    for (let i = 0; i <= frames.length; i++) {
      const frame = i < frames.length ? frames[i] : null;
      const continues = runStart >= 0 && frame?.scores && !isSeek(frames[i - 1].timeSec, frame.timeSec);
      if (runStart >= 0 && !continues) {
        this.decodeRun(runStart, i, labels, bias);
        runStart = -1;
      }
      if (runStart < 0 && frame?.scores) runStart = i;
    }

    const timeline = new ChordTimeline();
    frames.forEach((frame, i) => timeline.push(labels[i], frame.timeSec));
    return timeline.toSpans();
  }

  /** Viterbi over frames [from, to), writing each frame's chord into `labels`. */
  private decodeRun(
    from: number,
    to: number,
    labels: Array<DetectedChord | null>,
    bias: Float64Array | null
  ): void {
    const states = CHORD_STATES.length;
    const length = to - from;
    // came[i * states + k]: the chord before frame i on the best path that has
    // chord k at frame i.
    const came = new Uint8Array(length * states);
    let previous = new Float64Array(states);
    let current = new Float64Array(states);

    for (let i = 0; i < length; i++) {
      const scores = this.frames[from + i].scores as Float32Array;

      // Any chord can be switched to from the best one so far, so the cheapest
      // way to change is the same for every candidate: no pairwise loop needed.
      let best = 0;
      for (let k = 1; k < states; k++) if (previous[k] > previous[best]) best = k;
      const switched = previous[best] - CHORD_SWITCH_COST;

      for (let k = 0; k < states; k++) {
        if (previous[k] >= switched) {
          current[k] = previous[k];
          came[i * states + k] = k;
        } else {
          current[k] = switched;
          came[i * states + k] = best;
        }
        current[k] += bias ? scores[k] + bias[k] : scores[k];
      }
      [previous, current] = [current, previous];
    }

    let state = 0;
    for (let k = 1; k < states; k++) if (previous[k] > previous[state]) state = k;
    for (let i = length - 1; i >= 0; i--) {
      const scores = this.frames[from + i].scores as Float32Array;
      labels[from + i] = { ...CHORD_STATES[state], score: scores[state] };
      state = came[i * states + state];
    }
  }
}
