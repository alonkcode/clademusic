-- GENERATED - slice of supabase/schema_bundle.sql. Do not edit.
-- PART 4/6: playlists-and-billing
-- Run parts 01..06 IN ORDER in the Supabase SQL Editor.

BEGIN;

-- ============================================================
-- 20260122_playlists.sql

-- ============================================================
-- Playlist System
-- Created: 2026-01-22
-- Purpose: User-created playlists with collaborative features

-- Create playlists table
CREATE TABLE IF NOT EXISTS public.playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  is_public boolean DEFAULT true,
  is_collaborative boolean DEFAULT false,
  cover_url text,
  cover_color text, -- Hex color for auto-generated covers
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_played_at timestamptz,
  play_count integer DEFAULT 0,
  CONSTRAINT name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 100)
);

-- Create playlist_tracks table (join table)
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid REFERENCES public.playlists(id) ON DELETE CASCADE NOT NULL,
  track_id uuid REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(playlist_id, track_id)
);

-- Create playlist_collaborators table
CREATE TABLE IF NOT EXISTS public.playlist_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid REFERENCES public.playlists(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  can_edit boolean DEFAULT true,
  can_add_tracks boolean DEFAULT true,
  can_remove_tracks boolean DEFAULT true,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(playlist_id, user_id)
);

-- Create playlist_folders table
CREATE TABLE IF NOT EXISTS public.playlist_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  parent_folder_id uuid REFERENCES public.playlist_folders(id) ON DELETE CASCADE,
  position integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create playlist_folder_items table
CREATE TABLE IF NOT EXISTS public.playlist_folder_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid REFERENCES public.playlist_folders(id) ON DELETE CASCADE NOT NULL,
  playlist_id uuid REFERENCES public.playlists(id) ON DELETE CASCADE NOT NULL,
  position integer DEFAULT 0,
  UNIQUE(folder_id, playlist_id)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_playlists_user ON public.playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_playlists_public ON public.playlists(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_playlists_collaborative ON public.playlists(is_collaborative) WHERE is_collaborative = true;
CREATE INDEX IF NOT EXISTS idx_playlists_updated ON public.playlists(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON public.playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON public.playlist_tracks(track_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position ON public.playlist_tracks(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_added_by ON public.playlist_tracks(added_by);

CREATE INDEX IF NOT EXISTS idx_playlist_collaborators_playlist ON public.playlist_collaborators(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_collaborators_user ON public.playlist_collaborators(user_id);

CREATE INDEX IF NOT EXISTS idx_playlist_folders_user ON public.playlist_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_playlist_folders_parent ON public.playlist_folders(parent_folder_id);

-- RLS Policies
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_folder_items ENABLE ROW LEVEL SECURITY;

-- Playlists: Users can view their own and public playlists
CREATE POLICY "Users can view own playlists" ON public.playlists
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Public playlists viewable" ON public.playlists
FOR SELECT USING (is_public = true);

CREATE POLICY "Collaborators can view playlists" ON public.playlists
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.playlist_collaborators
    WHERE playlist_id = playlists.id AND user_id = auth.uid()
  )
);

-- Playlists: Users can manage own playlists
CREATE POLICY "Users can insert own playlists" ON public.playlists
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own playlists" ON public.playlists
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own playlists" ON public.playlists
FOR DELETE USING (auth.uid() = user_id);

-- Playlist tracks: View based on playlist access
CREATE POLICY "Users can view playlist tracks" ON public.playlist_tracks
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.playlists
    WHERE id = playlist_tracks.playlist_id
    AND (user_id = auth.uid() OR is_public = true OR is_collaborative = true)
  )
);

-- Playlist tracks: Add/remove based on permissions
CREATE POLICY "Owners can manage playlist tracks" ON public.playlist_tracks
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.playlists
    WHERE id = playlist_tracks.playlist_id AND user_id = auth.uid()
  )
);

CREATE POLICY "Collaborators can add tracks" ON public.playlist_tracks
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.playlist_collaborators
    WHERE playlist_id = playlist_tracks.playlist_id 
    AND user_id = auth.uid() 
    AND can_add_tracks = true
  )
);

CREATE POLICY "Collaborators can remove tracks" ON public.playlist_tracks
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.playlist_collaborators
    WHERE playlist_id = playlist_tracks.playlist_id 
    AND user_id = auth.uid() 
    AND can_remove_tracks = true
  )
);

-- Playlist collaborators: View own collaborations
CREATE POLICY "Users can view collaborators" ON public.playlist_collaborators
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.playlists
    WHERE id = playlist_collaborators.playlist_id 
    AND (user_id = auth.uid() OR is_public = true)
  )
);

-- Playlist collaborators: Owners can manage
CREATE POLICY "Owners can manage collaborators" ON public.playlist_collaborators
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.playlists
    WHERE id = playlist_collaborators.playlist_id AND user_id = auth.uid()
  )
);

-- Playlist folders: Users manage their own
CREATE POLICY "Users can manage own folders" ON public.playlist_folders
FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage folder items" ON public.playlist_folder_items
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.playlist_folders
    WHERE id = playlist_folder_items.folder_id AND user_id = auth.uid()
  )
);

-- Update timestamp function
CREATE OR REPLACE FUNCTION public.update_playlist_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER playlists_updated_at
  BEFORE UPDATE ON public.playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.update_playlist_timestamp();

-- Function to reorder playlist tracks
CREATE OR REPLACE FUNCTION public.reorder_playlist_tracks(
  p_playlist_id uuid,
  p_track_ids uuid[]
)
RETURNS void AS $$
DECLARE
  track_id uuid;
  idx integer := 0;
BEGIN
  -- Check if user has permission
  IF NOT EXISTS (
    SELECT 1 FROM public.playlists
    WHERE id = p_playlist_id AND user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.playlist_collaborators
    WHERE playlist_id = p_playlist_id AND user_id = auth.uid() AND can_edit = true
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Update positions
  FOREACH track_id IN ARRAY p_track_ids
  LOOP
    UPDATE public.playlist_tracks
    SET position = idx
    WHERE playlist_id = p_playlist_id AND track_id = track_id;
    idx := idx + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.reorder_playlist_tracks(uuid, uuid[]) TO authenticated;

-- Function to add tracks to playlist (with auto position)
CREATE OR REPLACE FUNCTION public.add_track_to_playlist(
  p_playlist_id uuid,
  p_track_id uuid
)
RETURNS uuid AS $$
DECLARE
  max_position integer;
  new_id uuid;
BEGIN
  -- Get current max position
  SELECT COALESCE(MAX(position), -1) INTO max_position
  FROM public.playlist_tracks
  WHERE playlist_id = p_playlist_id;

  -- Insert with next position
  INSERT INTO public.playlist_tracks (playlist_id, track_id, added_by, position)
  VALUES (p_playlist_id, p_track_id, auth.uid(), max_position + 1)
  ON CONFLICT (playlist_id, track_id) DO NOTHING
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.add_track_to_playlist(uuid, uuid) TO authenticated;

COMMENT ON TABLE public.playlists IS 'User-created playlists';
COMMENT ON TABLE public.playlist_tracks IS 'Tracks within playlists';
COMMENT ON TABLE public.playlist_collaborators IS 'Collaborative playlist permissions';
COMMENT ON TABLE public.playlist_folders IS 'Playlist organization folders';



-- ============================================================
-- bundle-fixes/05-playlists-compat.sql

-- ============================================================
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



-- ============================================================
-- 20260122_unified_interactions.sql

-- ============================================================
-- Unified User Interactions System
-- Links likes, harmonies, saves, playlists, and collections together


-- ============================================================================
-- 1. UNIFIED USER_INTERACTIONS TABLE

-- ============================================================================

CREATE TABLE IF NOT EXISTS user_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  
  -- Interaction types (can have multiple per track)
  liked BOOLEAN DEFAULT FALSE,
  harmony_saved BOOLEAN DEFAULT FALSE,
  bookmarked BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  liked_at TIMESTAMPTZ,
  harmony_saved_at TIMESTAMPTZ,
  bookmarked_at TIMESTAMPTZ,
  play_count INTEGER DEFAULT 0,
  last_played_at TIMESTAMPTZ,
  
  -- Analytics
  total_listen_time_ms BIGINT DEFAULT 0,
  skip_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_user_interactions_user ON user_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_track ON user_interactions(track_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_liked ON user_interactions(user_id) WHERE liked = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_interactions_harmony ON user_interactions(user_id) WHERE harmony_saved = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_interactions_bookmarked ON user_interactions(user_id) WHERE bookmarked = TRUE;


-- ============================================================================
-- 2. PLAYLISTS SYSTEM (DRY with user_interactions)

-- ============================================================================

CREATE TABLE IF NOT EXISTS playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 100),
  description TEXT,
  cover_image_url TEXT,
  
  -- Playlist type
  type TEXT DEFAULT 'custom' CHECK (type IN ('custom', 'smart', 'liked', 'harmony', 'bookmarked')),
  
  -- Smart playlist criteria (JSONB for flexibility)
  smart_criteria JSONB,
  
  -- Visibility
  is_public BOOLEAN DEFAULT TRUE,
  is_collaborative BOOLEAN DEFAULT FALSE,
  
  -- Stats
  track_count INTEGER DEFAULT 0,
  total_duration_ms BIGINT DEFAULT 0,
  follower_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_playlists_type ON playlists(type);
CREATE INDEX IF NOT EXISTS idx_playlists_public ON playlists(is_public) WHERE is_public = TRUE;

-- Playlist tracks (many-to-many with ordering)
CREATE TABLE IF NOT EXISTS playlist_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(playlist_id, track_id),
  UNIQUE(playlist_id, position)
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id);

-- Playlist followers
CREATE TABLE IF NOT EXISTS playlist_followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followed_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(playlist_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_followers_user ON playlist_followers(user_id);
CREATE INDEX IF NOT EXISTS idx_playlist_followers_playlist ON playlist_followers(playlist_id);


-- ============================================================================
-- 3. AUTO-GENERATED PLAYLISTS (Liked Songs, Harmonies, Bookmarks)

-- ============================================================================

-- Create auto-playlists for existing users
CREATE OR REPLACE FUNCTION create_auto_playlists()
RETURNS TRIGGER AS $$
BEGIN
  -- Liked Songs playlist
  INSERT INTO playlists (user_id, name, description, type, is_public)
  VALUES (
    NEW.id,
    'Liked Songs',
    'All your liked tracks in one place',
    'liked',
    FALSE
  );
  
  -- Harmony Saves playlist
  INSERT INTO playlists (user_id, name, description, type, is_public)
  VALUES (
    NEW.id,
    'Harmony Collection',
    'Tracks with saved chord progressions',
    'harmony',
    FALSE
  );
  
  -- Bookmarks playlist
  INSERT INTO playlists (user_id, name, description, type, is_public)
  VALUES (
    NEW.id,
    'Bookmarked',
    'Saved for later',
    'bookmarked',
    FALSE
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_create_auto_playlists
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION create_auto_playlists();


-- ============================================================================
-- 4. SYNC USER_INTERACTIONS TO PLAYLISTS

-- ============================================================================

CREATE OR REPLACE FUNCTION sync_interaction_to_playlist()
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
    WHERE user_id = NEW.user_id AND type = 'liked';
    
    DELETE FROM playlist_tracks 
    WHERE playlist_id = v_playlist_id AND track_id = NEW.track_id;
  END IF;
  
  -- Handle HARMONY_SAVED tracks
  IF NEW.harmony_saved = TRUE AND (OLD.harmony_saved IS NULL OR OLD.harmony_saved = FALSE) THEN
    SELECT id INTO v_playlist_id 
    FROM playlists 
    WHERE user_id = NEW.user_id AND type = 'harmony';
    
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
    WHERE user_id = NEW.user_id AND type = 'harmony';
    
    DELETE FROM playlist_tracks 
    WHERE playlist_id = v_playlist_id AND track_id = NEW.track_id;
  END IF;
  
  -- Handle BOOKMARKED tracks
  IF NEW.bookmarked = TRUE AND (OLD.bookmarked IS NULL OR OLD.bookmarked = FALSE) THEN
    SELECT id INTO v_playlist_id 
    FROM playlists 
    WHERE user_id = NEW.user_id AND type = 'bookmarked';
    
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
    WHERE user_id = NEW.user_id AND type = 'bookmarked';
    
    DELETE FROM playlist_tracks 
    WHERE playlist_id = v_playlist_id AND track_id = NEW.track_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_sync_interactions
AFTER INSERT OR UPDATE ON user_interactions
FOR EACH ROW EXECUTE FUNCTION sync_interaction_to_playlist();


-- ============================================================================
-- 5. DRY HELPER FUNCTIONS

-- ============================================================================

-- Toggle like (reusable)
CREATE OR REPLACE FUNCTION toggle_like(
  p_user_id UUID,
  p_track_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_liked BOOLEAN;
BEGIN
  INSERT INTO user_interactions (user_id, track_id, liked, liked_at)
  VALUES (p_user_id, p_track_id, TRUE, NOW())
  ON CONFLICT (user_id, track_id)
  DO UPDATE SET 
    liked = NOT user_interactions.liked,
    liked_at = CASE 
      WHEN NOT user_interactions.liked THEN NOW() 
      ELSE NULL 
    END;
  
  SELECT liked INTO v_is_liked 
  FROM user_interactions 
  WHERE user_id = p_user_id AND track_id = p_track_id;
  
  RETURN v_is_liked;
END;
$$ LANGUAGE plpgsql;

-- Toggle harmony save (reusable)
CREATE OR REPLACE FUNCTION toggle_harmony_save(
  p_user_id UUID,
  p_track_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_saved BOOLEAN;
BEGIN
  INSERT INTO user_interactions (user_id, track_id, harmony_saved, harmony_saved_at)
  VALUES (p_user_id, p_track_id, TRUE, NOW())
  ON CONFLICT (user_id, track_id)
  DO UPDATE SET 
    harmony_saved = NOT user_interactions.harmony_saved,
    harmony_saved_at = CASE 
      WHEN NOT user_interactions.harmony_saved THEN NOW() 
      ELSE NULL 
    END;
  
  SELECT harmony_saved INTO v_is_saved 
  FROM user_interactions 
  WHERE user_id = p_user_id AND track_id = p_track_id;
  
  RETURN v_is_saved;
END;
$$ LANGUAGE plpgsql;

-- Toggle bookmark (reusable)
CREATE OR REPLACE FUNCTION toggle_bookmark(
  p_user_id UUID,
  p_track_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_bookmarked BOOLEAN;
BEGIN
  INSERT INTO user_interactions (user_id, track_id, bookmarked, bookmarked_at)
  VALUES (p_user_id, p_track_id, TRUE, NOW())
  ON CONFLICT (user_id, track_id)
  DO UPDATE SET 
    bookmarked = NOT user_interactions.bookmarked,
    bookmarked_at = CASE 
      WHEN NOT user_interactions.bookmarked THEN NOW() 
      ELSE NULL 
    END;
  
  SELECT bookmarked INTO v_is_bookmarked 
  FROM user_interactions 
  WHERE user_id = p_user_id AND track_id = p_track_id;
  
  RETURN v_is_bookmarked;
END;
$$ LANGUAGE plpgsql;

-- Record play event (reusable, updates analytics)
CREATE OR REPLACE FUNCTION record_play(
  p_user_id UUID,
  p_track_id TEXT,
  p_duration_ms BIGINT DEFAULT 0,
  p_skipped BOOLEAN DEFAULT FALSE
)
RETURNS void AS $$
BEGIN
  INSERT INTO user_interactions (
    user_id, 
    track_id, 
    play_count, 
    last_played_at,
    total_listen_time_ms,
    skip_count
  )
  VALUES (
    p_user_id, 
    p_track_id, 
    1, 
    NOW(),
    p_duration_ms,
    CASE WHEN p_skipped THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, track_id)
  DO UPDATE SET 
    play_count = user_interactions.play_count + 1,
    last_played_at = NOW(),
    total_listen_time_ms = user_interactions.total_listen_time_ms + p_duration_ms,
    skip_count = user_interactions.skip_count + CASE WHEN p_skipped THEN 1 ELSE 0 END;
END;
$$ LANGUAGE plpgsql;

-- Get user's interaction state for track (reusable)
CREATE OR REPLACE FUNCTION get_interaction_state(
  p_user_id UUID,
  p_track_id TEXT
)
RETURNS TABLE (
  liked BOOLEAN,
  harmony_saved BOOLEAN,
  bookmarked BOOLEAN,
  play_count INTEGER,
  last_played_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(ui.liked, FALSE),
    COALESCE(ui.harmony_saved, FALSE),
    COALESCE(ui.bookmarked, FALSE),
    COALESCE(ui.play_count, 0),
    ui.last_played_at
  FROM user_interactions ui
  WHERE ui.user_id = p_user_id AND ui.track_id = p_track_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, 0, NULL::TIMESTAMPTZ;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get all user's liked tracks (reusable for feed)
CREATE OR REPLACE FUNCTION get_liked_tracks(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  track_id TEXT,
  liked_at TIMESTAMPTZ,
  play_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ui.track_id,
    ui.liked_at,
    ui.play_count
  FROM user_interactions ui
  WHERE ui.user_id = p_user_id AND ui.liked = TRUE
  ORDER BY ui.liked_at DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;


-- ============================================================================
-- 6. RLS POLICIES

-- ============================================================================

ALTER TABLE user_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_followers ENABLE ROW LEVEL SECURITY;

-- User interactions: users can only see/edit their own
CREATE POLICY "user_interactions_select" ON user_interactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_interactions_insert" ON user_interactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_interactions_update" ON user_interactions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "user_interactions_delete" ON user_interactions
  FOR DELETE USING (auth.uid() = user_id);

-- Playlists: public playlists visible to all, private only to owner
CREATE POLICY "playlists_select" ON playlists
  FOR SELECT USING (is_public = TRUE OR auth.uid() = user_id);

CREATE POLICY "playlists_insert" ON playlists
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "playlists_update" ON playlists
  FOR UPDATE USING (
    auth.uid() = user_id OR 
    (is_collaborative = TRUE AND EXISTS (
      SELECT 1 FROM playlist_followers 
      WHERE playlist_id = playlists.id AND user_id = auth.uid()
    ))
  );

CREATE POLICY "playlists_delete" ON playlists
  FOR DELETE USING (auth.uid() = user_id);

-- Playlist tracks: visible if playlist is visible
CREATE POLICY "playlist_tracks_select" ON playlist_tracks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM playlists 
      WHERE id = playlist_tracks.playlist_id 
        AND (is_public = TRUE OR user_id = auth.uid())
    )
  );

CREATE POLICY "playlist_tracks_insert" ON playlist_tracks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM playlists 
      WHERE id = playlist_tracks.playlist_id 
        AND (user_id = auth.uid() OR (
          is_collaborative = TRUE AND EXISTS (
            SELECT 1 FROM playlist_followers 
            WHERE playlist_id = playlists.id AND user_id = auth.uid()
          )
        ))
    )
  );

CREATE POLICY "playlist_tracks_delete" ON playlist_tracks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM playlists 
      WHERE id = playlist_tracks.playlist_id 
        AND (user_id = auth.uid() OR (
          is_collaborative = TRUE AND EXISTS (
            SELECT 1 FROM playlist_followers 
            WHERE playlist_id = playlists.id AND user_id = auth.uid()
          )
        ))
    )
  );

-- Playlist followers: users can manage their own follows
CREATE POLICY "playlist_followers_select" ON playlist_followers
  FOR SELECT USING (true);

CREATE POLICY "playlist_followers_insert" ON playlist_followers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "playlist_followers_delete" ON playlist_followers
  FOR DELETE USING (auth.uid() = user_id);


-- ============================================================================
-- 7. UPDATE EXISTING TABLES TO USE NEW SYSTEM

-- ============================================================================

-- Migrate existing track_comment_likes to user_interactions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'track_comment_likes') THEN
    -- This would need custom logic based on your existing schema
    RAISE NOTICE 'Migration of existing data should be done carefully in production';
  END IF;
END $$;

COMMENT ON TABLE user_interactions IS 
'Unified user interactions: likes, harmonies, bookmarks, plays. Single source of truth.';

COMMENT ON FUNCTION toggle_like IS 
'DRY function to toggle like state. Returns new state.';

COMMENT ON FUNCTION sync_interaction_to_playlist IS 
'Auto-sync interactions to corresponding playlists (Liked Songs, Harmonies, Bookmarks).';



-- ============================================================
-- 20260122_profile_themes.sql

-- ============================================================
-- Profile Theme System
-- Created: 2026-01-22
-- Purpose: Custom profile themes and styling

-- Create user_themes table
CREATE TABLE IF NOT EXISTS public.user_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  theme_name text NOT NULL DEFAULT 'custom',
  colors jsonb NOT NULL DEFAULT '{
    "background": "#000000",
    "surface": "#1a1a1a",
    "primary": "#3b82f6",
    "secondary": "#8b5cf6",
    "accent": "#f59e0b",
    "text": "#ffffff",
    "textMuted": "#9ca3af"
  }'::jsonb,
  fonts jsonb NOT NULL DEFAULT '{
    "heading": "Inter",
    "body": "Inter"
  }'::jsonb,
  layout text NOT NULL DEFAULT 'modern' CHECK (layout IN ('modern', 'minimal', 'retro', 'neon', 'academic')),
  custom_css text,
  banner_url text,
  profile_url_slug text UNIQUE,
  show_visitor_count boolean DEFAULT false,
  animated_background boolean DEFAULT false,
  player_skin text DEFAULT 'default' CHECK (player_skin IN ('default', 'compact', 'glassmorphism', 'retro', 'minimal')),
  is_public boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_user_themes_user ON public.user_themes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_themes_slug ON public.user_themes(profile_url_slug) WHERE profile_url_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_themes_public ON public.user_themes(is_public) WHERE is_public = true;

-- Create theme presets table
CREATE TABLE IF NOT EXISTS public.theme_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  colors jsonb NOT NULL,
  fonts jsonb NOT NULL,
  layout text NOT NULL,
  custom_css text,
  player_skin text DEFAULT 'default',
  animated_background boolean DEFAULT false,
  is_featured boolean DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  usage_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_theme_presets_featured ON public.theme_presets(is_featured) WHERE is_featured = true;

-- Insert default theme presets
INSERT INTO public.theme_presets (name, description, colors, fonts, layout, player_skin, animated_background, is_featured) VALUES
  ('Dark Modern', 'Sleek dark theme with blue accents', 
   '{"background": "#0a0a0a", "surface": "#1a1a1a", "primary": "#3b82f6", "secondary": "#8b5cf6", "accent": "#f59e0b", "text": "#ffffff", "textMuted": "#9ca3af"}'::jsonb,
   '{"heading": "Inter", "body": "Inter"}'::jsonb,
   'modern', 'glassmorphism', false, true),
  
  ('Minimal Light', 'Clean and minimal light theme',
   '{"background": "#ffffff", "surface": "#f9fafb", "primary": "#1f2937", "secondary": "#6b7280", "accent": "#3b82f6", "text": "#111827", "textMuted": "#6b7280"}'::jsonb,
   '{"heading": "Inter", "body": "Inter"}'::jsonb,
   'minimal', 'minimal', false, true),
  
  ('Neon Dreams', 'Vibrant neon with animated background',
   '{"background": "#0a0014", "surface": "#1a0028", "primary": "#ff00ff", "secondary": "#00ffff", "accent": "#ffff00", "text": "#ffffff", "textMuted": "#b19cd9"}'::jsonb,
   '{"heading": "Orbitron", "body": "Roboto"}'::jsonb,
   'neon', 'retro', true, true),
  
  ('Retro Wave', 'Synthwave inspired retro theme',
   '{"background": "#1a1a2e", "surface": "#16213e", "primary": "#ff006e", "secondary": "#8338ec", "accent": "#ffbe0b", "text": "#eaeaea", "textMuted": "#a8a8a8"}'::jsonb,
   '{"heading": "Press Start 2P", "body": "Roboto Mono"}'::jsonb,
   'retro', 'retro', false, true),
  
  ('Dark Academia', 'Scholarly dark theme with warm tones',
   '{"background": "#1c1917", "surface": "#292524", "primary": "#d97706", "secondary": "#78716c", "accent": "#b45309", "text": "#fafaf9", "textMuted": "#a8a29e"}'::jsonb,
   '{"heading": "Playfair Display", "body": "Lora"}'::jsonb,
   'academic', 'default', false, true)
ON CONFLICT (name) DO NOTHING;

-- RLS Policies
ALTER TABLE public.user_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theme_presets ENABLE ROW LEVEL SECURITY;

-- Users can view their own themes
CREATE POLICY "Users can view own themes" ON public.user_themes
FOR SELECT USING (auth.uid() = user_id);

-- Users can view public themes
CREATE POLICY "Public themes are viewable" ON public.user_themes
FOR SELECT USING (is_public = true);

-- Users can manage their own themes
CREATE POLICY "Users can manage own themes" ON public.user_themes
FOR ALL USING (auth.uid() = user_id);

-- Everyone can view theme presets
CREATE POLICY "Anyone can view presets" ON public.theme_presets
FOR SELECT USING (true);

-- Only admins can manage theme presets
CREATE POLICY "Admins can manage presets" ON public.theme_presets
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'::app_role
  )
);

-- Update timestamp function
CREATE OR REPLACE FUNCTION public.update_user_theme_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER user_themes_updated_at
  BEFORE UPDATE ON public.user_themes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_theme_timestamp();

-- Function to increment theme preset usage
CREATE OR REPLACE FUNCTION public.increment_theme_usage(preset_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.theme_presets
  SET usage_count = usage_count + 1
  WHERE id = preset_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_theme_usage(uuid) TO authenticated;

COMMENT ON TABLE public.user_themes IS 'Custom profile themes for users';
COMMENT ON TABLE public.theme_presets IS 'Pre-made theme templates users can apply';



-- ============================================================
-- 20260122_premium_billing.sql

-- ============================================================
-- Premium Billing System Tables
-- Supports Stripe subscriptions and RevenueCat mobile in-app purchases

-- Add billing columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS premium_tier TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS premium_since TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS premium_expires_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS premium_canceled_at TIMESTAMPTZ;

-- Stripe-specific columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT;

-- RevenueCat-specific columns (for mobile)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS revenuecat_user_id TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS revenuecat_subscription_id TEXT;

-- Create index on premium users
CREATE INDEX IF NOT EXISTS idx_profiles_is_premium ON profiles(is_premium) WHERE is_premium = TRUE;
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer ON profiles(stripe_customer_id);

-- Stripe prices table
CREATE TABLE IF NOT EXISTS stripe_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL UNIQUE,
  stripe_product_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  interval TEXT, -- 'month', 'year', or NULL for one-time
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscription events log
CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'subscription_created', 'subscription_canceled', 'payment_succeeded', 'payment_failed', etc.
  product_id TEXT,
  stripe_session_id TEXT,
  stripe_subscription_id TEXT,
  stripe_invoice_id TEXT,
  amount INTEGER,
  currency TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_user ON subscription_events(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_type ON subscription_events(event_type);
CREATE INDEX IF NOT EXISTS idx_subscription_events_created ON subscription_events(created_at DESC);

-- Premium feature usage tracking
CREATE TABLE IF NOT EXISTS premium_feature_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feature_name TEXT NOT NULL,
  usage_count INTEGER DEFAULT 1,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_premium_feature_usage_user_feature 
  ON premium_feature_usage(user_id, feature_name);

-- Function: Check premium access
CREATE OR REPLACE FUNCTION check_premium_access(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_premium BOOLEAN;
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT is_premium, premium_expires_at
  INTO v_is_premium, v_expires_at
  FROM profiles
  WHERE id = p_user_id;

  -- Not premium at all
  IF NOT v_is_premium THEN
    RETURN FALSE;
  END IF;

  -- Lifetime member (no expiration)
  IF v_expires_at IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Check if subscription is still valid
  RETURN v_expires_at > NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Track feature usage
CREATE OR REPLACE FUNCTION track_premium_feature(
  p_user_id UUID,
  p_feature_name TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO premium_feature_usage (user_id, feature_name, metadata, last_used_at)
  VALUES (p_user_id, p_feature_name, p_metadata, NOW())
  ON CONFLICT (user_id, feature_name)
  DO UPDATE SET
    usage_count = premium_feature_usage.usage_count + 1,
    last_used_at = NOW(),
    metadata = p_metadata;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get subscription statistics (for admin dashboard)
CREATE OR REPLACE FUNCTION get_subscription_stats()
RETURNS TABLE(
  total_subscribers BIGINT,
  active_monthly BIGINT,
  active_annual BIGINT,
  lifetime_members BIGINT,
  trial_users BIGINT,
  monthly_revenue NUMERIC,
  annual_revenue NUMERIC,
  lifetime_revenue NUMERIC,
  churn_rate NUMERIC,
  trial_conversion_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) FILTER (WHERE is_premium = TRUE) as total_premium,
      COUNT(*) FILTER (WHERE premium_tier = 'premium_monthly' AND is_premium = TRUE) as monthly_subs,
      COUNT(*) FILTER (WHERE premium_tier = 'premium_annual' AND is_premium = TRUE) as annual_subs,
      COUNT(*) FILTER (WHERE premium_tier = 'premium_lifetime') as lifetime_subs,
      COUNT(*) FILTER (WHERE stripe_subscription_status = 'trialing') as trial_count
    FROM profiles
  ),
  revenue AS (
    SELECT
      SUM(amount) FILTER (WHERE event_type = 'payment_succeeded' AND product_id = 'premium_monthly') / 100.0 as monthly_rev,
      SUM(amount) FILTER (WHERE event_type = 'payment_succeeded' AND product_id = 'premium_annual') / 100.0 as annual_rev,
      SUM(amount) FILTER (WHERE event_type = 'payment_succeeded' AND product_id = 'premium_lifetime') / 100.0 as lifetime_rev
    FROM subscription_events
    WHERE created_at >= NOW() - INTERVAL '30 days'
  ),
  churn AS (
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'subscription_canceled' AND created_at >= NOW() - INTERVAL '30 days') as canceled,
      COUNT(*) FILTER (WHERE event_type = 'subscription_created' AND created_at >= NOW() - INTERVAL '30 days') as created
    FROM subscription_events
  )
  SELECT
    stats.total_premium,
    stats.monthly_subs,
    stats.annual_subs,
    stats.lifetime_subs,
    stats.trial_count,
    COALESCE(revenue.monthly_rev, 0),
    COALESCE(revenue.annual_rev, 0),
    COALESCE(revenue.lifetime_rev, 0),
    CASE 
      WHEN churn.created > 0 THEN (churn.canceled::NUMERIC / churn.created::NUMERIC * 100)
      ELSE 0
    END as churn_pct,
    CASE
      WHEN stats.trial_count > 0 THEN (stats.total_premium::NUMERIC / (stats.total_premium + stats.trial_count)::NUMERIC * 100)
      ELSE 0
    END as conversion_pct
  FROM stats, revenue, churn;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get user's premium features usage
CREATE OR REPLACE FUNCTION get_user_premium_usage(p_user_id UUID)
RETURNS TABLE(
  feature_name TEXT,
  usage_count INTEGER,
  last_used_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pfu.feature_name,
    pfu.usage_count,
    pfu.last_used_at
  FROM premium_feature_usage pfu
  WHERE pfu.user_id = p_user_id
  ORDER BY pfu.usage_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies

-- Profiles billing columns
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own billing info
CREATE POLICY "Users can view own billing info"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Subscription events
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription events"
  ON subscription_events FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can insert events
CREATE POLICY "Service role can insert subscription events"
  ON subscription_events FOR INSERT
  WITH CHECK (true);

-- Premium feature usage
ALTER TABLE premium_feature_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own feature usage"
  ON premium_feature_usage FOR SELECT
  USING (auth.uid() = user_id);

-- Stripe prices (public read)
ALTER TABLE stripe_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view prices"
  ON stripe_prices FOR SELECT
  TO public
  USING (true);

-- Seed initial products
INSERT INTO stripe_prices (product_id, stripe_product_id, stripe_price_id, amount, interval)
VALUES
  ('premium_monthly', 'prod_placeholder_monthly', 'price_placeholder_monthly', 999, 'month'),
  ('premium_annual', 'prod_placeholder_annual', 'price_placeholder_annual', 8999, 'year'),
  ('premium_lifetime', 'prod_placeholder_lifetime', 'price_placeholder_lifetime', 19999, NULL)
ON CONFLICT (product_id) DO NOTHING;

-- Comments
COMMENT ON TABLE subscription_events IS 'Log of all subscription lifecycle events for analytics and debugging';
COMMENT ON TABLE premium_feature_usage IS 'Tracks premium feature usage per user for analytics';
COMMENT ON FUNCTION check_premium_access IS 'Returns TRUE if user has valid premium access';
COMMENT ON FUNCTION track_premium_feature IS 'Increments usage counter for a premium feature';
COMMENT ON FUNCTION get_subscription_stats IS 'Returns aggregated subscription metrics for admin dashboard';



COMMIT;
