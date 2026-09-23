import { describe, it, expect } from 'vitest';
import { OnsetBuffer, estimateTempo, spectralFlux, type OnsetSample } from './tempoDetection';

/** Small deterministic PRNG so a failing case is reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PulseOptions {
  bpm: number;
  seconds: number;
  startSec?: number;
  /** Frames per second the analyser was polled at. */
  rateHz?: number;
  /** Std-dev of timestamp error, in ms - timer jitter. */
  jitterMs?: number;
  /** Uniform noise amplitude, relative to a beat's height of 1. */
  noise?: number;
  /** Height of a half-beat pulse (hi-hats, eighth notes). 0 for none. */
  offbeat?: number;
  /** Alternate beat heights, like kick/snare. */
  accent?: number;
  seed?: number;
}

/** Onset-strength samples for a steady pulse: Gaussian spikes on the beat, noise everywhere. */
function pulseTrain(o: PulseOptions): OnsetSample[] {
  const rate = o.rateHz ?? 46;
  const rand = mulberry32(o.seed ?? 1);
  const beat = 60 / o.bpm;
  const sigma = 0.015;
  const out: OnsetSample[] = [];
  const start = o.startSec ?? 0;

  const bump = (t: number, center: number, height: number) =>
    height * Math.exp(-0.5 * Math.pow((t - center) / sigma, 2));

  for (let i = 0; i < o.seconds * rate; i++) {
    const t = start + i / rate;
    let flux = 0;
    const k = Math.round((t - start) / beat);
    for (const n of [k - 1, k, k + 1]) {
      const height = o.accent && n % 2 !== 0 ? o.accent : 1;
      flux += bump(t, start + n * beat, height);
      if (o.offbeat) flux += bump(t, start + (n + 0.5) * beat, o.offbeat);
    }
    flux += (o.noise ?? 0) * rand();
    const jitter = ((o.jitterMs ?? 0) / 1000) * (rand() + rand() + rand() - 1.5);
    out.push({ timeSec: t + jitter, flux });
  }
  // Timestamps are only ever read forward from an audio clock.
  return out.sort((a, b) => a.timeSec - b.timeSec);
}

const bpmOf = (samples: OnsetSample[]) => estimateTempo(samples)?.bpm;

describe('estimateTempo on a clean pulse', () => {
  it.each([70, 90, 100, 120, 128, 140, 150, 160])('finds %i BPM', (bpm) => {
    const reading = estimateTempo(pulseTrain({ bpm, seconds: 30 }));
    expect(reading).not.toBeNull();
    expect(Math.abs(reading!.bpm - bpm)).toBeLessThan(1);
    expect(reading!.confidence).toBeGreaterThan(0.6);
  });

  // A bare pulse at 174 is the same signal as one at 87 with every other beat
  // missing, so nothing in it can settle which was meant; the preference for
  // the range people tap in picks the slower. Half-time is a normal way to
  // count fast music (drum and bass), so the guarantee is "the tempo or exactly
  // half of it", never some unrelated number.
  it.each([172, 174, 180])('reads %i BPM as itself or as half-time', (bpm) => {
    const reading = estimateTempo(pulseTrain({ bpm, seconds: 30 }));
    expect(reading).not.toBeNull();
    const nearTrue = Math.abs(reading!.bpm - bpm) < 1;
    const nearHalf = Math.abs(reading!.bpm - bpm / 2) < 1;
    expect(nearTrue || nearHalf).toBe(true);
    expect(reading!.confidence).toBeGreaterThan(0.6);
  });

  it('gets a tempo that is not a whole number', () => {
    const reading = estimateTempo(pulseTrain({ bpm: 127.5, seconds: 45 }));
    expect(Math.abs(reading!.bpm - 127.5)).toBeLessThan(1);
  });

  it('is fine with a short listen once there are enough beats', () => {
    const reading = estimateTempo(pulseTrain({ bpm: 110, seconds: 14 }));
    expect(reading).not.toBeNull();
    expect(Math.abs(reading!.bpm - 110)).toBeLessThan(2);
  });
});

describe('estimateTempo on realistic input', () => {
  it('survives timer jitter and background noise', () => {
    const reading = estimateTempo(pulseTrain({ bpm: 118, seconds: 40, jitterMs: 6, noise: 0.25, seed: 7 }));
    expect(reading).not.toBeNull();
    expect(Math.abs(reading!.bpm - 118)).toBeLessThan(1.5);
  });

  it('reads the beat, not the subdivision, when there are hi-hats between the beats', () => {
    const reading = estimateTempo(pulseTrain({ bpm: 96, seconds: 40, offbeat: 0.45 }));
    expect(Math.abs(reading!.bpm - 96)).toBeLessThan(1.5);
  });

  it('reads the beat when kick and snare alternate in strength', () => {
    const reading = estimateTempo(pulseTrain({ bpm: 104, seconds: 40, accent: 0.55 }));
    expect(Math.abs(reading!.bpm - 104)).toBeLessThan(1.5);
  });

  it('follows the most recent minute when the tempo changes', () => {
    const first = pulseTrain({ bpm: 90, seconds: 40 });
    const second = pulseTrain({ bpm: 130, seconds: 62, startSec: 40 });
    const reading = estimateTempo([...first, ...second]);
    expect(Math.abs(reading!.bpm - 130)).toBeLessThan(1.5);
  });

  it('does not care where on the clock the capture started', () => {
    const reading = estimateTempo(pulseTrain({ bpm: 122, seconds: 30, startSec: 1234.5 }));
    expect(Math.abs(reading!.bpm - 122)).toBeLessThan(1);
  });
});

describe('estimateTempo declines to guess', () => {
  it('returns null for too little audio', () => {
    expect(estimateTempo(pulseTrain({ bpm: 120, seconds: 5 }))).toBeNull();
    expect(estimateTempo([])).toBeNull();
    expect(estimateTempo([{ timeSec: 0, flux: 1 }])).toBeNull();
  });

  it('returns null when the samples are too sparse to show a beat (a throttled background tab)', () => {
    expect(estimateTempo(pulseTrain({ bpm: 120, seconds: 60, rateHz: 3 }))).toBeNull();
  });

  it('returns null for silence', () => {
    const silent = Array.from({ length: 1500 }, (_, i) => ({ timeSec: i / 46, flux: 0 }));
    expect(estimateTempo(silent)).toBeNull();
  });

  it('is not confident about noise', () => {
    const rand = mulberry32(99);
    const noise = Array.from({ length: 46 * 40 }, (_, i) => ({ timeSec: i / 46, flux: rand() }));
    const reading = estimateTempo(noise);
    // Either nothing, or something the caller's 0.6 threshold would throw away.
    expect(reading === null || reading.confidence < 0.4).toBe(true);
  });

  it('is not confident about a steady drone with no attacks', () => {
    const drone = Array.from({ length: 46 * 30 }, (_, i) => ({ timeSec: i / 46, flux: 0.5 }));
    expect(estimateTempo(drone)).toBeNull();
  });

  it('does not bridge a long gap in the data with an invented ramp', () => {
    const a = pulseTrain({ bpm: 120, seconds: 10 });
    const b = pulseTrain({ bpm: 120, seconds: 10, startSec: 20 });
    // Ten seconds of nothing in the middle: 10 s of real data on each side.
    const reading = estimateTempo([...a, ...b]);
    if (reading) expect(Math.abs(reading.bpm - 120)).toBeLessThan(3);
  });
});

describe('spectralFlux', () => {
  const frame = (fill: number, n = 64) => new Float32Array(n).fill(fill);

  it('is zero for identical frames', () => {
    expect(spectralFlux(frame(-50), frame(-50))).toBe(0);
  });

  it('adds up how much louder each bin got', () => {
    // -100 dB -> 0..1 maps to 0, -50 dB to 0.5: 10 bins in 1..11 each rise by 0.5.
    const prev = frame(-100);
    const curr = frame(-100);
    for (let k = 1; k <= 10; k++) curr[k] = -50;
    expect(spectralFlux(prev, curr)).toBeCloseTo(5, 5);
  });

  it('ignores energy falling away', () => {
    expect(spectralFlux(frame(-30), frame(-80))).toBe(0);
  });

  it('treats digital silence (-Infinity) as silence, not as a huge swing', () => {
    expect(spectralFlux(frame(-Infinity), frame(-Infinity))).toBe(0);
    expect(Number.isFinite(spectralFlux(frame(-Infinity), frame(-40)))).toBe(true);
  });

  it('only counts the bins asked for', () => {
    const prev = frame(-100);
    const curr = frame(-100);
    curr[3] = -50;
    curr[20] = -50;
    expect(spectralFlux(prev, curr, 1, 10)).toBeCloseTo(0.5, 5);
  });
});

describe('OnsetBuffer', () => {
  it('keeps samples in time order and ignores a repeated timestamp', () => {
    const buf = new OnsetBuffer();
    buf.push(1, 0.1);
    buf.push(2, 0.2);
    buf.push(2, 0.9);
    buf.push(1.5, 0.9);
    expect(buf.samples().map((s) => s.timeSec)).toEqual([1, 2]);
  });

  it('forgets what is older than its span', () => {
    const buf = new OnsetBuffer(10);
    for (let t = 0; t <= 30; t += 1) buf.push(t, 1);
    const times = buf.samples().map((s) => s.timeSec);
    expect(times[0]).toBeGreaterThanOrEqual(20);
    expect(times[times.length - 1]).toBe(30);
  });

  it('stays bounded over a long capture', () => {
    const buf = new OnsetBuffer(90);
    for (let i = 0; i < 46 * 600; i++) buf.push(i / 46, 1);
    expect(buf.samples().length).toBeLessThan(46 * 91 + 2);
  });

  it('replaces non-finite flux with zero and can be reset', () => {
    const buf = new OnsetBuffer();
    buf.push(1, NaN);
    expect(buf.samples()[0].flux).toBe(0);
    buf.reset();
    expect(buf.samples()).toEqual([]);
  });
});
