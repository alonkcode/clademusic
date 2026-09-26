import { describe, it, expect } from 'vitest';
import { analyzePcm } from '../../../supabase/functions/_shared/dsp/previewAnalysis';
import {
  StreamingAnalyzer,
  type AnalyzerEvent,
} from '../../../services/live-analysis/streamingAnalyzer';
import type { SnapshotMessage, WireSpan } from '../../../services/live-analysis/protocol';

/**
 * Real PCM pushed through the streaming analyzer in chunks, compared with the
 * whole-buffer pipeline (analyzePcm) that shares its detectors. Nothing fakes a
 * spectrum: the audio is synthesized sample by sample, so the analyser scaling
 * and the detectors' calibrated thresholds are all exercised together.
 */

const SAMPLE_RATE = 22_050;
const midiHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** C, G, Am, F. */
const PROGRESSION = [
  [48, 52, 55],
  [43, 47, 50],
  [45, 48, 52],
  [41, 45, 48],
];

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000 - 0.5;
  };
}

function synth(seconds: number, { bpm = 120, partialLevel = 0.1 } = {}) {
  const n = Math.round(seconds * SAMPLE_RATE);
  const out = new Float32Array(n);
  const noise = lcg(7);
  const beatSec = bpm > 0 ? 60 / bpm : 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const chord = PROGRESSION[Math.floor(t / 2) % PROGRESSION.length];
    let v = 0;
    for (const midi of chord) {
      for (const harmonic of [1, 2, 3, 4]) v += (partialLevel / harmonic) * Math.sin(2 * Math.PI * midiHz(midi) * harmonic * t);
    }
    if (beatSec > 0) {
      const sinceBeat = t % beatSec;
      if (sinceBeat < 0.05) v += 0.25 * noise() * Math.exp(-sinceBeat / 0.012);
    }
    out[i] = v;
  }
  return out;
}

const toInt16 = (f: Float32Array) => {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
  return out;
};

interface FeedOptions {
  chunkMs?: number;
  /** Track position of the first sample. */
  startPositionMs?: number;
  positionValid?: boolean;
  playing?: boolean;
  startSeq?: number;
}

/** Push `samples` in capture-sized chunks, stamping each with the player's position like the browser does. */
function feed(analyzer: StreamingAnalyzer, samples: Float32Array, options: FeedOptions = {}): AnalyzerEvent[] {
  const { chunkMs = 100, startPositionMs = 0, positionValid = true, playing = true, startSeq = 0 } = options;
  const int16 = toInt16(samples);
  const chunk = Math.round((chunkMs / 1000) * SAMPLE_RATE);
  const events: AnalyzerEvent[] = [];
  let seq = startSeq;
  for (let at = 0; at < int16.length; at += chunk) {
    const slice = int16.subarray(at, Math.min(at + chunk, int16.length));
    events.push(
      ...analyzer.push({
        seq: seq++,
        positionMs: startPositionMs + (at / SAMPLE_RATE) * 1000,
        playing,
        positionValid,
        samples: slice,
      })
    );
  }
  return events;
}

const chordName = (root: number, minor: number) => `${root}${minor ? 'm' : ''}`;
const snapshots = (events: AnalyzerEvent[]) => events.filter((e): e is SnapshotMessage => e.type === 'snapshot');

/** What a client does with deltas: replace from spanStart onward. */
function applyDeltas(all: SnapshotMessage[]): WireSpan[] {
  let spans: WireSpan[] = [];
  for (const s of all) spans = spans.slice(0, s.spanStart).concat(s.spans);
  return spans;
}

const CLIP_SEC = 30;
const clip = synth(CLIP_SEC);

describe('StreamingAnalyzer on a 30 s clip', () => {
  const analyzer = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
  const events = feed(analyzer, clip);
  const all = snapshots(events);
  const final = analyzer.flush();

  it('hears the progression in order, on the song clock', () => {
    const heard = final.spans.filter((s) => s[3] - s[2] >= 1000);
    const names = heard.slice(0, 8).map((s) => chordName(s[0], s[1]));
    expect(names).toEqual(['0', '7', '9m', '5', '0', '7', '9m', '5']);
    expect(heard[0][2]).toBeLessThan(600);
    expect(Math.abs(heard[1][2] - 2000)).toBeLessThan(600);
  });

  it('agrees with the whole-buffer pipeline it shares its detectors with', () => {
    const batch = analyzePcm(clip, SAMPLE_RATE);
    const batchNames = batch.chords.filter((c) => c.endMs - c.startMs >= 1000).slice(0, 8).map((c) => chordName(c.root, c.quality === 'minor' ? 1 : 0));
    const streamNames = final.spans.filter((s) => s[3] - s[2] >= 1000).slice(0, 8).map((s) => chordName(s[0], s[1]));
    expect(streamNames).toEqual(batchNames);

    const batchFinal = batch.snapshots[batch.snapshots.length - 1];
    expect(final.key?.tonic).toBe(batchFinal.key?.tonic);
    expect(final.key?.minor).toBe(batchFinal.key?.mode === 'minor' ? 1 : 0);
    expect(Math.abs((final.tempo?.bpm ?? 0) - (batchFinal.tempo?.bpm ?? 0))).toBeLessThan(2);
  });

  it('finds C major at 120 BPM', () => {
    expect(final.key).toMatchObject({ tonic: 0, minor: 0 });
    expect(Math.abs((final.tempo?.bpm ?? 0) - 120)).toBeLessThan(3);
  });

  it('snapshots every 3 s of audio and knows the tempo only once it has heard enough', () => {
    expect(all.length).toBe(10);
    expect(all[0].posMs).toBeGreaterThan(2900);
    expect(all[0].posMs).toBeLessThan(3100);
    expect(all[0].tempo).toBeNull();
    expect(all[all.length - 1].tempo).not.toBeNull();
  });

  it('sends a chord event only when the sounding chord changes', () => {
    const chords = events.filter((e) => e.type === 'chord');
    // 15 changes in 30 s of 2 s chords, plus the silence-to-first-chord edge; certainly not one per 120 ms tick.
    expect(chords.length).toBeGreaterThan(10);
    expect(chords.length).toBeLessThan(30);
    for (let i = 1; i < chords.length; i++) {
      const a = chords[i - 1];
      const b = chords[i];
      if (a.type === 'chord' && b.type === 'chord') expect(a.chord).not.toEqual(b.chord);
    }
  });

  it('delta snapshots rebuild exactly the complete span list', () => {
    // `final` is complete by construction (flush resets the delta base).
    expect(final.spanStart).toBe(0);
    const rebuilt = applyDeltas(all);
    const lastDelta = all[all.length - 1];
    // Everything up to the newest snapshot, which is all the deltas can cover.
    expect(rebuilt.length).toBeGreaterThan(8);
    expect(rebuilt.slice(0, rebuilt.length - 1)).toEqual(final.spans.slice(0, rebuilt.length - 1));
    expect(lastDelta.spanStart).toBeGreaterThan(0);
  });

  it('keeps each snapshot small however long the song has been playing', () => {
    const bytes = all.map((s) => JSON.stringify(s).length);
    // 30 s of music; every snapshot is well under a kilobyte of chord data plus the fixed parts.
    for (const b of bytes) expect(b).toBeLessThan(1500);
    // The seconds of audio each snapshot stands for would be ~130 KB at this rate.
    expect(bytes[bytes.length - 1]).toBeLessThan(130_000 / 50);
  });
});

describe('chunking', () => {
  it('gives the same chords whether audio arrives in 20 ms or 1 s pieces', () => {
    const seconds = 14;
    const audio = synth(seconds);
    const run = (chunkMs: number) => {
      const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
      feed(a, audio, { chunkMs });
      return a
        .flush()
        .spans.filter((s) => s[3] - s[2] >= 1000)
        .map((s) => chordName(s[0], s[1]));
    };
    const fine = run(20);
    const coarse = run(1000);
    expect(fine.length).toBeGreaterThanOrEqual(5);
    expect(coarse).toEqual(fine);
  });
});

describe('the song clock', () => {
  it('stamps chords with the player position, so a listener who joined mid-song gets mid-song times', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    feed(a, synth(10), { startPositionMs: 60_000 });
    const spans = a.flush().spans;
    expect(spans.length).toBeGreaterThan(2);
    expect(spans[0][2]).toBeGreaterThanOrEqual(60_000);
    expect(spans[spans.length - 1][3]).toBeLessThanOrEqual(70_500);
  });

  it('follows a seek: chords after the jump land where the player jumped to', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    const first = synth(8);
    feed(a, first, { startPositionMs: 0 });
    // Same audio continues, but the listener dragged the scrubber to 2:00.
    feed(a, synth(8), { startPositionMs: 120_000, startSeq: 80 });
    const spans = a.flush().spans;
    expect(spans.some((s) => s[3] <= 9_000)).toBe(true);
    expect(spans.some((s) => s[2] >= 119_500)).toBe(true);
  });

  it('runs on elapsed time and says so when the player reports no position', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    feed(a, synth(8), { positionValid: false, startPositionMs: 90_000 });
    const final = a.flush();
    expect(final.aligned).toBe(false);
    // The reported position is ignored: times are relative to the start of capture.
    expect(final.spans[0][2]).toBeLessThan(1_000);
    expect(final.spans.every((s) => s[3] < 10_000)).toBe(true);
  });

  it('scales time between chunks by the playback rate', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    a.setPlaybackRate(2);
    // One 1 s chunk anchored at 10 s: at 2x, its ticks span ~2 s of song.
    const events = feed(a, synth(6), { chunkMs: 6000, startPositionMs: 10_000 });
    const chordEvents = events.filter((e) => e.type === 'chord');
    const last = chordEvents[chordEvents.length - 1];
    expect(last && last.type === 'chord' ? last.posMs : 0).toBeGreaterThan(14_000);
  });
});

describe('pause and gaps', () => {
  it('analyses nothing while the player is paused, and says so', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    feed(a, synth(6), { startSeq: 0 });
    const before = a.stats().samplesProcessed;
    const pausedEvents = feed(a, synth(4), { playing: false, startPositionMs: 6_000, startSeq: 60 });
    expect(a.stats().samplesProcessed).toBe(before);
    expect(pausedEvents.some((e) => e.type === 'state' && e.status === 'paused')).toBe(true);
    expect(a.currentStatus).toBe('paused');

    const resumed = feed(a, synth(4), { playing: true, startPositionMs: 6_000, startSeq: 100 });
    expect(resumed.some((e) => e.type === 'state' && e.status === 'analyzing')).toBe(true);
    expect(a.stats().samplesProcessed).toBeGreaterThan(before);
  });

  it('does not treat a stopped player as silence when the player reports no position', () => {
    // No position means no way to know it is paused, so the audio is analysed as it comes.
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    feed(a, synth(3), { playing: false, positionValid: false });
    expect(a.stats().samplesProcessed).toBeGreaterThan(0);
  });

  it('survives lost frames: a sequence gap resets the window instead of splicing audio across it', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    feed(a, synth(6), { startSeq: 0 });
    expect(() => feed(a, synth(6), { startSeq: 500, startPositionMs: 6_000 })).not.toThrow();
    expect(a.flush().spans.length).toBeGreaterThan(2);
  });

  it('handles a sequence counter that wraps around', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    expect(() => feed(a, synth(3), { startSeq: 0xfffffff0 })).not.toThrow();
    expect(a.stats().samplesProcessed).toBeGreaterThan(0);
  });
});

describe('silence and level', () => {
  it('hears nothing in silence: no chord events, no key, no tempo', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    const events = feed(a, new Float32Array(SAMPLE_RATE * 12));
    expect(events.filter((e) => e.type === 'chord')).toEqual([]);
    const final = a.flush();
    expect(final.spans).toEqual([]);
    expect(final.key).toBeNull();
    expect(final.tempo).toBeNull();
  });

  it('still hears chords when the room is quiet', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    feed(a, synth(14, { partialLevel: 0.008 }));
    expect(a.flush().spans.length).toBeGreaterThanOrEqual(3);
  });
});

describe('memory', () => {
  it('holds at most maxChromaFrames however long it listens', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE, maxChromaFrames: 40 });
    feed(a, synth(20), { chunkMs: 500 });
    const early = a.stats().chromaFrames;
    feed(a, synth(20), { chunkMs: 500, startSeq: 40, startPositionMs: 20_000 });
    feed(a, synth(20), { chunkMs: 500, startSeq: 80, startPositionMs: 40_000 });
    expect(early).toBeLessThanOrEqual(40);
    expect(a.stats().chromaFrames).toBeLessThanOrEqual(40);
    // Thinning must not stop the analysis from working.
    expect(a.flush().key).not.toBeNull();
  });

  it('never grows its audio window: a long stream is processed and forgotten', () => {
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    feed(a, synth(12), { chunkMs: 1000 });
    // 12 s in 1 s chunks: every sample seen, none retained beyond the fixed ring.
    expect(a.stats().samplesProcessed).toBe(Math.round(12 * SAMPLE_RATE));
  });
});

describe('cost', () => {
  it('analyses audio far faster than real time', () => {
    const audio = synth(20);
    const a = new StreamingAnalyzer({ sampleRate: SAMPLE_RATE });
    const started = performance.now();
    feed(a, audio);
    const elapsedMs = performance.now() - started;
    // One session must use a small fraction of one core. 20 s of audio in under
    // 4 s (20% of real time) is a deliberately loose bound for a slow CI box.
    expect(elapsedMs).toBeLessThan(4_000);
  });
});
