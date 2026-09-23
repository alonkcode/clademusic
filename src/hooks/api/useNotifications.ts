import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { isTestEnv } from '@/lib/env';
import {
  notificationText,
  type NotificationActor,
  type NotificationItem,
  type NotificationRow,
} from '@/lib/notifications';

// Every notification query is keyed under ['notifications', userId, ...] so one
// prefix invalidation refreshes the list and the unread count together.
const baseKey = (userId: string | undefined) => ['notifications', userId] as const;

async function fetchActors(actorIds: string[]): Promise<Map<string, NotificationActor>> {
  const actors = new Map<string, NotificationActor>();
  if (actorIds.length === 0) return actors;

  // profiles_public, not profiles: profiles' RLS only lets a user read their
  // own row, so every actor would come back nameless.
  const { data, error } = await supabase
    .from('profiles_public')
    .select('id, display_name, avatar_url')
    .in('id', actorIds);
  if (error) {
    console.warn('[notifications] could not load actor profiles:', error.message ?? error);
    return actors;
  }

  for (const p of data ?? []) actors.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
  return actors;
}

export function useNotifications(limit = 30) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [...baseKey(user?.id), 'list', limit],
    queryFn: async (): Promise<NotificationItem[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      const rows = (data ?? []) as NotificationRow[];
      const actors = await fetchActors([...new Set(rows.map((r) => r.actor_id).filter((id): id is string => !!id))]);
      return rows.map((row) => ({ ...row, actor: row.actor_id ? actors.get(row.actor_id) ?? null : null }));
    },
    enabled: !isTestEnv && !!user,
    staleTime: 30 * 1000,
  });
}

export function useUnreadNotificationCount() {
  const { user } = useAuth();

  return useQuery({
    queryKey: [...baseKey(user?.id), 'unread'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .is('read_at', null);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !isTestEnv && !!user,
    staleTime: 30 * 1000,
  });
}

export function useMarkNotificationRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: baseKey(user?.id) }),
  });
}

export function useMarkAllNotificationsRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user!.id)
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: baseKey(user?.id) }),
  });
}

/**
 * Refreshes the bell and shows a toast the moment something new arrives. Mount
 * once, app-wide. The toast viewport already sits above the docked player, so
 * it can't be covered.
 */
export function useNotificationsRealtime() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user || isTestEnv) return;

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          queryClient.invalidateQueries({ queryKey: baseKey(user.id) });

          const row = payload.new as NotificationRow;
          const actors = await fetchActors(row.actor_id ? [row.actor_id] : []);
          toast({
            title: notificationText({
              type: row.type,
              comment_id: row.comment_id,
              actor: row.actor_id ? actors.get(row.actor_id) ?? null : null,
            }),
            description: row.data?.snippet || undefined,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);
}
