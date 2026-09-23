/**
 * Finds the catalog row (a real `tracks` UUID) for whatever the player is
 * holding.
 *
 * The player identifies a track from search by a provider id - `spotify:<id>`
 * or `youtube:<id>` - and only catalog tracks arrive with a UUID. Everything
 * that reads analysis (sections, key, tempo) is keyed by that UUID, so without
 * this lookup a track someone has already analysed would still look unknown to
 * everyone who reaches it from a search result. This is what makes an analysis
 * done once available to every later listener.
 *
 * Read-only: the row is created server-side (resolve_or_create_track) when a
 * capture is saved, never from here.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isTestEnv } from '@/lib/env';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `spotify:<id>` / `youtube:<id>`. The id charset is checked because it is
 * interpolated into a PostgREST filter string below, where a comma or
 * parenthesis would change the query.
 */
const SYNTHETIC_RE = /^(spotify|youtube):([A-Za-z0-9_-]{5,64})$/;

export interface ParsedProviderTrackId {
  provider: 'spotify' | 'youtube';
  providerId: string;
}

export function parseSyntheticTrackId(id: string | null | undefined): ParsedProviderTrackId | null {
  const match = id ? SYNTHETIC_RE.exec(id) : null;
  return match ? { provider: match[1] as 'spotify' | 'youtube', providerId: match[2] } : null;
}

/**
 * The row for this provider id, matching either its own provider/external_id
 * or the other provider's id column - so a YouTube video for a song the
 * catalog holds from Spotify resolves to that row instead of looking new.
 */
export async function findTrackIdByProviderId(
  provider: 'spotify' | 'youtube',
  providerId: string
): Promise<string | null> {
  const linkColumn = provider === 'spotify' ? 'spotify_id' : 'youtube_id';
  const { data, error } = await supabase
    .from('tracks')
    .select('id, provider, external_id')
    .or(`and(provider.eq.${provider},external_id.eq.${providerId}),${linkColumn}.eq.${providerId}`)
    .limit(5);

  if (error) {
    console.debug('track lookup failed:', error.message);
    return null;
  }
  const rows = (data ?? []) as Array<{ id: string; provider: string; external_id: string }>;
  if (rows.length === 0) return null;
  const exact = rows.find((r) => r.provider === provider && r.external_id === providerId);
  return (exact ?? rows[0]).id;
}

export const resolvedTrackIdKey = (canonicalTrackId: string | null | undefined) =>
  ['resolved-track-id', canonicalTrackId ?? null] as const;

export interface ResolvedTrackId {
  /** The catalog UUID, when there is one. */
  trackId: string | undefined;
  /** True only while a provider id is being looked up for the first time. */
  isResolving: boolean;
}

export function useResolvedTrackId(canonicalTrackId: string | null | undefined): ResolvedTrackId {
  const isUuid = !!canonicalTrackId && UUID_RE.test(canonicalTrackId);
  const parsed = isUuid ? null : parseSyntheticTrackId(canonicalTrackId);

  const query = useQuery({
    queryKey: resolvedTrackIdKey(canonicalTrackId),
    queryFn: () => findTrackIdByProviderId(parsed!.provider, parsed!.providerId),
    enabled: !isTestEnv && !!parsed,
    // A miss is cached briefly, not for an hour: someone else may analyse the
    // track in the meantime, and this listener should pick that up.
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60,
  });

  if (isUuid) return { trackId: canonicalTrackId!, isResolving: false };
  return { trackId: query.data ?? undefined, isResolving: !!parsed && query.isLoading };
}
