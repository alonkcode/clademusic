-- Seed a handful of fake users for local testing.
--
-- Inserts straight into auth.users instead of going through the client SDK
-- or the Admin API: this project's .env has no SUPABASE_SERVICE_ROLE_KEY (see
-- docs/TODO.md), so auth.admin.createUser() isn't available, and a normal
-- client-side signup would fire a real confirmation email via Resend to each
-- fake address. The SQL Editor runs as postgres, so neither restriction
-- applies here - email_confirmed_at is set directly, so GoTrue never tries
-- to send anything.
--
-- public.handle_new_user() and public.create_auto_playlists() are both
-- AFTER INSERT triggers on auth.users (06-harmonic-and-signup.sql) - they
-- fire on this insert exactly like a real signup, so each fake user also
-- gets a profile row, a 'user' role, 50 starting credits, and the three
-- default playlists for free. This script only fills in the extra profile
-- flavor (avatar, username, full name) those triggers don't set.
--
-- scripts/generate-fake-users.ts (JS, needs the service-role key, aimed at
-- 1,000,000 users) is not usable as-is: it inserts straight into
-- public.profiles, but profiles.id is `REFERENCES auth.users(id)`, so every
-- row would fail that FK. This script is the SQL-side equivalent, sized for
-- local testing instead.
--
-- All fake accounts share the @fakeseed.test domain (a reserved,
-- never-routable TLD per RFC 2606) so they're easy to find and wipe later:
--   DELETE FROM auth.users WHERE email LIKE '%@fakeseed.test';
-- (cascades to profiles/user_roles/credits/playlists automatically).
--
-- Shared login password for every seeded account: FakeUser123!
--
-- Safe to re-run: skips any (first,last,i) combination whose email already
-- exists, so re-running just tops up to v_count new users.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Change v_count below to seed more or fewer.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_count       INTEGER := 12;              -- <- how many fake users to create
  v_password    TEXT    := 'FakeUser123!';  -- <- shared login password for all of them
  v_instance    UUID    := '00000000-0000-0000-0000-000000000000';
  v_first_names TEXT[]  := ARRAY['Noa','Yael','Itai','Maya','Omri','Tal','Ronit','Eitan','Shira','Amir','Dana','Guy','Lior','Adi'];
  v_last_names  TEXT[]  := ARRAY['Cohen','Levi','Mizrahi','Katz','Peretz','Avraham','Shapiro','Ben-David','Azoulay','Golan'];
  i             INTEGER;
  v_first       TEXT;
  v_last        TEXT;
  v_username    TEXT;
  v_email       TEXT;
  v_display     TEXT;
  v_user_id     UUID;
  v_created     INTEGER := 0;
BEGIN
  FOR i IN 1..v_count LOOP
    v_first    := v_first_names[1 + floor(random() * array_length(v_first_names, 1))];
    v_last     := v_last_names[1 + floor(random() * array_length(v_last_names, 1))];
    v_username := lower(v_first || '_' || v_last || '_' || i);
    v_email    := v_username || '@fakeseed.test';
    v_display  := v_first || ' ' || v_last;

    IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
      CONTINUE;
    END IF;

    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      is_super_admin
    ) VALUES (
      v_instance, v_user_id, 'authenticated', 'authenticated', v_email,
      crypt(v_password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', v_display, 'seed_batch', true),
      '', '', '', '',
      false
    );

    -- Best-effort: needed for password login to work, but the identities
    -- schema has changed across Supabase versions, so don't let a mismatch
    -- here abort the whole batch - the auth.users row and its triggered
    -- profile/role/credits/playlists rows are the part that actually matters
    -- for populating the app with fake users.
    BEGIN
      INSERT INTO auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_user_id, v_user_id::text,
        jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
        'email', now(), now(), now()
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'auth.identities insert skipped for %: %', v_email, SQLERRM;
    END;

    -- handle_new_user() already created the profile row (id, email,
    -- display_name); fill in the rest for a more realistic-looking seed.
    UPDATE public.profiles
    SET username = v_username,
        full_name = v_display,
        avatar_url = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' || v_username
    WHERE id = v_user_id;

    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE 'Seeded % fake user(s)', v_created;
END;
$$;

COMMIT;

-- Verify
SELECT p.id, p.email, p.username, p.full_name, p.created_at
FROM public.profiles p
WHERE p.email LIKE '%@fakeseed.test'
ORDER BY p.created_at DESC;
