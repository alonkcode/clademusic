-- Simulate per-user comments on tracks.
--
-- Companion to 23-simulate-listening-activity.sql (play_history) and
-- 26-simulate-user-interactions.sql (likes/harmonic/bookmarks/vibes): gives
-- each account its own random set of comments instead of the handful of
-- real ones that exist today, so track_comments looks like genuine,
-- individualized activity per clademusic account rather than one shared
-- default. Like the other two, this only ever keys off user_id
-- (profiles/auth.users) - nothing here reads user_providers/Spotify, so
-- multiple clademusic accounts sharing one connected Spotify login still
-- end up with entirely independent comment activity.
--
-- Candidate tracks are each user's own play_history when they have any
-- (same personalization anchor as 26), falling back to a random catalog
-- sample otherwise, so a user only ever comments on something plausibly
-- "theirs".
--
-- track_comments has two synced text columns (content/comment - see
-- bundle-fixes/00-compat-prelude.sql) kept in sync by a BEFORE trigger, so
-- this only needs to set `comment`; the trigger fills `content` to match.
--
-- Runs as postgres, so it bypasses track_comments' RLS
-- (`auth.uid() = user_id` on INSERT) the same way every other seed script
-- here does - the anon/publishable key can only ever insert a comment as
-- whichever user is currently authenticated through it.
--
-- Safe to re-run: each run adds a fresh independent batch of comments (no
-- uniqueness constraint on content), it never edits or removes existing
-- ones.
--
-- These aren't tagged with a source column (track_comments has none), so
-- there's no scripted one-line undo. They're identifiable after the fact
-- by created_at falling in this run's timestamp and by coming from the
-- canned v_templates pool below - to remove a specific run, filter on
-- created_at and match against that text.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Tune v_user_limit / v_comments_min / v_comments_max below first.

BEGIN;

DO $$
DECLARE
  v_user_limit     INTEGER := 50;  -- cap how many profiles get simulated comments; NULL = every profile
  v_comments_min   INTEGER := 0;
  v_comments_max   INTEGER := 4;
  v_templates      TEXT[] := ARRAY[
    'this one lives in my head rent free',
    'the chord change here gets me every time',
    'been on repeat all week',
    'underrated track, more people need to hear this',
    'this is exactly my kind of harmony',
    'love how this one builds',
    'the bridge on this is criminally good',
    'instant mood lift every time',
    'this progression is so satisfying',
    'can''t stop coming back to this one',
    'this fits my vibe perfectly right now',
    'the production on this is so clean'
  ];

  v_user           RECORD;
  v_pool           TEXT[];
  v_pool_size      INTEGER;
  v_n              INTEGER;
  v_track_id       TEXT;
  v_text           TEXT;
  i                INTEGER;
  v_inserted       INTEGER := 0;
BEGIN
  FOR v_user IN
    SELECT id FROM public.profiles
    ORDER BY random()
    LIMIT COALESCE(v_user_limit, 2147483647)
  LOOP
    SELECT array_agg(DISTINCT track_id::text) INTO v_pool
    FROM public.play_history
    WHERE user_id = v_user.id;

    IF v_pool IS NULL OR array_length(v_pool, 1) IS NULL THEN
      SELECT array_agg(id::text) INTO v_pool
      FROM (SELECT id FROM public.tracks ORDER BY random() LIMIT 40) t;
    END IF;

    v_pool_size := COALESCE(array_length(v_pool, 1), 0);
    IF v_pool_size = 0 THEN
      CONTINUE;
    END IF;

    v_n := LEAST(v_pool_size, v_comments_min + floor(random() * (v_comments_max - v_comments_min + 1))::int);

    FOR i IN 1..v_n LOOP
      v_track_id := v_pool[1 + floor(random() * v_pool_size)::int];
      v_text := v_templates[1 + floor(random() * array_length(v_templates, 1))::int];

      INSERT INTO public.track_comments (track_id, user_id, comment, created_at, updated_at)
      VALUES (
        v_track_id,
        v_user.id,
        v_text,
        now() - (random() * 45 || ' days')::interval,
        now() - (random() * 45 || ' days')::interval
      );
      v_inserted := v_inserted + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Inserted % simulated track_comments row(s)', v_inserted;
END $$;

COMMIT;
