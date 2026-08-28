-- ⚠️  DESTRUCTIVE. Deletes every table, view, function and trigger in the
--     `public` schema, and all data in them.
--
-- Use this ONLY to recover a project where a partial or failed schema apply
-- left things inconsistent, and where `public` holds nothing you need.
--
-- It does NOT touch `auth`, so registered users survive. The signup trigger
-- lives on auth.users and points at public functions, so it is dropped
-- explicitly here and recreated by part 06.
--
-- If you have real data in `public`, back it up first and do not run this.

BEGIN;

-- Must go first: it references public.handle_new_user(), which the schema drop
-- below removes. Left in place it would break every subsequent signup.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS trigger_create_auto_playlists ON auth.users;

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Restore the default grants Supabase expects on a fresh project.
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

COMMIT;

-- Expect zero.
SELECT count(*) AS remaining_public_tables
FROM information_schema.tables WHERE table_schema = 'public';
