-- toggle_like / toggle_harmony_save / toggle_bookmark all write to
-- user_interactions, which fires trigger_sync_interactions
-- (sync_interaction_to_playlist) AFTER INSERT OR UPDATE to mirror the change
-- into the user's auto-generated Liked Songs / Harmony Collection / Bookmarked
-- playlists. toggle_vibe never touches this trigger's active branches at all
-- (vibed isn't one of the three columns it looks at) - it's the one toggle
-- that never exercises this code path.
--
-- Users report Like/Save/Harmonic failing ("Failed to update ... status")
-- while Vibe (added today, same RPC shape, same RLS shape on
-- user_interactions itself) works. That split points at this trigger: any
-- failure inside it - a missing auto-playlist for an account created before
-- the auto-playlist trigger existed, a stale duplicate playlist, a
-- position collision on playlist_tracks (UNIQUE(playlist_id, position),
-- which the existing `ON CONFLICT (playlist_id, track_id)` clause does not
-- cover) - currently propagates up through the AFTER trigger and aborts the
-- entire statement, including the user_interactions write that toggle_like
-- itself is trying to make.
--
-- A denormalized mirror should never be able to veto the write it's
-- mirroring. Wrap the body in EXCEPTION WHEN OTHERS so any failure here is
-- logged and swallowed instead of rolling back the caller's toggle.

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
