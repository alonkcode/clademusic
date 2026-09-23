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
