#!/usr/bin/env bash
#
# Split supabase/migrations into a handful of ordered, paste-sized SQL files for
# the Supabase SQL Editor. Use when the CLI cannot reach the project and
# `supabase db push` is unavailable.
#
# Each part is wrapped in BEGIN/COMMIT so it applies atomically - if a part
# fails you know exactly which one, and nothing from it is half-applied.
# Parts MUST be run in numeric order; later ones depend on earlier tables.
#
# CREATE INDEX CONCURRENTLY is rewritten to plain CREATE INDEX: the concurrent
# form is forbidden inside a transaction block and buys nothing on an empty
# project. The migrations themselves are never modified.
set -euo pipefail

cd "$(dirname "$0")/.."
outdir=supabase/sql-editor
rm -rf "$outdir"
mkdir -p "$outdir"

emit() {
  local part="$1" title="$2"; shift 2
  local file="$outdir/${part}.sql"
  {
    echo "-- GENERATED - do not edit. Regenerate: bash scripts/build-sql-editor-parts.sh"
    echo "-- PART ${part}: ${title}"
    echo "-- Run parts in numeric order. Paste whole file into the SQL Editor."
    echo
    echo "BEGIN;"
    for f in "$@"; do
      echo
      echo "-- ---------- $f ----------"
      sed 's/CREATE INDEX CONCURRENTLY/CREATE INDEX/g' "supabase/migrations/$f"
      echo
    done
    echo
    echo "COMMIT;"
  } > "$file"
  echo "  ${part}.sql  ($(wc -l < "$file") lines)  ${title}"
}

echo "Writing $outdir:"

emit 01-core-schema "profiles, roles, credits, tracks, base RLS" \
  20260114211348_2a4485e7-9d33-4c9d-9ea8-0420e1ad4044.sql \
  20260114211408_1be47900-6c38-4adb-b34e-5dfe41a998e4.sql \
  20260115085704_58686868-f4a3-4d8f-9b0b-766b1d0430fc.sql \
  20260115092130_unified_music_schema.sql

emit 02-tracks-and-security "sections, locations RLS, security fixes, 2FA" \
  20260117165737_58521ad8-f29a-48ec-b38b-292f2369be61.sql \
  20260118065431_c2bd75bd-b63c-4560-bc4c-0f96e698af9d.sql \
  20260120091200_add_sections_to_tracks.sql \
  20260120201900_fix_user_locations_rls.sql \
  20260120202800_critical_security_fixes.sql \
  20260120_add_track_sections.sql \
  20260120_secure_2fa_secrets.sql

emit 03-social "reactions, chat, playlists, forum, comments, interactions" \
  20260122_emoji_reactions.sql \
  20260122_live_chat.sql \
  20260122_playlists.sql \
  20260122_reddit_forum.sql \
  20260122_track_comments.sql \
  20260122_unified_interactions.sql

emit 04-performance-and-billing "indexes, perf tracking, themes, premium billing" \
  20260122_optimize_indexes.sql \
  20260122_performance_optimization.sql \
  20260122_performance_tracking.sql \
  20260122_profile_themes.sql \
  20260122_premium_billing.sql

emit 05-harmonic-and-telemetry "test runs, billing core, harmonic analysis, telemetry" \
  202601240001_test_runs.sql \
  20260124_billing_core.sql \
  20260125_harmonic_analysis_core.sql \
  20260204130000_playback_telemetry.sql

emit 06-harden-signup "signup trigger hardening + backfill" \
  20260828120000_harden_signup_trigger.sql

> "$outdir/99-verify.sql" cat <<'VERIFY_SQL'
-- GENERATED - do not edit. Regenerate: bash scripts/build-sql-editor-parts.sh
-- Verification queries. Run AFTER parts 01-06.
-- Run each block separately: the SQL Editor shows only the last result set.

-- 1. Every table created, with RLS status.
--    Anything with rls_enabled = false and 0 policies is readable through the
--    anon key - confirm that is intended.
SELECT
  c.relname        AS table_name,
  c.relrowsecurity AS rls_enabled,
  count(p.polname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;


-- 2. The tables the app actually queries must all exist.
--    Any false here means a part failed to apply.
SELECT t.name AS expected_table,
       to_regclass('public.' || t.name) IS NOT NULL AS exists
FROM (VALUES
  ('profiles'), ('user_roles'), ('user_credits'),
  ('tracks'), ('track_provider_links'), ('track_connections'),
  ('feed_items'), ('play_events'),
  ('track_comments'), ('user_interactions'),
  ('harmonic_fingerprints')
) AS t(name)
ORDER BY 2, 1;


-- 3. The signup trigger must exist and be enabled.
--    Without it, new users get no profile row.
--    tgenabled: 'O' = enabled. 'D' = disabled, a problem.
SELECT tgname AS trigger_name, tgenabled AS enabled_flag
FROM pg_trigger
WHERE tgname = 'on_auth_user_created' AND NOT tgisinternal;


-- 4. Confirm the trigger carries the hardening from part 06.
--    Both must be true; if either is false, part 06 did not apply.
SELECT
  prosrc LIKE '%ON CONFLICT%'   AS has_conflict_guards,
  prosrc LIKE '%RAISE WARNING%' AS has_exception_logging
FROM pg_proc
WHERE proname = 'handle_new_user';


-- 5. Auth wiring: every user needs a profile, a role and credits.
--    All three "missing" counts should be 0.
SELECT
  (SELECT count(*) FROM auth.users)                     AS users,
  (SELECT count(*) FROM auth.users u
     LEFT JOIN public.profiles p ON p.id = u.id
     WHERE p.id IS NULL)                                AS missing_profiles,
  (SELECT count(*) FROM auth.users u
     LEFT JOIN public.user_roles r ON r.user_id = u.id
     WHERE r.user_id IS NULL)                           AS missing_roles,
  (SELECT count(*) FROM auth.users u
     LEFT JOIN public.user_credits c ON c.user_id = u.id
     WHERE c.user_id IS NULL)                           AS missing_credits;


-- 6. Data volumes. All zero until scripts/seed.js runs.
SELECT 'tracks' AS table_name, count(*) FROM public.tracks
UNION ALL SELECT 'track_provider_links', count(*) FROM public.track_provider_links
UNION ALL SELECT 'feed_items',           count(*) FROM public.feed_items
UNION ALL SELECT 'profiles',             count(*) FROM public.profiles
ORDER BY 1;
VERIFY_SQL

echo "  99-verify.sql  ($(wc -l < "$outdir/99-verify.sql") lines)  post-install checks"
echo
echo "Done. Run 01 -> 06 in order, then supabase/sql-editor/99-verify.sql"
