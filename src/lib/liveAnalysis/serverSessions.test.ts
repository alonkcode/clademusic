import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIO_HEADER_BYTES,
  PROTOCOL_VERSION,
  encodeAudioFrame,
  type ServerMessage,
} from '../../../services/live-analysis/protocol';
import { LiveConnection, type SocketLike } from '../../../services/live-analysis/connection';
import { SessionManager, type LiveSession, type SessionSink } from '../../../services/live-analysis/sessionManager';

/**
 * The service's rules, exercised against a fake socket and a controllable
 * clock: who may do what, when a session dies, and that one user's session
 * can neither read nor break another's.
 */

const RATE = 22_050;
const midiHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

let clock = 0;
const now = () => clock;

function makeManager(limits = {}) {
  const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  let n = 0;
  const manager = new SessionManager(limits, {
    now,
    randomId: () => `session-${++n}`,
    randomKey: () => `key-${n}-secret`,
    log: (event, fields) => logs.push({ event, fields }),
  });
  return { manager, logs };
}

class FakeSocket implements SocketLike {
  sent: ServerMessage[] = [];
  closed: { code: number; reason?: string } | null = null;
  buffered = 0;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number, reason?: string) {
    this.closed = { code, reason };
  }
  bufferedAmount() {
    return this.buffered;
  }
  of<T extends ServerMessage['type']>(type: T) {
    return this.sent.filter((m) => m.type === type) as Array<Extract<ServerMessage, { type: T }>>;
  }
}

const TOKENS: Record<string, string> = { 'token-a': 'user-a', 'token-b': 'user-b' };

function makeConnection(manager: SessionManager, logs: unknown[] = [], config = {}) {
  const socket = new FakeSocket();
  const conn = new LiveConnection(socket, {
    manager,
    verifyToken: async (token) => TOKENS[token] ?? null,
    log: (event, fields) => logs.push({ event, fields }),
    now,
    config,
  });
  conn.open();
  return { socket, conn };
}

const helloText = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'hello',
    v: PROTOCOL_VERSION,
    token: 'token-a',
    source: 'microphone',
    provider: 'spotify',
    trackId: 'spotify:abc123',
    sampleRate: RATE,
    ...overrides,
  });

async function connect(manager: SessionManager, opts: { token?: string; resume?: { sessionId: string; resumeKey: string }; logs?: unknown[]; config?: object } = {}) {
  const { socket, conn } = makeConnection(manager, opts.logs, opts.config);
  await conn.handleText(helloText({ token: opts.token ?? 'token-a', ...(opts.resume ? { resume: opts.resume } : {}) }));
  return { socket, conn, ready: socket.of('ready')[0] };
}

/** A chord's worth of tone, `seconds` long, as the int16 the browser sends. */
function tone(seconds: number, midis = [48, 52, 55]): Int16Array {
  const n = Math.round(seconds * RATE);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const m of midis) for (const h of [1, 2, 3, 4]) v += (0.1 / h) * Math.sin((2 * Math.PI * midiHz(m) * h * i) / RATE);
    out[i] = Math.round(v * 32767);
  }
  return out;
}

let seqCounter = 0;
function frame(samples: Int16Array, opts: { positionMs?: number; playing?: boolean; positionValid?: boolean; seq?: number } = {}) {
  return encodeAudioFrame({
    seq: opts.seq ?? seqCounter++,
    positionMs: opts.positionMs ?? 0,
    playing: opts.playing ?? true,
    positionValid: opts.positionValid ?? true,
    samples,
  });
}

/** Push `samples` through a connection in 100 ms chunks, advancing the clock as a real 1x stream would. */
function stream(conn: LiveConnection, samples: Int16Array, startPositionMs = 0) {
  const chunk = Math.round(RATE * 0.1);
  for (let at = 0; at < samples.length; at += chunk) {
    conn.handleBinary(frame(samples.subarray(at, at + chunk), { positionMs: startPositionMs + (at / RATE) * 1000 }));
    clock += 100;
  }
}

beforeEach(() => {
  clock = 1_000_000;
  seqCounter = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('SessionManager', () => {
  const req = { provider: 'spotify', trackId: 'spotify:x', sampleRate: RATE };

  it('creates sessions with distinct ids and secrets, and starts them in "starting"', () => {
    const { manager } = makeManager();
    const a = manager.create('user-a', req);
    const b = manager.create('user-b', req);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.session.id).not.toBe(b.session.id);
    expect(a.session.resumeKey).not.toBe(b.session.resumeKey);
    expect(a.session.status).toBe('starting');
    expect(a.session.capabilities.liveAnalysis).toBe(true);
  });

  it('refuses new sessions past the global cap, so the CPU stays bounded', () => {
    const { manager } = makeManager({ maxSessions: 2 });
    expect(manager.create('u1', req).ok).toBe(true);
    expect(manager.create('u2', req).ok).toBe(true);
    expect(manager.create('u3', req)).toEqual({ ok: false, code: 'capacity' });
    expect(manager.size).toBe(2);
  });

  it('caps one user, and frees the slot when their session stops', () => {
    const { manager } = makeManager({ maxSessionsPerUser: 1 });
    const first = manager.create('u1', req);
    expect(manager.create('u1', req)).toEqual({ ok: false, code: 'capacity' });
    if (first.ok) manager.stop(first.session, 'client');
    expect(manager.create('u1', req).ok).toBe(true);
  });

  it('rate-limits session creation per user and forgets the limit afterwards', () => {
    const { manager } = makeManager({ createsPerWindow: 3, createWindowMs: 60_000, maxSessionsPerUser: 99 });
    for (let i = 0; i < 3; i++) {
      const r = manager.create('u1', req);
      if (r.ok) manager.stop(r.session, 'client');
    }
    expect(manager.create('u1', req)).toEqual({ ok: false, code: 'rate_limited' });
    // Another user is unaffected.
    expect(manager.create('u2', req).ok).toBe(true);
    clock += 61_000;
    expect(manager.create('u1', req).ok).toBe(true);
  });

  it('ends a user\'s abandoned (disconnected) session when they start a new one', () => {
    const { manager } = makeManager({ maxSessionsPerUser: 1 });
    const first = manager.create('u1', req);
    if (!first.ok) throw new Error('setup');
    const sink: SessionSink = { end: vi.fn(), supersede: vi.fn() };
    manager.attach(first.session, sink);
    manager.detach(first.session, sink);
    expect(manager.create('u1', req).ok).toBe(true);
    expect(manager.size).toBe(1);
  });

  describe('lifecycle timeouts (sweep)', () => {
    const setup = (limits = {}) => {
      const { manager, logs } = makeManager({ idleTimeoutMs: 30_000, pausedTimeoutMs: 120_000, resumeWindowMs: 30_000, maxSessionMs: 600_000, ...limits });
      const r = manager.create('u1', req);
      if (!r.ok) throw new Error('setup');
      const end = vi.fn();
      manager.attach(r.session, { end, supersede: vi.fn() });
      return { manager, logs, session: r.session, end };
    };

    it('ends a session that has gone quiet, and tells the connection why', () => {
      const { manager, end } = setup();
      clock += 29_000;
      expect(manager.sweep()).toBe(0);
      clock += 2_000;
      expect(manager.sweep()).toBe(1);
      expect(end).toHaveBeenCalledWith('idle_timeout');
      expect(manager.size).toBe(0);
    });

    it('keeps a session alive as long as audio keeps arriving', () => {
      const { manager, session } = setup();
      for (let i = 0; i < 10; i++) {
        clock += 20_000;
        manager.touchAudio(session);
        expect(manager.sweep()).toBe(0);
      }
      expect(manager.size).toBe(1);
    });

    it('does not let pings and syncs keep a playing session alive: a tab that lost its microphone is not analysing', () => {
      const { manager, session, end } = setup();
      for (let i = 0; i < 4; i++) {
        clock += 10_000;
        manager.touch(session); // heartbeat only, no audio
        manager.sweep();
      }
      expect(end).toHaveBeenCalledWith('idle_timeout');
      expect(manager.size).toBe(0);
    });

    it('does keep a paused session alive on heartbeats alone, since no audio is expected then', () => {
      const { manager, session } = setup();
      manager.setPaused(session, true);
      for (let i = 0; i < 5; i++) {
        clock += 20_000;
        manager.touch(session);
        expect(manager.sweep()).toBe(0);
      }
      expect(manager.size).toBe(1);
    });

    it('gives the microphone a fresh grace period when playback resumes after a long pause', () => {
      const { manager, session } = setup();
      manager.setPaused(session, true);
      for (let i = 0; i < 4; i++) {
        clock += 20_000;
        manager.touch(session);
      }
      manager.setPaused(session, false);
      clock += 20_000;
      expect(manager.sweep()).toBe(0);
    });

    it('gives the microphone a fresh grace period after a reconnect', () => {
      const { manager, session } = setup();
      const sink = session.sink as SessionSink;
      clock += 20_000;
      manager.detach(session, sink);
      clock += 5_000;
      manager.resume('u1', session.id, session.resumeKey);
      clock += 20_000;
      expect(manager.sweep()).toBe(0);
    });

    it('ends a session that has been paused too long, even if the tab keeps pinging', () => {
      const { manager, session, end } = setup();
      manager.setPaused(session, true);
      for (let i = 0; i < 7; i++) {
        clock += 20_000;
        manager.touch(session);
        manager.sweep();
      }
      expect(end).toHaveBeenCalledWith('paused_timeout');
      expect(manager.size).toBe(0);
    });

    it('resuming playback clears the paused clock', () => {
      const { manager, session } = setup();
      manager.setPaused(session, true);
      clock += 100_000;
      manager.touch(session);
      manager.setPaused(session, false);
      clock += 20_000;
      manager.touchAudio(session);
      expect(manager.sweep()).toBe(0);
    });

    it('caps total duration however active the session is', () => {
      const { manager, session, end } = setup({ maxSessionMs: 60_000 });
      for (let i = 0; i < 7; i++) {
        clock += 10_000;
        manager.touchAudio(session);
        manager.sweep();
      }
      expect(end).toHaveBeenCalledWith('max_duration');
    });

    it('drops a disconnected session once its resume window has passed', () => {
      const { manager, session } = setup();
      const sink = session.sink as SessionSink;
      manager.detach(session, sink);
      clock += 29_000;
      expect(manager.sweep()).toBe(0);
      clock += 2_000;
      expect(manager.sweep()).toBe(1);
      expect(manager.size).toBe(0);
    });

    it('logs the lifecycle with the spec\'s event names and no secrets', () => {
      const { manager, logs, session } = setup();
      manager.stop(session, 'client');
      const events = logs.map((l) => l.event);
      expect(events).toContain('analysis_session_started');
      expect(events).toContain('analysis_session_stopped');
      expect(JSON.stringify(logs)).not.toContain(session.resumeKey);
    });
  });

  describe('ownership', () => {
    const setup = () => {
      const { manager } = makeManager();
      const r = manager.create('user-a', req);
      if (!r.ok) throw new Error('setup');
      return { manager, session: r.session };
    };

    it('lets the owner resume with the key', () => {
      const { manager, session } = setup();
      const resumed = manager.resume('user-a', session.id, session.resumeKey);
      expect(resumed.ok).toBe(true);
    });

    it('refuses another user, even holding the right session id and key', () => {
      const { manager, session } = setup();
      expect(manager.resume('user-b', session.id, session.resumeKey)).toEqual({ ok: false, code: 'session_expired' });
    });

    it('refuses the owner with a wrong key', () => {
      const { manager, session } = setup();
      expect(manager.resume('user-a', session.id, 'nope')).toEqual({ ok: false, code: 'session_expired' });
    });

    it('answers "no such session" and "not yours" identically', () => {
      const { manager, session } = setup();
      const notYours = manager.resume('user-b', session.id, session.resumeKey);
      const missing = manager.resume('user-b', 'does-not-exist', 'whatever');
      expect(notYours).toEqual(missing);
    });

    it('takes a session over from a stale connection', () => {
      const { manager, session } = setup();
      const old: SessionSink = { end: vi.fn(), supersede: vi.fn() };
      manager.attach(session, old);
      manager.resume('user-a', session.id, session.resumeKey);
      expect(old.supersede).toHaveBeenCalled();
    });
  });

  it('frees a session\'s analyzer when it stops, and stopping twice is harmless', () => {
    const { manager } = makeManager();
    const r = manager.create('u1', req);
    if (!r.ok) throw new Error('setup');
    manager.stop(r.session, 'client');
    manager.stop(r.session, 'client');
    expect(manager.size).toBe(0);
    expect(r.session.status).toBe('stopped');
  });

  it('stopAll tells every attached connection and empties the table', () => {
    const { manager } = makeManager();
    const ends: string[] = [];
    for (const u of ['u1', 'u2', 'u3']) {
      const r = manager.create(u, req);
      if (r.ok) manager.attach(r.session, { end: (reason) => ends.push(reason), supersede: vi.fn() });
    }
    manager.stopAll('shutdown');
    expect(ends).toEqual(['shutdown', 'shutdown', 'shutdown']);
    expect(manager.size).toBe(0);
  });
});

describe('LiveConnection: getting in', () => {
  it('closes a socket that never says hello', async () => {
    const { manager } = makeManager();
    const { socket } = makeConnection(manager);
    vi.advanceTimersByTime(5_100);
    expect(socket.closed?.code).toBe(4401);
    expect(manager.size).toBe(0);
  });

  it('refuses a bad token and creates no session', async () => {
    const { manager } = makeManager();
    const { socket } = await connect(manager, { token: 'forged' });
    expect(socket.of('ready')).toHaveLength(0);
    expect(socket.of('error')[0]).toMatchObject({ code: 'unauthorized', fatal: true });
    expect(socket.closed?.code).toBe(4401);
    expect(manager.size).toBe(0);
  });

  it('refuses malformed JSON, out-of-range values and unknown message types', async () => {
    const { manager } = makeManager();
    for (const bad of ['not json', helloText({ sampleRate: 999_999 }), helloText({ trackId: 'has spaces & <script>' }), JSON.stringify({ type: 'nope' })]) {
      const { socket, conn } = makeConnection(manager);
      await conn.handleText(bad);
      expect(socket.of('error')[0]?.code).toBe('bad_request');
      expect(socket.closed?.code).toBe(4400);
    }
    expect(manager.size).toBe(0);
  });

  it('answers a token-service outage with a generic error that leaks nothing', async () => {
    const { manager, logs } = makeManager();
    const socket = new FakeSocket();
    const serverLogs: unknown[] = [];
    const conn = new LiveConnection(socket, {
      manager,
      verifyToken: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:443 at Object.<anonymous> (/srv/secret/path.ts:12)');
      },
      log: (event, fields) => serverLogs.push({ event, fields }),
      now,
    });
    conn.open();
    await conn.handleText(helloText());
    const err = socket.of('error')[0];
    expect(err.code).toBe('internal');
    expect(JSON.stringify(socket.sent)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|secret|\.ts:/);
    expect(JSON.stringify(serverLogs)).toContain('ECONNREFUSED'); // the detail is kept where operators can see it
    expect(logs).toEqual([]);
  });

  it('says plainly that a provider\'s own audio is unavailable, and records it', async () => {
    const { manager } = makeManager();
    const logs: Array<{ event: string }> = [];
    const { socket } = await connect(manager, { logs });
    expect(socket.of('ready')).toHaveLength(1);

    const other = makeConnection(manager, logs);
    await other.conn.handleText(helloText({ source: 'provider-audio' }));
    const err = other.socket.of('error')[0];
    expect(err).toMatchObject({ code: 'unsupported', message: "Live analysis isn't available for this provider." });
    expect(logs.some((l) => l.event === 'analysis_provider_unsupported')).toBe(true);
  });

  it('refuses a provider Clade does not play through', async () => {
    const { manager } = makeManager();
    const { socket } = await connect(manager, { logs: [] });
    expect(socket.of('ready')).toHaveLength(1);
    const other = makeConnection(manager);
    await other.conn.handleText(helloText({ provider: 'napster' }));
    expect(other.socket.of('error')[0].code).toBe('unsupported');
  });

  it('completes a hello with ready: session id, secret, capabilities, limits', async () => {
    const { manager } = makeManager();
    const { ready, socket } = await connect(manager);
    expect(ready.sessionId).toBe('session-1');
    expect(ready.resumed).toBe(false);
    expect(ready.capabilities).toMatchObject({ liveAnalysis: true, chords: true, key: true, bpm: true });
    expect(ready.limits.resumeWindowSec).toBe(30);
    expect(socket.closed).toBeNull();
    expect(manager.size).toBe(1);
  });

  it('ignores audio that arrives before the token check finishes, and does not count it', async () => {
    const { manager } = makeManager();
    const { socket, conn } = makeConnection(manager);
    const pending = conn.handleText(helloText());
    conn.handleBinary(frame(tone(0.1)));
    await pending;
    expect(socket.closed).toBeNull();
    expect(socket.of('ready')).toHaveLength(1);
  });

  it('rejects a second hello on the same connection', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    await conn.handleText(helloText());
    expect(socket.of('error')[0].code).toBe('bad_request');
  });
});

describe('LiveConnection: analysing', () => {
  it('turns streamed audio into chord events and snapshots, and tells the client when it changes', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    stream(conn, tone(4), 10_000);
    const chords = socket.of('chord');
    expect(chords.length).toBeGreaterThan(0);
    const heard = chords.find((c) => c.chord !== null);
    expect(heard?.chord).toEqual([0, 0]); // C major
    expect(heard!.posMs).toBeGreaterThanOrEqual(10_000);
    expect(socket.of('snapshot').length).toBeGreaterThanOrEqual(1);
  });

  it('sends analysis frames that are tiny next to the audio that produced them', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    const audio = tone(6);
    stream(conn, audio);
    const outBytes = socket.sent.reduce((n, m) => n + JSON.stringify(m).length, 0);
    const inBytes = audio.length * 2;
    expect(outBytes).toBeLessThan(inBytes / 50);
  });

  it('reports pause and resume, and stops analysing while paused', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    stream(conn, tone(2));
    const sessionBefore = manager.size;
    conn.handleBinary(frame(tone(0.1), { playing: false, positionMs: 2000 }));
    expect(socket.of('state').map((s) => s.status)).toContain('paused');
    conn.handleBinary(frame(tone(0.1), { playing: true, positionMs: 2000 }));
    expect(socket.of('state').map((s) => s.status)).toEqual(['paused', 'analyzing']);
    expect(manager.size).toBe(sessionBefore);
  });

  it('accepts sync messages between audio, and a pause reported by sync alone', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    stream(conn, tone(1));
    await conn.handleText(JSON.stringify({ type: 'sync', positionMs: 1000, playing: false, playbackRate: 1, timestamp: clock }));
    expect(socket.of('state').map((s) => s.status)).toContain('paused');
    await conn.handleText(JSON.stringify({ type: 'sync', positionMs: 1000, playing: true, playbackRate: 1.25, timestamp: clock }));
    expect(socket.closed).toBeNull();
  });

  it('answers ping with pong', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    await conn.handleText(JSON.stringify({ type: 'ping', t: 42 }));
    expect(socket.of('pong')[0]).toEqual({ type: 'pong', t: 42 });
  });

  it('stop sends the final analysis, says stopped, closes, and frees the session', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    stream(conn, tone(4));
    await conn.handleText(JSON.stringify({ type: 'stop' }));
    const types = socket.sent.map((m) => m.type);
    expect(types.slice(-2)).toEqual(['snapshot', 'stopped']);
    expect(socket.closed?.code).toBe(1000);
    expect(manager.size).toBe(0);
  });

  it('the manager ending a session (idle) sends the result so far and closes cleanly', async () => {
    const { manager } = makeManager({ idleTimeoutMs: 5_000 });
    const { conn, socket } = await connect(manager);
    stream(conn, tone(2));
    clock += 10_000;
    manager.sweep();
    expect(socket.sent.slice(-2).map((m) => m.type)).toEqual(['snapshot', 'stopped']);
    expect(socket.of('stopped')[0].reason).toBe('idle_timeout');
    expect(socket.closed?.code).toBe(1000);
    expect(manager.size).toBe(0);
  });
});

describe('LiveConnection: reconnection', () => {
  it('lets the owner resume after the connection drops, and sends the whole picture again', async () => {
    const { manager } = makeManager();
    const first = await connect(manager);
    stream(first.conn, tone(4));
    first.conn.handleClose();
    expect(manager.size).toBe(1); // held for the resume window

    clock += 5_000;
    const second = await connect(manager, { resume: { sessionId: first.ready.sessionId, resumeKey: first.ready.resumeKey } });
    expect(second.ready.resumed).toBe(true);
    expect(second.ready.sessionId).toBe(first.ready.sessionId);
    const snap = second.socket.of('snapshot')[0];
    expect(snap.spanStart).toBe(0);
    expect(manager.size).toBe(1);

    // and it keeps analysing
    stream(second.conn, tone(2), 4_000);
    expect(second.socket.sent.some((m) => m.type === 'chord' || m.type === 'snapshot')).toBe(true);
  });

  it('a stale connection is dropped quietly when the phone comes back on a new one', async () => {
    const { manager } = makeManager();
    const first = await connect(manager);
    const second = await connect(manager, { resume: { sessionId: first.ready.sessionId, resumeKey: first.ready.resumeKey } });
    expect(second.ready.resumed).toBe(true);
    expect(first.socket.closed?.code).toBe(1000);
    expect(first.socket.of('error')).toHaveLength(0);
  });

  it('too late: the session is gone and the client is told to start again', async () => {
    const { manager } = makeManager({ resumeWindowMs: 10_000 });
    const first = await connect(manager);
    first.conn.handleClose();
    clock += 11_000;
    manager.sweep();
    const second = await connect(manager, { resume: { sessionId: first.ready.sessionId, resumeKey: first.ready.resumeKey } });
    expect(second.socket.of('error')[0]).toMatchObject({ code: 'session_expired', message: 'The connection was lost for too long. Start the analysis again.' });
    expect(second.socket.closed?.code).toBe(4404);
  });

  it('a different user cannot resume it', async () => {
    const { manager } = makeManager();
    const a = await connect(manager, { token: 'token-a' });
    a.conn.handleClose();
    const b = await connect(manager, { token: 'token-b', resume: { sessionId: a.ready.sessionId, resumeKey: a.ready.resumeKey } });
    expect(b.socket.of('ready')).toHaveLength(0);
    expect(b.socket.of('error')[0].code).toBe('session_expired');
    // ...and it is still A's.
    const a2 = await connect(manager, { token: 'token-a', resume: { sessionId: a.ready.sessionId, resumeKey: a.ready.resumeKey } });
    expect(a2.socket.of('ready')).toHaveLength(1);
  });
});

describe('isolation between users', () => {
  it('never sends one user\'s analysis to another', async () => {
    const { manager } = makeManager();
    const a = await connect(manager, { token: 'token-a' });
    const b = await connect(manager, { token: 'token-b' });
    stream(a.conn, tone(4, [48, 52, 55])); // C major
    stream(b.conn, tone(4, [45, 48, 52])); // A minor
    const aChords = a.socket.of('chord').flatMap((c) => (c.chord ? [c.chord.join(',')] : []));
    const bChords = b.socket.of('chord').flatMap((c) => (c.chord ? [c.chord.join(',')] : []));
    expect(aChords).toContain('0,0');
    expect(aChords).not.toContain('9,1');
    expect(bChords).toContain('9,1');
    expect(bChords).not.toContain('0,0');
    expect(a.socket.of('ready')[0].sessionId).not.toBe(b.socket.of('ready')[0].sessionId);
  });

  it('a crash in one session ends that session only', async () => {
    const { manager } = makeManager();
    const a = await connect(manager, { token: 'token-a' });
    const b = await connect(manager, { token: 'token-b' });
    const sessionA = (manager as unknown as { sessions: Map<string, LiveSession> }).sessions.get(a.ready.sessionId)!;
    vi.spyOn(sessionA.analyzer, 'push').mockImplementation(() => {
      throw new Error('boom /srv/app/secret.ts:1');
    });

    a.conn.handleBinary(frame(tone(0.2)));
    expect(a.socket.of('error')[0]).toMatchObject({ code: 'internal', fatal: true });
    expect(JSON.stringify(a.socket.sent)).not.toContain('boom');
    expect(manager.size).toBe(1);

    stream(b.conn, tone(3));
    expect(b.socket.closed).toBeNull();
    expect(b.socket.of('chord').length).toBeGreaterThan(0);
  });

  it('frees everything when a client just vanishes: nothing runs forever', async () => {
    const { manager } = makeManager();
    const a = await connect(manager);
    stream(a.conn, tone(2));
    a.conn.handleClose(); // no stop, no goodbye
    for (let i = 0; i < 4; i++) {
      clock += 10_000;
      manager.sweep();
    }
    expect(manager.size).toBe(0);
  });
});

describe('backpressure and abuse', () => {
  it('does not queue analysis for a client that is not draining, but never drops a state change', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager, { config: { highWaterBytes: 1000 } });
    socket.buffered = 5_000;
    stream(conn, tone(4));
    expect(socket.of('chord')).toHaveLength(0);
    expect(socket.of('snapshot')).toHaveLength(0);
    conn.handleBinary(frame(tone(0.1), { playing: false, positionMs: 4000 }));
    expect(socket.of('state').map((s) => s.status)).toContain('paused');
  });

  it('after dropping a snapshot the next one is complete, not a delta against something the client never got', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager, { config: { highWaterBytes: 1000 } });
    stream(conn, tone(4)); // delivered normally
    const delivered = socket.of('snapshot').length;
    expect(delivered).toBeGreaterThan(0);
    socket.buffered = 5_000;
    stream(conn, tone(3), 4_000);
    socket.buffered = 0;
    stream(conn, tone(3), 7_000);
    const after = socket.of('snapshot').slice(delivered);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].spanStart).toBe(0);
  });

  it('disconnects a client that stays unable to keep up', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager, { config: { hardLimitBytes: 1000, slowClientGraceMs: 2_000 } });
    socket.buffered = 5_000;
    stream(conn, tone(5));
    expect(socket.of('error')[0]?.code).toBe('too_slow');
    expect(socket.closed?.code).toBe(4508);
  });

  it('refuses audio faster than the client could be capturing it, and cuts a flooder off', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    const burst = frame(tone(0.5));
    for (let i = 0; i < 400; i++) conn.handleBinary(burst); // clock never moves: no refill
    expect(socket.of('error')[0]?.code).toBe('rate_limited');
    expect(socket.closed?.code).toBe(4429);
  });

  it('tolerates a burst after a stall: delayed audio arriving all at once', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    // 2 s of audio in twenty 100 ms frames delivered together after a network hiccup.
    const audio = tone(2);
    const chunk = Math.round(RATE * 0.1);
    for (let at = 0, i = 0; at < audio.length; at += chunk, i++) {
      conn.handleBinary(frame(audio.subarray(at, at + chunk), { positionMs: (at / RATE) * 1000, seq: i }));
    }
    expect(socket.closed).toBeNull();
    expect(socket.of('chord').length).toBeGreaterThan(0);
  });

  it('cuts off a client that sends garbage instead of audio', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    for (let i = 0; i < 7; i++) conn.handleBinary(new Uint8Array(AUDIO_HEADER_BYTES - 1));
    expect(socket.of('error')[0]?.code).toBe('bad_request');
    expect(socket.closed?.code).toBe(4400);
  });

  it('rejects an oversized control message without parsing it', async () => {
    const { manager } = makeManager();
    const { conn, socket } = await connect(manager);
    await conn.handleText('x'.repeat(20_000));
    expect(socket.of('error')[0]?.code).toBe('bad_request');
  });
});
