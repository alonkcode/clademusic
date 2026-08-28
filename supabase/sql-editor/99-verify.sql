-- GENERATED - regenerate: bash scripts/build-sql-editor-parts.sh
-- Run AFTER parts 01-06. Run each block separately: the SQL Editor only shows
-- the result of the last statement.

-- 1. Tables the app queries. Every row must be true.
SELECT t.name AS expected_table,
       to_regclass('public.' || t.name) IS NOT NULL AS exists
FROM (VALUES
  ('profiles'),('user_roles'),('user_credits'),('tracks'),
  ('track_provider_links'),('track_connections'),('feed_items'),
  ('play_events'),('track_comments'),('user_interactions'),
  ('harmonic_fingerprints'),('forum_posts'),('playlists')
) AS t(name) ORDER BY 2, 1;

-- 2. Signup trigger must exist and be enabled ('O'). Without it new users get
--    no profile row.
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgname = 'on_auth_user_created' AND NOT tgisinternal;

-- 3. Trigger hardening present? Both must be true.
SELECT prosrc LIKE '%ON CONFLICT%'   AS has_conflict_guards,
       prosrc LIKE '%RAISE WARNING%' AS has_exception_logging
FROM pg_proc WHERE proname = 'handle_new_user';

-- 4. RLS coverage. Review anything with rls_enabled = false and 0 policies.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       count(p.polname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
GROUP BY 1,2 ORDER BY 1;

-- 5. Every auth user should have a profile, a role and credits. All zeros.
SELECT
  (SELECT count(*) FROM auth.users) AS users,
  (SELECT count(*) FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id
     WHERE p.id IS NULL) AS missing_profiles,
  (SELECT count(*) FROM auth.users u LEFT JOIN public.user_roles r ON r.user_id=u.id
     WHERE r.user_id IS NULL) AS missing_roles,
  (SELECT count(*) FROM auth.users u LEFT JOIN public.user_credits c ON c.user_id=u.id
     WHERE c.user_id IS NULL) AS missing_credits;

-- 6. Row counts. All zero until scripts/seed.js runs.
SELECT 'tracks' AS t, count(*) FROM public.tracks
UNION ALL SELECT 'feed_items', count(*) FROM public.feed_items
UNION ALL SELECT 'profiles',   count(*) FROM public.profiles
ORDER BY 1;
