import { supabase } from '@/integrations/supabase/client';

/** Ids of the users this user follows. */
export async function fetchFollowingIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('following_id')
    .eq('follower_id', userId);
  if (error) throw error;
  return (data ?? []).map((row: { following_id: string }) => row.following_id);
}
