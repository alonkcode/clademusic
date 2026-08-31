-- GENERATED - slice of supabase/schema_bundle.sql. Do not edit.
-- PART 3/6: forum-and-social
-- Run parts 01..06 IN ORDER in the Supabase SQL Editor.

BEGIN;

-- ============================================================
-- 20260122_reddit_forum.sql

-- ============================================================
-- Reddit-like Discussion Forum
-- Supports subreddit-style communities, posts, comments, voting, awards

-- Forums (Subreddits)
CREATE TABLE IF NOT EXISTS forums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL CHECK (name ~ '^[a-zA-Z0-9_]{3,21}$'),
  display_name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  banner_url TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  is_nsfw BOOLEAN DEFAULT FALSE,
  is_restricted BOOLEAN DEFAULT FALSE,
  member_count INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forums_name ON forums(name);
CREATE INDEX IF NOT EXISTS idx_forums_category ON forums(category);
CREATE INDEX IF NOT EXISTS idx_forums_member_count ON forums(member_count DESC);

-- Forum Members
CREATE TABLE IF NOT EXISTS forum_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID REFERENCES forums(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin', 'banned')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(forum_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_members_user ON forum_members(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_members_forum ON forum_members(forum_id);

-- Posts
CREATE TABLE IF NOT EXISTS forum_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID REFERENCES forums(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(title) >= 3 AND char_length(title) <= 300),
  content TEXT,
  content_type TEXT DEFAULT 'text' CHECK (content_type IN ('text', 'link', 'image', 'video', 'poll')),
  url TEXT,
  image_urls TEXT[],
  track_id TEXT,
  vote_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_locked BOOLEAN DEFAULT FALSE,
  is_nsfw BOOLEAN DEFAULT FALSE,
  is_spoiler BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_posts_forum ON forum_posts(forum_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_user ON forum_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_vote_count ON forum_posts(vote_count DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_track ON forum_posts(track_id) WHERE track_id IS NOT NULL;

-- Comments
CREATE TABLE IF NOT EXISTS forum_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES forum_comments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 10000),
  vote_count INTEGER DEFAULT 0,
  is_deleted BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_comments_post ON forum_comments(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_forum_comments_parent ON forum_comments(parent_comment_id) WHERE parent_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forum_comments_user ON forum_comments(user_id);

-- Votes (Reddit-style upvote/downvote)
CREATE TABLE IF NOT EXISTS forum_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES forum_comments(id) ON DELETE CASCADE,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, post_id),
  UNIQUE(user_id, comment_id),
  CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_forum_votes_user ON forum_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_votes_post ON forum_votes(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forum_votes_comment ON forum_votes(comment_id) WHERE comment_id IS NOT NULL;

-- Awards (Gold, Silver, etc.)
CREATE TABLE IF NOT EXISTS forum_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  icon TEXT NOT NULL,
  description TEXT,
  cost INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Award Instances (given to posts/comments)
CREATE TABLE IF NOT EXISTS forum_award_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id UUID REFERENCES forum_awards(id) ON DELETE CASCADE,
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES forum_comments(id) ON DELETE CASCADE,
  given_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  given_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_award_instances_post ON forum_award_instances(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_award_instances_comment ON forum_award_instances(comment_id) WHERE comment_id IS NOT NULL;

-- User Flair
CREATE TABLE IF NOT EXISTS forum_user_flair (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID REFERENCES forums(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  flair_text TEXT CHECK (char_length(flair_text) <= 64),
  flair_color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(forum_id, user_id)
);

-- Saved Posts (bookmarks)
CREATE TABLE IF NOT EXISTS forum_saved_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, post_id)
);

-- Triggers for auto-updating counts

-- Update forum member count
CREATE OR REPLACE FUNCTION update_forum_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE forums SET member_count = member_count + 1 WHERE id = NEW.forum_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE forums SET member_count = GREATEST(0, member_count - 1) WHERE id = OLD.forum_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_forum_member_count
AFTER INSERT OR DELETE ON forum_members
FOR EACH ROW EXECUTE FUNCTION update_forum_member_count();

-- Update forum post count
CREATE OR REPLACE FUNCTION update_forum_post_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE forums SET post_count = post_count + 1 WHERE id = NEW.forum_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE forums SET post_count = GREATEST(0, post_count - 1) WHERE id = OLD.forum_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_forum_post_count
AFTER INSERT OR DELETE ON forum_posts
FOR EACH ROW EXECUTE FUNCTION update_forum_post_count();

-- Update post comment count
CREATE OR REPLACE FUNCTION update_post_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE forum_posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE forum_posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_post_comment_count
AFTER INSERT OR DELETE ON forum_comments
FOR EACH ROW EXECUTE FUNCTION update_post_comment_count();

-- Update post vote count
CREATE OR REPLACE FUNCTION update_post_vote_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE forum_posts 
    SET vote_count = vote_count + CASE WHEN NEW.vote_type = 'up' THEN 1 ELSE -1 END 
    WHERE id = NEW.post_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE forum_posts 
    SET vote_count = vote_count + CASE 
      WHEN NEW.vote_type = 'up' AND OLD.vote_type = 'down' THEN 2
      WHEN NEW.vote_type = 'down' AND OLD.vote_type = 'up' THEN -2
      ELSE 0 
    END 
    WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE forum_posts 
    SET vote_count = vote_count - CASE WHEN OLD.vote_type = 'up' THEN 1 ELSE -1 END 
    WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_post_vote_count
AFTER INSERT OR UPDATE OR DELETE ON forum_votes
FOR EACH ROW 
EXECUTE FUNCTION update_post_vote_count();

-- Update comment vote count
CREATE OR REPLACE FUNCTION update_comment_vote_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE forum_comments 
    SET vote_count = vote_count + CASE WHEN NEW.vote_type = 'up' THEN 1 ELSE -1 END 
    WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE forum_comments 
    SET vote_count = vote_count + CASE 
      WHEN NEW.vote_type = 'up' AND OLD.vote_type = 'down' THEN 2
      WHEN NEW.vote_type = 'down' AND OLD.vote_type = 'up' THEN -2
      ELSE 0 
    END 
    WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE forum_comments 
    SET vote_count = vote_count - CASE WHEN OLD.vote_type = 'up' THEN 1 ELSE -1 END 
    WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_comment_vote_count
AFTER INSERT OR UPDATE OR DELETE ON forum_votes
FOR EACH ROW 
EXECUTE FUNCTION update_comment_vote_count();

-- RLS Policies

ALTER TABLE forums ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_award_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_user_flair ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_saved_posts ENABLE ROW LEVEL SECURITY;

-- Forums: Public read, authenticated create
CREATE POLICY "forums_select" ON forums FOR SELECT USING (true);
CREATE POLICY "forums_insert" ON forums FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "forums_update" ON forums FOR UPDATE USING (
  created_by = auth.uid() OR 
  EXISTS (SELECT 1 FROM forum_members WHERE forum_id = id AND user_id = auth.uid() AND role IN ('admin', 'moderator'))
);

-- Forum Members: Public read, users can join/leave
CREATE POLICY "forum_members_select" ON forum_members FOR SELECT USING (true);
CREATE POLICY "forum_members_insert" ON forum_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "forum_members_delete" ON forum_members FOR DELETE USING (auth.uid() = user_id);

-- Posts: Public read, authenticated create, author/mod edit
CREATE POLICY "forum_posts_select" ON forum_posts FOR SELECT USING (true);
CREATE POLICY "forum_posts_insert" ON forum_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "forum_posts_update" ON forum_posts FOR UPDATE USING (
  user_id = auth.uid() OR 
  EXISTS (SELECT 1 FROM forum_members WHERE forum_id = forum_posts.forum_id AND user_id = auth.uid() AND role IN ('admin', 'moderator'))
);
CREATE POLICY "forum_posts_delete" ON forum_posts FOR DELETE USING (
  user_id = auth.uid() OR 
  EXISTS (SELECT 1 FROM forum_members WHERE forum_id = forum_posts.forum_id AND user_id = auth.uid() AND role IN ('admin', 'moderator'))
);

-- Comments: Public read, authenticated create, author edit
CREATE POLICY "forum_comments_select" ON forum_comments FOR SELECT USING (true);
CREATE POLICY "forum_comments_insert" ON forum_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "forum_comments_update" ON forum_comments FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "forum_comments_delete" ON forum_comments FOR DELETE USING (user_id = auth.uid());

-- Votes: User can manage their own votes
CREATE POLICY "forum_votes_select" ON forum_votes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "forum_votes_insert" ON forum_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "forum_votes_update" ON forum_votes FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "forum_votes_delete" ON forum_votes FOR DELETE USING (user_id = auth.uid());

-- Awards: Public read
CREATE POLICY "forum_awards_select" ON forum_awards FOR SELECT USING (true);
CREATE POLICY "forum_award_instances_select" ON forum_award_instances FOR SELECT USING (true);
CREATE POLICY "forum_award_instances_insert" ON forum_award_instances FOR INSERT WITH CHECK (auth.uid() = given_by);

-- Flair: Public read, user can set their own
CREATE POLICY "forum_user_flair_select" ON forum_user_flair FOR SELECT USING (true);
CREATE POLICY "forum_user_flair_insert" ON forum_user_flair FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "forum_user_flair_update" ON forum_user_flair FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "forum_user_flair_delete" ON forum_user_flair FOR DELETE USING (user_id = auth.uid());

-- Saved Posts: User can manage their own saves
CREATE POLICY "forum_saved_posts_select" ON forum_saved_posts FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "forum_saved_posts_insert" ON forum_saved_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "forum_saved_posts_delete" ON forum_saved_posts FOR DELETE USING (user_id = auth.uid());

-- Seed default forums
INSERT INTO forums (name, display_name, description, category) VALUES
('music', 'Music Hub', 'All things music - discuss tracks, artists, and genres', 'music'),
('hiphop', 'Hip Hop', 'Hip hop music discussion and culture', 'music'),
('rock', 'Rock Music', 'Classic and modern rock', 'music'),
('jazz', 'Jazz', 'Jazz appreciation and discussion', 'music'),
('electronic', 'Electronic', 'EDM, techno, house, and all electronic music', 'music'),
('israel', 'Israel', 'Israeli music and culture (ישראל)', 'regional'),
('worldmusic', 'World Music', 'Music from around the globe', 'regional'),
('recommendations', 'Music Recommendations', 'Get and give music recommendations', 'general'),
('production', 'Music Production', 'Production tips, techniques, and gear', 'creation'),
('theory', 'Music Theory', 'Discuss chords, progressions, and composition', 'education')
ON CONFLICT (name) DO NOTHING;

-- Seed awards
INSERT INTO forum_awards (name, display_name, icon, description, cost) VALUES
('gold', 'Gold', '🥇', 'Premium award showing exceptional content', 500),
('silver', 'Silver', '🥈', 'Great content worth recognizing', 100),
('bronze', 'Bronze', '🥉', 'Good contribution', 50),
('fire', 'Fire', '🔥', 'Hot take or trending content', 200),
('headphones', 'Headphones', '🎧', 'Excellent music recommendation', 150),
('mic', 'Golden Mic', '🎤', 'Outstanding vocal/lyrical analysis', 300),
('heart', 'Heart', '❤️', 'Wholesome or touching post', 100)
ON CONFLICT (name) DO NOTHING;



-- ============================================================
-- bundle-fixes/03-forum-compat.sql

-- ============================================================
-- Columns the forum performance work assumes but the forum schema never adds.
--
-- 20260122_performance_optimization indexes forum_posts with
-- "WHERE NOT is_deleted", and mv_hot_posts filters on it, but
-- 20260122_reddit_forum only defines is_pinned / is_locked / is_nsfw /
-- is_spoiler on forum_posts. (forum_comments does have is_deleted, which is
-- probably how the omission went unnoticed.)
--
-- Soft-delete is clearly the intent - the posts RLS policy allows DELETE, but
-- the hot/new/top indexes are all written to exclude deleted posts.

ALTER TABLE public.forum_posts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- mv_top_contributors sums forum_posts.vote_count and forum_comments.vote_count
-- per profile; NULLs there would poison the SUM.
ALTER TABLE public.forum_posts    ALTER COLUMN vote_count SET DEFAULT 0;
ALTER TABLE public.forum_comments ALTER COLUMN vote_count SET DEFAULT 0;



-- ============================================================
-- 20260122_emoji_reactions.sql

-- ============================================================
-- Emoji Reactions System
-- Allows users to react to posts and comments with emojis


-- ============================================================================
-- 1. REACTION TYPES TABLE

-- ============================================================================

CREATE TABLE IF NOT EXISTS reaction_types (
  id TEXT PRIMARY KEY,
  emoji TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT CHECK (category IN ('positive', 'funny', 'love', 'thinking', 'surprised', 'sad', 'angry')),
  display_order INTEGER DEFAULT 0
);

-- Insert default reaction types
INSERT INTO reaction_types (id, emoji, label, category, display_order) VALUES
  ('like', '👍', 'Like', 'positive', 1),
  ('love', '❤️', 'Love', 'love', 2),
  ('fire', '🔥', 'Fire', 'positive', 3),
  ('laugh', '😂', 'Laugh', 'funny', 4),
  ('wow', '😮', 'Wow', 'surprised', 5),
  ('think', '🤔', 'Thinking', 'thinking', 6),
  ('clap', '👏', 'Applause', 'positive', 7),
  ('heart_eyes', '😍', 'Love It', 'love', 8),
  ('mind_blown', '🤯', 'Mind Blown', 'surprised', 9),
  ('cry_laugh', '😭', 'Crying Laughing', 'funny', 10),
  ('rocket', '🚀', 'Rocket', 'positive', 11),
  ('musical_note', '🎵', 'Musical', 'positive', 12),
  ('star', '⭐', 'Star', 'positive', 13),
  ('celebrate', '🎉', 'Celebrate', 'positive', 14),
  ('sad', '😢', 'Sad', 'sad', 15),
  ('angry', '😠', 'Angry', 'angry', 16)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- 2. POST REACTIONS TABLE

-- ============================================================================

CREATE TABLE IF NOT EXISTS forum_post_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction_id TEXT NOT NULL REFERENCES reaction_types(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(post_id, user_id, reaction_id)
);

CREATE INDEX IF NOT EXISTS idx_post_reactions_post ON forum_post_reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_post_reactions_user ON forum_post_reactions(user_id);


-- ============================================================================
-- 3. COMMENT REACTIONS TABLE

-- ============================================================================

CREATE TABLE IF NOT EXISTS forum_comment_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES forum_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction_id TEXT NOT NULL REFERENCES reaction_types(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(comment_id, user_id, reaction_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON forum_comment_reactions(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_user ON forum_comment_reactions(user_id);


-- ============================================================================
-- 4. REACTION FUNCTIONS

-- ============================================================================

-- Toggle post reaction
CREATE OR REPLACE FUNCTION toggle_post_reaction(
  p_post_id UUID,
  p_user_id UUID,
  p_reaction_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Check if reaction exists
  SELECT EXISTS(
    SELECT 1 FROM forum_post_reactions
    WHERE post_id = p_post_id
      AND user_id = p_user_id
      AND reaction_id = p_reaction_id
  ) INTO v_exists;
  
  IF v_exists THEN
    -- Remove reaction
    DELETE FROM forum_post_reactions
    WHERE post_id = p_post_id
      AND user_id = p_user_id
      AND reaction_id = p_reaction_id;
    RETURN FALSE;
  ELSE
    -- Add reaction
    INSERT INTO forum_post_reactions (post_id, user_id, reaction_id)
    VALUES (p_post_id, p_user_id, p_reaction_id)
    ON CONFLICT DO NOTHING;
    RETURN TRUE;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Toggle comment reaction
CREATE OR REPLACE FUNCTION toggle_comment_reaction(
  p_comment_id UUID,
  p_user_id UUID,
  p_reaction_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM forum_comment_reactions
    WHERE comment_id = p_comment_id
      AND user_id = p_user_id
      AND reaction_id = p_reaction_id
  ) INTO v_exists;
  
  IF v_exists THEN
    DELETE FROM forum_comment_reactions
    WHERE comment_id = p_comment_id
      AND user_id = p_user_id
      AND reaction_id = p_reaction_id;
    RETURN FALSE;
  ELSE
    INSERT INTO forum_comment_reactions (comment_id, user_id, reaction_id)
    VALUES (p_comment_id, p_user_id, p_reaction_id)
    ON CONFLICT DO NOTHING;
    RETURN TRUE;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Get post reactions summary
CREATE OR REPLACE FUNCTION get_post_reactions(p_post_id UUID)
RETURNS TABLE (
  reaction_id TEXT,
  emoji TEXT,
  count BIGINT,
  user_reacted BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rt.id,
    rt.emoji,
    COUNT(fpr.id)::BIGINT,
    BOOL_OR(fpr.user_id = auth.uid()) as user_reacted
  FROM reaction_types rt
  LEFT JOIN forum_post_reactions fpr ON fpr.reaction_id = rt.id AND fpr.post_id = p_post_id
  WHERE EXISTS (
    SELECT 1 FROM forum_post_reactions 
    WHERE post_id = p_post_id AND reaction_id = rt.id
  )
  GROUP BY rt.id, rt.emoji, rt.display_order
  ORDER BY COUNT(fpr.id) DESC, rt.display_order;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get comment reactions summary
CREATE OR REPLACE FUNCTION get_comment_reactions(p_comment_id UUID)
RETURNS TABLE (
  reaction_id TEXT,
  emoji TEXT,
  count BIGINT,
  user_reacted BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rt.id,
    rt.emoji,
    COUNT(fcr.id)::BIGINT,
    BOOL_OR(fcr.user_id = auth.uid()) as user_reacted
  FROM reaction_types rt
  LEFT JOIN forum_comment_reactions fcr ON fcr.reaction_id = rt.id AND fcr.comment_id = p_comment_id
  WHERE EXISTS (
    SELECT 1 FROM forum_comment_reactions 
    WHERE comment_id = p_comment_id AND reaction_id = rt.id
  )
  GROUP BY rt.id, rt.emoji, rt.display_order
  ORDER BY COUNT(fcr.id) DESC, rt.display_order;
END;
$$ LANGUAGE plpgsql STABLE;


-- ============================================================================
-- 5. RLS POLICIES

-- ============================================================================

ALTER TABLE forum_post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_comment_reactions ENABLE ROW LEVEL SECURITY;

-- Anyone can view reactions
CREATE POLICY "post_reactions_select" ON forum_post_reactions
  FOR SELECT USING (true);

CREATE POLICY "comment_reactions_select" ON forum_comment_reactions
  FOR SELECT USING (true);

-- Users can manage their own reactions
CREATE POLICY "post_reactions_insert" ON forum_post_reactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "post_reactions_delete" ON forum_post_reactions
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "comment_reactions_insert" ON forum_comment_reactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "comment_reactions_delete" ON forum_comment_reactions
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE forum_post_reactions IS 'Emoji reactions to forum posts';
COMMENT ON TABLE forum_comment_reactions IS 'Emoji reactions to comments';
COMMENT ON FUNCTION toggle_post_reaction IS 'Toggle reaction on post (add if not exists, remove if exists)';
COMMENT ON FUNCTION get_post_reactions IS 'Get reaction summary for a post with counts';



-- ============================================================
-- 20260122_live_chat.sql

-- ============================================================
-- Live Real-time Chat System
-- Enables users to chat with each other in real-time while listening to music

-- Chat rooms table (can be global, per track, or per user group)
CREATE TABLE IF NOT EXISTS chat_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('global', 'track', 'group', 'direct')),
  track_id TEXT, -- For track-specific chat rooms
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  reply_to UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb, -- For reactions, mentions, etc.
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Chat room members (who's in which room)
CREATE TABLE IF NOT EXISTS chat_room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'moderator', 'member')),
  last_read_at TIMESTAMPTZ DEFAULT now(),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, user_id)
);

-- User online status
CREATE TABLE IF NOT EXISTS user_presence (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'away', 'offline')),
  current_track_id TEXT,
  last_seen TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created ON chat_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_room_members_room ON chat_room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_room_members_user ON chat_room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_type ON chat_rooms(type);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_track ON chat_rooms(track_id) WHERE track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_presence_status ON user_presence(status) WHERE status = 'online';

-- Enable Row Level Security
ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- RLS Policies for chat_rooms
CREATE POLICY "Users can view public chat rooms"
  ON chat_rooms FOR SELECT
  USING (type IN ('global', 'track'));

CREATE POLICY "Users can view rooms they're members of"
  ON chat_rooms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_room_members
      WHERE chat_room_members.room_id = chat_rooms.id
      AND chat_room_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create chat rooms"
  ON chat_rooms FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- RLS Policies for chat_messages
CREATE POLICY "Users can view messages in their rooms"
  ON chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_room_members
      WHERE chat_room_members.room_id = chat_messages.room_id
      AND chat_room_members.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM chat_rooms
      WHERE chat_rooms.id = chat_messages.room_id
      AND chat_rooms.type IN ('global', 'track')
    )
  );

CREATE POLICY "Users can send messages to their rooms"
  ON chat_messages FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM chat_room_members
        WHERE chat_room_members.room_id = chat_messages.room_id
        AND chat_room_members.user_id = auth.uid()
      )
      OR
      EXISTS (
        SELECT 1 FROM chat_rooms
        WHERE chat_rooms.id = chat_messages.room_id
        AND chat_rooms.type IN ('global', 'track')
      )
    )
  );

CREATE POLICY "Users can edit their own messages"
  ON chat_messages FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own messages"
  ON chat_messages FOR DELETE
  USING (user_id = auth.uid());

-- RLS Policies for chat_room_members
CREATE POLICY "Users can view room members"
  ON chat_room_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM chat_room_members AS crm
      WHERE crm.room_id = chat_room_members.room_id
      AND crm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join public rooms"
  ON chat_room_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chat_rooms
      WHERE chat_rooms.id = chat_room_members.room_id
      AND chat_rooms.type IN ('global', 'track')
    )
  );

CREATE POLICY "Users can leave rooms"
  ON chat_room_members FOR DELETE
  USING (user_id = auth.uid());

-- RLS Policies for user_presence
CREATE POLICY "Users can view all presence"
  ON user_presence FOR SELECT
  USING (true);

CREATE POLICY "Users can update their own presence"
  ON user_presence FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own presence status"
  ON user_presence FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_chat_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE OR REPLACE TRIGGER update_chat_rooms_updated_at
  BEFORE UPDATE ON chat_rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_updated_at();

CREATE OR REPLACE TRIGGER update_user_presence_updated_at
  BEFORE UPDATE ON user_presence
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_updated_at();

-- Create a global chat room by default
INSERT INTO chat_rooms (name, type, metadata)
VALUES ('Global Chat', 'global', '{"description": "Chat with everyone on CladeAI"}'::jsonb)
ON CONFLICT DO NOTHING;

-- Function to get unread message count
CREATE OR REPLACE FUNCTION get_unread_count(p_room_id UUID, p_user_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM chat_messages cm
  WHERE cm.room_id = p_room_id
  AND cm.created_at > COALESCE(
    (SELECT last_read_at FROM chat_room_members WHERE room_id = p_room_id AND user_id = p_user_id),
    '1970-01-01'::timestamptz
  );
$$ LANGUAGE sql STABLE;

-- Function to mark room as read
CREATE OR REPLACE FUNCTION mark_room_as_read(p_room_id UUID)
RETURNS void AS $$
  INSERT INTO chat_room_members (room_id, user_id, last_read_at)
  VALUES (p_room_id, auth.uid(), now())
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET last_read_at = now();
$$ LANGUAGE sql;

COMMENT ON TABLE chat_rooms IS 'Chat rooms for different contexts (global, track-specific, groups)';
COMMENT ON TABLE chat_messages IS 'Real-time chat messages between users';
COMMENT ON TABLE chat_room_members IS 'Tracks which users are in which rooms';
COMMENT ON TABLE user_presence IS 'Real-time user online status and current activity';



-- ============================================================
-- 20260122_track_comments.sql

-- ============================================================
-- Track Comments System
-- Public comments on track profiles visible to all users

-- Track comments table
CREATE TABLE IF NOT EXISTS track_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comment TEXT NOT NULL CHECK (length(comment) >= 1 AND length(comment) <= 2000),
  reply_to UUID REFERENCES track_comments(id) ON DELETE CASCADE,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  edited_at TIMESTAMPTZ
);

-- Comment likes table
CREATE TABLE IF NOT EXISTS track_comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES track_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(comment_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_track_comments_track_id ON track_comments(track_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_track_comments_user_id ON track_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_track_comments_reply_to ON track_comments(reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_track_comment_likes_comment ON track_comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_track_comment_likes_user ON track_comment_likes(user_id);

-- Enable Row Level Security
ALTER TABLE track_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_comment_likes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for track_comments
CREATE POLICY "Anyone can view track comments"
  ON track_comments FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can post comments"
  ON track_comments FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );

CREATE POLICY "Users can edit their own comments"
  ON track_comments FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own comments"
  ON track_comments FOR DELETE
  USING (user_id = auth.uid());

-- RLS Policies for track_comment_likes
CREATE POLICY "Anyone can view comment likes"
  ON track_comment_likes FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can like comments"
  ON track_comment_likes FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );

CREATE POLICY "Users can remove their likes"
  ON track_comment_likes FOR DELETE
  USING (user_id = auth.uid());

-- Function to update comment likes count
CREATE OR REPLACE FUNCTION update_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE track_comments
    SET likes_count = likes_count + 1
    WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE track_comments
    SET likes_count = likes_count - 1
    WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update likes count automatically
CREATE OR REPLACE TRIGGER track_comment_likes_count_trigger
  AFTER INSERT OR DELETE ON track_comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_comment_likes_count();

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_track_comment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE OR REPLACE TRIGGER update_track_comments_updated_at
  BEFORE UPDATE ON track_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_track_comment_updated_at();

-- Function to get comments with user info
CREATE OR REPLACE FUNCTION get_track_comments(p_track_id TEXT, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0)
RETURNS TABLE (
  id UUID,
  track_id TEXT,
  user_id UUID,
  comment TEXT,
  reply_to UUID,
  likes_count INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  user_display_name TEXT,
  user_avatar_url TEXT,
  user_liked BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tc.id,
    tc.track_id,
    tc.user_id,
    tc.comment,
    tc.reply_to,
    tc.likes_count,
    tc.created_at,
    tc.updated_at,
    tc.edited_at,
    p.display_name,
    p.avatar_url,
    EXISTS(
      SELECT 1 FROM track_comment_likes tcl
      WHERE tcl.comment_id = tc.id
      AND tcl.user_id = auth.uid()
    ) as user_liked
  FROM track_comments tc
  LEFT JOIN profiles p ON p.id = tc.user_id
  WHERE tc.track_id = p_track_id
  AND tc.reply_to IS NULL -- Only top-level comments
  ORDER BY tc.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to get comment replies
CREATE OR REPLACE FUNCTION get_comment_replies(p_comment_id UUID)
RETURNS TABLE (
  id UUID,
  track_id TEXT,
  user_id UUID,
  comment TEXT,
  reply_to UUID,
  likes_count INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  user_display_name TEXT,
  user_avatar_url TEXT,
  user_liked BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tc.id,
    tc.track_id,
    tc.user_id,
    tc.comment,
    tc.reply_to,
    tc.likes_count,
    tc.created_at,
    tc.updated_at,
    tc.edited_at,
    p.display_name,
    p.avatar_url,
    EXISTS(
      SELECT 1 FROM track_comment_likes tcl
      WHERE tcl.comment_id = tc.id
      AND tcl.user_id = auth.uid()
    ) as user_liked
  FROM track_comments tc
  LEFT JOIN profiles p ON p.id = tc.user_id
  WHERE tc.reply_to = p_comment_id
  ORDER BY tc.created_at ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON TABLE track_comments IS 'Public comments on track profiles visible to all users';
COMMENT ON TABLE track_comment_likes IS 'User likes on track comments';
COMMENT ON FUNCTION get_track_comments IS 'Get top-level comments for a track with user info and like status';
COMMENT ON FUNCTION get_comment_replies IS 'Get replies to a specific comment';



COMMIT;
