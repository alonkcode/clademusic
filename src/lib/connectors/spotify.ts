/**
 * Spotify API Connector
 * Implements unified search and link resolution for Spotify
 * 
 * SECURITY: Uses Supabase Edge Function for search (server-side auth)
 * Client secret is NEVER exposed to the browser
 */

import {
  ProviderConnector,
  NormalizedTrack,
  SearchOptions,
  searchWithTimeout,
} from './base';
import { ProviderLink } from '@/types';
import { supabase } from '@/integrations/supabase/client';

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    images: Array<{ url: string; height: number }>;
  };
  duration_ms: number;
  external_ids?: {
    isrc?: string;
  };
  external_urls: {
    spotify: string;
  };
  preview_url?: string;
  uri: string;
}

/**
 * A raw Spotify Web API track, as search-spotify returns it, in the
 * provider-agnostic shape the connectors share.
 *
 * Replaces a normaliser written for a response shape - `title`, `artist`,
 * `providers.spotify.provider_track_id` - that the function has never
 * produced, which is why every field it read came back undefined.
 */
export function normalizeSpotifyTrack(track: SpotifyTrack): NormalizedTrack {
  // Spotify orders images largest first; take the first rather than guessing
  // at a size, since any of them is better than none.
  const artwork = track.album?.images?.[0]?.url;
  return {
    title: track.name,
    artists: (track.artists ?? []).map((a) => a.name).filter(Boolean),
    album: track.album?.name ?? '',
    duration_ms: track.duration_ms ?? 0,
    artwork_url: artwork,
    isrc: track.external_ids?.isrc,
    provider_track_id: track.id,
    provider: 'spotify',
    url_web: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
    url_app: track.uri ?? `spotify:track:${track.id}`,
    url_preview: track.preview_url ?? undefined,
  };
}

export class SpotifyConnector implements ProviderConnector {
  readonly name = 'spotify' as const;
  readonly enabled: boolean;
  
  constructor(
    private clientId?: string
    // NOTE: No client secret - auth happens server-side via Edge Function
  ) {
    // Spotify is always enabled - uses Edge Function for search
    this.enabled = true;
  }

  async searchTracks(options: SearchOptions): Promise<NormalizedTrack[]> {
    const { query, market = 'US', limit = 10, timeout = 5000 } = options;

    const searchPromise = this.performSearch(query, market, limit);
    const results = await searchWithTimeout(searchPromise, timeout, 'Spotify');

    return results;
  }

  /**
   * Search using Supabase Edge Function (server-side Spotify auth)
   * Falls back to cached/external tracks if user not authenticated
   */
  private async performSearch(
    query: string,
    market: string,
    limit: number
  ): Promise<NormalizedTrack[]> {
    try {
      // Try Edge Function (for authenticated users with connected Spotify)
      const { data: session } = await supabase.auth.getSession();
      
      if (session?.session) {
        // The function is `search-spotify` and returns Spotify's own track
        // objects as `{ tracks, total }`. This used to call `search_spotify`
        // (which does not exist) and read `data.results` (which the function
        // never sends), so it failed twice over and always fell through to
        // the cache below. spotifySearchService already calls it correctly.
        const { data, error } = await supabase.functions.invoke('search-spotify', {
          body: { query, limit, market },
        });

        if (!error && Array.isArray(data?.tracks)) {
          return (data.tracks as SpotifyTrack[]).map((t) => normalizeSpotifyTrack(t));
        }
      }
      
      // Fallback: Search cached external_tracks table
      // Sanitize search input to prevent filter injection
      const sanitizedQuery = query.replace(/[%_,().*\\]/g, '');
      const { data: cached } = await supabase
        .from('external_tracks')
        .select('*')
        .eq('provider', 'spotify')
        .or(`title.ilike.%${sanitizedQuery}%,artist.ilike.%${sanitizedQuery}%`)
        .limit(limit);
      
      if (cached && cached.length > 0) {
        return cached.map(track => this.normalizeCachedTrack(track));
      }
      
      return [];
    } catch (error) {
      console.error('Spotify search failed:', error);
      return [];
    }
  }

  private normalizeCachedTrack(track: any): NormalizedTrack {
    return {
      title: track.title,
      artists: track.artist?.split(', ') || [],
      album: track.album || '',
      duration_ms: track.duration_ms || 0,
      artwork_url: track.artwork_url,
      isrc: track.isrc,
      provider_track_id: track.provider_track_id,
      provider: 'spotify',
      url_web: `https://open.spotify.com/track/${track.provider_track_id}`,
      url_app: `spotify:track:${track.provider_track_id}`,
    };
  }

  async resolveLinks(providerTrackId: string): Promise<ProviderLink> {
    // Look up from track_provider_links table
    const { data } = await supabase
      .from('track_provider_links')
      .select('*')
      .eq('provider', 'spotify')
      .eq('provider_track_id', providerTrackId)
      .single();
    
    if (data) {
      return {
        provider: 'spotify',
        provider_track_id: data.provider_track_id,
        url_web: data.url_web,
        url_app: data.url_app,
      };
    }

    // Fallback to generated URLs
    return {
      provider: 'spotify',
      provider_track_id: providerTrackId,
      url_web: `https://open.spotify.com/track/${providerTrackId}`,
      url_app: `spotify:track:${providerTrackId}`,
    };
  }

  async checkHealth(): Promise<boolean> {
    // Check if we can connect to Supabase
    try {
      const { error } = await supabase.from('external_tracks').select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  }
}
