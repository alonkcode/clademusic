#!/usr/bin/env bash
#
# Split the VERIFIED supabase/schema_bundle.sql into paste-sized parts for the
# Supabase SQL Editor.
#
# These are slices of the bundle, not a re-derivation from supabase/migrations.
# That matters: the bundle interleaves ordering changes and compat fragments
# (supabase/bundle-fixes/*) between specific migrations, and rebuilding the
# parts independently would drop them. Slicing guarantees the parts contain
# exactly what scripts/test-schema-bundle.sh verified.
#
# Run:   bash scripts/build-schema-bundle.sh && bash scripts/build-sql-editor-parts.sh
set -euo pipefail

cd "$(dirname "$0")/.."

bundle=supabase/schema_bundle.sql
outdir=supabase/sql-editor

[ -f "$bundle" ] || { echo "Missing $bundle - run scripts/build-schema-bundle.sh first"; exit 1; }

rm -rf "$outdir"; mkdir -p "$outdir"

# Split points: the bundle section header naming each source file. A part ends
# just before the named file's header. Chosen so each part is a coherent stage
# and no compat fragment is separated from the migration it patches.
awk -v outdir="$outdir" '
  function partfile(n, name) { return sprintf("%s/%02d-%s.sql", outdir, n, name) }
  BEGIN {
    n = 1
    names[1]="core-schema"; names[2]="security-and-sections"; names[3]="forum-and-social"
    names[4]="playlists-and-billing"; names[5]="performance"; names[6]="harmonic-and-signup"
    # A new part starts when the bundle reaches one of these source files.
    starts["20260117165737_58521ad8-f29a-48ec-b38b-292f2369be61.sql"]=2
    starts["20260122_reddit_forum.sql"]=3
    starts["20260122_playlists.sql"]=4
    starts["20260122_performance_tracking.sql"]=5
    starts["202601240001_test_runs.sql"]=6
    cur = partfile(1, names[1])
    print "-- GENERATED - slice of supabase/schema_bundle.sql. Do not edit." > cur
    print "-- PART 1/6: " names[1] > cur
    print "-- Run parts 01..06 IN ORDER in the Supabase SQL Editor." > cur
    print "" > cur
    print "BEGIN;" > cur
    pending = 0
  }
  # Section headers look like:  -- <filename>   between two ==== rules.
  /^-- =+$/ { rule = 1; buf = $0; next }
  rule == 1 {
    fname = $0; sub(/^-- /, "", fname)
    if (fname in starts && starts[fname] != n) {
      print "" > cur; print "COMMIT;" > cur; close(cur)
      n = starts[fname]
      cur = partfile(n, names[n])
      print "-- GENERATED - slice of supabase/schema_bundle.sql. Do not edit." > cur
      print "-- PART " n "/6: " names[n] > cur
      print "-- Run parts 01..06 IN ORDER in the Supabase SQL Editor." > cur
      print "" > cur
      print "BEGIN;" > cur
    }
    print "" > cur; print buf > cur; print $0 > cur
    rule = 2; next
  }
  rule == 2 && /^-- =+$/ { print $0 > cur; rule = 0; next }
  # Drop the bundle-level transaction; each part supplies its own.
  /^BEGIN;$/ && NR < 20 { next }
  /^COMMIT;$/ { next }
  { print $0 > cur }
  END { print "" > cur; print "COMMIT;" > cur; close(cur) }
' "$bundle"

for f in "$outdir"/*.sql; do
  printf '  %-38s %5s lines\n' "$(basename "$f")" "$(wc -l < "$f")"
done

# Verification queries (not a slice - written fresh each time).
cat > "$outdir/99-verify.sql" <<'VERIFY_SQL'
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
VERIFY_SQL

printf '  %-38s %5s lines\n' "99-verify.sql" "$(wc -l < "$outdir/99-verify.sql")"
echo
echo "Run 01..06 in order, then 99-verify.sql"
