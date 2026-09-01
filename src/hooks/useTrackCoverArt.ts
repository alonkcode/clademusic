import { useQuery } from '@tanstack/react-query';
import { searchSpotifyPublic } from '@/services/spotifySearchService';

/**
 * The seed catalog ships generic Unsplash stock photos as placeholder art -
 * they render fine, but they are not the song's actual cover, so a track
 * carrying one should still be treated as "no real cover" and get a proper
 * one fetched. Anything else (Spotify's own i.scdn.co, a YouTube thumbnail,
 * a real database-stored cover) is left alone.
 */
function isPlaceholderCover(url: string | undefined | null): boolean {
  if (!url) return true;
  return url.includes('images.unsplash.com');
}

export interface CoverArtQuery {
  cover_url?: string | null;
  artwork_url?: string | null;
  title?: string | null;
  artist?: string | null;
}

/**
 * Resolves the best cover art available for a track: its own cover_url when
 * that's a real image, otherwise a dynamic Spotify catalog lookup by title +
 * artist (the public, no-connection-required search, so this works for every
 * visitor, not just ones who connected Spotify). Returns undefined while
 * loading or when nothing turns up - callers keep their own existing
 * no-cover fallback for that case, this only ever offers a better URL.
 */
export function useTrackCoverArt(track: CoverArtQuery): string | undefined {
  const existing = track.cover_url || track.artwork_url || undefined;
  const hasRealCover = !isPlaceholderCover(existing);
  const title = track.title?.trim();
  const artist = track.artist?.trim();
  const canSearch = !hasRealCover && !!title;

  const { data } = useQuery({
    queryKey: ['spotify-cover-art', title, artist],
    queryFn: async () => {
      const query = artist ? `${title} ${artist}` : title!;
      const { tracks } = await searchSpotifyPublic(query, 1);
      return tracks[0]?.cover_url ?? null;
    },
    enabled: canSearch,
    staleTime: 7 * 24 * 60 * 60 * 1000, // a week - album art doesn't change
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: false,
  });

  if (hasRealCover) return existing;
  return data ?? undefined;
}
