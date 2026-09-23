import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isTestEnv } from '@/lib/env';
import type { UserVote, VoteDirection } from '@/lib/forum';
import * as forumService from '@/services/forumService';
import type { ForumSort } from '@/services/forumService';

const requireUser = (userId: string | undefined): string => {
  if (!userId) throw new Error('Sign in required');
  return userId;
};

export function useForums() {
  return useQuery({
    queryKey: ['forums'],
    queryFn: () => forumService.listForums(),
    enabled: !isTestEnv,
    staleTime: 60 * 1000,
  });
}

export function useForumByName(name: string | undefined) {
  return useQuery({
    queryKey: ['forum', name],
    queryFn: () => forumService.getForumByName(name!),
    enabled: !isTestEnv && !!name,
    staleTime: 60 * 1000,
  });
}

export function useForumPosts(options: { sort: ForumSort; forumId?: string; enabled?: boolean }) {
  const { user } = useAuth();
  const { sort, forumId, enabled = true } = options;

  return useQuery({
    queryKey: ['forum-posts', sort, forumId ?? 'all', user?.id ?? null],
    queryFn: () => forumService.listPosts({ sort, forumId, userId: user?.id }),
    enabled: !isTestEnv && enabled,
    staleTime: 30 * 1000,
  });
}

export function useForumPost(postId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['forum-post', postId, user?.id ?? null],
    queryFn: () => forumService.getPost(postId!, user?.id),
    enabled: !isTestEnv && !!postId,
  });
}

export function useMyForumMemberships() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['forum-memberships', user?.id],
    queryFn: () => forumService.listMyMemberships(user!.id),
    enabled: !isTestEnv && !!user,
    staleTime: 60 * 1000,
  });
}

export function useToggleMembership() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ forumId, joined }: { forumId: string; joined: boolean }) => {
      const userId = requireUser(user?.id);
      if (joined) await forumService.leaveForum(forumId, userId);
      else await forumService.joinForum(forumId, userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-memberships', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['forums'] });
    },
  });
}

export function useCreatePost() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { forumId: string; title: string; content?: string }) =>
      forumService.createPost({ ...input, userId: requireUser(user?.id) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-posts'] });
      queryClient.invalidateQueries({ queryKey: ['forums'] });
    },
  });
}

export function useCreateForum() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; displayName: string; description?: string; category: string }) =>
      forumService.createForum({ ...input, userId: requireUser(user?.id) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forums'] });
      queryClient.invalidateQueries({ queryKey: ['forum-memberships', user?.id] });
    },
  });
}

export function usePostComments(postId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['forum-comments', postId, user?.id ?? null],
    queryFn: () => forumService.listPostComments(postId!, user?.id),
    enabled: !isTestEnv && !!postId,
  });
}

/** Refreshes the thread (and the post's comment count) when anyone comments. */
export function useForumCommentsRealtime(postId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!postId || isTestEnv) return;

    const channel = supabase
      .channel(`forum-comments:${postId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'forum_comments', filter: `post_id=eq.${postId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['forum-comments', postId] });
          queryClient.invalidateQueries({ queryKey: ['forum-post', postId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId, queryClient]);
}

export function useAddPostComment(postId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { content: string; parentId?: string | null }) =>
      forumService.addPostComment({ postId, userId: requireUser(user?.id), ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-comments', postId] });
      queryClient.invalidateQueries({ queryKey: ['forum-post', postId] });
      queryClient.invalidateQueries({ queryKey: ['forum-posts'], refetchType: 'none' });
    },
  });
}

export function useDeletePostComment(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) => forumService.softDeleteComment(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-comments', postId] });
    },
  });
}

/**
 * The button that was pressed already updated the count and arrow locally, so
 * cached lists are only marked stale (not refetched) - refetching a list sorted
 * by votes would reorder it under the user's cursor.
 */
export function useForumVote() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { target: 'post' | 'comment'; id: string; current: UserVote; direction: VoteDirection }) =>
      forumService.castVote({ ...input, userId: requireUser(user?.id) }),
    onSuccess: (_data, variables) => {
      const keys =
        variables.target === 'post'
          ? [['forum-posts'], ['forum-post']]
          : [['forum-comments']];
      for (const queryKey of keys) queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
    },
  });
}
