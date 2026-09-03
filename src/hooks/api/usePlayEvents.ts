/**
 * "Recently Played" / "Top Artists" (ProfilePage) read from `play_history`
 * - the same table useFollowing.ts's following-feed reads from, and the one
 *   PlayerContext.tsx's play()/openPlayer() write to via recordPlayHistory().
 *
 * This file used to query `user_interactions` for rows shaped like
 * `play_${action}`, filed under "a stand-in until play_events exists" - but
 * nothing ever wrote those rows (the one hook that did,
 * useRecordPlayEvent, had zero callers, and its own interaction_type would
 * have been rejected by user_interactions' check constraint on the very
 * first real call). These hooks always returned empty/zero, silently.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface PlayHistoryTrack {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  cover_url: string | null;
  spotify_id: string | null;
  youtube_id: string | null;
}

export interface PlayHistoryEntry {
  id: string;
  /** Convenience flat field - same as track.id. */
  track_id: string;
  played_at: string;
  source: string | null;
  track: PlayHistoryTrack;
}

interface PlayHistoryParams {
  limit?: number;
}

/**
 * The signed-in user's own recently-played tracks, most recent first.
 */
export function usePlayHistory(params: PlayHistoryParams = {}) {
  const { user } = useAuth();
  const { limit = 20 } = params;

  return useQuery({
    queryKey: ['play-history', user?.id, limit],
    queryFn: async (): Promise<PlayHistoryEntry[]> => {
      if (!user) return [];

      const { data: history, error } = await supabase
        .from('play_history')
        .select('id, track_id, played_at, source')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.warn('Failed to fetch play history:', error);
        return [];
      }
      if (!history || history.length === 0) return [];

      const trackIds = [...new Set(history.map((h) => h.track_id))];
      const { data: tracks, error: tracksError } = await supabase
        .from('tracks')
        .select('id, title, artist, album, cover_url, spotify_id, youtube_id')
        .in('id', trackIds);

      if (tracksError) {
        console.warn('Failed to fetch tracks for play history:', tracksError);
        return [];
      }

      const trackById = new Map((tracks || []).map((t) => [t.id, t as PlayHistoryTrack]));

      return history
        .map((h) => {
          const track = trackById.get(h.track_id);
          if (!track) return null; // track since deleted, or RLS-hidden
          return { id: h.id, track_id: track.id, played_at: h.played_at, source: h.source, track };
        })
        .filter((h): h is PlayHistoryEntry => h !== null);
    },
    enabled: !!user,
  });
}

export interface TopArtist {
  name: string;
  playCount: number;
  /** One representative cover from that artist's most-played track, for a thumbnail. */
  coverUrl: string | null;
}

/**
 * The signed-in user's most-played artists within Clade, ranked by play
 * count over their `historyWindow` most recent plays (not all-time - most
 * profiles don't have enough history yet for all-time to mean much more
 * than "recent", and scanning the full table for every profile view isn't
 * worth it either).
 */
export function useTopArtists(limit = 10, historyWindow = 200) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['top-artists', user?.id, limit, historyWindow],
    queryFn: async (): Promise<TopArtist[]> => {
      if (!user) return [];

      const { data: history, error } = await supabase
        .from('play_history')
        .select('track_id')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })
        .limit(historyWindow);

      if (error) {
        console.warn('Failed to fetch play history for top artists:', error);
        return [];
      }
      if (!history || history.length === 0) return [];

      const trackIds = [...new Set(history.map((h) => h.track_id))];
      const { data: tracks, error: tracksError } = await supabase
        .from('tracks')
        .select('id, artist, cover_url')
        .in('id', trackIds);

      if (tracksError) {
        console.warn('Failed to fetch tracks for top artists:', tracksError);
        return [];
      }

      const artistByTrack = new Map((tracks || []).map((t) => [t.id, t]));
      const counts = new Map<string, { playCount: number; coverUrl: string | null }>();

      for (const h of history) {
        const track = artistByTrack.get(h.track_id);
        const artist = track?.artist?.trim();
        if (!artist) continue;
        const entry = counts.get(artist) ?? { playCount: 0, coverUrl: track.cover_url ?? null };
        entry.playCount += 1;
        counts.set(artist, entry);
      }

      return [...counts.entries()]
        .map(([name, { playCount, coverUrl }]) => ({ name, playCount, coverUrl }))
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, limit);
    },
    enabled: !!user,
  });
}

/**
 * Total plays recorded for the signed-in user.
 */
export function usePlayStats() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['play-stats', user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { count } = await supabase
        .from('play_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      return { totalPlays: count || 0 };
    },
    enabled: !!user,
  });
}
