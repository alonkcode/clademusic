-- Reconcile the two playlist definitions.
--
--   20260122_playlists.sql          -> playlists(cover_url, cover_color, ...)
--                                      playlist_tracks(track_id UUID -> tracks)
--   20260122_unified_interactions   -> playlists(type, smart_criteria, ...)
--                                      playlist_tracks(track_id TEXT)
--
-- The second runs CREATE TABLE IF NOT EXISTS, so it no-ops against the tables
-- the first already made, and its indexes/triggers then reference columns that
-- were never added ("ERROR: column type does not exist").
--
-- Added here as a superset so both migrations, and the auto-playlist trigger
-- that depends on playlists.type, work.

-- ----------------------------------------------------------------- playlists
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'custom';
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS smart_criteria JSONB;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS track_count INTEGER DEFAULT 0;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS total_duration_ms BIGINT DEFAULT 0;
ALTER TABLE public.playlists ADD COLUMN IF NOT EXISTS follower_count INTEGER DEFAULT 0;

-- Mirrors the CHECK the later migration declares inline.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'playlists_type_check'
  ) THEN
    ALTER TABLE public.playlists ADD CONSTRAINT playlists_type_check
      CHECK (type IN ('custom','smart','liked','harmony','bookmarked'));
  END IF;
END $$;

-- ----------------------------------------------------------- playlist_tracks
-- TEXT for the same reason as user_interactions.track_id: provider-only tracks
-- are keyed 'spotify:<id>' / 'youtube:<id>' and are not UUIDs, and the
-- auto-playlist sync trigger copies user_interactions.track_id straight across.
ALTER TABLE public.playlist_tracks
  DROP CONSTRAINT IF EXISTS playlist_tracks_track_id_fkey;
ALTER TABLE public.playlist_tracks
  ALTER COLUMN track_id TYPE TEXT USING track_id::text;
