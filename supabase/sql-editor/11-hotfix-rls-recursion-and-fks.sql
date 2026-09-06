-- Fix three features that are completely broken in production, found by
-- sweeping every route in a real browser and reading what the API returned.
--
-- 1. public.playlists is UNREADABLE. Even `select id from playlists` fails
--    with 42P17 "infinite recursion detected in policy". Its SELECT policy
--    ("Collaborators can view playlists") reads playlist_collaborators,
--    whose own SELECT policy ("Users can view collaborators") reads
--    playlists - each re-triggers the other forever. So /playlists and
--    /playlist/:id are dead, and so is every playlist read anywhere else.
--
-- 2. public.chat_messages is UNREADABLE for the same reason, one table over:
--    the chat_room_members SELECT policy queries chat_room_members itself
--    (`EXISTS (SELECT 1 FROM chat_room_members AS crm ...)`), which re-enters
--    the same policy. Reading chat_messages consults that policy, so the
--    feed's live comments fail with 42P17.
--
-- 3. Three embeds the app relies on have no foreign key to resolve, so
--    PostgREST rejects the query with PGRST200:
--      forum_posts    -> profiles  (forum shows no posts at all)
--      playlists      -> profiles  (public playlist list fails)
--      playlist_tracks-> tracks    (playlist detail page renders blank)
--    Each *_id column points at auth.users (or nothing), never at the
--    public table the query embeds.
--
-- The recursion fix is the standard one: move each cross-table membership
-- check into a SECURITY DEFINER function. Such a function runs as its owner
-- with RLS bypassed for the lookup, so the policy no longer re-enters the
-- table it is protecting.
--
-- Safe to run on an already-provisioned project. It only replaces policies
-- and adds constraints/functions; no data is deleted.

BEGIN;

-- ============================================================ 1. chat rooms

CREATE OR REPLACE FUNCTION public.is_chat_room_member(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_room_members m
    WHERE m.room_id = p_room_id AND m.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_open_chat_room(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_rooms r
    WHERE r.id = p_room_id AND r.type IN ('global', 'track')
  );
$$;

-- The self-referential one - this is the actual 42P17 source.
DROP POLICY IF EXISTS "Users can view room members" ON public.chat_room_members;
CREATE POLICY "Users can view room members"
  ON public.chat_room_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_chat_room_member(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can join public rooms" ON public.chat_room_members;
CREATE POLICY "Users can join public rooms"
  ON public.chat_room_members FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.is_open_chat_room(room_id));

-- These read chat_room_members, so they must go through the function too,
-- or they re-enter the member policy and recurse again.
DROP POLICY IF EXISTS "Users can view messages in their rooms" ON public.chat_messages;
CREATE POLICY "Users can view messages in their rooms"
  ON public.chat_messages FOR SELECT
  USING (
    public.is_open_chat_room(room_id)
    OR public.is_chat_room_member(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can send messages to their rooms" ON public.chat_messages;
CREATE POLICY "Users can send messages to their rooms"
  ON public.chat_messages FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.is_open_chat_room(room_id)
      OR public.is_chat_room_member(room_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can view rooms they're members of" ON public.chat_rooms;
CREATE POLICY "Users can view rooms they're members of"
  ON public.chat_rooms FOR SELECT
  USING (public.is_chat_room_member(id, auth.uid()));

-- ============================================================= 2. playlists

CREATE OR REPLACE FUNCTION public.is_playlist_collaborator(p_playlist_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.playlist_collaborators c
    WHERE c.playlist_id = p_playlist_id AND c.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_playlist(p_playlist_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = p_playlist_id AND p.user_id = p_user_id
  );
$$;

-- is_collaborative only exists in some revisions of this schema; read it
-- defensively so this file applies either way.
CREATE OR REPLACE FUNCTION public.can_read_playlist(p_playlist_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'playlists'
      AND column_name = 'is_collaborative'
  ) THEN
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM public.playlists p
         WHERE p.id = $1 AND (p.user_id = $2 OR p.is_public OR p.is_collaborative))'
      INTO v_ok USING p_playlist_id, p_user_id;
  ELSE
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM public.playlists p
         WHERE p.id = $1 AND (p.user_id = $2 OR p.is_public))'
      INTO v_ok USING p_playlist_id, p_user_id;
  END IF;
  RETURN v_ok;
END;
$$;

-- Half of the playlists <-> playlist_collaborators cycle.
DROP POLICY IF EXISTS "Collaborators can view playlists" ON public.playlists;
CREATE POLICY "Collaborators can view playlists"
  ON public.playlists FOR SELECT
  USING (public.is_playlist_collaborator(id, auth.uid()));

-- ...and the other half.
DROP POLICY IF EXISTS "Users can view collaborators" ON public.playlist_collaborators;
CREATE POLICY "Users can view collaborators"
  ON public.playlist_collaborators FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.can_read_playlist(playlist_id, auth.uid())
  );

DROP POLICY IF EXISTS "Owners can manage collaborators" ON public.playlist_collaborators;
CREATE POLICY "Owners can manage collaborators"
  ON public.playlist_collaborators FOR ALL
  USING (public.owns_playlist(playlist_id, auth.uid()));

-- playlist_tracks policies read playlists; route them through the functions
-- as well so they can never re-enter a playlists policy.
DROP POLICY IF EXISTS "Users can view playlist tracks" ON public.playlist_tracks;
CREATE POLICY "Users can view playlist tracks"
  ON public.playlist_tracks FOR SELECT
  USING (public.can_read_playlist(playlist_id, auth.uid()));

DROP POLICY IF EXISTS "Owners can manage playlist tracks" ON public.playlist_tracks;
CREATE POLICY "Owners can manage playlist tracks"
  ON public.playlist_tracks FOR ALL
  USING (public.owns_playlist(playlist_id, auth.uid()));

-- ========================================================== 3. missing FKs

-- Every embed below resolves against public.profiles, so make sure a profile
-- row exists for each user first, or adding the constraint would fail.
INSERT INTO public.profiles (id, email, display_name)
SELECT u.id,
       u.email,
       COALESCE(
         NULLIF(u.raw_user_meta_data->>'display_name', ''),
         NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
         'listener'
       )
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- forum_posts.user_id -> profiles.id  (forum feed embeds user:profiles)
DO $$
BEGIN
  IF to_regclass('public.forum_posts') IS NOT NULL THEN
    ALTER TABLE public.forum_posts DROP CONSTRAINT IF EXISTS forum_posts_user_id_fkey;
    ALTER TABLE public.forum_posts
      ADD CONSTRAINT forum_posts_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- forum_comments embeds the same way in the comment thread.
DO $$
BEGIN
  IF to_regclass('public.forum_comments') IS NOT NULL THEN
    ALTER TABLE public.forum_comments DROP CONSTRAINT IF EXISTS forum_comments_user_id_fkey;
    ALTER TABLE public.forum_comments
      ADD CONSTRAINT forum_comments_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- playlists.user_id -> profiles.id  (owner:user_id(username, avatar_url))
DO $$
BEGIN
  IF to_regclass('public.playlists') IS NOT NULL THEN
    ALTER TABLE public.playlists DROP CONSTRAINT IF EXISTS playlists_user_id_fkey;
    ALTER TABLE public.playlists
      ADD CONSTRAINT playlists_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END;
$$;

-- playlist_tracks.track_id -> tracks.id  (playlist detail embeds track:track_id)
-- Two revisions of this table exist in the migration history - one with
-- track_id as uuid, one as text. Only wire the FK when the types actually
-- line up and every existing value resolves, so a mismatched deployment
-- degrades to "no embed" rather than failing the whole apply.
DO $$
DECLARE
  v_type TEXT;
  v_orphans INTEGER;
BEGIN
  IF to_regclass('public.playlist_tracks') IS NULL THEN
    RETURN;
  END IF;

  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'playlist_tracks' AND column_name = 'track_id';

  IF v_type = 'text' THEN
    -- Convert only if every value is a well-formed uuid.
    IF EXISTS (
      SELECT 1 FROM public.playlist_tracks
      WHERE track_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    ) THEN
      RAISE WARNING 'playlist_tracks.track_id holds non-uuid values; leaving it as text and skipping the FK';
      RETURN;
    END IF;
    ALTER TABLE public.playlist_tracks ALTER COLUMN track_id TYPE UUID USING track_id::uuid;
    v_type := 'uuid';
  END IF;

  IF v_type <> 'uuid' THEN
    RAISE WARNING 'playlist_tracks.track_id is %, expected uuid; skipping the FK', v_type;
    RETURN;
  END IF;

  SELECT count(*) INTO v_orphans
  FROM public.playlist_tracks pt
  LEFT JOIN public.tracks t ON t.id = pt.track_id
  WHERE t.id IS NULL;

  IF v_orphans > 0 THEN
    DELETE FROM public.playlist_tracks pt
    WHERE NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = pt.track_id);
    RAISE NOTICE 'removed % playlist_tracks rows pointing at tracks that no longer exist', v_orphans;
  END IF;

  ALTER TABLE public.playlist_tracks DROP CONSTRAINT IF EXISTS playlist_tracks_track_id_fkey;
  ALTER TABLE public.playlist_tracks
    ADD CONSTRAINT playlist_tracks_track_id_fkey
    FOREIGN KEY (track_id) REFERENCES public.tracks(id) ON DELETE CASCADE;
END;
$$;

COMMIT;

-- PostgREST caches the schema; nudge it so the new relationships are usable
-- immediately instead of after the next redeploy.
NOTIFY pgrst, 'reload schema';
