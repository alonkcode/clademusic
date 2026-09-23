import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { applyLikeToggle, normalizeComment, type TrackComment } from '@/lib/trackComments';

// Newest comments, not oldest: a track with more comments than this would
// otherwise never show anything recent.
const MAX_COMMENTS = 200;

// Keyed ['track-comments', trackId, userId] (the user matters because each
// comment carries whether *they* liked it); invalidating the ['track-comments',
// trackId] prefix refreshes every viewer of the thread.
const commentsKey = (trackId: string, userId: string | undefined) =>
  ['track-comments', trackId, userId ?? null] as const;

function invalidateTrackComments(queryClient: QueryClient, trackId: string) {
  queryClient.invalidateQueries({ queryKey: ['track-comments', trackId] });
  queryClient.invalidateQueries({ queryKey: ['comment-count', trackId] });
}

async function fetchLikedIds(userId: string | undefined, commentIds: string[]): Promise<Set<string>> {
  const liked = new Set<string>();
  if (!userId || commentIds.length === 0) return liked;

  const { data, error } = await supabase
    .from('track_comment_likes')
    .select('comment_id')
    .eq('user_id', userId)
    .in('comment_id', commentIds);
  // Heart state decorates the thread; failing to load it shouldn't blank it.
  if (error) {
    console.warn('[Comments] could not load your likes:', error.message ?? error);
    return liked;
  }

  for (const row of data ?? []) liked.add(row.comment_id);
  return liked;
}

/** A track's comments (top-level and replies together), oldest first. */
export function useTrackComments(trackId: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: commentsKey(trackId, user?.id),
    queryFn: async (): Promise<TrackComment[]> => {
      // Authors come through profiles_public - profiles' own RLS only lets a
      // user read their own row, which made everyone else "Anonymous".
      const { data, error } = await supabase
        .from('track_comments')
        .select('*, profiles_public(display_name, avatar_url)')
        .eq('track_id', trackId)
        .order('created_at', { ascending: false })
        .limit(MAX_COMMENTS);

      if (error) {
        console.warn('[Comments] track_comments fetch skipped due to schema error', error);
        return [];
      }

      const rows = [...(data ?? [])].reverse();
      const liked = await fetchLikedIds(user?.id, rows.map((r: { id: string }) => r.id));
      return rows.map((row: unknown) => normalizeComment(row, liked));
    },
    enabled: !!trackId,
  });
}

export function usePostTrackComment(trackId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ comment, replyTo }: { comment: string; replyTo?: string | null }) => {
      if (!user) throw new Error('Must be logged in to comment');

      const { error } = await supabase.from('track_comments').insert({
        track_id: trackId,
        user_id: user.id,
        comment: comment.trim(),
        reply_to: replyTo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateTrackComments(queryClient, trackId),
  });
}

export function useEditTrackComment(trackId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ commentId, comment }: { commentId: string; comment: string }) => {
      const { error } = await supabase
        .from('track_comments')
        .update({ comment: comment.trim(), edited_at: new Date().toISOString() })
        .eq('id', commentId);
      if (error) throw error;
    },
    onSuccess: () => invalidateTrackComments(queryClient, trackId),
  });
}

export function useDeleteTrackComment(trackId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase.from('track_comments').delete().eq('id', commentId);
      if (error) throw error;
    },
    onSuccess: () => invalidateTrackComments(queryClient, trackId),
  });
}

/** Optimistic: the heart and count flip at once and roll back if the write fails. */
export function useToggleCommentLike(trackId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = commentsKey(trackId, user?.id);

  return useMutation({
    mutationFn: async ({ commentId, liked }: { commentId: string; liked: boolean }) => {
      if (!user) throw new Error('Must be logged in to like');

      if (liked) {
        const { error } = await supabase
          .from('track_comment_likes')
          .delete()
          .eq('comment_id', commentId)
          .eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('track_comment_likes')
          .insert({ comment_id: commentId, user_id: user.id });
        // 23505: already liked (a double tap) - the end state is what was asked for.
        if (error && (error as { code?: string }).code !== '23505') throw error;
      }
    },
    onMutate: async ({ commentId, liked }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TrackComment[]>(key);
      queryClient.setQueryData<TrackComment[]>(key, (old) =>
        old ? applyLikeToggle(old, commentId, liked) : old
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['track-comments', trackId] }),
  });
}

/** Refreshes the thread and the count whenever anyone posts, edits or deletes. */
export function useTrackCommentsRealtime(trackId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!trackId) return;

    const channel = supabase
      .channel(`track-comments:${trackId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'track_comments', filter: `track_id=eq.${trackId}` },
        () => invalidateTrackComments(queryClient, trackId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [trackId, queryClient]);
}

export function useCommentCount(trackId: string) {
  return useQuery({
    queryKey: ['comment-count', trackId],
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from('track_comments')
          .select('*', { count: 'exact', head: true })
          .eq('track_id', trackId);

        if (error) throw error;
        return count || 0;
      } catch (error) {
        console.error('Failed to load comment count:', error);
        return 0;
      }
    },
    enabled: !!trackId,
  });
}

/** Keeps just the count current, for cards that don't show the thread itself. */
export function useCommentCountRealtime(trackId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!trackId) return;

    const channel = supabase
      .channel(`comment-count:${trackId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'track_comments', filter: `track_id=eq.${trackId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['comment-count', trackId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [trackId, queryClient]);
}
