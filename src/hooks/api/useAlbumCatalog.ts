import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { shouldRetryQuery } from './usePlaylists';
import type { ArtistCatalogTrack } from './useArtistCatalog';

export type AlbumCatalogTrack = ArtistCatalogTrack;

/** LIKE treats % and _ as wildcards; an album containing them must match literally. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Every catalog track on an album.
 *
 * Albums have no table and no id of their own - a track just carries its album
 * name as text, and TrackMenu already routes to /album/<name> on exactly that.
 * So the album *is* the name, and the page is the set of tracks sharing it.
 *
 * The server filter is case-insensitive on the whole string (not a substring),
 * so "÷ (Divide)" does not also drag in a different album that happens to
 * contain it.
 */
export function useAlbumCatalog(albumName: string | undefined) {
  const name = albumName?.trim() ?? '';
  return useQuery({
    queryKey: ['album-catalog', name.toLocaleLowerCase()],
    enabled: name.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: shouldRetryQuery,
    queryFn: async (): Promise<AlbumCatalogTrack[]> => {
      const { data, error } = await supabase
        .from('tracks')
        .select(
          'id, title, artist, album, cover_url, duration_ms, detected_key, detected_mode, progression_roman, tempo, genres, spotify_id, youtube_id'
        )
        .ilike('album', escapeLike(name));
      if (error) throw error;
      return (data ?? []) as AlbumCatalogTrack[];
    },
  });
}
