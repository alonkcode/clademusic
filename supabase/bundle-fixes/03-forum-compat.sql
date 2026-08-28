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
