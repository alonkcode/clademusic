-- Copy of supabase/migrations/20260921210000_make_playlist_sync_nonfatal.sql
-- for pasting into the Supabase SQL Editor. See that file for the full
-- explanation of why this is needed.

CREATE OR REPLACE FUNCTION public.sync_interaction_to_playlist()
RETURNS TRIGGER AS $$
DECLARE
  v_playlist_id UUID;
  v_max_position INTEGER;
BEGIN
  -- Handle LIKED tracks
  IF NEW.liked = TRUE AND (OLD.liked IS NULL OR OLD.liked = FALSE) THEN
    SELECT id INTO v_playlist_id
    FROM playlists
    WHERE user_id = NEW.user_id AND type = 'liked'
    LIMIT 1;

    IF v_playlist_id IS NOT NULL THEN
      SELECT COALESCE(MAX(position), 0) INTO v_max_position
      FROM playlist_tracks
      WHERE playlist_id = v_playlist_id;

      INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by)
      VALUES (v_playlist_id, NEW.track_id, v_max_position + 1, NEW.user_id)
      ON CONFLICT (playlist_id, track_id) DO NOTHING;
    END IF;
  ELSIF NEW.liked = FALSE AND OLD.liked = TRUE THEN
    SELECT id INTO v_playlist_id
    FROM playlists
    WHERE user_id = NEW.user_id AND type = 'liked'
    LIMIT 1;

    DELETE FROM playlist_tracks
    WHERE playlist_id = v_playlist_id AND track_id = NEW.track_id;
  END IF;

  -- Handle HARMONY_SAVED tracks
  IF NEW.harmony_saved = TRUE AND (OLD.harmony_saved IS NULL OR OLD.harmony_saved = FALSE) THEN
    SELECT id INTO v_playlist_id
    FROM playlists
    WHERE user_id = NEW.user_id AND type = 'harmony'
    LIMIT 1;

    IF v_playlist_id IS NOT NULL THEN
      SELECT COALESCE(MAX(position), 0) INTO v_max_position
      FROM playlist_tracks
      WHERE playlist_id = v_playlist_id;

      INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by)
      VALUES (v_playlist_id, NEW.track_id, v_max_position + 1, NEW.user_id)
      ON CONFLICT (playlist_id, track_id) DO NOTHING;
    END IF;
  ELSIF NEW.harmony_saved = FALSE AND OLD.harmony_saved = TRUE THEN
    SELECT id INTO v_playlist_id
    FROM playlists
    WHERE user_id = NEW.user_id AND type = 'harmony'
    LIMIT 1;

    DELETE FROM playlist_tracks
    WHERE playlist_id = v_playlist_id AND track_id = NEW.track_id;
  END IF;

  -- Handle BOOKMARKED tracks
  IF NEW.bookmarked = TRUE AND (OLD.bookmarked IS NULL OR OLD.bookmarked = FALSE) THEN
    SELECT id INTO v_playlist_id
    FROM playlists
    WHERE user_id = NEW.user_id AND type = 'bookmarked'
    LIMIT 1;

    IF v_playlist_id IS NOT NULL THEN
      SELECT COALESCE(MAX(position), 0) INTO v_max_position
      FROM playlist_tracks
      WHERE playlist_id = v_playlist_id;

      INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by)
      VALUES (v_playlist_id, NEW.track_id, v_max_position + 1, NEW.user_id)
      ON CONFLICT (playlist_id, track_id) DO NOTHING;
    END IF;
  ELSIF NEW.bookmarked = FALSE AND OLD.bookmarked = TRUE THEN
    SELECT id INTO v_playlist_id
    FROM playlists
    WHERE user_id = NEW.user_id AND type = 'bookmarked'
    LIMIT 1;

    DELETE FROM playlist_tracks
    WHERE playlist_id = v_playlist_id AND track_id = NEW.track_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_interaction_to_playlist failed for user %, track %: %', NEW.user_id, NEW.track_id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.sync_interaction_to_playlist IS
'Best-effort mirror of user_interactions into the auto-generated Liked/Harmony/Bookmarked playlists. Never allowed to fail the interaction toggle itself - errors are caught and logged as warnings.';

NOTIFY pgrst, 'reload schema';
