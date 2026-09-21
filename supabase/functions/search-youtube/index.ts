// Supabase Edge Function: server-side YouTube Data API proxy.
//
// WHY THIS EXISTS
// src/services/youtubeSearchService.ts used to call googleapis.com directly
// from the browser with VITE_YOUTUBE_API_KEY, protected only by an
// HTTP-referrer allowlist. Production is served from a GitHub Pages subpath
// (https://kaospan.github.io/clademusic/), and browsers' default
// Referrer-Policy (strict-origin-when-cross-origin) sends only the origin -
// https://kaospan.github.io/ - cross-origin, dropping /clademusic/. A
// path-scoped allowlist entry never matches that stripped referrer, so every
// request got 403'd in production while working in dev. Proxying through
// here removes the referrer dependency entirely (Deno never sends one) and
// keeps the real key off the client, the same way search-spotify keeps the
// Spotify client secret off the client.
//
// Deploy:
//   supabase secrets set YOUTUBE_API_KEY=<key> --project-ref <ref>
//   supabase functions deploy search-youtube --project-ref <ref>
//
// YOUTUBE_API_KEY must be a key separate from VITE_YOUTUBE_API_KEY, created
// with NO HTTP-referrer restriction (this function calls it from Deno, not a
// browser - a referrer restriction would reject every request here too,
// since no referrer is ever sent). Restrict it to the YouTube Data API v3
// only in Google Cloud Console, and never expose it as a VITE_ variable.

import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const API_KEY = Deno.env.get('YOUTUBE_API_KEY');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

type SearchBody = { endpoint: 'search'; query?: string; maxResults?: number; videoCategoryId?: string };
type VideosBody = { endpoint: 'videos'; ids?: string; part?: string };

// Mirrors the client's old behavior of only disabling further calls (for the
// session) on YouTube's own auth/quota errors, not on transient failures -
// forwarding those two status codes as-is lets the client tell them apart
// from a generic upstream problem (returned as 502).
function forwardedStatus(youtubeStatus: number): number {
  return youtubeStatus === 401 || youtubeStatus === 403 ? youtubeStatus : 502;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!API_KEY) {
    return json({ error: 'YOUTUBE_API_KEY is not configured on this function' }, 500);
  }

  let body: SearchBody | VideosBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    if (body.endpoint === 'search') {
      const query = (body.query ?? '').trim();
      if (!query) return json({ error: 'query is required' }, 400);
      if (query.length > 200) return json({ error: 'query is too long' }, 400);
      const maxResults = Math.min(Math.max(body.maxResults ?? 5, 1), 10);

      const params = new URLSearchParams({
        part: 'snippet',
        q: query,
        type: 'video',
        videoCategoryId: body.videoCategoryId ?? '10',
        maxResults: String(maxResults),
        key: API_KEY,
      });

      const res = await fetch(`${YOUTUBE_API_BASE}/search?${params}`);
      const data = await res.json();
      if (!res.ok) {
        console.error('YouTube search failed', res.status, data);
        return json({ error: 'YouTube search failed', status: res.status }, forwardedStatus(res.status));
      }
      return json(data);
    }

    if (body.endpoint === 'videos') {
      const ids = (body.ids ?? '').trim();
      if (!ids) return json({ error: 'ids is required' }, 400);
      if (ids.length > 300) return json({ error: 'ids is too long' }, 400);

      const params = new URLSearchParams({
        part: body.part ?? 'snippet,contentDetails',
        id: ids,
        key: API_KEY,
      });

      const res = await fetch(`${YOUTUBE_API_BASE}/videos?${params}`);
      const data = await res.json();
      if (!res.ok) {
        console.error('YouTube video lookup failed', res.status, data);
        return json({ error: 'YouTube video lookup failed', status: res.status }, forwardedStatus(res.status));
      }
      return json(data);
    }

    return json({ error: 'Unknown endpoint' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('search-youtube error', message);
    return json({ error: message }, 500);
  }
});
