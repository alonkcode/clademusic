/**
 * Production entry: reads the environment, wires Supabase auth, serves.
 *
 *   SUPABASE_URL          required  https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY     required  the publishable key (public by design)
 *   ALLOWED_ORIGINS       required  comma-separated exact origins, e.g. https://www.clademusic.com
 *   PORT                  optional  default 8787
 *   MAX_SESSIONS          optional  default 50 (measured ~0.5% of a core each)
 *   MAX_SESSIONS_PER_USER optional  default 2
 *
 * TLS is terminated in front of this (the platform's edge or nginx); the
 * browser connects with wss://. Nothing here needs a service-role key.
 */

import { createLiveAnalysisServer } from './server.ts';
import { supabaseTokenVerifier } from './supabaseAuth.ts';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'startup_error', detail: `${name} is required` }));
    process.exit(1);
  }
  return value;
}

function intFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'startup_error', detail: `${name} must be a positive integer` }));
    process.exit(1);
  }
  return n;
}

const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));

const allowedOrigins = required('ALLOWED_ORIGINS')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (allowedOrigins.includes('*')) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'startup_error', detail: 'ALLOWED_ORIGINS must list exact origins, not *' }));
  process.exit(1);
}

const service = createLiveAnalysisServer({
  port: intFromEnv('PORT') ?? 8787,
  verifyToken: supabaseTokenVerifier({ supabaseUrl: required('SUPABASE_URL'), anonKey: required('SUPABASE_ANON_KEY') }),
  allowedOrigins,
  limits: {
    ...(intFromEnv('MAX_SESSIONS') ? { maxSessions: intFromEnv('MAX_SESSIONS') } : {}),
    ...(intFromEnv('MAX_SESSIONS_PER_USER') ? { maxSessionsPerUser: intFromEnv('MAX_SESSIONS_PER_USER') } : {}),
  },
  log,
});
log('server_started', { port: service.port, maxSessions: service.manager.config.maxSessions, origins: allowedOrigins.length });

// One connection's bug is contained by LiveConnection; anything that still
// reaches here is unexpected. A stray rejected promise is logged and survived;
// an uncaught exception may have left shared state half-written, so exit and
// let the platform restart a clean process (clients resume or start over).
process.on('unhandledRejection', (reason) => log('unhandled_rejection', { detail: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason) }));
process.on('uncaughtException', (error) => {
  log('uncaught_exception', { detail: error.stack ?? error.message });
  process.exit(1);
});

const shutdown = (signal: string) => {
  log('shutdown', { signal });
  service.stop();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
