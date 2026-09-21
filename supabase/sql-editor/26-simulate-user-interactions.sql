-- Simulate per-user Likes / Harmonic saves / Bookmarks / Vibes.
--
-- Right now user_interactions is empty (or nearly empty) for most accounts,
-- so every profile looks identical - the same "0 liked songs" or whatever
-- flat default a UI falls back to when there's no real data. This gives
-- each account its OWN random set of interactions, sized and chosen
-- independently per user, so counts genuinely differ from one account to
-- the next instead of everyone showing the same number.
--
-- Personalization is anchored to the clademusic account, not to Spotify:
-- this only ever writes user_id (a profiles/auth.users id). Nothing here
-- reads from user_providers/Spotify at all, so even multiple clademusic
-- accounts that happen to share one connected Spotify login end up with
-- completely independent liked/saved/harmonic sets - Spotify is where the
-- audio streams from, it has no bearing on what this app records as *this
-- account's* taste.
--
-- For personalization that actually hangs together as one story, each
-- user's candidate track pool is their own play_history (from
-- 23-simulate-listening-activity.sql - run that first, or in the same
-- session) when they have any: liking/saving something you have a play row
-- for reads as normal. Falls back to a random catalog sample for anyone
-- with no play_history yet.
--
-- toggle_like/toggle_harmony_save/toggle_bookmark's own RPCs aren't used
-- here (they require an authenticated session and only ever touch one row
-- at a time); this inserts directly the same way those RPCs would end up
-- writing, running as postgres so it bypasses user_interactions' RLS
-- (`auth.uid() = user_id`) the same way every other seed script here does.
-- The AFTER trigger that mirrors liked/harmony_saved/bookmarked into the
-- auto-generated playlists (sync_interaction_to_playlist,
-- 20260921210000_make_playlist_sync_nonfatal.sql) fires normally, so this
-- also populates each user's Liked Songs / Harmony Collection / Bookmarked
-- playlists for free.
--
-- Safe to re-run: ON CONFLICT (user_id, track_id) DO UPDATE only ever turns
-- flags further on (GREATEST/OR against the existing value) or refreshes
-- their timestamp - it never un-likes anything a previous run set.
--
-- There's no source/is_seed column on user_interactions to tag these rows
-- (unlike play_history's `source = 'demo-sim'`), so there is no scripted
-- one-line undo. To remove everything this ever touched for the accounts it
-- ran against, you'd need to reset those specific (user_id, track_id) rows
-- by hand.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Tune v_user_limit / the *_min/*_max ranges below first.

BEGIN;

DO $$
DECLARE
  v_user_limit       INTEGER := 50;  -- cap how many profiles get simulated interactions; NULL = every profile
  v_liked_min        INTEGER := 2;
  v_liked_max        INTEGER := 15;
  v_harmony_min      INTEGER := 0;
  v_harmony_max      INTEGER := 6;
  v_bookmark_min     INTEGER := 0;
  v_bookmark_max     INTEGER := 8;
  v_vibe_min         INTEGER := 0;
  v_vibe_max         INTEGER := 10;
  v_share_chance     NUMERIC := 0.3; -- fraction of users who also get a random share_count bump

  v_user             RECORD;
  v_pool             TEXT[]; -- user_interactions.track_id is TEXT (tracks.id/play_history.track_id are UUID), so the pool is cast to text once here
  v_pool_size        INTEGER;
  v_n                INTEGER;
  v_track_id         TEXT;
  i                  INTEGER;
  v_users_touched    INTEGER := 0;
  v_rows_touched     INTEGER := 0;
BEGIN
  FOR v_user IN
    SELECT id FROM public.profiles
    ORDER BY random()
    LIMIT COALESCE(v_user_limit, 2147483647)
  LOOP
    -- Prefer this user's own play_history as the candidate pool (ties likes
    -- back to what they've actually "listened to"); fall back to a random
    -- catalog sample so accounts with no play_history yet still get data.
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

    -- Liked
    v_n := LEAST(v_pool_size, v_liked_min + floor(random() * (v_liked_max - v_liked_min + 1))::int);
    FOR i IN 1..v_n LOOP
      v_track_id := v_pool[1 + floor(random() * v_pool_size)::int];
      INSERT INTO public.user_interactions (user_id, track_id, liked, liked_at)
      VALUES (v_user.id, v_track_id, TRUE, now() - (random() * 30 || ' days')::interval)
      ON CONFLICT (user_id, track_id) DO UPDATE
        SET liked = TRUE,
            liked_at = COALESCE(public.user_interactions.liked_at, EXCLUDED.liked_at);
      v_rows_touched := v_rows_touched + 1;
    END LOOP;

    -- Harmony saved
    v_n := LEAST(v_pool_size, v_harmony_min + floor(random() * (v_harmony_max - v_harmony_min + 1))::int);
    FOR i IN 1..v_n LOOP
      v_track_id := v_pool[1 + floor(random() * v_pool_size)::int];
      INSERT INTO public.user_interactions (user_id, track_id, harmony_saved, harmony_saved_at)
      VALUES (v_user.id, v_track_id, TRUE, now() - (random() * 30 || ' days')::interval)
      ON CONFLICT (user_id, track_id) DO UPDATE
        SET harmony_saved = TRUE,
            harmony_saved_at = COALESCE(public.user_interactions.harmony_saved_at, EXCLUDED.harmony_saved_at);
      v_rows_touched := v_rows_touched + 1;
    END LOOP;

    -- Bookmarked
    v_n := LEAST(v_pool_size, v_bookmark_min + floor(random() * (v_bookmark_max - v_bookmark_min + 1))::int);
    FOR i IN 1..v_n LOOP
      v_track_id := v_pool[1 + floor(random() * v_pool_size)::int];
      INSERT INTO public.user_interactions (user_id, track_id, bookmarked, bookmarked_at)
      VALUES (v_user.id, v_track_id, TRUE, now() - (random() * 30 || ' days')::interval)
      ON CONFLICT (user_id, track_id) DO UPDATE
        SET bookmarked = TRUE,
            bookmarked_at = COALESCE(public.user_interactions.bookmarked_at, EXCLUDED.bookmarked_at);
      v_rows_touched := v_rows_touched + 1;
    END LOOP;

    -- Vibed
    v_n := LEAST(v_pool_size, v_vibe_min + floor(random() * (v_vibe_max - v_vibe_min + 1))::int);
    FOR i IN 1..v_n LOOP
      v_track_id := v_pool[1 + floor(random() * v_pool_size)::int];
      INSERT INTO public.user_interactions (user_id, track_id, vibed, vibed_at)
      VALUES (v_user.id, v_track_id, TRUE, now() - (random() * 30 || ' days')::interval)
      ON CONFLICT (user_id, track_id) DO UPDATE
        SET vibed = TRUE,
            vibed_at = COALESCE(public.user_interactions.vibed_at, EXCLUDED.vibed_at);
      v_rows_touched := v_rows_touched + 1;
    END LOOP;

    -- Occasional share bump on one already-touched track
    IF random() < v_share_chance THEN
      v_track_id := v_pool[1 + floor(random() * v_pool_size)::int];
      INSERT INTO public.user_interactions (user_id, track_id, share_count, last_shared_at)
      VALUES (v_user.id, v_track_id, 1 + floor(random() * 3)::int, now() - (random() * 30 || ' days')::interval)
      ON CONFLICT (user_id, track_id) DO UPDATE
        SET share_count = public.user_interactions.share_count + EXCLUDED.share_count,
            last_shared_at = EXCLUDED.last_shared_at;
    END IF;

    v_users_touched := v_users_touched + 1;
  END LOOP;

  RAISE NOTICE 'Touched % user_interactions row(s) across % user(s)', v_rows_touched, v_users_touched;
END $$;

COMMIT;
