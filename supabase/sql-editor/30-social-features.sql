-- Social features: room chat, forum writes, live comments, notifications.
--
-- The four files in supabase/migrations/202609231*-2026092315* concatenated, in
-- order, in one transaction so they apply all-or-nothing. Every statement is
-- idempotent, so re-running is safe.
--
--   150000 chat_room_uniqueness_realtime     one global room, one room per track,
--                                            realtime for chat_messages
--   151000 forum_write_paths                 forum counters that actually update,
--                                            no self-assigned admin, realtime
--   152000 track_comments_realtime_and_edit_sync
--                                            realtime, edited text syncs, like
--                                            counts on other people's comments
--   153000 notifications                     the notifications table + triggers
--
-- Until this runs the site still works: chat, forums and comments function, the
-- notification bell stays hidden, and counters/realtime just don't update.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.

BEGIN;


-- ======================================================================
-- 20260923150000_chat_room_uniqueness_realtime.sql
-- ======================================================================

-- Make room chat safe to mount: one global room, one room per track, realtime on.
--
-- Why: 20260122_live_chat.sql seeds the global room with
-- `INSERT ... ON CONFLICT DO NOTHING`, but chat_rooms had no unique key for it
-- to conflict on, so every re-run of that seed added another "Global Chat".
-- Track rooms are created on demand by the client (select, then insert), so two
-- people opening the same track at once could each create one. Clients resolve
-- a room with LIMIT 1, so duplicates split the audience into rooms that can't
-- see each other's messages.
--
-- Also: no migration in this repo adds any table to the supabase_realtime
-- publication, so postgres_changes subscriptions on chat_messages would never
-- receive an event on a database built only from these files.
--
-- Safe to re-run.

DO $$
BEGIN
  IF to_regclass('public.chat_rooms') IS NULL OR to_regclass('public.chat_messages') IS NULL THEN
    RAISE NOTICE 'chat tables not present; skipping chat room uniqueness migration';
    RETURN;
  END IF;

  -- 1. Merge duplicate global / per-track rooms into the oldest one. Messages are
  --    repointed first; the duplicate rooms' memberships only hold last_read_at,
  --    and public rooms don't need membership to read or post, so those cascade.
  UPDATE public.chat_messages m
  SET room_id = r.keeper_id
  FROM (
    SELECT id,
           first_value(id) OVER (
             PARTITION BY type, COALESCE(track_id, '')
             ORDER BY created_at, id
           ) AS keeper_id
    FROM public.chat_rooms
    WHERE type IN ('global', 'track')
  ) r
  WHERE m.room_id = r.id AND r.id <> r.keeper_id;

  DELETE FROM public.chat_rooms c
  USING (
    SELECT id,
           first_value(id) OVER (
             PARTITION BY type, COALESCE(track_id, '')
             ORDER BY created_at, id
           ) AS keeper_id
    FROM public.chat_rooms
    WHERE type IN ('global', 'track')
  ) r
  WHERE c.id = r.id AND r.id <> r.keeper_id;

  -- 2. Enforce it going forward. The constant expression makes the partial
  --    index a singleton: at most one row can ever have type = 'global'.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_rooms_single_global
    ON public.chat_rooms ((true)) WHERE type = 'global';

  CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_rooms_one_per_track
    ON public.chat_rooms (track_id) WHERE type = 'track';

  -- 3. The app needs a global room to exist.
  INSERT INTO public.chat_rooms (name, type, metadata)
  SELECT 'Global Chat', 'global', '{"description": "Chat with everyone on CladeAI"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.chat_rooms WHERE type = 'global');

  -- 4. Realtime delivery for new messages.
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'chat_messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END $$;


-- ======================================================================
-- 20260923151000_forum_write_paths.sql
-- ======================================================================

-- Make the forum safe to write to: counts that update, and roles that can't be self-assigned.
--
-- Until now the forum was read-only in the UI, so three problems in the schema
-- never surfaced. Creating posts, joining, commenting and voting exposes them.
--
-- 1. Counts never change for other people's content.
--    update_post_vote_count, update_comment_vote_count, update_post_comment_count,
--    update_forum_member_count and update_forum_post_count are ordinary
--    (SECURITY INVOKER) trigger functions, so their UPDATEs on forum_posts /
--    forum_comments / forums run as the voter, commenter or joiner and are
--    filtered by RLS - those tables only allow UPDATE to the author or a
--    moderator. Someone upvoting another user's post updated zero rows and the
--    score never moved. They only touch counter columns, so run them as the
--    table owner.
--
-- 2. Anyone could make themselves an admin.
--    forum_members_insert only checks user_id = auth.uid(); role is free. A user
--    could insert (forum, me, 'admin') into any forum and then edit or delete
--    every post in it through the moderator branches of the posts policies.
--    Members may now only insert themselves as 'member'. A forum's creator is
--    made its admin by a trigger instead of by the client.
--
-- 3. Realtime for forum_comments, so an open thread updates live. No migration
--    in this repo adds any table to the supabase_realtime publication.
--
-- Safe to re-run.

DO $$
DECLARE
  fn text;
  pol record;
BEGIN
  -- 1. Counters run as owner.
  FOREACH fn IN ARRAY ARRAY[
    'update_forum_member_count',
    'update_forum_post_count',
    'update_post_comment_count',
    'update_post_vote_count',
    'update_comment_vote_count'
  ] LOOP
    IF to_regprocedure('public.' || fn || '()') IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION public.%I() SECURITY DEFINER SET search_path = public', fn);
    END IF;
  END LOOP;

  -- 2. Members can only add themselves as plain members. Every existing INSERT
  --    policy is dropped first (policies are OR'd, so a permissive one under a
  --    different name would keep the hole open).
  IF to_regclass('public.forum_members') IS NOT NULL THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'forum_members' AND cmd = 'INSERT'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.forum_members', pol.policyname);
    END LOOP;

    CREATE POLICY "forum_members_insert" ON public.forum_members
      FOR INSERT
      WITH CHECK (auth.uid() = user_id AND role = 'member');
  END IF;

  -- 3. Realtime for comment threads.
  IF to_regclass('public.forum_comments') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'forum_comments'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.forum_comments;
  END IF;
END $$;

-- A forum's creator becomes its admin. Non-fatal: failing to add the membership
-- must never block creating the forum itself.
CREATE OR REPLACE FUNCTION public.add_forum_creator_as_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.forum_members (forum_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'admin')
    ON CONFLICT (forum_id, user_id) DO NOTHING;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'add_forum_creator_as_admin failed for forum %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.forums') IS NOT NULL AND to_regclass('public.forum_members') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trigger_add_forum_creator_as_admin ON public.forums;
    CREATE TRIGGER trigger_add_forum_creator_as_admin
      AFTER INSERT ON public.forums
      FOR EACH ROW EXECUTE FUNCTION public.add_forum_creator_as_admin();
  END IF;
END $$;


-- ======================================================================
-- 20260923152000_track_comments_realtime_and_edit_sync.sql
-- ======================================================================

-- Live track comments: deliver realtime events, keep edited text in sync, count likes.
--
-- 1. Realtime. TrackComments, ScrollingComments and the feed card's comment
--    count all subscribe to postgres_changes on track_comments, but no
--    migration in this repo adds the table to the supabase_realtime
--    publication, so on a database built from these files none of them ever
--    receives an event.
--
-- 2. Edits. track_comments carries two text columns (comment, written by
--    TrackComments; content, read by ScrollingComments) kept in step by the
--    sync_track_comment_text trigger from bundle-fixes/00-compat-prelude.sql.
--    That trigger only fills in whichever column is NULL, which is right on
--    INSERT but never fires on an edit: after TrackComments updates `comment`,
--    `content` is still non-null, so nothing is copied and the scrolling
--    overlay keeps showing the old text forever. On UPDATE, copy whichever of
--    the two changed across to the other.
--
-- 3. Like counts. update_comment_likes_count (20260122_track_comments.sql) is an
--    ordinary SECURITY INVOKER trigger function, so its UPDATE of
--    track_comments.likes_count runs as the person pressing the heart - and
--    track_comments only allows UPDATE by the comment's own author. Liking
--    anyone else's comment updated zero rows and the count never moved. It only
--    touches the counter, so run it as the table owner (and never below zero).
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.update_comment_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.track_comments
    SET likes_count = COALESCE(likes_count, 0) + 1
    WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.track_comments
    SET likes_count = GREATEST(0, COALESCE(likes_count, 0) - 1)
    WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_track_comment_text()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.comment IS DISTINCT FROM OLD.comment
       AND NEW.content IS NOT DISTINCT FROM OLD.content THEN
      NEW.content := NEW.comment;
    ELSIF NEW.content IS DISTINCT FROM OLD.content
       AND NEW.comment IS NOT DISTINCT FROM OLD.comment THEN
      NEW.comment := NEW.content;
    END IF;
  END IF;

  IF NEW.comment IS NULL AND NEW.content IS NOT NULL THEN
    NEW.comment := NEW.content;
  ELSIF NEW.content IS NULL AND NEW.comment IS NOT NULL THEN
    NEW.content := NEW.comment;
  END IF;

  IF NEW.reply_to IS NULL AND NEW.parent_id IS NOT NULL THEN
    NEW.reply_to := NEW.parent_id;
  ELSIF NEW.parent_id IS NULL AND NEW.reply_to IS NOT NULL THEN
    NEW.parent_id := NEW.reply_to;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.track_comments') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'track_comments'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.track_comments;
  END IF;
END $$;


-- ======================================================================
-- 20260923153000_notifications.sql
-- ======================================================================

-- In-app notifications: replies, likes, follows, forum activity and chat replies.
--
-- Rows are written only by triggers on the tables where the activity happens,
-- never by the client:
--   * it covers every write path at once (both comment UIs, the like toggles,
--     forum and chat) instead of relying on each screen to remember to notify;
--   * a client can't fabricate a notification for someone else. There is no
--     INSERT policy, the INSERT privilege is revoked, and create_notification
--     is not executable by API roles.
-- Every trigger is non-fatal (the style of 20260921210000_make_playlist_sync_
-- nonfatal.sql): a failure to notify is logged as a warning and never blocks
-- the comment, vote or follow that caused it.
--
-- Plain likes / saves of a catalog track are not notified: tracks have no
-- owner to tell. They feed the personalized ranking instead.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- recipient
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- who did it; SET NULL so deleting an account doesn't erase what others were told
  actor_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN (
                  'follow',
                  'comment_reply',
                  'comment_like',
                  'forum_post_comment',
                  'forum_reply',
                  'forum_upvote',
                  'chat_reply'
                )),
  track_id      TEXT,
  forum_post_id UUID,
  comment_id    UUID,
  -- snippet, forum name, post title, room type: display text only
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Set for events that should notify once however often they repeat (like ->
  -- unlike -> like, follow -> unfollow -> follow).
  dedupe_key    TEXT,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id) WHERE read_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe
  ON public.notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());

-- Users may read and delete their own rows and flip read_at; nothing else.
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

-- ---------------------------------------------------------------- helper
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id       UUID,
  p_actor_id      UUID,
  p_type          TEXT,
  p_track_id      TEXT DEFAULT NULL,
  p_forum_post_id UUID DEFAULT NULL,
  p_comment_id    UUID DEFAULT NULL,
  p_data          JSONB DEFAULT '{}'::jsonb,
  p_dedupe_key    TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Nobody needs telling about their own action, or about a deleted account.
  IF p_user_id IS NULL OR p_user_id = p_actor_id THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications
    (user_id, actor_id, type, track_id, forum_post_id, comment_id, data, dedupe_key)
  VALUES
    (p_user_id, p_actor_id, p_type, p_track_id, p_forum_post_id, p_comment_id,
     COALESCE(p_data, '{}'::jsonb), p_dedupe_key)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'create_notification failed (%): %', p_type, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(UUID, UUID, TEXT, TEXT, UUID, UUID, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------- triggers
-- Values are assigned inside BEGIN, not in DECLARE: an error in a DECLARE
-- initialiser is raised before the EXCEPTION clause can catch it.

CREATE OR REPLACE FUNCTION public.notify_on_follow()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.create_notification(
    NEW.following_id, NEW.follower_id, 'follow',
    NULL, NULL, NULL, '{}'::jsonb,
    'follow:' || NEW.follower_id::text
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_on_follow failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_track_comment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent UUID;
  v_recipient UUID;
BEGIN
  -- track_comments carries both reply_to and parent_id, kept in step by
  -- sync_track_comment_text (bundle-fixes/00-compat-prelude.sql).
  v_parent := COALESCE(NEW.reply_to, NEW.parent_id);
  IF v_parent IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT user_id INTO v_recipient FROM public.track_comments WHERE id = v_parent;

  PERFORM public.create_notification(
    v_recipient, NEW.user_id, 'comment_reply',
    NEW.track_id::text, NULL, NEW.id,
    jsonb_build_object('snippet', left(COALESCE(NEW.comment, NEW.content, ''), 140))
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_on_track_comment failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_comment_like()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recipient UUID;
  v_track TEXT;
  v_snippet TEXT;
BEGIN
  SELECT user_id, track_id::text, left(COALESCE(comment, content, ''), 140)
    INTO v_recipient, v_track, v_snippet
  FROM public.track_comments WHERE id = NEW.comment_id;

  PERFORM public.create_notification(
    v_recipient, NEW.user_id, 'comment_like',
    v_track, NULL, NEW.comment_id,
    jsonb_build_object('snippet', v_snippet),
    'comment_like:' || NEW.comment_id::text || ':' || NEW.user_id::text
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_on_comment_like failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_forum_comment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recipient UUID;
  v_type TEXT;
  v_title TEXT;
  v_forum TEXT;
BEGIN
  IF NEW.parent_comment_id IS NOT NULL THEN
    SELECT user_id INTO v_recipient FROM public.forum_comments WHERE id = NEW.parent_comment_id;
    v_type := 'forum_reply';
  ELSE
    SELECT user_id INTO v_recipient FROM public.forum_posts WHERE id = NEW.post_id;
    v_type := 'forum_post_comment';
  END IF;

  SELECT p.title, f.name INTO v_title, v_forum
  FROM public.forum_posts p
  LEFT JOIN public.forums f ON f.id = p.forum_id
  WHERE p.id = NEW.post_id;

  PERFORM public.create_notification(
    v_recipient, NEW.user_id, v_type,
    NULL, NEW.post_id, NEW.id,
    jsonb_build_object('snippet', left(NEW.content, 140), 'post_title', v_title, 'forum', v_forum)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_on_forum_comment failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_forum_vote()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recipient UUID;
  v_post UUID;
  v_comment UUID;
  v_title TEXT;
  v_forum TEXT;
  v_snippet TEXT;
  v_key TEXT;
BEGIN
  IF NEW.vote_type <> 'up' THEN
    RETURN NULL;
  END IF;
  -- Re-saving an existing upvote isn't a new one.
  IF TG_OP = 'UPDATE' AND OLD.vote_type = 'up' THEN
    RETURN NULL;
  END IF;

  IF NEW.post_id IS NOT NULL THEN
    SELECT p.user_id, p.id, p.title, f.name
      INTO v_recipient, v_post, v_title, v_forum
    FROM public.forum_posts p
    LEFT JOIN public.forums f ON f.id = p.forum_id
    WHERE p.id = NEW.post_id;
    v_key := 'forum_upvote:post:' || NEW.post_id::text || ':' || NEW.user_id::text;
  ELSE
    SELECT c.user_id, c.post_id, left(c.content, 140)
      INTO v_recipient, v_post, v_snippet
    FROM public.forum_comments c
    WHERE c.id = NEW.comment_id;
    v_comment := NEW.comment_id;
    SELECT p.title, f.name INTO v_title, v_forum
    FROM public.forum_posts p
    LEFT JOIN public.forums f ON f.id = p.forum_id
    WHERE p.id = v_post;
    v_key := 'forum_upvote:comment:' || NEW.comment_id::text || ':' || NEW.user_id::text;
  END IF;

  PERFORM public.create_notification(
    v_recipient, NEW.user_id, 'forum_upvote',
    NULL, v_post, v_comment,
    jsonb_build_object('post_title', v_title, 'forum', v_forum, 'snippet', v_snippet),
    v_key
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_on_forum_vote failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_chat_reply()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recipient UUID;
  v_room_type TEXT;
  v_track TEXT;
BEGIN
  IF NEW.reply_to IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT user_id INTO v_recipient FROM public.chat_messages WHERE id = NEW.reply_to;
  SELECT type, track_id INTO v_room_type, v_track FROM public.chat_rooms WHERE id = NEW.room_id;

  PERFORM public.create_notification(
    v_recipient, NEW.user_id, 'chat_reply',
    v_track, NULL, NULL,
    jsonb_build_object('snippet', left(NEW.message, 140), 'room_type', v_room_type, 'room_id', NEW.room_id)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_on_chat_reply failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

-- Attach each function to its table, skipping any table this database lacks.
DO $$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('user_follows',        'notify_on_follow',        'AFTER INSERT'),
      ('track_comments',      'notify_on_track_comment', 'AFTER INSERT'),
      ('track_comment_likes', 'notify_on_comment_like',  'AFTER INSERT'),
      ('forum_comments',      'notify_on_forum_comment', 'AFTER INSERT'),
      ('forum_votes',         'notify_on_forum_vote',    'AFTER INSERT OR UPDATE OF vote_type'),
      ('chat_messages',       'notify_on_chat_reply',    'AFTER INSERT')
    ) AS t(tbl, fn, ev)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
      RAISE NOTICE 'table public.% does not exist - no notification trigger attached', spec.tbl;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || spec.fn, spec.tbl);
    EXECUTE format(
      'CREATE TRIGGER %I %s ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()',
      'trg_' || spec.fn, spec.ev, spec.tbl, spec.fn
    );
  END LOOP;

  -- Realtime delivery to the bell. Row-level security still applies, so a
  -- subscriber only ever receives their own rows.
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;


COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify. Expect: notifications_rows = 0, notification_triggers = 6 (fewer only
-- if a source table such as chat_messages does not exist), and realtime_tables
-- listing chat_messages, forum_comments, track_comments and notifications.
SELECT
  (SELECT count(*) FROM public.notifications) AS notifications_rows,
  (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_notify_on_%' AND NOT tgisinternal) AS notification_triggers,
  (SELECT string_agg(tablename, ', ' ORDER BY tablename) FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename IN ('chat_messages', 'forum_comments', 'track_comments', 'notifications')) AS realtime_tables;
