-- Add the foreign keys four more embeds need, found once 11-hotfix fixed the
-- errors that had been hiding them.
--
-- 11-hotfix-rls-recursion-and-fks.sql repaired forum_posts, forum_comments,
-- playlists and playlist_tracks. Those now work. But with the recursion errors
-- gone, a sweep of every embed in the codebase against the live database
-- turned up four that still fail with PGRST200 ("Could not find a
-- relationship"), because each user_id column points at auth.users - which
-- the API does not expose - and never at public.profiles:
--
--   playlist_collaborators.user_id  -> profiles   /playlist/:id page
--   user_themes.user_id             -> profiles   theme sharing
--   track_comments.user_id          -> profiles   feed scrolling comments
--   user_interactions.user_id       -> profiles   admin dashboard
--
-- THIS FILE IS PURELY ADDITIVE: it removes nothing and rewrites no column. It adds
-- a second foreign key next to the existing auth.users one instead of
-- replacing it. The API only resolves relationships inside exposed schemas,
-- so the new profiles key is the one it uses, and the auth.users key keeps
-- enforcing what it always did. Re-running it is safe: each key is only added
-- when it is not already there.
--
-- Each key is added NOT VALID first, so a pre-existing row with no matching
-- profile cannot abort the run, and then validated. If validation finds such
-- rows it leaves that one key unvalidated with a warning rather than deleting
-- anything - it still enforces every new row either way.
--
-- NOT covered here, deliberately: user_interactions.track_id -> tracks. That
-- column is text in this database while tracks.id is uuid, so no foreign key
-- is possible without rewriting the column, and it most likely holds provider
-- ids rather than catalogue uuids anyway. It is fixed in application code
-- instead.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.

BEGIN;

-- Every new key points at public.profiles, so each user needs a row there.
-- 11-hotfix already backfilled this; re-running catches anyone who signed up
-- since without a profile row. ON CONFLICT makes it a no-op otherwise.
INSERT INTO public.profiles (id, email, display_name)
SELECT u.id,
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

DO $$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('playlist_collaborators', 'playlist_collaborators_user_id_profiles_fkey', 'CASCADE'),
      ('user_themes',            'user_themes_user_id_profiles_fkey',            'CASCADE'),
      ('track_comments',         'track_comments_user_id_profiles_fkey',         'SET NULL'),
      ('user_interactions',      'user_interactions_user_id_profiles_fkey',      'CASCADE')
    ) AS t(tbl, conname, on_delete)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
      RAISE WARNING 'table public.% does not exist - skipped', spec.tbl;
      CONTINUE;
    END IF;

    -- Already has a key from user_id to profiles (under any name)?
    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND c.conrelid = ('public.' || spec.tbl)::regclass
        AND c.confrelid = 'public.profiles'::regclass
        AND a.attname = 'user_id'
    ) THEN
      RAISE NOTICE '%: user_id -> profiles already exists - nothing to do', spec.tbl;
      CONTINUE;
    END IF;

    -- SET NULL needs a nullable column; fall back rather than fail.
    IF spec.on_delete = 'SET NULL' AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec.tbl
        AND column_name = 'user_id' AND is_nullable = 'NO'
    ) THEN
      spec.on_delete := 'CASCADE';
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE %s NOT VALID',
      spec.tbl, spec.conname, spec.on_delete
    );

    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', spec.tbl, spec.conname);
      RAISE NOTICE '%: added and validated %', spec.tbl, spec.conname;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING '%: added % but some existing rows reference a missing profile, so it is left unvalidated. Nothing was deleted; new rows are still enforced.',
        spec.tbl, spec.conname;
    END;
  END LOOP;
END;
$$;

COMMIT;

-- Make the new relationships usable immediately instead of on next redeploy.
NOTIFY pgrst, 'reload schema';

-- Verify: one row per table, validated = true is the normal outcome.
SELECT conrelid::regclass AS table_name,
       conname            AS constraint_name,
       convalidated       AS validated
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid = 'public.profiles'::regclass
  AND conrelid IN (
    'public.playlist_collaborators'::regclass,
    'public.user_themes'::regclass,
    'public.track_comments'::regclass,
    'public.user_interactions'::regclass
  )
ORDER BY 1;
