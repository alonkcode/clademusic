/**
 * HarmonicLoopEngine
 *
 * Plays a Roman-numeral progression as real audio using Web Audio, in any key
 * and at any tempo. Uses a lookahead scheduler (timer ticks well ahead of the
 * audio clock) so chord timing is sample-accurate and unaffected by React
 * renders or a busy main thread.
 *
 * Voices are synthesised — no samples to download, so this works offline and
 * adds nothing to bundle weight beyond this file.
 */

import {
  bassNote,
  midiToFrequency,
  parseRomanChord,
  voiceChord,
  type ParsedChord,
} from './theory';

/** How far ahead (seconds) we schedule audio events. */
const SCHEDULE_AHEAD = 0.15;
/** How often (ms) the scheduler wakes up. Must be well under SCHEDULE_AHEAD. */
const TICK_INTERVAL = 25;

export interface LoopEngineOptions {
  /** Roman numerals, e.g. ["I", "V", "vi", "IV"]. */
  progression: string[];
  /** Tonic as a pitch class 0-11. */
  tonicPitchClass: number;
  mode: 'major' | 'minor';
  bpm: number;
  /** Beats each chord is held for. */
  beatsPerChord: number;
  /** 0-1. */
  volume: number;
}

export type StepListener = (stepIndex: number) => void;

export class HarmonicLoopEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private chords: ParsedChord[] = [];
  private nextStep = 0;
  private nextNoteTime = 0;
  private running = false;

  private listeners = new Set<StepListener>();
  private options: LoopEngineOptions;

  constructor(options: LoopEngineOptions) {
    this.options = options;
    this.chords = this.parse(options);
  }

  private parse(options: LoopEngineOptions): ParsedChord[] {
    return options.progression
      .map((symbol) => parseRomanChord(symbol, options.mode))
      .filter((c): c is ParsedChord => c !== null);
  }

  /** True when the progression contained at least one chord we can sound. */
  get isPlayable(): boolean {
    return this.chords.length > 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  onStep(listener: StepListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Update settings live. Key, tempo and volume changes take effect on the next
   * scheduled chord, so the loop keeps playing without a gap.
   */
  update(partial: Partial<LoopEngineOptions>): void {
    const next = { ...this.options, ...partial };
    const progressionChanged =
      partial.progression !== undefined || partial.mode !== undefined;
    this.options = next;
    if (progressionChanged) {
      this.chords = this.parse(next);
      this.nextStep = 0;
    }
    if (this.master && partial.volume !== undefined && this.ctx) {
      this.master.gain.setTargetAtTime(partial.volume, this.ctx.currentTime, 0.05);
    }
  }

  async start(): Promise<void> {
    if (this.running || !this.isPlayable) return;

    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return; // No Web Audio in this browser — caller shows a fallback.
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.options.volume;

      // A gentle low-pass keeps the synth pad soft rather than buzzy.
      const tone = this.ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2600;
      tone.Q.value = 0.4;

      this.master.connect(tone);
      tone.connect(this.ctx.destination);
    }

    // Browsers start contexts suspended until a user gesture.
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.running = true;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.nextStep = 0;
    this.emit(-1);
  }

  /** Release audio resources. Call on unmount. */
  dispose(): void {
    this.stop();
    this.listeners.clear();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  private tick(): void {
    if (!this.ctx || !this.running) return;
    const { bpm, beatsPerChord } = this.options;
    const secondsPerChord = (60 / Math.max(bpm, 20)) * Math.max(beatsPerChord, 0.25);

    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
      this.scheduleChord(this.nextStep, this.nextNoteTime, secondsPerChord);
      this.nextNoteTime += secondsPerChord;
      this.nextStep = (this.nextStep + 1) % this.chords.length;
    }
  }

  private previousVoicing: number[] | undefined;

  private scheduleChord(stepIndex: number, when: number, duration: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const chord = this.chords[stepIndex];
    if (!chord) return;

    const voicing = voiceChord(chord, this.options.tonicPitchClass, this.previousVoicing);
    this.previousVoicing = voicing;

    // Pad voices: two detuned sines per note give a warm, chorused body.
    voicing.forEach((midi, index) => {
      const freq = midiToFrequency(midi);
      this.playVoice(freq, when, duration * 0.95, 0.16 / voicing.length, 'triangle');
      this.playVoice(freq * 1.004, when, duration * 0.95, 0.1 / voicing.length, 'sine');
      void index;
    });

    // Bass root, slightly shorter and punchier.
    this.playVoice(
      midiToFrequency(bassNote(chord, this.options.tonicPitchClass)),
      when,
      duration * 0.7,
      0.22,
      'sine'
    );

    // Notify the UI on the audio clock, not the render loop.
    const delayMs = Math.max(0, (when - ctx.currentTime) * 1000);
    setTimeout(() => {
      if (this.running) this.emit(stepIndex);
    }, delayMs);
  }

  private playVoice(
    frequency: number,
    when: number,
    duration: number,
    peak: number,
    type: OscillatorType
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;

    // Soft attack / long release so chords bloom into each other.
    const attack = Math.min(0.08, duration * 0.2);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  }

  private emit(stepIndex: number): void {
    this.listeners.forEach((listener) => listener(stepIndex));
  }
}
