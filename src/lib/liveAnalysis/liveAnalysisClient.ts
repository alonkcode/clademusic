/**
 * Browser end of the live-analysis WebSocket protocol.
 *
 * Only `protocol.ts` is imported from services/live-analysis - it was written
 * with no imports and no runtime APIs precisely so it can load in the browser
 * bundle as well as in Bun. The rest of that directory is server code and must
 * never be pulled in here, or `Bun.*` ends up in the app bundle.
 *
 * This owns the socket and the wire only: no audio, no React, no DSP. What it
 * emits is already-decoded app types, so the hook above it never sees a
 * millisecond or a 0-100 confidence.
 */

import {
  ERROR_MESSAGES,
  PROTOCOL_VERSION,
  encodeAudioFrame,
  parseServerMessage,
  type ErrorCode,
  type ReadyMessage,
  type SnapshotMessage,
  type StopReason,
} from '../../../services/live-analysis/protocol';
import type { ChordSpan } from '@/lib/harmony/chordTimeline';
import type { DetectedChord } from '@/lib/harmony/chordDetection';
import type { DetectedSection } from '@/lib/harmony/sectionDetection';
import type { KeyEstimate } from '@/lib/harmony/keyEstimation';
import type { TempoReading } from '@/lib/harmony/tempoDetection';
import { applySpanDelta, decodeChord, decodeKey, decodeSection, decodeTempo } from './wireDecode';

/** The service is told the player state on change and, while it does not change, this often. */
const SYNC_INTERVAL_MS = 2_000;
const PING_INTERVAL_MS = 15_000;
/** Beyond this the socket is behind and a frame would be stale by the time it lands. */
const MAX_BUFFERED_BYTES = 256 * 1024;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000];

/** Close codes the service chose deliberately; everything else is a dropped network. */
const FATAL_CLOSE_CODES = new Set([1000, 4400, 4401, 4404, 4429, 4503, 4508]);

/** The subset of WebSocket this client uses, so a test can supply its own. */
export interface ClientSocket {
  send(data: string | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount: number;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: ((code: number) => void) | null;
  onerror: (() => void) | null;
}

export interface AnalysisUpdate {
  chord: DetectedChord | null;
  chordSpans: ChordSpan[];
  sections: DetectedSection[];
  key: KeyEstimate | null;
  tempo: TempoReading | null;
  /** The server's word on whether these times are the song's own clock. */
  aligned: boolean;
}

export interface LiveAnalysisClientOptions {
  url: string;
  token: string;
  provider: string;
  trackId: string;
  sampleRate: number;
  onReady: (ready: ReadyMessage) => void;
  onUpdate: (update: AnalysisUpdate) => void;
  onError: (message: string, fatal: boolean) => void;
  onStopped: (reason: StopReason) => void;
  createSocket?: (url: string) => ClientSocket;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

const browserSocket = (url: string): ClientSocket => {
  const ws = new WebSocket(url);
  const adapter: ClientSocket = {
    send: (data) => ws.send(data as string | ArrayBufferView),
    close: (code, reason) => ws.close(code, reason),
    get bufferedAmount() {
      return ws.bufferedAmount;
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => adapter.onopen?.();
  ws.onmessage = (event) => {
    // The service only ever sends text; binary from it is not part of the protocol.
    if (typeof event.data === 'string') adapter.onmessage?.(event.data);
  };
  ws.onclose = (event) => adapter.onclose?.(event.code);
  ws.onerror = () => adapter.onerror?.();
  return adapter;
};

export class LiveAnalysisClient {
  private socket: ClientSocket | null = null;
  private seq = 0;
  private resume: { sessionId: string; resumeKey: string } | null = null;
  private reconnects = 0;
  private stopped = false;
  private helloSent = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private spans: ChordSpan[] = [];
  private chord: DetectedChord | null = null;
  private sections: DetectedSection[] = [];
  private key: KeyEstimate | null = null;
  private tempo: TempoReading | null = null;
  private aligned = false;

  private player = { positionMs: 0, playing: false, valid: false };
  private lastSyncAt = 0;

  private readonly createSocket: (url: string) => ClientSocket;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  constructor(private readonly options: LiveAnalysisClientOptions) {
    this.createSocket = options.createSocket ?? browserSocket;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  connect(): void {
    if (this.stopped) return;
    const socket = this.createSocket(this.options.url);
    this.socket = socket;
    this.helloSent = false;
    socket.onopen = () => this.sendHello();
    socket.onmessage = (data) => this.handleMessage(data);
    socket.onclose = (code) => this.handleClose(code);
    // An error is always followed by a close; the close is where recovery happens.
    socket.onerror = () => {};
  }

  /**
   * The player's position at this instant. Held as state rather than sent
   * immediately: every audio frame carries it, and `sync` only has to go out
   * on a change or every couple of seconds.
   */
  updatePlayer(positionMs: number, playing: boolean, valid: boolean): void {
    const changed = this.player.playing !== playing || this.player.valid !== valid;
    this.player = { positionMs, playing, valid };
    if (changed) this.sendSync();
  }

  /** Stamped at capture, so alignment to the song survives network jitter. */
  sendFrame(samples: Int16Array): void {
    const socket = this.socket;
    if (!socket || !this.helloSent) return;
    // Behind by this much and the frame lands stale; the server is already
    // dropping droppable frames for a client that cannot keep up.
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
    socket.send(
      encodeAudioFrame({
        seq: this.seq++,
        positionMs: this.player.positionMs,
        playing: this.player.playing,
        positionValid: this.player.valid,
        samples,
      })
    );
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.socket && this.helloSent) this.send({ type: 'stop' });
    this.socket?.close(1000, 'client');
    this.socket = null;
  }

  private sendHello(): void {
    this.send({
      type: 'hello',
      v: PROTOCOL_VERSION,
      token: this.options.token,
      source: 'microphone',
      provider: this.options.provider,
      trackId: this.options.trackId,
      sampleRate: this.options.sampleRate,
      ...(this.resume ? { resume: this.resume } : {}),
    });
    this.helloSent = true;
  }

  private send(message: unknown): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // A send on a closing socket throws; the close handler runs recovery.
    }
  }

  private sendSync(): void {
    if (!this.helloSent) return;
    this.lastSyncAt = Date.now();
    this.send({
      type: 'sync',
      positionMs: Math.max(0, Math.round(this.player.positionMs)),
      playing: this.player.playing,
      playbackRate: 1,
      timestamp: Date.now(),
    });
  }

  private startTimers(): void {
    this.clearTimers();
    const tickSync = () => {
      if (Date.now() - this.lastSyncAt >= SYNC_INTERVAL_MS) this.sendSync();
      this.syncTimer = this.setTimer(tickSync, SYNC_INTERVAL_MS);
    };
    this.syncTimer = this.setTimer(tickSync, SYNC_INTERVAL_MS);

    const tickPing = () => {
      this.send({ type: 'ping', t: Date.now() });
      this.pingTimer = this.setTimer(tickPing, PING_INTERVAL_MS);
    };
    this.pingTimer = this.setTimer(tickPing, PING_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.syncTimer) this.clearTimer(this.syncTimer);
    if (this.pingTimer) this.clearTimer(this.pingTimer);
    if (this.reconnectTimer) this.clearTimer(this.reconnectTimer);
    this.syncTimer = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
  }

  private handleMessage(data: string): void {
    const message = parseServerMessage(data);
    if (!message) return;

    switch (message.type) {
      case 'ready':
        this.resume = { sessionId: message.sessionId, resumeKey: message.resumeKey };
        this.reconnects = 0;
        this.startTimers();
        this.sendSync();
        this.options.onReady(message);
        break;
      case 'chord':
        this.chord = decodeChord(message.chord);
        this.emit();
        break;
      case 'snapshot':
        this.applySnapshot(message);
        this.emit();
        break;
      case 'error':
        this.options.onError(message.message ?? ERROR_MESSAGES[message.code as ErrorCode], message.fatal);
        if (message.fatal) this.stopped = true;
        break;
      case 'stopped':
        this.stopped = true;
        this.clearTimers();
        this.options.onStopped(message.reason);
        break;
      case 'state':
      case 'pong':
        break;
    }
  }

  private applySnapshot(message: SnapshotMessage): void {
    this.spans = applySpanDelta(this.spans, message.spanStart, message.spans);
    this.sections = message.sections.map(decodeSection);
    this.key = decodeKey(message.key);
    // Like the local path, a quiet stretch means "no clear beats right now",
    // not "the tempo went away" - keep the last good reading.
    this.tempo = decodeTempo(message.tempo) ?? this.tempo;
    this.aligned = message.aligned;
  }

  private emit(): void {
    this.options.onUpdate({
      chord: this.chord,
      chordSpans: this.spans,
      sections: this.sections,
      key: this.key,
      tempo: this.tempo,
      aligned: this.aligned,
    });
  }

  private handleClose(code: number): void {
    this.socket = null;
    this.helloSent = false;
    this.clearTimers();
    if (this.stopped) return;

    // A code the service chose means the next attempt fails the same way.
    // Anything else is a dropped connection, which the resume window covers.
    if (FATAL_CLOSE_CODES.has(code) || !this.resume || this.reconnects >= RECONNECT_DELAYS_MS.length) {
      this.stopped = true;
      this.options.onStopped(code === 1000 ? 'client' : 'error');
      return;
    }

    const delay = RECONNECT_DELAYS_MS[this.reconnects];
    this.reconnects += 1;
    this.reconnectTimer = this.setTimer(() => this.connect(), delay);
  }
}

/** Configured per deployment; unset means the microphone route is simply unavailable. */
export const liveAnalysisUrl = (): string | null => {
  const url = import.meta.env?.VITE_LIVE_ANALYSIS_WS_URL as string | undefined;
  return url && url.trim().length > 0 ? url.trim() : null;
};
