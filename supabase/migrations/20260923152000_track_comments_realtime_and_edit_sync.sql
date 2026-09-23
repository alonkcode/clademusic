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
