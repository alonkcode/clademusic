-- Harden the second signup trigger.
--
-- 20260828120000 hardened handle_new_user(), but there is a SECOND trigger on
-- auth.users: trigger_create_auto_playlists, from 20260122_unified_interactions.
-- It creates the "Liked Songs" / "Harmony Collection" / "Bookmarked" playlists
-- for a new user, and it has neither of the protections handle_new_user got:
--
--   1. It is not SECURITY DEFINER, so it runs as the signup role
--      (supabase_auth_admin), not as the table owner.
--   2. public.playlists has RLS with
--         playlists_insert ... WITH CHECK (auth.uid() = user_id)
--      and during signup there is no JWT, so auth.uid() is NULL. The check
--      fails and Postgres raises:
--         new row violates row-level security policy for table "playlists"
--   3. It has no exception handler, so that error propagates out of the
--      AFTER INSERT trigger and rolls back the auth.users insert. GoTrue then
--      returns the same opaque "Database error saving new user".
--
-- This is invisible when testing as a superuser or the table owner, because
-- both bypass RLS. It only appears on a real signup.
--
-- SECURITY DEFINER makes the function run as its owner (the role applying this
-- migration), which owns public.playlists and is therefore exempt from RLS on
-- it. The per-statement exception handling matches handle_new_user: creating
-- the account is the critical path, and provisioning convenience playlists must
-- never be able to block it.

CREATE OR REPLACE FUNCTION public.create_auto_playlists()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.playlists (user_id, name, description, type, is_public)
    VALUES
      (NEW.id, 'Liked Songs',        'All your liked tracks in one place',      'liked',      FALSE),
      (NEW.id, 'Harmony Collection', 'Tracks with saved chord progressions',    'harmony',    FALSE),
      (NEW.id, 'Bookmarked',         'Saved for later',                         'bookmarked', FALSE);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'create_auto_playlists: could not create playlists for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_auto_playlists ON auth.users;
CREATE TRIGGER trigger_create_auto_playlists
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_auto_playlists();

-- The same RLS trap applies to sync_interaction_to_playlist(): it writes to
-- playlist_tracks from a trigger on user_interactions. There the caller IS the
-- authenticated user, so auth.uid() is set and RLS passes for their own rows -
-- but a failure would still roll back the like/bookmark that triggered it.
-- Give it the same treatment so a playlist problem cannot break liking a track.
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
BEGIN
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
          VALUES (v_playlist_id, NEW.track_id, v_max_position + 1, NEW.user_id)
          ON CONFLICT (playlist_id, track_id) DO NOTHING;
        END IF;

      ELSIF NOT COALESCE(v_now, FALSE) AND v_before THEN
        SELECT id INTO v_playlist_id
        FROM public.playlists
        WHERE user_id = NEW.user_id AND type = v_type
        LIMIT 1;

        IF v_playlist_id IS NOT NULL THEN
          DELETE FROM public.playlist_tracks
          WHERE playlist_id = v_playlist_id AND track_id = NEW.track_id;
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
