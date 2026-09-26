/**
 * End-to-end check against the real Bun server and real WebSockets.
 *
 *   bun services/live-analysis/smoke.ts            functional checks, exits 1 on any failure
 *   bun services/live-analysis/smoke.ts --bench 20 20 concurrent sessions for 10 s each; prints CPU and memory
 *
 * Vitest cannot run this (it needs Bun's server), which is why the rules
 * themselves are unit-tested against a fake socket and this only proves the
 * adapter wires them to a real socket correctly.
 */

import { ANALYSIS_SAMPLE_RATE, PROTOCOL_VERSION, encodeAudioFrame, type ServerMessage } from './protocol.ts';
import { createLiveAnalysisServer } from './server.ts';

const ORIGIN = 'https://app.test';
const RATE = ANALYSIS_SAMPLE_RATE;
const TOKENS: Record<string, string> = { 'token-a': 'user-a', 'token-b': 'user-b' };

const midiHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
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

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  messages: ServerMessage[] = [];
  closeCode: number | null = null;
  bytesOut = 0;
  private ws: WebSocket;
  opened: Promise<boolean>;
  private seq = 0;

  constructor(url: string, origin: string | null) {
    this.ws = new WebSocket(url, origin ? ({ headers: { Origin: origin } } as never) : undefined);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.messages.push(JSON.parse(e.data));
    };
    this.ws.onclose = (e) => {
      this.closeCode = e.code;
    };
    this.opened = new Promise((resolve) => {
      this.ws.onopen = () => resolve(true);
      this.ws.onerror = () => resolve(false);
    });
  }

  hello(overrides: Record<string, unknown> = {}) {
    this.sendText({ type: 'hello', v: PROTOCOL_VERSION, token: 'token-a', source: 'microphone', provider: 'spotify', trackId: 'spotify:abc', sampleRate: RATE, ...overrides });
  }
  sendText(obj: unknown) {
    const text = JSON.stringify(obj);
    this.bytesOut += text.length;
    this.ws.send(text);
  }
  async stream(samples: Int16Array, startMs = 0, paceMs = 25) {
    const chunk = Math.round(RATE * 0.1);
    for (let at = 0; at < samples.length; at += chunk) {
      const bytes = encodeAudioFrame({ seq: this.seq++, positionMs: startMs + (at / RATE) * 1000, playing: true, positionValid: true, samples: samples.subarray(at, at + chunk) });
      this.bytesOut += bytes.byteLength;
      this.ws.send(bytes);
      if (paceMs) await sleep(paceMs);
    }
  }
  async waitFor(pred: (m: ServerMessage) => boolean, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = this.messages.find(pred);
      if (m) return m;
      await sleep(20);
    }
    return undefined;
  }
  async closed(ms = 3000) {
    const end = Date.now() + ms;
    while (this.closeCode === null && Date.now() < end) await sleep(20);
    return this.closeCode;
  }
  drop() {
    this.ws.close();
  }
  of<T extends ServerMessage['type']>(t: T) {
    return this.messages.filter((m) => m.type === t) as Array<Extract<ServerMessage, { type: T }>>;
  }
}

async function functional() {
  const logs: Array<{ event: string }> = [];
  const service = createLiveAnalysisServer({
    port: 0,
    allowedOrigins: [ORIGIN],
    verifyToken: async (t) => TOKENS[t] ?? null,
    limits: { idleTimeoutMs: 1500, resumeWindowMs: 1500 },
    sweepIntervalMs: 300,
    log: (event) => logs.push({ event }),
  });
  const url = `ws://localhost:${service.port}/ws`;

  const health = await fetch(`http://localhost:${service.port}/healthz`);
  check('healthz answers', health.ok);

  const wrongOrigin = new Client(url, 'https://evil.example');
  check('a page on another origin cannot open a socket', (await wrongOrigin.opened) === false);
  const noOrigin = new Client(url, null);
  check('a handshake with no Origin is refused', (await noOrigin.opened) === false);

  const forged = new Client(url, ORIGIN);
  await forged.opened;
  forged.hello({ token: 'forged' });
  check('a forged token is refused with 4401', (await forged.closed()) === 4401 && forged.of('error')[0]?.code === 'unauthorized');

  const silent = new Client(url, ORIGIN);
  await silent.opened;
  // never sends hello; the 5 s auth timer is exercised in unit tests, here just confirm it is still open and unauthenticated
  check('a socket that has not said hello holds no session', service.manager.size === 0);
  silent.drop();

  const a = new Client(url, ORIGIN);
  await a.opened;
  a.hello();
  const ready = (await a.waitFor((m) => m.type === 'ready')) as Extract<ServerMessage, { type: 'ready' }> | undefined;
  check('hello gets ready with a session id and resume key', Boolean(ready?.sessionId && ready?.resumeKey));

  const audio = tone(8);
  await a.stream(audio, 30_000, 20);
  await sleep(200);
  const chord = a.of('chord').find((c) => c.chord !== null);
  check('streamed C major is heard as C major', chord?.chord?.[0] === 0 && chord?.chord?.[1] === 0, JSON.stringify(chord?.chord));
  check('chord times are on the song clock (started at 30 s)', (chord?.posMs ?? 0) >= 30_000);
  const snaps = a.of('snapshot');
  check('snapshots arrive during playback', snaps.length >= 2, `${snaps.length}`);
  const inBytes = a.bytesOut;
  const outBytes = a.messages.reduce((n, m) => n + JSON.stringify(m).length, 0);
  check('analysis traffic is a small fraction of the audio sent', outBytes < inBytes / 50, `${outBytes} B out vs ${inBytes} B in (${(inBytes / outBytes).toFixed(0)}x)`);

  // The phone loses signal: no stop, no goodbye.
  a.drop();
  await sleep(200);
  check('a dropped connection keeps its session for the resume window', service.manager.size === 1);

  const b = new Client(url, ORIGIN);
  await b.opened;
  b.hello({ token: 'token-b', resume: { sessionId: ready!.sessionId, resumeKey: ready!.resumeKey } });
  check("another user cannot resume the session (session_expired, 4404)", (await b.closed()) === 4404 && b.of('error')[0]?.code === 'session_expired');

  const a2 = new Client(url, ORIGIN);
  await a2.opened;
  a2.hello({ resume: { sessionId: ready!.sessionId, resumeKey: ready!.resumeKey } });
  const back = (await a2.waitFor((m) => m.type === 'ready')) as Extract<ServerMessage, { type: 'ready' }> | undefined;
  check('the owner resumes the same session', back?.resumed === true && back.sessionId === ready!.sessionId);
  const full = await a2.waitFor((m) => m.type === 'snapshot');
  check('resume re-sends the complete analysis', full?.type === 'snapshot' && full.spanStart === 0 && full.spans.length > 0);

  await a2.stream(tone(2), 38_000, 20);
  a2.sendText({ type: 'stop' });
  const stopped = await a2.waitFor((m) => m.type === 'stopped');
  check('stop ends the session cleanly', stopped?.type === 'stopped' && (await a2.closed()) === 1000);
  check('and frees it on the server', service.manager.size === 0);

  const c = new Client(url, ORIGIN);
  await c.opened;
  c.hello({ source: 'provider-audio' });
  await c.closed();
  const unsupported = c.of('error')[0];
  check("asking for a provider's own audio is answered plainly", unsupported?.code === 'unsupported' && unsupported.message === "Live analysis isn't available for this provider.");

  // A tab that is simply abandoned: connect, say hello, never send anything again.
  const d = new Client(url, ORIGIN);
  await d.opened;
  d.hello();
  await d.waitFor((m) => m.type === 'ready');
  check('an abandoned tab is holding a session', service.manager.size === 1);
  const stoppedByServer = await d.waitFor((m) => m.type === 'stopped', 4000);
  check('the server ends it on its own (idle timeout)', stoppedByServer?.type === 'stopped' && stoppedByServer.reason === 'idle_timeout');
  await sleep(200);
  check('and nothing is left running', service.manager.size === 0 && service.openSockets() === 0, `sessions=${service.manager.size} sockets=${service.openSockets()}`);

  const events = new Set(logs.map((l) => l.event));
  check(
    'lifecycle events are logged under the spec names',
    ['analysis_session_started', 'analysis_session_connected', 'analysis_session_reconnected', 'analysis_session_stopped', 'analysis_session_error', 'analysis_provider_unsupported'].every((e) => events.has(e)),
    [...events].join(', ')
  );

  service.stop();
}

async function bench(sessions: number, seconds: number) {
  const service = createLiveAnalysisServer({
    port: 0,
    allowedOrigins: [ORIGIN],
    verifyToken: async (t) => t,
    limits: { maxSessions: sessions + 5, maxSessionsPerUser: 1, createsPerWindow: 1000 },
  });
  const url = `ws://localhost:${service.port}/ws`;
  const audio = tone(seconds);
  const clients = await Promise.all(
    Array.from({ length: sessions }, async (_, i) => {
      const c = new Client(url, ORIGIN);
      await c.opened;
      c.hello({ token: `user-${i}` });
      await c.waitFor((m) => m.type === 'ready');
      return c;
    })
  );
  const cpu0 = process.cpuUsage();
  const rss0 = process.memoryUsage().rss;
  const t0 = performance.now();
  // Real-time pacing: 100 ms of audio every 100 ms.
  await Promise.all(clients.map((c) => c.stream(audio, 0, 100)));
  const wallMs = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  const cpuMs = (cpu.user + cpu.system) / 1000;
  const rssMb = (process.memoryUsage().rss - rss0) / 1e6;
  const outBytes = clients.reduce((n, c) => n + c.messages.reduce((m, x) => m + JSON.stringify(x).length, 0), 0);
  const inBytes = clients.reduce((n, c) => n + c.bytesOut, 0);
  console.log(
    JSON.stringify(
      {
        sessions,
        audioSecondsEach: seconds,
        wallSec: +(wallMs / 1000).toFixed(1),
        // Client and server share this process, so this is an upper bound on the server's cost.
        cpuPercentOfOneCore: +((cpuMs / wallMs) * 100).toFixed(1),
        cpuPercentPerSession: +((cpuMs / wallMs / sessions) * 100).toFixed(2),
        rssGrowthMb: +rssMb.toFixed(1),
        uplinkKBps: +(inBytes / 1000 / (wallMs / 1000) / sessions).toFixed(1),
        downlinkBytesPerSec: +(outBytes / (wallMs / 1000) / sessions).toFixed(0),
      },
      null,
      2
    )
  );
  clients.forEach((c) => c.drop());
  service.stop();
}

const benchIdx = process.argv.indexOf('--bench');
if (benchIdx >= 0) {
  await bench(Number(process.argv[benchIdx + 1] ?? 10), Number(process.argv[benchIdx + 2] ?? 10));
} else {
  await functional();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
