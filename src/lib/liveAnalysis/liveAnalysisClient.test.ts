import { describe, it, expect, vi } from 'vitest';
import { LiveAnalysisClient, type ClientSocket } from './liveAnalysisClient';
import {
  decodeAudioFrame,
  PROTOCOL_VERSION,
  type ReadyMessage,
  type SnapshotMessage,
  type StopReason,
} from '../../../services/live-analysis/protocol';

/** A socket the test drives by hand: nothing here touches a real WebSocket. */
class FakeSocket implements ClientSocket {
  sent: Array<string | ArrayBufferView> = [];
  closed: number | null = null;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((code: number) => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string | ArrayBufferView) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closed = code ?? 1000;
  }

  /** Everything the client sent as parsed JSON, binary frames excluded. */
  control(): Array<Record<string, unknown>> {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
  binary(): ArrayBufferView[] {
    return this.sent.filter((d): d is ArrayBufferView => typeof d !== 'string');
  }
}

const ready = (over: Partial<ReadyMessage> = {}): string =>
  JSON.stringify({
    type: 'ready',
    sessionId: 'sess-1',
    resumeKey: 'key-1',
    resumed: false,
    capabilities: { liveAnalysis: true, chords: true, sections: true, key: true, bpm: true, realtime: true },
    sampleRate: 22_050,
    limits: { maxSessionSec: 900, idleTimeoutSec: 30, resumeWindowSec: 30 },
    ...over,
  } satisfies ReadyMessage);

const snapshot = (over: Partial<SnapshotMessage> = {}): string =>
  JSON.stringify({
    type: 'snapshot',
    posMs: 10_000,
    aligned: true,
    spanStart: 0,
    spans: [],
    sections: [],
    key: null,
    tempo: null,
    ...over,
  } satisfies SnapshotMessage);

function harness(over: Record<string, unknown> = {}) {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const updates: unknown[] = [];
  const errors: Array<{ message: string; fatal: boolean }> = [];
  const stops: StopReason[] = [];

  const client = new LiveAnalysisClient({
    url: 'wss://live.example/ws',
    token: 'token-abc',
    provider: 'youtube',
    trackId: 'dQw4w9WgXcQ',
    sampleRate: 22_050,
    onReady: vi.fn(),
    onUpdate: (u) => updates.push(u),
    onError: (message, fatal) => errors.push({ message, fatal }),
    onStopped: (reason) => stops.push(reason),
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    // Timers are captured, never run, so nothing here depends on wall time.
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {},
    ...over,
  });

  return { client, sockets, timers, updates, errors, stops };
}

describe('LiveAnalysisClient', () => {
  it('introduces itself as a microphone source once the socket opens', () => {
    const { client, sockets } = harness();
    client.connect();
    sockets[0].onopen?.();

    const hello = sockets[0].control()[0];
    expect(hello).toMatchObject({
      type: 'hello',
      v: PROTOCOL_VERSION,
      token: 'token-abc',
      // The service refuses any other source outright; this is the only route
      // that exists, and it must not silently become something else.
      source: 'microphone',
      provider: 'youtube',
      trackId: 'dQw4w9WgXcQ',
      sampleRate: 22_050,
    });
    expect(hello.resume).toBeUndefined();
  });

  it('stamps each audio frame with the position at capture', () => {
    const { client, sockets } = harness();
    client.connect();
    sockets[0].onopen?.();
    client.updatePlayer(42_000, true, true);

    client.sendFrame(new Int16Array([1, -1, 32_767]));
    const frame = decodeAudioFrame(sockets[0].binary()[0]);
    expect(frame).not.toBeNull();
    expect(frame!.positionMs).toBe(42_000);
    expect(frame!.playing).toBe(true);
    expect(frame!.positionValid).toBe(true);
    expect(Array.from(frame!.samples)).toEqual([1, -1, 32_767]);

    // seq increments so the server can tell a gap from a reorder.
    client.sendFrame(new Int16Array([0]));
    expect(decodeAudioFrame(sockets[0].binary()[1])!.seq).toBe(1);
  });

  it('drops frames rather than queueing them when the socket is behind', () => {
    const { client, sockets } = harness();
    client.connect();
    sockets[0].onopen?.();
    sockets[0].bufferedAmount = 512 * 1024;

    client.sendFrame(new Int16Array([1, 2, 3]));
    expect(sockets[0].binary()).toHaveLength(0);
  });

  it('sends no audio before hello has gone out', () => {
    const { client, sockets } = harness();
    client.connect();
    client.sendFrame(new Int16Array([1]));
    expect(sockets[0].binary()).toHaveLength(0);
  });

  it('accumulates snapshot deltas into a growing chord timeline', () => {
    const { client, sockets, updates } = harness();
    client.connect();
    sockets[0].onopen?.();
    sockets[0].onmessage?.(ready());

    // Key and sections are complete in every snapshot, unlike the span delta,
    // so a real server re-sends the key it already has rather than dropping it.
    const key = { tonic: 0, minor: 0 as const, confidence: 70 };
    sockets[0].onmessage?.(snapshot({ spanStart: 0, spans: [[0, 0, 0, 2_000, 90]], key }));
    sockets[0].onmessage?.(snapshot({ spanStart: 1, spans: [[7, 0, 2_000, 4_000, 88]], key }));

    const latest = updates.at(-1) as { chordSpans: unknown[]; key: unknown; aligned: boolean };
    expect(latest.chordSpans).toHaveLength(2);
    expect(latest.key).toEqual({ tonic: 0, mode: 'major', confidence: 0.7 });
    // The server's verdict, since these are the times the spans carry.
    expect(latest.aligned).toBe(true);
  });

  it('keeps the last good tempo through a snapshot that reports none', () => {
    const { client, sockets, updates } = harness();
    client.connect();
    sockets[0].onopen?.();
    sockets[0].onmessage?.(ready());

    sockets[0].onmessage?.(snapshot({ tempo: { bpm: 120, confidence: 80 } }));
    sockets[0].onmessage?.(snapshot({ tempo: null }));

    // Null means "no clear beats right now", not "the tempo went away".
    expect((updates.at(-1) as { tempo: unknown }).tempo).toEqual({ bpm: 120, confidence: 0.8 });
  });

  it('resumes the same session after the connection drops', () => {
    const { client, sockets, timers } = harness();
    client.connect();
    sockets[0].onopen?.();
    sockets[0].onmessage?.(ready());

    sockets[0].onclose?.(1006); // abnormal: the network went away
    const reconnect = timers.at(-1)!;
    expect(reconnect.ms).toBe(1_000);
    reconnect.fn();

    sockets[1].onopen?.();
    expect(sockets[1].control()[0]).toMatchObject({
      resume: { sessionId: 'sess-1', resumeKey: 'key-1' },
    });
  });

  it('does not retry a close the service chose', () => {
    const { client, sockets, stops } = harness();
    client.connect();
    sockets[0].onopen?.();
    sockets[0].onmessage?.(ready());

    sockets[0].onclose?.(4401); // unauthorized - the next attempt fails identically
    expect(sockets).toHaveLength(1);
    expect(stops).toEqual(['error']);
  });

  it('surfaces a fatal error and stops trying', () => {
    const { client, sockets, errors } = harness();
    client.connect();
    sockets[0].onopen?.();
    sockets[0].onmessage?.(
      JSON.stringify({ type: 'error', code: 'capacity', message: 'Live analysis is busy right now.', fatal: true })
    );

    expect(errors).toEqual([{ message: 'Live analysis is busy right now.', fatal: true }]);
    sockets[0].onclose?.(4503);
    expect(sockets).toHaveLength(1);
  });

  it('says goodbye before closing so the server frees the session', () => {
    const { client, sockets } = harness();
    client.connect();
    sockets[0].onopen?.();
    sockets[0].onmessage?.(ready());

    client.stop();
    expect(sockets[0].control().at(-1)).toEqual({ type: 'stop' });
    expect(sockets[0].closed).toBe(1000);
  });

  it('ignores anything that is not a message it knows', () => {
    const { client, sockets, updates } = harness();
    client.connect();
    sockets[0].onopen?.();
    sockets[0].onmessage?.('not json at all');
    sockets[0].onmessage?.(JSON.stringify({ type: 'something-new' }));
    expect(updates).toHaveLength(0);
  });
});
