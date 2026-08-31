/**
 * Spotify Authentication Service
 *
 * Centralized token management for Spotify API calls.
 * Handles credential retrieval, token refresh, and validation.
 *
 * Every Spotify call needs a token, so the credentials are cached rather than
 * re-read from the database each time: in memory for the life of the tab, and
 * the access token (never the refresh token) in localStorage so a reload keeps
 * the connection alive without a round trip. Fetches and refreshes are
 * single-flighted, so a burst of parallel calls costs one request, not ten.
 */

import { supabase } from '@/integrations/supabase/client';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

/** Refresh this long before the token actually expires. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface UserProviderRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  connected_at: string;
}

const credentialCache = new Map<string, UserProviderRow>();
const pendingFetch = new Map<string, Promise<UserProviderRow | null>>();
const pendingRefresh = new Map<string, Promise<string | null>>();

/**
 * Only the short-lived access token is mirrored to storage. The refresh token
 * stays in the database, where a stolen storage dump cannot reach it.
 */
const storageKey = (userId: string) => `clade-spotify-token:${userId}`;

function readStoredToken(userId: string): { access_token: string; expires_at: string } | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token || !parsed?.expires_at) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredToken(userId: string, access_token: string, expires_at: string): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify({ access_token, expires_at }));
  } catch {
    // Storage can be full or blocked; the in-memory cache still applies.
  }
}

function isUsable(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() - Date.now() > EXPIRY_BUFFER_MS;
}

/**
 * Forget everything cached for a user. Call on disconnect and on sign-out, so
 * the next session cannot pick up the previous user's token.
 */
export function clearSpotifyCredentialCache(userId?: string): void {
  if (!userId) {
    credentialCache.clear();
    pendingFetch.clear();
    pendingRefresh.clear();
    return;
  }
  credentialCache.delete(userId);
  pendingFetch.delete(userId);
  pendingRefresh.delete(userId);
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // nothing to clean up
  }
}

/**
 * Get user's Spotify credentials from database
 *
 * Cached; pass `{ fresh: true }` when the cached row is known to be stale.
 */
export async function getSpotifyCredentials(
  userId: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<UserProviderRow | null> {
  if (!fresh) {
    const cached = credentialCache.get(userId);
    if (cached) return cached;
  }

  const inFlight = pendingFetch.get(userId);
  if (inFlight && !fresh) return inFlight;

  const request = (async () => {
    const { data, error } = await supabase
      .from('user_providers')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'spotify')
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const row = data as UserProviderRow;
    credentialCache.set(userId, row);
    writeStoredToken(userId, row.access_token, row.expires_at);
    return row;
  })().finally(() => {
    pendingFetch.delete(userId);
  });

  pendingFetch.set(userId, request);
  return request;
}

/**
 * Refresh Spotify access token
 */
export async function refreshSpotifyToken(
  userId: string,
  refreshToken: string
): Promise<string | null> {
  const existing = pendingRefresh.get(userId);
  if (existing) return existing;

  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

  if (!clientId) {
    console.error('Spotify client ID not configured');
    return null;
  }
  if (!refreshToken) {
    console.warn('Spotify refresh token missing; reconnect required');
    return null;
  }

  const request = (async () => {
    try {
      const response = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to refresh Spotify token:', errorData);
        return null;
      }

      const data = await response.json();
      const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

      // Update token in database
      await supabase
        .from('user_providers')
        .update({
          access_token: data.access_token,
          expires_at: newExpiresAt,
          // Spotify may return a new refresh token
          ...(data.refresh_token && { refresh_token: data.refresh_token }),
        })
        .eq('user_id', userId)
        .eq('provider', 'spotify');

      const cached = credentialCache.get(userId);
      if (cached) {
        credentialCache.set(userId, {
          ...cached,
          access_token: data.access_token,
          expires_at: newExpiresAt,
          refresh_token: data.refresh_token ?? cached.refresh_token,
        });
      }
      writeStoredToken(userId, data.access_token, newExpiresAt);

      return data.access_token as string;
    } catch (error) {
      console.error('Error refreshing Spotify token:', error);
      return null;
    }
  })().finally(() => {
    pendingRefresh.delete(userId);
  });

  pendingRefresh.set(userId, request);
  return request;
}

/**
 * Get valid access token, refreshing if needed
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const cached = credentialCache.get(userId);
  if (cached && isUsable(cached.expires_at)) {
    return cached.access_token;
  }

  // Nothing in memory yet: a token left over from the last page load is still
  // good until it expires, which keeps a reload from waiting on the database.
  if (!cached) {
    const stored = readStoredToken(userId);
    if (stored && isUsable(stored.expires_at)) {
      return stored.access_token;
    }
  }

  const credentials = await getSpotifyCredentials(userId, { fresh: !!cached });

  if (!credentials) {
    return null;
  }

  if (!isUsable(credentials.expires_at)) {
    return await refreshSpotifyToken(userId, credentials.refresh_token);
  }

  return credentials.access_token;
}
