import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ArtistCatalogTrack = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  cover_url: string | null;
  duration_ms: number | null;
  detected_key: string | null;
  detected_mode: string | null;
  progression_roman: string[] | null;
  tempo: number | null;
  genres: string[] | null;
  spotify_id: string | null;
  youtube_id: string | null;
};

// Credit strings in the catalog are free text - "The Weeknd ft. Daft Punk",
// "Mark Ronson ft. Bruno Mars" - and the structured `artists` array is empty
// for every row, so featured artists only exist inside that string. Splitting
// on these is what lets /artist/Bruno%20Mars find "Uptown Funk".
//
// "and" is deliberately not a separator: it would cut real names apart
// ("Earth, Wind and Fire"). A band whose name contains a separator still
// matches, because the whole string is compared as well as its parts.
const CREDIT_SEPARATOR = /\s+(?:ft\.?|feat\.?|featuring|with|vs\.?|x)\s+|\s*&\s*|\s*,\s*/i;

const normalize = (value: string) => value.trim().toLocaleLowerCase();

/** Whether a track's credit string actually credits this artist - not merely
 *  contains the name as a substring ("Adele" must not match "Adeleine"). */
export function creditsArtist(credit: string | null | undefined, artistName: string): boolean {
  if (!credit || !artistName.trim()) return false;
  const target = normalize(artistName);
  if (normalize(credit) === target) return true;
  return credit.split(CREDIT_SEPARATOR).some((part) => normalize(part) === target);
}

/** LIKE treats % and _ as wildcards; a name containing them must match literally. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Every catalog track that credits an artist, primary or featured.
 *
 * Narrows server-side with a substring match, then applies creditsArtist, so
 * the page never shows a track that merely has the name inside a longer one.
 */
export function useArtistCatalog(artistName: string | undefined) {
  const name = artistName?.trim() ?? '';
  return useQuery({
    queryKey: ['artist-catalog', name.toLocaleLowerCase()],
    enabled: name.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ArtistCatalogTrack[]> => {
      const { data, error } = await supabase
        .from('tracks')
        .select(
          'id, title, artist, album, cover_url, duration_ms, detected_key, detected_mode, progression_roman, tempo, genres, spotify_id, youtube_id'
        )
        .ilike('artist', `%${escapeLike(name)}%`);
      if (error) throw error;
      return ((data ?? []) as ArtistCatalogTrack[])
        .filter((track) => creditsArtist(track.artist, name))
        .sort((a, b) => a.title.localeCompare(b.title));
    },
  });
}
