import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Check if current user is admin
export function useIsAdmin() {
  return useQuery({
    queryKey: ['isAdmin'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // is_admin() was never a real function - only has_role(_user_id, _role)
      // exists in the schema (used by RLS policies throughout), which is
      // exactly this check. Calling a nonexistent RPC 404'd on every load.
      const { data, error } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
      if (error) {
        console.error('Error checking admin status:', error);
        return false;
      }

      return data === true;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Get all users with pagination and search
export function useAdminUsers(search?: string, limit = 20, offset = 0) {
  return useQuery({
    queryKey: ['adminUsers', search, limit, offset],
    queryFn: async () => {
      // No user_roles(role) embed here. user_roles.user_id points at
      // auth.users, which the API does not expose, so there is no
      // profiles -> user_roles relationship for it to follow - the embed
      // failed the whole query with PGRST200 and the Users tab could only
      // ever show "Failed to load users." Roles are looked up separately
      // below and merged back in under the same `user_roles` key.
      let query = supabase
        .from('profiles')
        .select('*', { count: 'exact' })
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      if (search) {
        query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      const profiles = data ?? [];

      // Best-effort: if the roles lookup fails, the rows still render with
      // "—" in the Roles column rather than taking the whole tab down again.
      const rolesByUser = new Map<string, { role: string }[]>();
      if (profiles.length) {
        const { data: roleRows } = await supabase
          .from('user_roles')
          .select('user_id, role')
          .in('user_id', profiles.map((p) => p.id));
        for (const r of roleRows ?? []) {
          const list = rolesByUser.get(r.user_id) ?? [];
          list.push({ role: r.role });
          rolesByUser.set(r.user_id, list);
        }
      }

      const users = profiles.map((p) => ({ ...p, user_roles: rolesByUser.get(p.id) ?? [] }));
      return { users, total: count || 0 };
    },
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Get admin stats
export function useAdminStats() {
  return useQuery({
    queryKey: ['adminStats'],
    queryFn: async () => {
      // Get total users
      const { count: totalUsers } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      // Get active users (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { count: activeUsers } = await supabase
        .from('play_history')
        .select('user_id', { count: 'exact', head: true })
        .gte('played_at', sevenDaysAgo.toISOString());

      // Get total tracks
      const { count: totalTracks } = await supabase
        .from('tracks')
        .select('*', { count: 'exact', head: true });

      // Get total plays
      const { count: totalPlays } = await supabase
        .from('play_history')
        .select('*', { count: 'exact', head: true });

      // Get total interactions
      const { count: totalInteractions } = await supabase
        .from('user_interactions')
        .select('*', { count: 'exact', head: true });

      return {
        totalUsers: totalUsers || 0,
        activeUsers: activeUsers || 0,
        totalTracks: totalTracks || 0,
        totalPlays: totalPlays || 0,
        totalInteractions: totalInteractions || 0,
      };
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Get flagged content
export function useFlaggedContent(status = 'unresolved') {
  return useQuery({
    queryKey: ['flaggedContent', status],
    queryFn: async () => {
      // No track:track_id(...) embed here. user_interactions.track_id is text
      // in this database while tracks.id is uuid, so there is no foreign key
      // for the API to follow and it can never be added without rewriting the
      // column - the embed failed the whole query with PGRST200, taking the
      // flagged-content panel down with it. The track is looked up separately
      // below instead, matching whichever id shape each row actually holds.
      const { data, error } = await supabase
        .from('user_interactions')
        .select(`
          *,
          user:user_id(username, email)
        `)
        .eq('interaction_type', 'flag')
        .order('created_at', { ascending: false });

      if (error) throw error;
      const rows = data ?? [];

      const rawIds = [...new Set(rows.map((r: any) => r.track_id).filter(Boolean))] as string[];
      const uuidIds = rawIds.filter((id) => UUID_PATTERN.test(id));
      // Provider ids arrive either bare or as 'spotify:track:<id>'.
      const providerIds = rawIds
        .filter((id) => !UUID_PATTERN.test(id))
        .map((id) => id.replace(/^spotify:track:/, ''));

      type TrackRow = { id: string; title: string | null; artist: string | null; spotify_id: string | null; youtube_id: string | null };
      const found: TrackRow[] = [];
      const cols = 'id, title, artist, spotify_id, youtube_id';
      // Each lookup is best-effort: a failure leaves those rows showing
      // "Unknown track" rather than failing the moderation panel again.
      if (uuidIds.length) {
        const { data: byId } = await supabase.from('tracks').select(cols).in('id', uuidIds);
        if (byId) found.push(...(byId as TrackRow[]));
      }
      if (providerIds.length) {
        const [{ data: bySpotify }, { data: byYoutube }] = await Promise.all([
          supabase.from('tracks').select(cols).in('spotify_id', providerIds),
          supabase.from('tracks').select(cols).in('youtube_id', providerIds),
        ]);
        if (bySpotify) found.push(...(bySpotify as TrackRow[]));
        if (byYoutube) found.push(...(byYoutube as TrackRow[]));
      }

      const lookup = new Map<string, { title: string | null; artist: string | null }>();
      for (const t of found) {
        const summary = { title: t.title, artist: t.artist };
        lookup.set(t.id, summary);
        if (t.spotify_id) lookup.set(t.spotify_id, summary);
        if (t.youtube_id) lookup.set(t.youtube_id, summary);
      }

      return rows.map((r: any) => {
        const key = typeof r.track_id === 'string' ? r.track_id.replace(/^spotify:track:/, '') : r.track_id;
        return { ...r, track: lookup.get(r.track_id) ?? lookup.get(key) ?? null };
      });
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}
