/**
 * Checks a Supabase access token by asking Supabase, rather than verifying the
 * JWT here: the project's signing keys never leave Supabase, this service
 * holds only the public URL and publishable key, and a revoked session stops
 * working immediately instead of when the token expires.
 *
 * Resolves to the user's id, null when Supabase says the token is not valid,
 * and throws when it cannot tell (network error, 5xx) - the caller must not
 * treat an outage as "unauthorized", or a Supabase blip would look like every
 * user being signed out.
 */

import type { TokenVerifier } from './connection.ts';

export interface SupabaseAuthOptions {
  supabaseUrl: string;
  /** The publishable (anon) key. Public by design; the user's own token is what authorises. */
  anonKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function supabaseTokenVerifier(options: SupabaseAuthOptions): TokenVerifier {
  const base = options.supabaseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 4_000;

  return async (token) => {
    // A controller and a timer rather than AbortSignal.timeout: same effect, but
    // it also covers reading the body, and it exists in every runtime this runs in.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${base}/auth/v1/user`, {
        headers: { apikey: options.anonKey, Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new Error(`Supabase auth responded ${response.status}`);
      const body = (await response.json()) as { id?: unknown };
      return typeof body.id === 'string' && body.id.length > 0 ? body.id : null;
    } finally {
      clearTimeout(timer);
    }
  };
}
