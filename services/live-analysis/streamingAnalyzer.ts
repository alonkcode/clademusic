/**
 * The live pipeline, fed audio as it arrives instead of from an AnalyserNode.
 *
 * useLiveChordDetection (browser) and analyzePcm (whole buffer, edge function)
 * already run this pipeline. This is the third way in: chunks of PCM pushed
 * one at a time, results handed back as wire events. It reuses the same
 * SpectrumAnalyser, ChordSmoother, ChordDecoder, key, tempo and section code
 * unchanged, so a chord heard through the microphone route means what it means
 * in the tab-capture route. The tick rates below mirror those two; keep the
 * three in step.
 *
 * Memory is bounded by construction, whatever the session length:
 *   - audio: a 16k-sample ring. A chunk is analysed and overwritten.
 *   - chroma history: at most `maxChromaFrames`; on overflow every other frame
 *     is dropped and the sampling stride doubles, which the section detector
 *     (it re-buckets to whole seconds anyway) does not notice.
 *   - onsets: OnsetBuffer keeps the last ~90 s.
 * Chord spans grow with the song, but a session has a hard duration cap.
 */

import { ChordSmoother, chromaEnergy, chromaFromMagnitudes, matchChordTemplate } from '../../supabase/functions/_shared/dsp/chordDetection.ts';
import { ChordDecoder } from '../../supabase/functions/_shared/dsp/chordDecoder.ts';
import type { ChordSpan } from '../../supabase/functions/_shared/dsp/chordTimeline.ts';
import { estimateKey } from '../../supabase/functions/_shared/dsp/keyEstimation.ts';
import { SpectrumAnalyser } from '../../supabase/functions/_shared/dsp/previewAnalysis.ts';
import { detectSections } from '../../supabase/functions/_shared/dsp/sectionDetection.ts';
import type { ChromaFrame } from '../../supabase/functions/_shared/dsp/sectionDetection.ts';
import { OnsetBuffer, estimateTempo, spectralFlux } from '../../supabase/functions/_shared/dsp/tempoDetection.ts';
import type { TempoReading } from '../../supabase/functions/_shared/dsp/tempoDetection.ts';
import type {
  AnalysisStatus,
  AudioFrame,
  ChordMessage,
  SnapshotMessage,
  StateMessage,
  WireChord,
  WireSpan,
} from './protocol.ts';

/**
 * The browser pipeline uses an 8192-point chord FFT and a 1024-point onset FFT
 * at the 44.1/48 kHz an AudioContext runs at: a ~186 ms and ~23 ms window, with
 * ~5.4 Hz bins. The detectors' thresholds are calibrated to that. At a lower
 * rate the same point counts would mean a longer window (twice as long at
 * 22.05 kHz, which measurably delays every chord change), so the sizes scale
 * with the rate instead, keeping window and bin width what the detectors were
 * tuned against.
 */
const REFERENCE_RATE = 44_100;
const REFERENCE_CHORD_FFT = 8192;
const REFERENCE_ONSET_FFT = 1024;
const scaledFftSize = (reference: number, sampleRate: number) =>
  2 ** Math.round(Math.log2((reference * sampleRate) / REFERENCE_RATE));

const CHORD_SMOOTHING = 0.4;
const CHORD_TICK_MS = 120;
const ONSET_TICK_MS = 20;
const ONSET_MAX_HZ = 8000;
const SNAPSHOT_MS = 3000;
/** Ceiling on the section detector's self-similarity matrix side; see useLiveChordDetection. */
const MAX_SECTION_BUCKETS = 300;

const CHORD_TICKS_PER_ONSET_TICK = CHORD_TICK_MS / ONSET_TICK_MS;
const ONSET_TICKS_PER_SNAPSHOT = SNAPSHOT_MS / ONSET_TICK_MS;

/** Room for one FFT window plus the largest slice appended between tick passes. */
const RING_CAPACITY = 16_384;
const APPEND_STEP = 2_048;
const DEFAULT_MAX_CHROMA_FRAMES = 4_000;

export type AnalyzerEvent = ChordMessage | SnapshotMessage | StateMessage;

export interface StreamingAnalyzerOptions {
  sampleRate: number;
  maxChromaFrames?: number;
}

export interface AnalyzerStats {
  samplesProcessed: number;
  chromaFrames: number;
  chordSpans: number;
}

const sameWire = (a: WireChord | null, b: WireChord | null) =>
  a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);

const sameSpan = (a: ChordSpan, b: ChordSpan) =>
  a.root === b.root && a.quality === b.quality && a.startSec === b.startSec && a.endSec === b.endSec;

const toWireSpan = (s: ChordSpan): WireSpan => [
  s.root,
  s.quality === 'minor' ? 1 : 0,
  Math.round(s.startSec * 1000),
  Math.round(s.endSec * 1000),
  Math.round(Math.max(0, Math.min(1, s.confidence)) * 100),
];

export class StreamingAnalyzer {
  private readonly sampleRate: number;
  private readonly maxChromaFrames: number;

  /** ring[0] is absolute sample `base`; the newest sample is `filled - 1`. */
  private readonly ring = new Float32Array(RING_CAPACITY);
  private base = 0;
  private filled = 0;
  private ticks = 0;

  private readonly chordFft: number;
  private readonly onsetFft: number;
  private readonly chordAnalyser: SpectrumAnalyser;
  private readonly onsetAnalyser: SpectrumAnalyser;
  private readonly onsetMaxBin: number;
  private readonly previousOnsetDb: Float32Array;
  private havePreviousOnset = false;

  private readonly smoother = new ChordSmoother();
  private readonly decoder = new ChordDecoder();
  private readonly onsets = new OnsetBuffer();
  private frames: ChromaFrame[] = [];
  private chromaSeen = 0;
  private chromaStride = 1;
  private tempo: TempoReading | null = null;

  private lastChord: WireChord | null = null;
  private lastSeq: number | null = null;
  private status: AnalysisStatus = 'analyzing';
  private rate = 1;
  private aligned = false;
  private startAudioSec: number | null = null;
  /** Where the current chunk starts, on the song's clock. Null when the player reports no position. */
  private anchor: { trackSec: number; audioSec: number } | null = null;
  private needsWindowReset = false;

  /** The chord spans the client already holds and that cannot have changed, for delta snapshots. */
  private sentSpans: ChordSpan[] = [];

  constructor(options: StreamingAnalyzerOptions) {
    this.sampleRate = options.sampleRate;
    this.maxChromaFrames = options.maxChromaFrames ?? DEFAULT_MAX_CHROMA_FRAMES;
    this.chordFft = scaledFftSize(REFERENCE_CHORD_FFT, this.sampleRate);
    this.onsetFft = scaledFftSize(REFERENCE_ONSET_FFT, this.sampleRate);
    this.chordAnalyser = new SpectrumAnalyser(this.ring, this.chordFft, CHORD_SMOOTHING);
    this.onsetAnalyser = new SpectrumAnalyser(this.ring, this.onsetFft, 0);
    this.previousOnsetDb = new Float32Array(this.onsetFft / 2);
    const onsetBinHz = this.sampleRate / this.onsetFft;
    this.onsetMaxBin = Math.min(this.onsetFft / 2, Math.floor(ONSET_MAX_HZ / onsetBinHz));
  }

  get currentStatus(): AnalysisStatus {
    return this.status;
  }

  stats(): AnalyzerStats {
    return {
      samplesProcessed: this.filled,
      chromaFrames: this.frames.length,
      chordSpans: this.decoder.toSpans().length,
    };
  }

  /** The player's playback rate, from a sync message. Only scales time between chunk anchors. */
  setPlaybackRate(rate: number): void {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate;
  }

  /** A sync message with no audio behind it: the state can change while nothing is being sent. */
  setPlaying(playing: boolean): AnalyzerEvent[] {
    const events: AnalyzerEvent[] = [];
    this.setStatus(!playing && this.aligned ? 'paused' : 'analyzing', events);
    if (!playing && this.aligned) this.needsWindowReset = true;
    return events;
  }

  /** Forget what the client holds, so the next snapshot is complete. Used after a snapshot was not delivered. */
  invalidateDelta(): void {
    this.sentSpans = [];
  }

  /** The analysis as it stands, complete. Sent once more on stop so the last seconds are not lost. */
  flush(): SnapshotMessage {
    this.invalidateDelta();
    return this.buildSnapshot();
  }

  push(frame: AudioFrame): AnalyzerEvent[] {
    const events: AnalyzerEvent[] = [];
    const paused = !frame.playing && frame.positionValid;
    const gap = this.lastSeq !== null && frame.seq !== ((this.lastSeq + 1) >>> 0);
    this.lastSeq = frame.seq;
    this.aligned = frame.positionValid;
    this.setStatus(paused ? 'paused' : 'analyzing', events);

    // Paused partway through a capture of this player: the audio has gone quiet
    // and there is nothing to record, and a stretch of silence is not evidence
    // about the beat. Same rule as the browser hook.
    if (paused) {
      this.needsWindowReset = true;
      return events;
    }

    if (gap || this.needsWindowReset) {
      this.resetWindow();
      this.needsWindowReset = false;
    }

    const chunkAudioSec = this.filled / this.sampleRate;
    if (this.startAudioSec === null) this.startAudioSec = chunkAudioSec;
    this.anchor = frame.positionValid ? { trackSec: frame.positionMs / 1000, audioSec: chunkAudioSec } : null;

    const src = frame.samples;
    for (let offset = 0; offset < src.length; ) {
      const n = Math.min(src.length - offset, APPEND_STEP);
      this.append(src, offset, n);
      offset += n;
      this.runTicks(events);
    }
    return events;
  }

  private setStatus(status: AnalysisStatus, events: AnalyzerEvent[]): void {
    if (status === this.status) return;
    this.status = status;
    events.push({ type: 'state', status });
  }

  private append(src: Int16Array, offset: number, n: number): void {
    if (this.filled - this.base + n > RING_CAPACITY) {
      // Keep one FFT window of history; nothing pending needs more than that.
      const keep = Math.min(this.filled - this.base, this.chordFft);
      const from = this.filled - this.base - keep;
      this.ring.copyWithin(0, from, from + keep);
      this.base = this.filled - keep;
    }
    let at = this.filled - this.base;
    for (let i = 0; i < n; i++) this.ring[at++] = src[offset + i] / 32768;
    this.filled += n;
  }

  /** Drop the audio window and the smoothing history, so audio from before a gap is not blended with audio after it. */
  private resetWindow(): void {
    this.ring.fill(0, 0, this.filled - this.base);
    this.base = this.filled;
    this.smoother.reset();
    this.havePreviousOnset = false;
  }

  private trackSecAt(audioSec: number): number {
    if (this.anchor) return Math.max(0, this.anchor.trackSec + (audioSec - this.anchor.audioSec) * this.rate);
    return Math.max(0, audioSec - (this.startAudioSec ?? 0));
  }

  private runTicks(events: AnalyzerEvent[]): void {
    for (;;) {
      const end = Math.round(((this.ticks + 1) * ONSET_TICK_MS * this.sampleRate) / 1000);
      if (end > this.filled) return;
      this.ticks++;
      const audioSec = end / this.sampleRate;
      const rel = end - this.base;

      const currentDb = this.onsetAnalyser.readDecibels(rel);
      if (this.havePreviousOnset) {
        this.onsets.push(audioSec, spectralFlux(this.previousOnsetDb, currentDb, 1, this.onsetMaxBin));
      }
      this.previousOnsetDb.set(currentDb);
      this.havePreviousOnset = true;

      if (this.ticks % CHORD_TICKS_PER_ONSET_TICK === 0) this.chordTick(rel, audioSec, events);
      if (this.ticks % ONSET_TICKS_PER_SNAPSHOT === 0) events.push(this.buildSnapshot());
    }
  }

  private chordTick(rel: number, audioSec: number, events: AnalyzerEvent[]): void {
    const linear = this.chordAnalyser.read(rel);
    const chroma = chromaFromMagnitudes(linear, this.sampleRate, this.chordFft);
    const energy = chromaEnergy(linear, this.sampleRate, this.chordFft);
    const smoothed = this.smoother.push(matchChordTemplate(chroma, energy));
    const timeSec = this.trackSecAt(audioSec);

    // The recorded progression is decoded from every frame, not from the
    // per-frame vote that drives the live chord events below - see ChordDecoder.
    this.decoder.push(chroma, energy, timeSec);
    this.recordChroma({ chroma, timeSec });

    const wire: WireChord | null = smoothed ? [smoothed.root, smoothed.quality === 'minor' ? 1 : 0] : null;
    if (!sameWire(wire, this.lastChord)) {
      this.lastChord = wire;
      events.push({ type: 'chord', posMs: Math.round(timeSec * 1000), chord: wire });
    }
  }

  private recordChroma(frame: ChromaFrame): void {
    this.chromaSeen++;
    if (this.chromaSeen % this.chromaStride !== 0) return;
    this.frames.push(frame);
    if (this.frames.length > this.maxChromaFrames) {
      this.frames = this.frames.filter((_, i) => i % 2 === 0);
      this.chromaStride *= 2;
    }
  }

  private buildSnapshot(): SnapshotMessage {
    // Section detection is quadratic in its buckets; widen them as the capture
    // grows so cost and allocation stay bounded (see useLiveChordDetection).
    let earliest = Infinity;
    let latest = -Infinity;
    for (const f of this.frames) {
      if (f.timeSec < earliest) earliest = f.timeSec;
      if (f.timeSec > latest) latest = f.timeSec;
    }
    const spannedSec = this.frames.length > 0 ? Math.max(0, latest - earliest) : 0;
    const bucketSec = Math.max(1, Math.ceil(spannedSec / MAX_SECTION_BUCKETS));

    const sections = detectSections(this.frames, { bucketSec });
    const spans = this.decoder.toSpans();
    const key = estimateKey(spans);
    // A null reading means "not enough clear beats right now", not "the tempo
    // went away": keep the last good one.
    this.tempo = estimateTempo(this.onsets.samples()) ?? this.tempo;

    // Send only what the client does not already hold. A seek back over an
    // earlier stretch rewrites spans behind the tail, which is caught here by
    // comparing what was sent against what is now the timeline.
    let spanStart = Math.min(this.sentSpans.length, spans.length);
    for (let i = 0; i < spanStart; i++) {
      if (!sameSpan(spans[i], this.sentSpans[i])) {
        spanStart = 0;
        break;
      }
    }
    // The last span may still be growing, so it is never counted as delivered.
    this.sentSpans = spans.slice(0, Math.max(0, spans.length - 1));

    const positionSec = this.trackSecAt(this.filled / this.sampleRate);
    return {
      type: 'snapshot',
      posMs: Math.round(positionSec * 1000),
      aligned: this.aligned,
      spanStart,
      spans: spans.slice(spanStart).map(toWireSpan),
      sections: sections.map((s) => ({
        t: s.type,
        l: s.label,
        s: Math.round(s.startSec * 1000),
        e: Math.round(s.endSec * 1000),
      })),
      key: key
        ? {
            tonic: key.tonic,
            minor: key.mode === 'minor' ? 1 : 0,
            confidence: Math.round(Math.max(0, Math.min(1, key.confidence)) * 100),
          }
        : null,
      tempo: this.tempo
        ? { bpm: Math.round(this.tempo.bpm * 10) / 10, confidence: Math.round(Math.max(0, Math.min(1, this.tempo.confidence)) * 100) }
        : null,
    };
  }
}
