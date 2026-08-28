-- Compatibility prelude for the generated schema bundle.
--
-- Several later migrations (and parts of the app) reference columns that no
-- migration ever creates. Applied against a real, long-lived project those
-- columns presumably arrived by hand through the dashboard; against an EMPTY
-- project the migrations fail outright.
--
-- This prelude declares them up front so the bundle applies cleanly. Every
-- statement is idempotent and additive - it never drops or rewrites anything.
--
-- Referenced by:
--   profiles.username, full_name    -> mv_hot_posts, mv_top_contributors,
--                                      idx_profiles_search_name, and the app
--                                      (ScrollingComments, billing.ts)
--   profiles.country, personality_type -> idx_profiles_country_created,
--                                      idx_profiles_personality_location
--   profiles.role                   -> performance_test_results RLS policy
--   tracks.genre, tempo,
--     is_common_ancestor            -> 20260122_optimize_indexes
--   feed_items.user_id, posted_at   -> 20260122_optimize_indexes
--   user_interactions.resolved_at   -> 20260122_optimize_indexes

-- Extensions must exist before any index that uses their operator classes.
-- 20260122_optimize_indexes uses gin_trgm_ops but only creates pg_trgm at the
-- END of the file, which is too late for its own indexes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 20260122_performance_optimization defines a slow_queries view over
-- pg_stat_statements without ever enabling it ("ERROR: relation
-- pg_stat_statements does not exist"). Guarded, because the extension needs to
-- be in shared_preload_libraries and is not creatable on every host; the view
-- is monitoring-only and nothing in the app reads it.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_stat_statements unavailable (%): slow_queries will be a stub', SQLERRM;
END $$;

-- Stub so the CREATE OR REPLACE VIEW later in the bundle has something to
-- replace even where the extension could not be created. Same column names and
-- types as the real view, so replacing it is a no-op shape-wise.
DO $$
BEGIN
  IF to_regclass('public.pg_stat_statements') IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')
  THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.slow_queries AS
      SELECT NULL::text AS query, NULL::bigint AS calls,
             NULL::double precision AS total_time_sec,
             NULL::double precision AS mean_time_sec,
             NULL::double precision AS max_time_sec
      WHERE false
    $v$;
  END IF;
END $$;

-- ---------------------------------------------------------------- profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS personality_type TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

-- Indexes below build on these; NULLs would make the expression NULL, so the
-- concatenation in idx_profiles_search_name needs COALESCE-safe defaults.
UPDATE public.profiles SET username = COALESCE(username, ''), full_name = COALESCE(full_name, '')
WHERE username IS NULL OR full_name IS NULL;

-- ------------------------------------------------------------------ tracks
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS genres TEXT[];
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS tempo NUMERIC;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS is_common_ancestor BOOLEAN DEFAULT FALSE;

-- -------------------------------------------------------------- feed_items
ALTER TABLE public.feed_items ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.feed_items ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ DEFAULT now();

-- ------------------------------------------------------- user_interactions
-- Two incompatible designs again:
--   20260114 base -> one row per (user, track, interaction_type)
--   20260122      -> one row per (user, track), with liked/harmony_saved/
--                    bookmarked booleans and analytics counters
-- The later CREATE TABLE IF NOT EXISTS no-ops, so its indexes and its
-- toggle_like/toggle_harmony_save/toggle_bookmark functions then fail.
--
-- The app depends on BOTH: it reads interaction_type directly in several hooks
-- (useFeed, useAdmin, tasteDNA) and calls the toggle_* RPCs in useInteractions.
-- The RPCs use ON CONFLICT (user_id, track_id), which structurally requires the
-- one-row-per-track shape, so that is what we adopt.
--
-- NOTE: this is a behavioural narrowing, flagged in docs/DATABASE_SETUP.md.
-- A user can no longer hold separate rows per interaction_type; the booleans
-- carry that state instead. interaction_type is kept (nullable) so the existing
-- queries still resolve.
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- track_id must be TEXT: the toggle_* functions take p_track_id TEXT, and
-- provider-only tracks use keys like 'spotify:<id>' that are not UUIDs.
ALTER TABLE public.user_interactions
  DROP CONSTRAINT IF EXISTS user_interactions_track_id_fkey;
ALTER TABLE public.user_interactions
  ALTER COLUMN track_id TYPE TEXT USING track_id::text;

-- The toggle_* functions insert without it.
ALTER TABLE public.user_interactions ALTER COLUMN interaction_type DROP NOT NULL;

ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS liked BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS harmony_saved BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS bookmarked BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS liked_at TIMESTAMPTZ;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS harmony_saved_at TIMESTAMPTZ;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS bookmarked_at TIMESTAMPTZ;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS last_played_at TIMESTAMPTZ;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS total_listen_time_ms BIGINT DEFAULT 0;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS skip_count INTEGER DEFAULT 0;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Required target for ON CONFLICT (user_id, track_id) in the toggle_* functions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_interactions_user_track
  ON public.user_interactions(user_id, track_id);

-- ---------------------------------------------------------- track_comments
-- Two migrations define this table incompatibly:
--   20260117165737 -> track_id UUID, content NOT NULL, parent_id
--   20260122       -> track_id TEXT, comment,          reply_to, likes_count
-- The later one is CREATE TABLE IF NOT EXISTS, so it silently no-ops and its
-- own indexes/functions then fail on the columns it assumed.
--
-- The app is split across both shapes: TrackComments.tsx (the main comments UI)
-- writes `comment`/`reply_to`, while ScrollingComments.tsx reads `content`.
-- Reconciling to a superset keeps both working; dropping either column would
-- break one of them.
ALTER TABLE public.track_comments ALTER COLUMN track_id TYPE TEXT USING track_id::text;
ALTER TABLE public.track_comments ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE public.track_comments ADD COLUMN IF NOT EXISTS reply_to UUID
  REFERENCES public.track_comments(id) ON DELETE CASCADE;
ALTER TABLE public.track_comments ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0;
ALTER TABLE public.track_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE public.track_comments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- Neither text column can stay NOT NULL: each UI writes only one of them.
ALTER TABLE public.track_comments ALTER COLUMN content DROP NOT NULL;

-- Keep the two in step so a row written through either path reads back from
-- both. Without this, comments posted in TrackComments are invisible to
-- ScrollingComments and vice versa.
CREATE OR REPLACE FUNCTION public.sync_track_comment_text()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
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

DROP TRIGGER IF EXISTS track_comments_sync_text ON public.track_comments;
CREATE TRIGGER track_comments_sync_text
  BEFORE INSERT OR UPDATE ON public.track_comments
  FOR EACH ROW EXECUTE FUNCTION public.sync_track_comment_text();
