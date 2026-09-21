-- Simulate realistic listening activity for existing users.
--
-- Right now play_history is empty for everyone, so the Admin Dashboard's
-- "Active (7d)" stat and total-plays count (useAdminStats in
-- src/hooks/api/useAdmin.ts) read as zero, and any user's Taste DNA
-- (computeTasteDNA in src/api/tasteDNA.ts, which derives mode/energy/cadence
-- preference from play_history) has nothing to compute from. This backfills
-- plays so both have real rows to work with.
--
-- Each user is given a private "taste" for this run only - a preferred mode
-- (major/minor) and an energy level (0=chill..1=energetic), picked once per
-- user. Their plays are weighted toward tracks matching it, blended with
-- enough random noise that it's never a strict ranking - some exploration
-- outside their usual taste gets through too, same as a real listener. The
-- taste itself is never stored anywhere; it only shows up as a pattern in
-- which tracks that user ends up with in play_history, exactly like a real
-- listening history would look to computeTasteDNA.
--
-- Runs as postgres in the SQL Editor, same reasoning as
-- 20-seed-fake-users.sql: play_history's insert policy is
-- `auth.uid() = user_id` (supabase/sql-editor/02-security-and-sections.sql),
-- so the anon/publishable key this project's .env has can only ever insert
-- a row for the currently-authenticated user, never backfill history for
-- other accounts - and there is no SUPABASE_SERVICE_ROLE_KEY locally to
-- bypass that from a script either. Running here as postgres bypasses RLS
-- entirely, same as every other seed script in this directory.
--
-- Safe to re-run: it only adds new rows (played_at is randomized fresh each
-- time), it never touches or duplicates-away existing ones.
--
-- To remove everything this script ever inserted:
--   DELETE FROM public.play_history WHERE source = 'demo-sim';
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Tune v_user_limit / v_days_back / v_min_plays / v_max_plays below first -
-- defaults are a small batch (<= 50 users, 5-25 plays each).

BEGIN;

DO $$
DECLARE
  v_user_limit   INTEGER := 50;   -- cap how many profiles get simulated plays; NULL = every profile
  v_days_back    INTEGER := 14;   -- spread plays over the last N days
  v_min_plays    INTEGER := 5;    -- plays per user, lower bound
  v_max_plays    INTEGER := 25;   -- plays per user, upper bound
  v_user         RECORD;
  v_track        RECORD;
  v_mode_bias    TEXT;     -- this user's leaning: 'major' or 'minor'
  v_energy_bias  NUMERIC;  -- this user's leaning: 0 (chill) .. 1 (energetic)
  v_play_count   INTEGER;
  v_inserted     INTEGER := 0;
  i              INTEGER;
BEGIN
  FOR v_user IN
    SELECT id FROM public.profiles
    ORDER BY random()
    LIMIT COALESCE(v_user_limit, 2147483647)
  LOOP
    v_mode_bias   := (ARRAY['major', 'minor'])[(1 + floor(random() * 2))::int];
    v_energy_bias := random();
    v_play_count  := v_min_plays + floor(random() * (v_max_plays - v_min_plays + 1));

    FOR i IN 1..v_play_count LOOP
      -- Weighted pick: tracks matching this user's mode/energy sort first,
      -- but the random() term means it's never a strict ranking.
      SELECT id, duration_ms INTO v_track
      FROM public.tracks
      ORDER BY
        (CASE WHEN detected_mode = v_mode_bias THEN 0 ELSE 0.4 END)
        + abs(COALESCE(energy, 0.5) - v_energy_bias)
        + random() * 0.6
      LIMIT 1;

      INSERT INTO public.play_history (user_id, track_id, played_at, duration_ms, source)
      VALUES (
        v_user.id,
        v_track.id,
        now() - (random() * v_days_back || ' days')::interval,
        floor(COALESCE(v_track.duration_ms, 200000) * (0.3 + random() * 0.7)),
        'demo-sim'
      );
      v_inserted := v_inserted + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Inserted % simulated play_history rows', v_inserted;
END $$;

COMMIT;

-- Best-effort refresh of the Popular Tracks aggregate (05-performance.sql),
-- guarded so this script doesn't fail on a project where that view was
-- never created.
DO $$
BEGIN
  IF to_regproc('public.refresh_track_stats') IS NOT NULL THEN
    PERFORM public.refresh_track_stats();
  END IF;
END $$;
