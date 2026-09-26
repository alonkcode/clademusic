/**
 * The Bun WebSocket adapter: accepts sockets, checks the Origin, and hands each
 * one to a LiveConnection. It decides nothing about analysis or sessions.
 *
 * Exposed as a factory that takes its token verifier, so the production entry
 * (main.ts) wires Supabase and a test wires a stub - there is no environment
 * switch that turns authentication off.
 */

import { MAX_AUDIO_FRAME_BYTES, MAX_CONTROL_BYTES } from './protocol.ts';
import { LiveConnection } from './connection.ts';
import type { ConnectionConfig, SocketLike, TokenVerifier } from './connection.ts';
import { SessionManager } from './sessionManager.ts';
import type { Logger, SessionLimits } from './sessionManager.ts';

export interface ServerOptions {
  port: number;
  verifyToken: TokenVerifier;
  /** Exact origins allowed to open a socket. Empty means none: a browser page must be on the list. */
  allowedOrigins: string[];
  limits?: Partial<SessionLimits>;
  connection?: Partial<ConnectionConfig>;
  log?: Logger;
  sweepIntervalMs?: number;
}

interface SocketData {
  conn: LiveConnection | null;
}

export interface LiveAnalysisServer {
  readonly port: number;
  readonly manager: SessionManager;
  /** Sockets currently open, authenticated or not. */
  openSockets(): number;
  stop(): void;
}

export function createLiveAnalysisServer(options: ServerOptions): LiveAnalysisServer {
  const log: Logger = options.log ?? (() => {});
  const manager = new SessionManager(options.limits, { log });
  const allowed = new Set(options.allowedOrigins);
  // Unauthenticated sockets cost memory too; bound them relative to real capacity.
  const maxSockets = manager.config.maxSessions * 4;
  let open = 0;

  const server = Bun.serve<SocketData>({
    port: options.port,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === '/healthz') return new Response('ok');
      if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });

      // A browser always sends Origin on a WebSocket handshake. Refusing
      // unknown ones stops another site's page from using a visitor's session.
      const origin = req.headers.get('origin');
      if (!origin || !allowed.has(origin)) return new Response('Forbidden', { status: 403 });
      if (open >= maxSockets) return new Response('Busy', { status: 503, headers: { 'Retry-After': '30' } });

      if (srv.upgrade(req, { data: { conn: null } })) return undefined;
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    },
    websocket: {
      // The biggest legitimate message is one second of audio; anything larger is refused by the runtime.
      maxPayloadLength: Math.max(MAX_AUDIO_FRAME_BYTES, MAX_CONTROL_BYTES) + 1024,
      idleTimeout: 60,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      open(ws) {
        open++;
        const socket: SocketLike = {
          send: (data) => void ws.send(data),
          close: (code, reason) => ws.close(code, reason),
          bufferedAmount: () => ws.getBufferedAmount(),
        };
        const conn = new LiveConnection(socket, {
          manager,
          verifyToken: options.verifyToken,
          log,
          now: () => Date.now(),
          config: options.connection,
        });
        ws.data.conn = conn;
        conn.open();
      },
      message(ws, message) {
        const conn = ws.data.conn;
        if (!conn) return;
        if (typeof message === 'string') {
          conn.handleText(message).catch((error: unknown) => {
            log('analysis_session_error', { code: 'internal', detail: error instanceof Error ? (error.stack ?? error.message) : String(error) });
            ws.close(1011, 'internal');
          });
        } else {
          conn.handleBinary(message);
        }
      },
      close(ws) {
        open--;
        ws.data.conn?.handleClose();
      },
    },
  });

  const sweep = setInterval(() => manager.sweep(), options.sweepIntervalMs ?? 5_000);

  return {
    port: server.port ?? options.port,
    manager,
    openSockets: () => open,
    stop() {
      clearInterval(sweep);
      manager.stopAll('shutdown');
      server.stop(true);
    },
  };
}
