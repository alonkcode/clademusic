-- Auth diagnosis + fix + verification. Run the WHOLE file in the SQL Editor.
-- Creates no users: the signup reproduction is rolled back.

-- ============================================================
-- 1. BEFORE: what is currently attached to auth.users?
-- ============================================================
-- prosecdef = true means SECURITY DEFINER. Both trigger functions MUST be
-- true, or they run as the signup role (supabase_auth_admin) and are blocked
-- by RLS on public.profiles / public.playlists.
SELECT
  t.tgname                                   AS trigger_name,
  p.proname                                  AS function_name,
  p.prosecdef                                AS security_definer,
  pg_get_userbyid(p.proowner)                AS function_owner,
  p.prosrc LIKE '%EXCEPTION%'                AS has_exception_handling
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal
ORDER BY t.tgname;


-- ============================================================
-- 2. FIX: idempotent, safe to re-run.
-- ============================================================
-- SECURITY DEFINER is correct here (not a workaround for a permission error):
-- these triggers run during signup, where there is no JWT at all, so auth.uid()
-- is NULL and no RLS policy keyed on it can ever pass. Running as the table
-- owner is the documented Supabase pattern for auth.users triggers.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (NEW.id, NEW.email,
      COALESCE(NULLIF(NEW.raw_user_meta_data->>'display_name',''),
               NULLIF(split_part(COALESCE(NEW.email,''),'@',1),''), 'listener'))
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user/profiles %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user/roles %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    INSERT INTO public.user_credits (user_id) VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user/credits %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.create_auto_playlists()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  BEGIN
    INSERT INTO public.playlists (user_id, name, description, type, is_public)
    VALUES
      (NEW.id,'Liked Songs','All your liked tracks in one place','liked',FALSE),
      (NEW.id,'Harmony Collection','Tracks with saved chord progressions','harmony',FALSE),
      (NEW.id,'Bookmarked','Saved for later','bookmarked',FALSE);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'create_auto_playlists %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS trigger_create_auto_playlists ON auth.users;
CREATE TRIGGER trigger_create_auto_playlists
  AFTER INSERT ON auth.users FOR EACH ROW
  EXECUTE FUNCTION public.create_auto_playlists();

-- These are trigger functions; nothing should be able to call them directly.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_auto_playlists() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 3. AFTER: confirm both are SECURITY DEFINER now.
-- ============================================================
SELECT t.tgname AS trigger_name, p.proname AS function_name,
       p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS owner
FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal
ORDER BY t.tgname;


-- ============================================================
-- 4. REPRODUCE THE REAL SIGNUP PATH — then roll back.
-- ============================================================
-- Running this as `postgres` proves nothing: postgres owns these tables and so
-- bypasses RLS. GoTrue signs up as supabase_auth_admin, which does not. If this
-- block raises, the message IS the hidden cause of "Database error saving new
-- user" - copy it back.
DO $diag$
DECLARE
  uid uuid := gen_random_uuid();
BEGIN
  SET LOCAL ROLE supabase_auth_admin;
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (uid, 'rollback-probe@example.com', '{"display_name":"Probe"}'::jsonb);
  RESET ROLE;
  RAISE NOTICE 'SIGNUP PATH OK - profile/role/credits/playlists created for %', uid;
  -- Undo it: this probe must not leave a user behind.
  DELETE FROM auth.users WHERE id = uid;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE NOTICE 'SIGNUP PATH FAILED: % (SQLSTATE %)', SQLERRM, SQLSTATE;
END
$diag$;

-- Should be 0 - the probe cleans up after itself.
SELECT count(*) AS leftover_probe_users
FROM auth.users WHERE email = 'rollback-probe@example.com';
