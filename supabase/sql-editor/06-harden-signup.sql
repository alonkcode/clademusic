-- GENERATED - do not edit. Regenerate: bash scripts/build-sql-editor-parts.sh
-- PART 06-harden-signup: signup trigger hardening + backfill
-- Run parts in numeric order. Paste whole file into the SQL Editor.

BEGIN;

-- ---------- 20260828120000_harden_signup_trigger.sql ----------
-- Harden the signup trigger.
--
-- Problem: public.handle_new_user() runs AFTER INSERT ON auth.users and does
-- three unguarded INSERTs. Because the trigger runs inside the same transaction
-- as the auth.users insert, ANY failure in it (a duplicate row, a missing
-- table, an RLS/permission surprise) rolls back the whole statement. GoTrue
-- then reports the opaque "Database error saving new user" and registration is
-- dead in the water with nothing useful in the client.
--
-- Fix, in two parts:
--   1. Make every insert idempotent (ON CONFLICT DO NOTHING), so a retried or
--      partially-applied signup cannot collide with itself.
--   2. Catch any remaining exception and log a warning instead of propagating.
--      Creating the account is the critical path; provisioning the profile rows
--      is recoverable and must never be able to block it.
--
-- COALESCE on display_name also guards the case where email is NULL (phone or
-- OAuth signups), which would otherwise yield a NULL display name.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(
        NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
        NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
        'listener'
      )
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: could not create profile for %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: could not assign role for %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    INSERT INTO public.user_credits (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: could not create credits for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Recreate the trigger idempotently so this migration is safe to re-run.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill anything the old, fragile trigger dropped on the floor.
INSERT INTO public.profiles (id, email, display_name)
SELECT
  u.id,
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

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'user'
FROM auth.users u
LEFT JOIN public.user_roles r ON r.user_id = u.id
WHERE r.user_id IS NULL
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_credits (user_id)
SELECT u.id
FROM auth.users u
LEFT JOIN public.user_credits c ON c.user_id = u.id
WHERE c.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;


COMMIT;
