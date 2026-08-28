-- GENERATED - do not edit. Regenerate: bash scripts/build-sql-editor-parts.sh
-- PART 04-performance-and-billing: indexes, perf tracking, themes, premium billing
-- Run parts in numeric order. Paste whole file into the SQL Editor.

BEGIN;

-- ---------- 20260122_optimize_indexes.sql ----------
-- Database Optimization: Add Performance Indexes
-- Created: 2026-01-22
-- Purpose: Improve query performance for common operations

-- Tracks table indexes
CREATE INDEX IF NOT EXISTS idx_tracks_title_trgm ON public.tracks USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_trgm ON public.tracks USING gin(artist gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON public.tracks(genre) WHERE genre IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_energy ON public.tracks(energy) WHERE energy IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_tempo ON public.tracks(tempo) WHERE tempo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_detected_key_mode ON public.tracks(detected_key, detected_mode);
CREATE INDEX IF NOT EXISTS idx_tracks_progression_gin ON public.tracks USING gin(progression_roman);
CREATE INDEX IF NOT EXISTS idx_tracks_is_common_ancestor ON public.tracks(is_common_ancestor) WHERE is_common_ancestor = true;

-- Play history indexes
CREATE INDEX IF NOT EXISTS idx_play_history_user_played_at ON public.play_history(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_play_history_track_played_at ON public.play_history(track_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_play_history_recent ON public.play_history(played_at DESC) WHERE played_at > NOW() - INTERVAL '30 days';

-- User interactions indexes
CREATE INDEX IF NOT EXISTS idx_user_interactions_user_type ON public.user_interactions(user_id, interaction_type);
CREATE INDEX IF NOT EXISTS idx_user_interactions_track_type ON public.user_interactions(track_id, interaction_type);
CREATE INDEX IF NOT EXISTS idx_user_interactions_created_at ON public.user_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_interactions_flags ON public.user_interactions(interaction_type) WHERE interaction_type = 'flag' AND resolved_at IS NULL;

-- Profiles indexes
CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm ON public.profiles USING gin(username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON public.profiles(created_at DESC);

-- Feed items indexes
CREATE INDEX IF NOT EXISTS idx_feed_items_user_posted ON public.feed_items(user_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_posted_at ON public.feed_items(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_track ON public.feed_items(track_id) WHERE track_id IS NOT NULL;

-- User providers indexes
CREATE INDEX IF NOT EXISTS idx_user_providers_user_provider ON public.user_providers(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_user_providers_connected_at ON public.user_providers(connected_at DESC);

-- Search cache indexes (already exists, but ensure)
CREATE INDEX IF NOT EXISTS idx_search_cache_expires_at ON public.search_cache(expires_at) WHERE expires_at > NOW();

-- Analyze tables to update statistics
ANALYZE public.tracks;
ANALYZE public.play_history;
ANALYZE public.user_interactions;
ANALYZE public.profiles;
ANALYZE public.feed_items;
ANALYZE public.user_providers;

-- Create materialized view for track statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS public.track_stats AS
SELECT 
  t.id,
  t.title,
  t.artist,
  COUNT(DISTINCT ph.user_id) as unique_listeners,
  COUNT(ph.id) as total_plays,
  COUNT(DISTINCT CASE WHEN ui.interaction_type = 'like' THEN ui.user_id END) as total_likes,
  COUNT(DISTINCT CASE WHEN ui.interaction_type = 'save' THEN ui.user_id END) as total_saves,
  MAX(ph.played_at) as last_played_at
FROM public.tracks t
LEFT JOIN public.play_history ph ON ph.track_id = t.id
LEFT JOIN public.user_interactions ui ON ui.track_id = t.id
GROUP BY t.id, t.title, t.artist;

CREATE UNIQUE INDEX IF NOT EXISTS idx_track_stats_id ON public.track_stats(id);
CREATE INDEX IF NOT EXISTS idx_track_stats_plays ON public.track_stats(total_plays DESC);
CREATE INDEX IF NOT EXISTS idx_track_stats_listeners ON public.track_stats(unique_listeners DESC);

-- Create refresh function for track stats
CREATE OR REPLACE FUNCTION public.refresh_track_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.track_stats;
END;
$$;

-- Grant permissions
GRANT SELECT ON public.track_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_track_stats() TO authenticated;

-- Enable pg_trgm extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;

COMMENT ON INDEX idx_tracks_title_trgm IS 'Trigram index for fast fuzzy text search on track titles';
COMMENT ON INDEX idx_tracks_progression_gin IS 'GIN index for array containment searches on chord progressions';
COMMENT ON MATERIALIZED VIEW public.track_stats IS 'Pre-computed track statistics for analytics dashboard';


-- ---------- 20260122_performance_optimization.sql ----------
-- Performance Optimization for 1M+ Users
-- Indexes, partitioning, materialized views, and caching strategies

-- ============================================================================
-- 1. ADVANCED INDEXES FOR HIGH-TRAFFIC TABLES
-- ============================================================================

-- Profiles table - composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_profiles_country_created 
ON profiles(country, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_personality_location 
ON profiles(personality_type, country);

CREATE INDEX IF NOT EXISTS idx_profiles_search_name 
ON profiles USING gin(to_tsvector('english', full_name || ' ' || username));

-- Forum posts - composite indexes for hot/new/top sorting
CREATE INDEX IF NOT EXISTS idx_forum_posts_hot 
ON forum_posts(forum_id, vote_count DESC, created_at DESC) 
WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS idx_forum_posts_new 
ON forum_posts(forum_id, created_at DESC) 
WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS idx_forum_posts_top_week 
ON forum_posts(forum_id, vote_count DESC) 
WHERE created_at > NOW() - INTERVAL '7 days' AND NOT is_deleted;

-- Forum comments - covering index for thread loading
CREATE INDEX IF NOT EXISTS idx_forum_comments_thread 
ON forum_comments(post_id, parent_comment_id, created_at ASC) 
INCLUDE (user_id, content, vote_count, is_deleted);

-- Forum votes - partial indexes for active users
CREATE INDEX IF NOT EXISTS idx_forum_votes_user_recent 
ON forum_votes(user_id, created_at DESC) 
WHERE created_at > NOW() - INTERVAL '30 days';

-- Chat messages - partitioned index for real-time performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_time 
ON chat_messages(room_id, created_at DESC) 
WHERE created_at > NOW() - INTERVAL '7 days';

-- Track comments - composite for popular tracks
CREATE INDEX IF NOT EXISTS idx_track_comments_popular 
ON track_comments(track_id, likes_count DESC, created_at DESC) 
WHERE NOT is_deleted;

-- ============================================================================
-- 2. TABLE PARTITIONING FOR TIME-SERIES DATA
-- ============================================================================

-- Partition chat_messages by month (keeps queries fast)
CREATE TABLE IF NOT EXISTS chat_messages_partitioned (
  LIKE chat_messages INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- Create partitions for past year and next month
DO $$
DECLARE
  start_date DATE := DATE_TRUNC('month', NOW() - INTERVAL '12 months');
  end_date DATE := DATE_TRUNC('month', NOW() + INTERVAL '2 months');
  partition_date DATE;
  partition_name TEXT;
BEGIN
  partition_date := start_date;
  WHILE partition_date < end_date LOOP
    partition_name := 'chat_messages_' || TO_CHAR(partition_date, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF chat_messages_partitioned
       FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      partition_date,
      partition_date + INTERVAL '1 month'
    );
    partition_date := partition_date + INTERVAL '1 month';
  END LOOP;
END $$;

-- Partition forum_posts by quarter for historical data
CREATE TABLE IF NOT EXISTS forum_posts_partitioned (
  LIKE forum_posts INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- ============================================================================
-- 3. MATERIALIZED VIEWS FOR EXPENSIVE QUERIES
-- ============================================================================

-- Hot posts cache (refresh every 5 minutes)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hot_posts AS
SELECT 
  p.*,
  f.name as forum_name,
  f.display_name as forum_display_name,
  pr.username,
  pr.display_name as user_display_name,
  pr.avatar_url,
  -- Hot score calculation: (upvotes - downvotes) / (age_hours + 2)^1.5
  (p.vote_count::float / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5)) as hot_score
FROM forum_posts p
JOIN forums f ON f.id = p.forum_id
JOIN profiles pr ON pr.id = p.user_id
WHERE p.created_at > NOW() - INTERVAL '7 days'
  AND NOT p.is_deleted
ORDER BY hot_score DESC
LIMIT 500;

CREATE UNIQUE INDEX ON mv_hot_posts (id);
CREATE INDEX ON mv_hot_posts (hot_score DESC);

-- Top contributors cache (refresh hourly)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_contributors AS
SELECT 
  p.id,
  p.username,
  p.display_name,
  p.avatar_url,
  COUNT(DISTINCT fp.id) as post_count,
  COUNT(DISTINCT fc.id) as comment_count,
  SUM(fp.vote_count) + SUM(fc.vote_count) as total_karma,
  COUNT(DISTINCT fm.forum_id) as forum_count
FROM profiles p
LEFT JOIN forum_posts fp ON fp.user_id = p.id AND fp.created_at > NOW() - INTERVAL '30 days'
LEFT JOIN forum_comments fc ON fc.user_id = p.id AND fc.created_at > NOW() - INTERVAL '30 days'
LEFT JOIN forum_members fm ON fm.user_id = p.id
GROUP BY p.id
HAVING COUNT(DISTINCT fp.id) > 0 OR COUNT(DISTINCT fc.id) > 0
ORDER BY total_karma DESC
LIMIT 100;

CREATE UNIQUE INDEX ON mv_top_contributors (id);

-- Forum stats cache (refresh every 15 minutes)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_forum_stats AS
SELECT 
  f.*,
  COUNT(DISTINCT fm.user_id) as actual_member_count,
  COUNT(DISTINCT fp.id) as actual_post_count,
  COUNT(DISTINCT fp.id) FILTER (WHERE fp.created_at > NOW() - INTERVAL '24 hours') as posts_24h,
  COUNT(DISTINCT fp.id) FILTER (WHERE fp.created_at > NOW() - INTERVAL '7 days') as posts_7d,
  AVG(fp.vote_count)::int as avg_post_votes
FROM forums f
LEFT JOIN forum_members fm ON fm.forum_id = f.id
LEFT JOIN forum_posts fp ON fp.forum_id = f.id
GROUP BY f.id;

CREATE UNIQUE INDEX ON mv_forum_stats (id);
CREATE INDEX ON mv_forum_stats (posts_24h DESC);

-- ============================================================================
-- 4. REFRESH FUNCTIONS FOR MATERIALIZED VIEWS
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_hot_posts()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hot_posts;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_top_contributors()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_contributors;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_forum_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_forum_stats;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. CONNECTION POOLING & PREPARED STATEMENTS
-- ============================================================================

-- Set optimal connection settings
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET effective_cache_size = '6GB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET work_mem = '10MB';
ALTER SYSTEM SET min_wal_size = '1GB';
ALTER SYSTEM SET max_wal_size = '4GB';

-- ============================================================================
-- 6. QUERY OPTIMIZATION FUNCTIONS
-- ============================================================================

-- Efficient hot posts query (uses materialized view)
CREATE OR REPLACE FUNCTION get_hot_posts(
  p_forum_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  forum_id UUID,
  title TEXT,
  content TEXT,
  vote_count INTEGER,
  comment_count INTEGER,
  created_at TIMESTAMPTZ,
  hot_score FLOAT,
  forum_name TEXT,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    hp.id,
    hp.forum_id,
    hp.title,
    hp.content,
    hp.vote_count,
    hp.comment_count,
    hp.created_at,
    hp.hot_score,
    hp.forum_name,
    hp.username,
    hp.user_display_name,
    hp.avatar_url
  FROM mv_hot_posts hp
  WHERE p_forum_id IS NULL OR hp.forum_id = p_forum_id
  ORDER BY hp.hot_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- Efficient comment thread loading (single query, no N+1)
CREATE OR REPLACE FUNCTION get_comment_thread(
  p_post_id UUID,
  p_max_depth INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  parent_comment_id UUID,
  user_id UUID,
  content TEXT,
  vote_count INTEGER,
  created_at TIMESTAMPTZ,
  depth INTEGER,
  path TEXT,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE comment_tree AS (
    -- Base case: top-level comments
    SELECT 
      c.id,
      c.parent_comment_id,
      c.user_id,
      c.content,
      c.vote_count,
      c.created_at,
      0 as depth,
      c.id::TEXT as path,
      p.username,
      p.display_name,
      p.avatar_url
    FROM forum_comments c
    JOIN profiles p ON p.id = c.user_id
    WHERE c.post_id = p_post_id 
      AND c.parent_comment_id IS NULL
      AND NOT c.is_deleted
    
    UNION ALL
    
    -- Recursive case: child comments
    SELECT 
      c.id,
      c.parent_comment_id,
      c.user_id,
      c.content,
      c.vote_count,
      c.created_at,
      ct.depth + 1,
      ct.path || '/' || c.id::TEXT,
      p.username,
      p.display_name,
      p.avatar_url
    FROM forum_comments c
    JOIN profiles p ON p.id = c.user_id
    JOIN comment_tree ct ON c.parent_comment_id = ct.id
    WHERE ct.depth < p_max_depth AND NOT c.is_deleted
  )
  SELECT * FROM comment_tree
  ORDER BY path, created_at ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 7. CACHING LAYER WITH REDIS-COMPATIBLE TABLES
-- ============================================================================

-- Cache table for hot data (TTL-based)
CREATE TABLE IF NOT EXISTS cache_entries (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache_entries(expires_at) 
WHERE expires_at > NOW();

-- Auto-cleanup expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM cache_entries WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 8. RATE LIMITING WITH SLIDING WINDOW
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, action, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_action 
ON rate_limits(user_id, action, window_start DESC);

-- Rate limit check with sliding window
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id UUID,
  p_action TEXT,
  p_max_count INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_total_count INTEGER;
BEGIN
  v_window_start := DATE_TRUNC('minute', NOW());
  
  -- Count recent actions in sliding window
  SELECT COALESCE(SUM(count), 0) INTO v_total_count
  FROM rate_limits
  WHERE user_id = p_user_id
    AND action = p_action
    AND window_start > NOW() - INTERVAL '1 second' * p_window_seconds;
  
  -- Check if under limit
  IF v_total_count >= p_max_count THEN
    RETURN FALSE;
  END IF;
  
  -- Increment counter
  INSERT INTO rate_limits (user_id, action, window_start, count)
  VALUES (p_user_id, p_action, v_window_start, 1)
  ON CONFLICT (user_id, action, window_start)
  DO UPDATE SET count = rate_limits.count + 1;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Cleanup old rate limit entries (run hourly)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits 
  WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 9. STATISTICS AND MONITORING
-- ============================================================================

-- Update table statistics for better query planning
ANALYZE profiles;
ANALYZE forum_posts;
ANALYZE forum_comments;
ANALYZE forum_votes;
ANALYZE chat_messages;
ANALYZE track_comments;

-- Create monitoring view for slow queries
CREATE OR REPLACE VIEW slow_queries AS
SELECT 
  query,
  calls,
  total_exec_time / 1000 as total_time_sec,
  mean_exec_time / 1000 as mean_time_sec,
  max_exec_time / 1000 as max_time_sec
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY total_exec_time DESC
LIMIT 50;

-- ============================================================================
-- 10. AUTOMATED MAINTENANCE JOBS
-- ============================================================================

-- Schedule via pg_cron or external scheduler:
-- Every 5 minutes: refresh hot posts
-- Every 15 minutes: refresh forum stats
-- Every hour: refresh top contributors, cleanup rate limits, cleanup cache
-- Daily: vacuum analyze, update statistics

-- Example pg_cron setup (if available):
-- SELECT cron.schedule('refresh-hot-posts', '*/5 * * * *', 'SELECT refresh_hot_posts()');
-- SELECT cron.schedule('refresh-forum-stats', '*/15 * * * *', 'SELECT refresh_forum_stats()');
-- SELECT cron.schedule('cleanup-cache', '0 * * * *', 'SELECT cleanup_expired_cache()');
-- SELECT cron.schedule('cleanup-rate-limits', '0 * * * *', 'SELECT cleanup_old_rate_limits()');

COMMENT ON MATERIALIZED VIEW mv_hot_posts IS 
'Cached hot posts with score calculation. Refresh every 5 minutes for performance.';

COMMENT ON FUNCTION get_hot_posts IS 
'Efficient hot posts query using materialized view. Supports forum filtering and pagination.';

COMMENT ON FUNCTION get_comment_thread IS 
'Single-query comment thread loader with recursive CTE. No N+1 queries.';


-- ---------- 20260122_performance_tracking.sql ----------
-- Performance Test Results Table
-- Stores automated performance test metrics for admin dashboard

CREATE TABLE IF NOT EXISTS performance_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_suite TEXT NOT NULL,
  test_name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'warning')),
  threshold_ms INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  tested_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_tests_suite ON performance_test_results(test_suite);
CREATE INDEX IF NOT EXISTS idx_performance_tests_status ON performance_test_results(status);
CREATE INDEX IF NOT EXISTS idx_performance_tests_tested_at ON performance_test_results(tested_at DESC);
CREATE INDEX IF NOT EXISTS idx_performance_tests_name ON performance_test_results(test_name);

-- Function: Get performance trends over time
CREATE OR REPLACE FUNCTION get_performance_trends(
  p_test_name TEXT DEFAULT NULL,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE(
  test_name TEXT,
  avg_duration NUMERIC,
  min_duration INTEGER,
  max_duration INTEGER,
  test_count BIGINT,
  pass_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ptr.test_name,
    ROUND(AVG(ptr.duration_ms)::NUMERIC, 2) as avg_duration,
    MIN(ptr.duration_ms) as min_duration,
    MAX(ptr.duration_ms) as max_duration,
    COUNT(*) as test_count,
    ROUND((COUNT(*) FILTER (WHERE ptr.status = 'pass')::NUMERIC / COUNT(*)::NUMERIC * 100), 2) as pass_rate
  FROM performance_test_results ptr
  WHERE 
    (p_test_name IS NULL OR ptr.test_name = p_test_name)
    AND ptr.tested_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY ptr.test_name
  ORDER BY avg_duration DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get slowest features
CREATE OR REPLACE FUNCTION get_slowest_features(p_limit INTEGER DEFAULT 10)
RETURNS TABLE(
  test_name TEXT,
  test_suite TEXT,
  avg_duration NUMERIC,
  last_tested TIMESTAMPTZ,
  failure_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ptr.test_name,
    ptr.test_suite,
    ROUND(AVG(ptr.duration_ms)::NUMERIC, 2) as avg_duration,
    MAX(ptr.tested_at) as last_tested,
    COUNT(*) FILTER (WHERE ptr.status = 'fail') as failure_count
  FROM performance_test_results ptr
  WHERE ptr.tested_at >= NOW() - INTERVAL '7 days'
  GROUP BY ptr.test_name, ptr.test_suite
  ORDER BY avg_duration DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get performance summary for dashboard
CREATE OR REPLACE FUNCTION get_performance_summary()
RETURNS TABLE(
  total_tests BIGINT,
  passed_tests BIGINT,
  failed_tests BIGINT,
  warning_tests BIGINT,
  avg_duration NUMERIC,
  pass_rate NUMERIC,
  last_test_run TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total_tests,
    COUNT(*) FILTER (WHERE status = 'pass') as passed_tests,
    COUNT(*) FILTER (WHERE status = 'fail') as failed_tests,
    COUNT(*) FILTER (WHERE status = 'warning') as warning_tests,
    ROUND(AVG(duration_ms)::NUMERIC, 2) as avg_duration,
    ROUND((COUNT(*) FILTER (WHERE status = 'pass')::NUMERIC / COUNT(*)::NUMERIC * 100), 2) as pass_rate,
    MAX(tested_at) as last_test_run
  FROM performance_test_results
  WHERE tested_at >= NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get test history for specific feature
CREATE OR REPLACE FUNCTION get_test_history(
  p_test_name TEXT,
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE(
  tested_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT,
  threshold_ms INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ptr.tested_at,
    ptr.duration_ms,
    ptr.status,
    ptr.threshold_ms
  FROM performance_test_results ptr
  WHERE 
    ptr.test_name = p_test_name
    AND ptr.tested_at >= NOW() - (p_days || ' days')::INTERVAL
  ORDER BY ptr.tested_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies
ALTER TABLE performance_test_results ENABLE ROW LEVEL SECURITY;

-- Admins can view all performance results
CREATE POLICY "Admins can view performance results"
  ON performance_test_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Service role can insert results
CREATE POLICY "Service role can insert performance results"
  ON performance_test_results FOR INSERT
  WITH CHECK (true);

-- Comments
COMMENT ON TABLE performance_test_results IS 'Automated performance test results for monitoring feature speed';
COMMENT ON FUNCTION get_performance_trends IS 'Returns performance metrics trends over specified time period';
COMMENT ON FUNCTION get_slowest_features IS 'Returns list of slowest features based on recent tests';
COMMENT ON FUNCTION get_performance_summary IS 'Returns overall performance summary for dashboard';
COMMENT ON FUNCTION get_test_history IS 'Returns historical test results for a specific feature';


-- ---------- 20260122_profile_themes.sql ----------
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

CREATE TRIGGER user_themes_updated_at
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


-- ---------- 20260122_premium_billing.sql ----------
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
