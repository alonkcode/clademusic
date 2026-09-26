/**
 * Who is analysing what, and for how long.
 *
 * Every limit that keeps the service healthy lives here: a global cap on
 * concurrent sessions, a per-user cap, a creation rate limit, idle / paused /
 * disconnected / total-duration timeouts, and a sweep that enforces them. A
 * session that outlives its tab is ended by the sweep, not by anyone
 * remembering to close it.
 *
 * Ownership is enforced here and nowhere else: `resume` needs the session id,
 * its secret resume key AND the same authenticated user, and every failure
 * looks identical to "no such session", so a caller learns nothing about
 * someone else's.
 */

import type { AnalysisCapabilities, ErrorCode, StopReason } from './protocol.ts';
import { MICROPHONE_CAPABILITIES } from './protocol.ts';
import { StreamingAnalyzer } from './streamingAnalyzer.ts';

export interface SessionLimits {
  /**
   * Sessions in flight across all users, and the CPU guard. Measured under Bun
   * (smoke.ts --bench): about 0.5% of a core and ~1 MB per real-time session, so
   * 50 is roughly a quarter of one core with headroom for the periodic section
   * recompute.
   */
  maxSessions: number;
  maxSessionsPerUser: number;
  /**
   * A playing session must keep sending audio, and a paused one must keep
   * sending heartbeats, at least this often. Pings alone do not keep a playing
   * session alive: a tab that has lost its microphone but still answers pings is
   * not analysing anything.
   */
  idleTimeoutMs: number;
  /** Reported paused this long: playback has effectively ended. */
  pausedTimeoutMs: number;
  /** How long a dropped connection may take to come back and resume. */
  resumeWindowMs: number;
  maxSessionMs: number;
  /** New sessions per user per window. */
  createsPerWindow: number;
  createWindowMs: number;
}

export const DEFAULT_LIMITS: SessionLimits = {
  maxSessions: 50,
  maxSessionsPerUser: 2,
  idleTimeoutMs: 30_000,
  pausedTimeoutMs: 120_000,
  resumeWindowMs: 30_000,
  maxSessionMs: 15 * 60_000,
  createsPerWindow: 10,
  createWindowMs: 10 * 60_000,
};

export type SessionStatus = 'starting' | 'running' | 'paused' | 'stopped' | 'error';

/** The connection currently attached to a session, as the manager needs to reach it. */
export interface SessionSink {
  /** The manager ended the session; tell the client why and close. */
  end(reason: StopReason): void;
  /** Another connection resumed this session; drop this one quietly. */
  supersede(): void;
}

export interface LiveSession {
  readonly id: string;
  readonly userId: string;
  readonly provider: string;
  readonly trackId: string;
  readonly sampleRate: number;
  readonly startedAt: number;
  readonly capabilities: AnalysisCapabilities;
  readonly analyzer: StreamingAnalyzer;
  /** Secret. Never logged, never sent to anyone but the owner. */
  readonly resumeKey: string;
  status: SessionStatus;
  /** Last message of any kind. */
  lastActivityAt: number;
  /** Last accepted audio frame. */
  lastAudioAt: number;
  pausedSince: number | null;
  detachedAt: number | null;
  sink: SessionSink | null;
  chunks: number;
  droppedChunks: number;
  bytesIn: number;
}

export type Logger = (event: string, fields?: Record<string, unknown>) => void;

export interface ManagerDeps {
  now: () => number;
  randomId: () => string;
  randomKey: () => string;
  log: Logger;
}

export interface CreateRequest {
  provider: string;
  trackId: string;
  sampleRate: number;
}

export type CreateResult = { ok: true; session: LiveSession } | { ok: false; code: ErrorCode };

const defaultDeps = (): ManagerDeps => ({
  now: () => Date.now(),
  randomId: () => crypto.randomUUID(),
  randomKey: () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  },
  log: () => {},
});

/** Compares without stopping at the first difference, so timing does not leak how much of a key matched. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class SessionManager {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly createdAt = new Map<string, number[]>();
  private readonly limits: SessionLimits;
  private readonly deps: ManagerDeps;

  constructor(limits: Partial<SessionLimits> = {}, deps: Partial<ManagerDeps> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.deps = { ...defaultDeps(), ...deps };
  }

  get size(): number {
    return this.sessions.size;
  }

  get config(): SessionLimits {
    return this.limits;
  }

  create(userId: string, request: CreateRequest): CreateResult {
    const now = this.deps.now();

    const recent = (this.createdAt.get(userId) ?? []).filter((t) => now - t < this.limits.createWindowMs);
    if (recent.length >= this.limits.createsPerWindow) {
      this.createdAt.set(userId, recent);
      return { ok: false, code: 'rate_limited' };
    }

    // A user who reopens on another device should not be locked out by the
    // dropped connection they left behind: those sessions can only be resumed
    // with a key the new tab does not have, so they are ended.
    for (const s of this.userSessions(userId)) {
      if (s.detachedAt !== null) this.stop(s, 'client');
    }
    if (this.userSessions(userId).length >= this.limits.maxSessionsPerUser) return { ok: false, code: 'capacity' };
    if (this.sessions.size >= this.limits.maxSessions) return { ok: false, code: 'capacity' };

    recent.push(now);
    this.createdAt.set(userId, recent);

    const session: LiveSession = {
      id: this.deps.randomId(),
      userId,
      provider: request.provider,
      trackId: request.trackId,
      sampleRate: request.sampleRate,
      startedAt: now,
      capabilities: MICROPHONE_CAPABILITIES,
      analyzer: new StreamingAnalyzer({ sampleRate: request.sampleRate }),
      resumeKey: this.deps.randomKey(),
      status: 'starting',
      lastActivityAt: now,
      lastAudioAt: now,
      pausedSince: null,
      detachedAt: null,
      sink: null,
      chunks: 0,
      droppedChunks: 0,
      bytesIn: 0,
    };
    this.sessions.set(session.id, session);
    this.deps.log('analysis_session_started', {
      sessionId: session.id,
      provider: session.provider,
      sampleRate: session.sampleRate,
      active: this.sessions.size,
    });
    return { ok: true, session };
  }

  /** The owner picks a session back up. Anything wrong at all is `session_expired`, never a more specific answer. */
  resume(userId: string, sessionId: string, resumeKey: string): CreateResult {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId || !safeEqual(session.resumeKey, resumeKey)) {
      return { ok: false, code: 'session_expired' };
    }
    // A half-open socket (phone changed network) may still think it is attached.
    session.sink?.supersede();
    session.sink = null;
    session.detachedAt = null;
    // The microphone has to come back after a reconnect; give it the full grace period.
    session.lastActivityAt = session.lastAudioAt = this.deps.now();
    this.deps.log('analysis_session_reconnected', { sessionId: session.id, provider: session.provider });
    return { ok: true, session };
  }

  attach(session: LiveSession, sink: SessionSink): void {
    session.sink = sink;
    session.detachedAt = null;
    if (session.status === 'starting') session.status = 'running';
  }

  /** The connection went away. The session stays resumable for `resumeWindowMs`. */
  detach(session: LiveSession, sink: SessionSink): void {
    if (session.sink !== sink) return; // already superseded by a resume
    session.sink = null;
    session.detachedAt = this.deps.now();
  }

  /** Any message from the client: a heartbeat, a sync, a ping. */
  touch(session: LiveSession): void {
    session.lastActivityAt = this.deps.now();
  }

  /** An accepted audio frame: proof the client is really listening. */
  touchAudio(session: LiveSession): void {
    session.lastActivityAt = session.lastAudioAt = this.deps.now();
  }

  /** Record whether playback is running, for the paused timeout. */
  setPaused(session: LiveSession, paused: boolean): void {
    if (session.status === 'stopped' || session.status === 'error') return;
    if (paused) {
      session.status = 'paused';
      session.pausedSince ??= this.deps.now();
    } else {
      // Coming back from a pause: the audio has not been flowing, so restart its clock.
      if (session.status === 'paused') session.lastAudioAt = this.deps.now();
      session.status = 'running';
      session.pausedSince = null;
    }
  }

  /** Ends a session and frees its analyzer. Idempotent. */
  stop(session: LiveSession, reason: StopReason): void {
    if (!this.sessions.delete(session.id)) return;
    session.status = reason === 'error' ? 'error' : 'stopped';
    session.sink = null;
    this.deps.log('analysis_session_stopped', {
      sessionId: session.id,
      provider: session.provider,
      reason,
      durationMs: this.deps.now() - session.startedAt,
      chunks: session.chunks,
      droppedChunks: session.droppedChunks,
      bytesIn: session.bytesIn,
      active: this.sessions.size,
    });
  }

  /** Enforce every timeout. Run on an interval; returns how many sessions it ended. */
  sweep(): number {
    const now = this.deps.now();
    let ended = 0;
    for (const session of [...this.sessions.values()]) {
      let reason: StopReason | null = null;
      const quietSince = session.status === 'paused' ? session.lastActivityAt : session.lastAudioAt;
      if (now - session.startedAt >= this.limits.maxSessionMs) reason = 'max_duration';
      else if (session.detachedAt !== null && now - session.detachedAt >= this.limits.resumeWindowMs) reason = 'idle_timeout';
      else if (session.detachedAt === null && now - quietSince >= this.limits.idleTimeoutMs) reason = 'idle_timeout';
      else if (session.pausedSince !== null && now - session.pausedSince >= this.limits.pausedTimeoutMs) reason = 'paused_timeout';
      if (!reason) continue;
      const sink = session.sink;
      this.stop(session, reason);
      sink?.end(reason);
      ended++;
    }
    for (const [userId, times] of this.createdAt) {
      const fresh = times.filter((t) => now - t < this.limits.createWindowMs);
      if (fresh.length === 0) this.createdAt.delete(userId);
      else if (fresh.length !== times.length) this.createdAt.set(userId, fresh);
    }
    return ended;
  }

  /** Graceful shutdown: tell every client, free everything. */
  stopAll(reason: StopReason): void {
    for (const session of [...this.sessions.values()]) {
      const sink = session.sink;
      this.stop(session, reason);
      sink?.end(reason);
    }
  }

  private userSessions(userId: string): LiveSession[] {
    return [...this.sessions.values()].filter((s) => s.userId === userId);
  }
}
