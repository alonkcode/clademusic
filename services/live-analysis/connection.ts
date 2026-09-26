/**
 * One WebSocket, from open to close.
 *
 * Runtime-agnostic on purpose: it talks to a `SocketLike`, so the same code
 * runs under Bun in production and against a fake socket in Vitest. Everything
 * that decides what a client may do is here or in SessionManager - the Bun
 * adapter in server.ts only moves bytes.
 *
 * Trust model: a connection is bound to exactly one authenticated user and at
 * most one session, fixed at `hello`. No later message names a session, so
 * there is nothing for a client to point at someone else's.
 */

import {
  CLOSE,
  CLOSE_FOR_ERROR,
  ERROR_MESSAGES,
  MAX_CONTROL_BYTES,
  decodeAudioFrame,
  parseClientMessage,
  providerAnalysisCapability,
} from './protocol.ts';
import type { ErrorCode, HelloMessage, ServerMessage, StopReason } from './protocol.ts';
import type { AnalyzerEvent } from './streamingAnalyzer.ts';
import type { LiveSession, Logger, SessionManager, SessionSink } from './sessionManager.ts';

export interface SocketLike {
  send(data: string): void;
  close(code: number, reason?: string): void;
  /** Bytes queued for the peer and not yet written. */
  bufferedAmount(): number;
}

export interface ConnectionConfig {
  /** How long a socket may sit without a valid hello. */
  authTimeoutMs: number;
  /** Above this, droppable frames are skipped rather than queued. */
  highWaterBytes: number;
  /** Above this for `slowClientGraceMs`, the client cannot keep up and is disconnected. */
  hardLimitBytes: number;
  slowClientGraceMs: number;
  /** Audio the client may send per second, as a multiple of real time. */
  maxAudioRealtimeFactor: number;
  /** Consecutive rejected frames before the connection is cut. */
  maxConsecutiveRejects: number;
}

export const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = {
  authTimeoutMs: 5_000,
  highWaterBytes: 64 * 1024,
  hardLimitBytes: 256 * 1024,
  slowClientGraceMs: 10_000,
  maxAudioRealtimeFactor: 2,
  maxConsecutiveRejects: 50,
};

/** Resolves to a user id, or null when the token is not valid. Throws when it cannot tell. */
export type TokenVerifier = (token: string) => Promise<string | null>;

export interface ConnectionDeps {
  manager: SessionManager;
  verifyToken: TokenVerifier;
  log: Logger;
  now: () => number;
  config?: Partial<ConnectionConfig>;
}

type State = 'awaiting_hello' | 'verifying' | 'active' | 'closed';

export class LiveConnection implements SessionSink {
  private state: State = 'awaiting_hello';
  private session: LiveSession | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly config: ConnectionConfig;
  private badFrames = 0;
  private rejectedInARow = 0;
  private slowSince: number | null = null;
  /** Token bucket for inbound audio, in bytes. */
  private allowance = 0;
  private allowanceAt = 0;
  private allowanceCap = 0;
  private allowanceRate = 0;

  constructor(
    private readonly socket: SocketLike,
    private readonly deps: ConnectionDeps
  ) {
    this.config = { ...DEFAULT_CONNECTION_CONFIG, ...deps.config };
  }

  open(): void {
    this.authTimer = setTimeout(() => {
      if (this.state === 'awaiting_hello' || this.state === 'verifying') this.fail('unauthorized');
    }, this.config.authTimeoutMs);
  }

  async handleText(text: string): Promise<void> {
    if (this.state === 'closed') return;
    if (text.length > MAX_CONTROL_BYTES) return this.fail('bad_request');
    const message = parseClientMessage(text);
    if (!message) return this.fail('bad_request');

    if (message.type === 'hello') {
      if (this.state !== 'awaiting_hello') return this.fail('bad_request');
      return this.onHello(message);
    }
    if (this.state !== 'active' || !this.session) return this.fail('unauthorized');

    const session = this.session;
    this.deps.manager.touch(session);
    switch (message.type) {
      case 'ping':
        this.send({ type: 'pong', t: message.t });
        return;
      case 'sync': {
        session.analyzer.setPlaybackRate(message.playbackRate);
        const events = session.analyzer.setPlaying(message.playing);
        this.afterAnalysis(session, events);
        return;
      }
      case 'stop':
        this.finish('client');
        return;
    }
  }

  handleBinary(data: ArrayBuffer | ArrayBufferView): void {
    // Audio can be in flight while the token is still being checked; it is not
    // acknowledged until `ready`, so it is simply not wanted yet.
    if (this.state === 'verifying') return;
    if (this.state !== 'active' || !this.session) return this.fail('unauthorized');
    const session = this.session;

    const frame = decodeAudioFrame(data);
    if (!frame) {
      session.droppedChunks++;
      if (++this.badFrames > 5) this.fail('bad_request');
      return;
    }

    const bytes = data.byteLength;
    if (!this.admit(bytes)) {
      session.droppedChunks++;
      if (++this.rejectedInARow > this.config.maxConsecutiveRejects) this.fail('rate_limited');
      return;
    }
    this.rejectedInARow = 0;

    session.chunks++;
    session.bytesIn += bytes;
    this.deps.manager.touchAudio(session);
    try {
      this.afterAnalysis(session, session.analyzer.push(frame));
    } catch (error) {
      // One session's failure must not reach another's. The detail stays in
      // the server log; the client is told only that something went wrong.
      this.deps.log('analysis_session_error', {
        sessionId: session.id,
        provider: session.provider,
        code: 'internal',
        detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      this.deps.manager.stop(session, 'error');
      this.session = null;
      this.fail('internal', { log: false });
    }
  }

  handleClose(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.clearAuthTimer();
    if (this.session) this.deps.manager.detach(this.session, this);
    this.session = null;
  }

  // SessionSink ------------------------------------------------------------

  end(reason: StopReason): void {
    const session = this.session;
    if (this.state === 'closed') return;
    if (session) this.send(session.analyzer.flush());
    this.send({ type: 'stopped', reason });
    this.session = null;
    this.state = 'closed';
    this.socket.close(CLOSE.NORMAL, reason);
  }

  supersede(): void {
    if (this.state === 'closed') return;
    this.session = null;
    this.state = 'closed';
    this.clearAuthTimer();
    this.socket.close(CLOSE.NORMAL, 'superseded');
  }

  // ------------------------------------------------------------------------

  private async onHello(hello: HelloMessage): Promise<void> {
    this.state = 'verifying';

    let userId: string | null;
    try {
      userId = await this.deps.verifyToken(hello.token);
    } catch (error) {
      this.deps.log('analysis_session_error', {
        code: 'internal',
        detail: 'token verification unavailable: ' + (error instanceof Error ? error.message : String(error)),
      });
      return this.fail('internal', { log: false });
    }
    if (this.state !== 'verifying') return; // the socket closed while the check was out
    if (!userId) return this.fail('unauthorized');
    this.clearAuthTimer();

    // Capability check: the only audio route is the user's own microphone.
    // Asking for anything else - a provider's own audio, or a provider Clade
    // does not play through - gets a plain answer, not a workaround.
    if (hello.source !== 'microphone' || !providerAnalysisCapability(hello.provider)) {
      this.deps.log('analysis_provider_unsupported', { provider: hello.provider, source: hello.source });
      return this.fail('unsupported');
    }

    const { manager } = this.deps;
    const result = hello.resume
      ? manager.resume(userId, hello.resume.sessionId, hello.resume.resumeKey)
      : manager.create(userId, { provider: hello.provider, trackId: hello.trackId, sampleRate: hello.sampleRate });
    // `in` rather than `!result.ok`: the app's tsconfig is not strict, and a boolean discriminant does not narrow there.
    if ('code' in result) return this.fail(result.code);

    const session = result.session;
    this.session = session;
    this.state = 'active';
    this.allowanceRate = session.sampleRate * 2 * this.config.maxAudioRealtimeFactor;
    this.allowanceCap = this.allowanceRate * 3;
    this.allowance = this.allowanceCap;
    this.allowanceAt = this.deps.now();
    manager.attach(session, this);

    const limits = manager.config;
    this.send({
      type: 'ready',
      sessionId: session.id,
      resumeKey: session.resumeKey,
      resumed: Boolean(hello.resume),
      capabilities: session.capabilities,
      sampleRate: session.sampleRate,
      limits: {
        maxSessionSec: Math.round(limits.maxSessionMs / 1000),
        idleTimeoutSec: Math.round(limits.idleTimeoutMs / 1000),
        resumeWindowSec: Math.round(limits.resumeWindowMs / 1000),
      },
    });
    this.deps.log('analysis_session_connected', { sessionId: session.id, provider: session.provider, resumed: Boolean(hello.resume) });

    if (hello.resume) {
      // Whatever was in flight when the connection dropped is lost, so the
      // client gets the whole picture rather than a delta against a base it may
      // not have.
      session.analyzer.invalidateDelta();
      this.send(session.analyzer.flush());
      session.analyzer.invalidateDelta();
    }
  }

  private afterAnalysis(session: LiveSession, events: AnalyzerEvent[]): void {
    this.deps.manager.setPaused(session, session.analyzer.currentStatus === 'paused');
    for (const event of events) this.deliver(session, event);
  }

  /**
   * Send an analysis event unless the client is not draining. Chord changes
   * and snapshots are droppable because the next snapshot restores everything
   * they said; a dropped snapshot invalidates the delta base so that next one
   * is complete. State changes are a few bytes and edge-triggered, so they are
   * never dropped.
   */
  private deliver(session: LiveSession, event: AnalyzerEvent): void {
    if (this.state === 'closed') return; // an earlier event in this batch already ended the connection
    const buffered = this.socket.bufferedAmount();

    if (buffered > this.config.hardLimitBytes) {
      const now = this.deps.now();
      this.slowSince ??= now;
      if (now - this.slowSince >= this.config.slowClientGraceMs) {
        this.deps.log('analysis_session_error', { sessionId: session.id, provider: session.provider, code: 'too_slow' });
        this.fail('too_slow', { log: false });
        return;
      }
    } else {
      this.slowSince = null;
    }

    if (event.type !== 'state' && buffered > this.config.highWaterBytes) {
      if (event.type === 'snapshot') session.analyzer.invalidateDelta();
      session.droppedChunks++;
      return;
    }
    this.send(event);
  }

  /** Inbound audio budget: a well-behaved client sends ~1x real time, so a flood is refused, not analysed. */
  private admit(bytes: number): boolean {
    const now = this.deps.now();
    const elapsedSec = Math.max(0, (now - this.allowanceAt) / 1000);
    this.allowanceAt = now;
    this.allowance = Math.min(this.allowanceCap, this.allowance + elapsedSec * this.allowanceRate);
    if (this.allowance < bytes) return false;
    this.allowance -= bytes;
    return true;
  }

  private finish(reason: StopReason): void {
    const session = this.session;
    if (!session) return;
    this.send(session.analyzer.flush());
    this.send({ type: 'stopped', reason });
    this.deps.manager.stop(session, reason);
    this.session = null;
    this.state = 'closed';
    this.socket.close(CLOSE.NORMAL, reason);
  }

  /**
   * End the connection with an error the listener can act on. `log: false` is
   * for call sites that have already logged the underlying detail.
   */
  private fail(code: ErrorCode, opts: { log?: boolean } = {}): void {
    if (this.state === 'closed') return;
    // A session that is still alive stays resumable: the client may just be misbehaving or slow.
    if (this.session) this.deps.manager.detach(this.session, this);
    this.session = null;
    this.state = 'closed';
    this.clearAuthTimer();
    if (opts.log !== false) this.deps.log('analysis_session_error', { code });
    this.send({ type: 'error', code, message: ERROR_MESSAGES[code], fatal: true });
    this.socket.close(CLOSE_FOR_ERROR[code], code);
  }

  private send(message: ServerMessage): void {
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      // A socket that has already closed under us; handleClose cleans up.
    }
  }

  private clearAuthTimer(): void {
    if (this.authTimer) clearTimeout(this.authTimer);
    this.authTimer = null;
  }
}
