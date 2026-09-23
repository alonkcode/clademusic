/**
 * Feed-related hooks for user interactions and stats
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { computeTasteDNA } from '@/api/tasteDNA';
import { useAuth } from '@/hooks/useAuth';
import { QUERY_KEYS } from '@/lib/constants';
import { getPersonalizedFeed } from '@/services/feedService';
import { getFeedTracks, type TrackResult } from '@/services/trackService';

/**
 * The feed's tracks, ranked for the signed-in user (their taste, what people
 * they follow are playing, what they keep skipping). Guests, and users with
 * nothing to personalize from yet, get the plain daily catalog pick.
 *
 * Deliberately not polling: re-ranking while someone is swiping would move
 * cards out from under them.
 */
export function usePersonalizedFeed(limit = 50) {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: [QUERY_KEYS.FEED, 'personalized', user?.id ?? null, limit],
    queryFn: async (): Promise<TrackResult> => {
      if (!user) return getFeedTracks(limit);

      // Shares useTasteDNA's cache entry, so opening the feed after the
      // profile page (or vice versa) doesn't recompute the profile.
      const tasteDNA = await queryClient
        .ensureQueryData({
          queryKey: ['taste-dna', user.id],
          queryFn: () => computeTasteDNA(user.id),
          staleTime: 5 * 60 * 1000,
        })
        .catch(() => null);

      return getPersonalizedFeed({ userId: user.id, limit, tasteDNA });
    },
    enabled: !loading,
    staleTime: 5 * 60 * 1000,
  });
}

interface UserInteractionStats {
  likes: number;
  saves: number;
  shares: number;
}

/**
 * Hook to fetch user interaction statistics
 */
export function useUserInteractionStats(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-interaction-stats', userId],
    queryFn: async (): Promise<UserInteractionStats> => {
      if (!userId) return { likes: 0, saves: 0, shares: 0 };

      // liked/bookmarked/share_count are the live columns the toggle_like,
      // toggle_bookmark and record_share RPCs actually write (one row per
      // user+track). interaction_type is a legacy column from the older
      // one-row-per-interaction-type design and nothing writes it anymore -
      // see bundle-fixes/00-compat-prelude.sql.
      const [likesResult, savesResult, sharesResult] = await Promise.all([
        supabase
          .from('user_interactions')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('liked', true),
        supabase
          .from('user_interactions')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('bookmarked', true),
        supabase
          .from('user_interactions')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gt('share_count', 0),
      ]);

      return {
        likes: likesResult.count || 0,
        saves: savesResult.count || 0,
        shares: sharesResult.count || 0,
      };
    },
    enabled: !!userId,
  });
}
