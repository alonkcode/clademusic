-- Like / Save / Harmonic (and any other write to public.user_interactions)
-- showed an error toast instead of saving. Two independent causes, both only
-- reachable once a signed-in user actually writes a row - the schema bundle
-- alone passes, which is why neither showed up before the feed buttons were
-- wired to the database.
--
-- 1. sync_interaction_to_playlist() copies user_interactions.track_id (TEXT)
--    straight into playlist_tracks.track_id. 11-hotfix-rls-recursion-and-fks
--    converted that column to UUID with an FK to tracks, so the INSERT fails
--    with:
--      column "track_id" is of type uuid but expression is of type text
--    The original trigger has no exception handler, so the failure rolls back
--    the like/bookmark/harmony toggle itself (Vibe and Share never hit it -
--    they don't flip liked/harmony_saved/bookmarked). The hardened version in
--    20260828140000 swallows the error, but still can never mirror anything:
--    the type mismatch fails at plan time for every track, so Liked Songs /
--    Bookmarked / Harmony Collection stay empty.
--
--    Rewritten to cast to UUID, and to mirror only ids that are real rows in
--    tracks. user_interactions.track_id is TEXT precisely because it also holds
--    provider-only ids ('lastfm:...', 'spotify:...') that have no tracks row and
--    can never be playlist members - those are skipped, not errors.
--
-- 2. 18-hotfix-missing-profile-fks added user_interactions.user_id -> profiles,
--    so a signed-in user with no profiles row (signup trigger swallowed its own
--    failure, or the account predates the hardening) is rejected on every
--    write with:
--      violates foreign key constraint "user_interactions_user_id_profiles_fkey"
--    Backfills any such user, same shape as the backfill in
--    06-harmonic-and-signup.sql.
--
-- Safe to re-run.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.

BEGIN;

INSERT INTO public.profiles (id, email, display_name)
SELECT
  u.id,
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

CREATE OR REPLACE FUNCTION public.sync_interaction_to_playlist()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_playlist_id UUID;
  v_max_position INTEGER;
  v_type TEXT;
  v_now BOOLEAN;
  v_before BOOLEAN;
  v_track_uuid UUID;
BEGIN
  IF NEW.track_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_track_uuid := NEW.track_id::uuid;
  END IF;

  IF v_track_uuid IS NULL OR NOT EXISTS (SELECT 1 FROM public.tracks WHERE id = v_track_uuid) THEN
    RETURN NEW;
  END IF;

  FOREACH v_type IN ARRAY ARRAY['liked','harmony','bookmarked'] LOOP
    BEGIN
      IF v_type = 'liked' THEN
        v_now := NEW.liked;           v_before := COALESCE(OLD.liked, FALSE);
      ELSIF v_type = 'harmony' THEN
        v_now := NEW.harmony_saved;   v_before := COALESCE(OLD.harmony_saved, FALSE);
      ELSE
        v_now := NEW.bookmarked;      v_before := COALESCE(OLD.bookmarked, FALSE);
      END IF;

      IF COALESCE(v_now, FALSE) AND NOT v_before THEN
        SELECT id INTO v_playlist_id
        FROM public.playlists
        WHERE user_id = NEW.user_id AND type = v_type
        LIMIT 1;

        IF v_playlist_id IS NOT NULL THEN
          SELECT COALESCE(MAX(position), 0) INTO v_max_position
          FROM public.playlist_tracks WHERE playlist_id = v_playlist_id;

          INSERT INTO public.playlist_tracks (playlist_id, track_id, position, added_by)
          VALUES (v_playlist_id, v_track_uuid, v_max_position + 1, NEW.user_id)
          ON CONFLICT (playlist_id, track_id) DO NOTHING;
        END IF;

      ELSIF NOT COALESCE(v_now, FALSE) AND v_before THEN
        SELECT id INTO v_playlist_id
        FROM public.playlists
        WHERE user_id = NEW.user_id AND type = v_type
        LIMIT 1;

        IF v_playlist_id IS NOT NULL THEN
          DELETE FROM public.playlist_tracks
          WHERE playlist_id = v_playlist_id AND track_id::text = v_track_uuid::text;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sync_interaction_to_playlist(%) failed for user % track %: %',
        v_type, NEW.user_id, NEW.track_id, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_interactions ON public.user_interactions;
CREATE TRIGGER trigger_sync_interactions
  AFTER INSERT OR UPDATE ON public.user_interactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_interaction_to_playlist();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify: expect 0 users missing a profile, and mirror_fix_installed = true.
SELECT
  (SELECT count(*) FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE p.id IS NULL) AS users_missing_profile,
  (SELECT prosrc LIKE '%v_track_uuid%' FROM pg_proc WHERE proname = 'sync_interaction_to_playlist') AS mirror_fix_installed;
