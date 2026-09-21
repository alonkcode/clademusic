/**
 * Feed-related hooks for user interactions and stats
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
