// Supabase Edge Function: public Spotify catalog search.
//
// WHY THIS EXISTS
// src/services/spotifySearchService.ts (searchSpotify) requires the caller's
// own Spotify OAuth access token, so it only works for a user who has
// personally connected their Spotify account. SearchPage.tsx gated the entire
// Spotify search branch behind that: guests, and any signed-in user who
// hasn't gone through Spotify's OAuth connect flow, got zero Spotify results
// and silently fell back to YouTube-only. Catalog search does not need a
// user's identity - it needs Spotify's Client Credentials flow (app-level
// auth), which this function performs server-side so the app's client secret
// never reaches the browser.
//
// Deploy:
//   supabase secrets set SPOTIFY_CLIENT_ID=<id> SPOTIFY_CLIENT_SECRET=<secret> --project-ref <ref>
//   supabase functions deploy search-spotify --project-ref <ref>
//
// SPOTIFY_CLIENT_ID may reuse the existing public VITE_SPOTIFY_CLIENT_ID value.
// SPOTIFY_CLIENT_SECRET is a real secret and must be set via the CLI, never
// committed or pasted into chat.

import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET');

// Client Credentials tokens are app-level (not per-user) and last ~1 hour, so
// caching across invocations on a warm function avoids re-authenticating on
// every search. Lost on cold start, which just means one extra token request.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAppAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
    return cachedToken.value;
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET are not configured on this function');
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`Spotify token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { query?: string; limit?: number; offset?: number; market?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const query = (body.query ?? '').trim();
  if (!query) return json({ error: 'query is required' }, 400);
  if (query.length > 200) return json({ error: 'query is too long' }, 400);

  const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);
  const offset = Math.max(body.offset ?? 0, 0);
  const market = body.market ?? 'US';

  try {
    const token = await getAppAccessToken();

    const params = new URLSearchParams({
      q: query,
      type: 'track',
      limit: String(limit),
      offset: String(offset),
      market,
    });

    const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      // A stale cached token would show up as 401 here; drop it so the next
      // request re-authenticates instead of repeating the same failure.
      if (res.status === 401) cachedToken = null;
      const detail = await res.text();
      console.error('Spotify search failed', res.status, detail);
      return json({ error: 'Spotify search failed', status: res.status }, 502);
    }

    const data = await res.json();
    return json({
      tracks: data.tracks?.items ?? [],
      total: data.tracks?.total ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('search-spotify error', message);
    return json({ error: message }, 500);
  }
});
