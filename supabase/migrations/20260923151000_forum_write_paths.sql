-- Make the forum safe to write to: counts that update, and roles that can't be self-assigned.
--
-- Until now the forum was read-only in the UI, so three problems in the schema
-- never surfaced. Creating posts, joining, commenting and voting exposes them.
--
-- 1. Counts never change for other people's content.
--    update_post_vote_count, update_comment_vote_count, update_post_comment_count,
--    update_forum_member_count and update_forum_post_count are ordinary
--    (SECURITY INVOKER) trigger functions, so their UPDATEs on forum_posts /
--    forum_comments / forums run as the voter, commenter or joiner and are
--    filtered by RLS - those tables only allow UPDATE to the author or a
--    moderator. Someone upvoting another user's post updated zero rows and the
--    score never moved. They only touch counter columns, so run them as the
--    table owner.
--
-- 2. Anyone could make themselves an admin.
--    forum_members_insert only checks user_id = auth.uid(); role is free. A user
--    could insert (forum, me, 'admin') into any forum and then edit or delete
--    every post in it through the moderator branches of the posts policies.
--    Members may now only insert themselves as 'member'. A forum's creator is
--    made its admin by a trigger instead of by the client.
--
-- 3. Realtime for forum_comments, so an open thread updates live. No migration
--    in this repo adds any table to the supabase_realtime publication.
--
-- Safe to re-run.

DO $$
DECLARE
  fn text;
  pol record;
BEGIN
  -- 1. Counters run as owner.
  FOREACH fn IN ARRAY ARRAY[
    'update_forum_member_count',
    'update_forum_post_count',
    'update_post_comment_count',
    'update_post_vote_count',
    'update_comment_vote_count'
  ] LOOP
    IF to_regprocedure('public.' || fn || '()') IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION public.%I() SECURITY DEFINER SET search_path = public', fn);
    END IF;
  END LOOP;

  -- 2. Members can only add themselves as plain members. Every existing INSERT
  --    policy is dropped first (policies are OR'd, so a permissive one under a
  --    different name would keep the hole open).
  IF to_regclass('public.forum_members') IS NOT NULL THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'forum_members' AND cmd = 'INSERT'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.forum_members', pol.policyname);
    END LOOP;

    CREATE POLICY "forum_members_insert" ON public.forum_members
      FOR INSERT
      WITH CHECK (auth.uid() = user_id AND role = 'member');
  END IF;

  -- 3. Realtime for comment threads.
  IF to_regclass('public.forum_comments') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'forum_comments'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.forum_comments;
  END IF;
END $$;

-- A forum's creator becomes its admin. Non-fatal: failing to add the membership
-- must never block creating the forum itself.
CREATE OR REPLACE FUNCTION public.add_forum_creator_as_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.forum_members (forum_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'admin')
    ON CONFLICT (forum_id, user_id) DO NOTHING;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'add_forum_creator_as_admin failed for forum %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.forums') IS NOT NULL AND to_regclass('public.forum_members') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trigger_add_forum_creator_as_admin ON public.forums;
    CREATE TRIGGER trigger_add_forum_creator_as_admin
      AFTER INSERT ON public.forums
      FOR EACH ROW EXECUTE FUNCTION public.add_forum_creator_as_admin();
  END IF;
END $$;
