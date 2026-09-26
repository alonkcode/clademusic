import { describe, expect, it } from 'vitest';
import { matchChordTemplate } from './chordDetection';
import { ChordDecoder, CHORD_SWITCH_COST } from './chordDecoder';
import { estimateKey } from './keyEstimation';
import { analyzePcm } from '../../../supabase/functions/_shared/dsp/previewAnalysis';

const TICK_SEC = 0.12;
/** Comfortably above the silence gate - the fixtures below are unit-scale. */
const LOUD = 1;

/** Unit-normalized chroma with the given pitch classes at the given weights. */
function chroma(weights: Record<number, number>): number[] {
  const v = new Array<number>(12).fill(0);
  for (const [pitchClass, weight] of Object.entries(weights)) v[Number(pitchClass)] = weight;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

const C_TRIAD = chroma({ 0: 1, 4: 1, 7: 1 });
const G_TRIAD = chroma({ 7: 1, 11: 1, 2: 1 });

/** Feed `count` identical frames from `startSec`; null is a silent frame. Returns the time after the last. */
function feed(decoder: ChordDecoder, frame: number[] | null, count: number, startSec: number): number {
  for (let i = 0; i < count; i++) {
    const t = Number((startSec + i * TICK_SEC).toFixed(4));
    if (frame) decoder.push(frame, LOUD, t);
    else decoder.push(new Array<number>(12).fill(0), 0, t);
  }
  return startSec + count * TICK_SEC;
}

const names = (decoder: ChordDecoder) =>
  decoder.toSpans().map((s) => `${s.root}${s.quality === 'minor' ? 'm' : ''}`);

describe('ChordDecoder', () => {
  it('reports a held chord as one span', () => {
    const decoder = new ChordDecoder();
    feed(decoder, C_TRIAD, 16, 0);
    const spans = decoder.toSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ root: 0, quality: 'major', startSec: 0 });
    expect(spans[0].confidence).toBeGreaterThan(0.9);
  });

  it('does not make a chord of a melody note passing over a held chord', () => {
    // A D sung twice as loud as the triad under it: on its own this frame reads
    // as G major, so a per-frame matcher changes chord for the length of the note.
    const withLoudD = chroma({ 0: 1, 4: 1, 7: 1, 2: 2.5 });
    expect(matchChordTemplate(withLoudD, LOUD)).not.toMatchObject({ root: 0, quality: 'major' });

    const decoder = new ChordDecoder();
    let t = feed(decoder, C_TRIAD, 8, 0);
    t = feed(decoder, withLoudD, 2, t);
    feed(decoder, C_TRIAD, 8, t);

    expect(names(decoder)).toEqual(['0']);
  });

  it('names an arpeggio by the chord it outlines, not by each note', () => {
    // One note at a time. Each alone is a better fit for a different triad -
    // the E is E minor's root - so a per-frame matcher walks C, Em, G, Em...
    expect(matchChordTemplate(chroma({ 4: 1 }), LOUD)).not.toMatchObject({ root: 0, quality: 'major' });

    const decoder = new ChordDecoder();
    let t = 0;
    for (let round = 0; round < 4; round++) {
      for (const note of [0, 4, 7, 4]) t = feed(decoder, chroma({ [note]: 1 }), 2, t);
    }

    expect(names(decoder)).toEqual(['0']);
  });

  it('follows a real change, and puts it where the sound changed', () => {
    const decoder = new ChordDecoder();
    const t = feed(decoder, C_TRIAD, 10, 0);
    feed(decoder, G_TRIAD, 10, t);

    const spans = decoder.toSpans();
    expect(spans.map((s) => s.root)).toEqual([0, 7]);
    // Decoded with the frames on both sides in view, so no majority-vote delay.
    expect(Math.abs(spans[1].startSec - t)).toBeLessThanOrEqual(TICK_SEC + 1e-9);
  });

  it('holds a chord whose contradicting evidence is too brief to pay for a change', () => {
    // A frame or two of G triad is worth far less than two changes cost.
    const decoder = new ChordDecoder();
    let t = feed(decoder, C_TRIAD, 8, 0);
    t = feed(decoder, G_TRIAD, 1, t);
    feed(decoder, C_TRIAD, 8, t);
    expect(names(decoder)).toEqual(['0']);
    expect(CHORD_SWITCH_COST).toBeGreaterThan(0);
  });

  it('does not bridge across silence', () => {
    const decoder = new ChordDecoder();
    let t = feed(decoder, C_TRIAD, 8, 0);
    t = feed(decoder, null, 4, t);
    feed(decoder, C_TRIAD, 8, t);

    const spans = decoder.toSpans();
    expect(spans).toHaveLength(2);
    expect(spans[1].startSec).toBeGreaterThanOrEqual(t - 1e-9);
  });

  it('starts afresh when the listener skips forward', () => {
    const decoder = new ChordDecoder();
    feed(decoder, C_TRIAD, 8, 0);
    feed(decoder, G_TRIAD, 8, 60);

    const spans = decoder.toSpans();
    expect(spans.map((s) => s.root)).toEqual([0, 7]);
    expect(spans[1].startSec).toBe(60);
  });

  it('lets a re-listened stretch replace what was heard there before', () => {
    const decoder = new ChordDecoder();
    const t = feed(decoder, C_TRIAD, 17, 0);
    feed(decoder, G_TRIAD, 17, t);
    // Seek back to the start and hear it again as G.
    feed(decoder, G_TRIAD, 9, 0);

    const spans = decoder.toSpans();
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].startSec).toBeGreaterThanOrEqual(spans[i - 1].endSec - 1e-6);
    }
    const early = spans.find((s) => s.startSec <= 0.5 && s.endSec > 0.5);
    expect(early?.root).toBe(7);
  });

  it('ignores a frame with a non-finite time', () => {
    const decoder = new ChordDecoder();
    feed(decoder, C_TRIAD, 8, 0);
    decoder.push(G_TRIAD, LOUD, Number.NaN);
    expect(decoder.toSpans()).toHaveLength(1);
  });

  it('gives nothing before anything is heard, and after a reset', () => {
    const decoder = new ChordDecoder();
    expect(decoder.toSpans()).toEqual([]);
    feed(decoder, C_TRIAD, 8, 0);
    expect(decoder.toSpans()).toHaveLength(1);
    decoder.reset();
    expect(decoder.toSpans()).toEqual([]);
  });

  it('updates as more is heard, and hands back a copy each time', () => {
    const decoder = new ChordDecoder();
    const t = feed(decoder, C_TRIAD, 8, 0);
    const first = decoder.toSpans();
    first.length = 0; // a caller may do what it likes with what it is given
    expect(decoder.toSpans()).toHaveLength(1);

    feed(decoder, G_TRIAD, 8, t);
    expect(names(decoder)).toEqual(['0', '7']);
  });
});

/**
 * Real PCM through the same pipeline the edge function runs. C - G - Am - F at
 * 120 BPM, one chord per two-second bar, played the way it is on records: with
 * a melody or an arpeggio moving underneath every bar's single chord, and eight
 * partials per note so each one puts energy on pitch classes outside its own.
 *
 * Measured on these exact clips (8 bars, so 8 chords is the right answer), the
 * frame-by-frame smoother that predates ChordDecoder produced 14 spans and got
 * 6 of 8 bars right for the arpeggio, and 23 spans and 1 of 8 for the melody.
 */
describe('against synthesized arrangements', () => {
  const SAMPLE_RATE = 44100;
  const BAR_SEC = 2;
  const BARS = 8;
  const midiHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

  /** Per bar: the chord's root and quality, its bass note, and the eight notes played over it. */
  const PROGRESSION = [
    { root: 0, quality: 'major', bass: 36, arpeggio: [60, 64, 67, 64, 60, 64, 67, 72], melody: [76, 74, 72, 74, 76, 79, 77, 74] },
    { root: 7, quality: 'major', bass: 31, arpeggio: [55, 59, 62, 59, 55, 59, 62, 67], melody: [74, 71, 74, 76, 74, 72, 71, 69] },
    { root: 9, quality: 'minor', bass: 33, arpeggio: [57, 60, 64, 60, 57, 60, 64, 69], melody: [72, 74, 76, 74, 72, 71, 72, 74] },
    { root: 5, quality: 'major', bass: 29, arpeggio: [53, 57, 60, 57, 53, 57, 60, 65], melody: [72, 69, 72, 74, 72, 77, 76, 74] },
  ] as const;

  /** Small deterministic PRNG so the drum noise is the same every run. */
  function lcg(seed: number) {
    let s = seed;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000 - 0.5;
    };
  }

  function synth(kind: 'arpeggio' | 'melody'): Float32Array {
    const out = new Float32Array(BARS * BAR_SEC * SAMPLE_RATE);
    const noise = lcg(7);
    const partials = Array.from({ length: 8 }, (_, i) => ({ k: i + 1, gain: 1 / Math.pow(i + 1, 0.8) }));
    // arpeggio: no sustained chord at all, just its notes one after another.
    // melody: the harmony is a weak pad under a melody several times louder.
    const level = kind === 'arpeggio' ? { pad: 0, note: 0.1, bass: 0.1, decay: 3 } : { pad: 0.02, note: 0.15, bass: 0.05, decay: 4 };
    const padNotes = [
      [48, 52, 55],
      [43, 47, 50],
      [45, 48, 52],
      [41, 45, 48],
    ];

    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      const barIndex = Math.floor(t / BAR_SEC) % PROGRESSION.length;
      const bar = PROGRESSION[barIndex];
      const inBar = t % BAR_SEC;
      let v = 0;

      if (level.pad > 0) {
        for (const midi of padNotes[barIndex]) {
          for (const p of partials) v += level.pad * p.gain * Math.sin(2 * Math.PI * midiHz(midi) * p.k * t);
        }
      }
      const sinceBass = inBar % 1;
      for (const p of partials.slice(0, 4)) {
        v += level.bass * p.gain * Math.exp(-sinceBass * 2) * Math.sin(2 * Math.PI * midiHz(bar.bass) * p.k * t);
      }
      const step = Math.floor(inBar / 0.25);
      const envelope = Math.exp(-(inBar - step * 0.25) * level.decay);
      const note = kind === 'arpeggio' ? bar.arpeggio[step] : bar.melody[step];
      for (const p of partials) v += level.note * p.gain * envelope * Math.sin(2 * Math.PI * midiHz(note) * p.k * t);

      const sinceBeat = t % 0.5;
      if (sinceBeat < 0.05) v += 0.25 * noise() * Math.exp(-sinceBeat / 0.012);
      out[i] = v;
    }
    return out;
  }

  /** How many bars had the right chord for the largest share of their length. */
  function barsRight(chords: Array<{ root: number; quality: string; startMs: number; endMs: number }>) {
    let right = 0;
    for (let bar = 0; bar < BARS; bar++) {
      const from = bar * BAR_SEC * 1000;
      const to = from + BAR_SEC * 1000;
      const heldMs = new Map<string, number>();
      for (const c of chords) {
        const overlap = Math.min(to, c.endMs) - Math.max(from, c.startMs);
        if (overlap > 0) heldMs.set(`${c.root}:${c.quality}`, (heldMs.get(`${c.root}:${c.quality}`) ?? 0) + overlap);
      }
      const top = [...heldMs.entries()].sort((a, b) => b[1] - a[1])[0];
      const want = PROGRESSION[bar % PROGRESSION.length];
      if (top?.[0] === `${want.root}:${want.quality}`) right++;
    }
    return right;
  }

  it('hears one chord per bar under an arpeggio, and finds the key from them', { timeout: 30_000 }, () => {
    const result = analyzePcm(synth('arpeggio'), SAMPLE_RATE);

    expect(result.chords.length).toBeLessThanOrEqual(BARS + 2);
    expect(barsRight(result.chords)).toBe(BARS);
    const key = estimateKey(
      result.chords.map((c) => ({
        root: c.root,
        quality: c.quality,
        startSec: c.startMs / 1000,
        endSec: c.endMs / 1000,
        confidence: 0.8,
      }))
    );
    expect(key).toMatchObject({ tonic: 0, mode: 'major' });
  });

  it('does not turn every melody note into a chord when the melody outshouts the harmony', { timeout: 30_000 }, () => {
    const result = analyzePcm(synth('melody'), SAMPLE_RATE);

    expect(result.chords.length).toBeLessThanOrEqual(BARS + 4);
    expect(barsRight(result.chords)).toBeGreaterThanOrEqual(6);
  });
});
