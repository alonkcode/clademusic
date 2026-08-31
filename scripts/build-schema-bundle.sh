#!/usr/bin/env bash
#
# Bundle supabase/migrations into one SQL file that applies cleanly to an EMPTY
# Supabase project via the SQL Editor.
#
# Verify with:  bash scripts/test-schema-bundle.sh   (needs Docker)
#
# This is not a plain concatenation. The migrations were written incrementally
# against a live database, so in pure filename order they do not apply to an
# empty one. Three classes of fix are applied here; the files in
# supabase/migrations/ are never modified.
#
#   1. ORDER. Filename order is not dependency order. 20260122_emoji_reactions
#      declares foreign keys to forum_posts/forum_comments, but those are
#      created in 20260122_reddit_forum, which sorts later ("e" < "r"). Same for
#      20260122_performance_optimization, which indexes the forum tables. The
#      explicit ORDER list below puts the forum schema first.
#
#   2. MISSING COLUMNS. See supabase/bundle-fixes/00-compat-prelude.sql, which
#      is emitted straight after the first migration.
#
#   3. STATEMENT REWRITES. Applied per-file by fix_sql() below, each commented
#      with the failure it prevents.
set -euo pipefail

cd "$(dirname "$0")/.."
out=supabase/schema_bundle.sql

# Dependency order. Forum tables move ahead of everything that references them;
# otherwise this matches filename order.
ORDER=(
  20260114211348_2a4485e7-9d33-4c9d-9ea8-0420e1ad4044.sql
  20260114211408_1be47900-6c38-4adb-b34e-5dfe41a998e4.sql
  20260115085704_58686868-f4a3-4d8f-9b0b-766b1d0430fc.sql
  20260115092130_unified_music_schema.sql
  20260117165737_58521ad8-f29a-48ec-b38b-292f2369be61.sql
  20260118065431_c2bd75bd-b63c-4560-bc4c-0f96e698af9d.sql
  20260120091200_add_sections_to_tracks.sql
  20260120201900_fix_user_locations_rls.sql
  20260120202800_critical_security_fixes.sql
  20260120_add_track_sections.sql
  20260120_secure_2fa_secrets.sql
  # Forum schema first - emoji_reactions and performance_optimization FK/index it.
  20260122_reddit_forum.sql
  20260122_emoji_reactions.sql
  20260122_live_chat.sql
  20260122_track_comments.sql
  20260122_playlists.sql
  20260122_unified_interactions.sql
  20260122_profile_themes.sql
  20260122_premium_billing.sql
  20260122_performance_tracking.sql
  20260122_optimize_indexes.sql
  20260122_performance_optimization.sql
  202601240001_test_runs.sql
  20260124_billing_core.sql
  20260125_harmonic_analysis_core.sql
  20260204130000_playback_telemetry.sql
  20260828120000_harden_signup_trigger.sql
  20260828140000_harden_auto_playlists.sql
)

fix_sql() {
  sed \
    `# CREATE INDEX CONCURRENTLY cannot run inside a transaction block. The` \
    `# concurrent form only exists to avoid locking a live table, so on an` \
    `# empty project it buys nothing. (REFRESH ... CONCURRENTLY inside function` \
    `# bodies is left alone - it runs at call time, not build time.)` \
    -e 's/CREATE INDEX CONCURRENTLY/CREATE INDEX/g' \
    `# ALTER SYSTEM requires superuser, is rejected inside a transaction, and is` \
    `# not permitted on managed Supabase at all. Instance tuning is a dashboard` \
    `# concern, not a migration.` \
    -e 's/^\s*ALTER SYSTEM SET/-- [bundle] removed, not permitted on Supabase: ALTER SYSTEM SET/' \
    `# The forum vote triggers fire on INSERT OR UPDATE OR DELETE with a WHEN` \
    `# clause referencing both NEW and OLD. Postgres rejects that outright:` \
    `# NEW does not exist on DELETE, OLD does not exist on INSERT. The guard is` \
    `# redundant - the function bodies filter on post_id/comment_id via WHERE,` \
    `# which simply matches no rows for the other kind of vote.` \
    -e '/^WHEN (NEW\.\(post_id\|comment_id\) IS NOT NULL OR OLD\.\(post_id\|comment_id\) IS NOT NULL)$/d' \
    `# Trigger names collide across migrations that both touch the same table` \
    `# (e.g. update_track_comments_updated_at, defined in 20260117 and again in` \
    `# 20260122). CREATE TRIGGER has no IF NOT EXISTS, so make them replaceable.` \
    `# Requires PG14+; Supabase projects are PG15+.` \
    -e 's/^CREATE TRIGGER /CREATE OR REPLACE TRIGGER /' \
    -e 's/^create trigger /create or replace trigger /' \
    `# Index names also collide across migrations (idx_playlists_user is defined` \
    `# in both 20260122_playlists and 20260122_unified_interactions). Only add` \
    `# IF NOT EXISTS where the index is NAMED - Postgres rejects it on the` \
    `# anonymous "CREATE INDEX ON tbl (col)" form used for the materialized views.` \
    -e 's/^CREATE INDEX \([a-zA-Z_][a-zA-Z0-9_]*\) ON /CREATE INDEX IF NOT EXISTS \1 ON /' \
    -e 's/^CREATE UNIQUE INDEX \([a-zA-Z_][a-zA-Z0-9_]*\) ON /CREATE UNIQUE INDEX IF NOT EXISTS \1 ON /' \
    -e 's/^create index \([a-zA-Z_][a-zA-Z0-9_]*\) on /create index if not exists \1 on /' \
    `# "LIKE <tbl> INCLUDING ALL" copies the source primary key (on id alone),` \
    `# but a partitioned table's unique constraints must contain the partition` \
    `# key: "unique constraint on partitioned table must include all` \
    `# partitioning columns". These two partitioned tables are scaffolding that` \
    `# nothing in the app reads or writes, so copy defaults only.` \
    -e 's/LIKE chat_messages INCLUDING ALL/LIKE chat_messages INCLUDING DEFAULTS/' \
    -e 's/LIKE forum_posts INCLUDING ALL/LIKE forum_posts INCLUDING DEFAULTS/' \
    `# user_interactions.track_id is TEXT (see the compat prelude), while` \
    `# tracks.id is UUID, so the track_stats join needs an explicit cast:` \
    `# "ERROR: operator does not exist: text = uuid".` \
    -e 's/LEFT JOIN public\.user_interactions ui ON ui\.track_id = t\.id/LEFT JOIN public.user_interactions ui ON ui.track_id = t.id::text/' \
    `# Partial index predicates must be IMMUTABLE, and NOW() is STABLE:` \
    `# "ERROR: functions in index predicate must be marked IMMUTABLE".` \
    `# These "only index recent rows" predicates would not work even if allowed -` \
    `# the cutoff is evaluated once at CREATE time and then never moves, so the` \
    `# index silently stops covering new rows. Dropped to plain indexes;` \
    `# genuinely immutable parts of the predicate (NOT is_deleted) are kept.` \
    -e "s/^WHERE created_at > NOW()[^;]* AND NOT is_deleted;/WHERE NOT is_deleted;/" \
    -e "s/^WHERE [a-z_]* > NOW()[^;]*;/;/" \
    -e "s/ WHERE [a-z_]* > NOW()[^;]*;/;/" \
    `# GENERATED ALWAYS ... STORED requires an IMMUTABLE expression, but` \
    `# timestamptz + interval is only STABLE (it resolves against TimeZone).` \
    `# Postgres: "ERROR: 42P17: generation expression is not immutable".` \
    `# Converted to plain columns; bundle-fixes/10-harmonic-retention.sql adds a` \
    `# trigger that maintains them.` \
    -e "s/^  reuse_until timestamptz generated always as (analysis_timestamp + interval '90 days') stored,/  reuse_until timestamptz not null default (now() + interval '90 days'),/" \
    -e "s/^  reanalyze_after timestamptz generated always as (analysis_timestamp + interval '365 days') stored,/  reanalyze_after timestamptz not null default (now() + interval '365 days'),/" \
    "$1"
}

{
  echo "-- GENERATED FILE - do not edit by hand."
  echo "-- Source: supabase/migrations/*.sql (dependency order, not filename order)"
  echo "-- Regenerate: bash scripts/build-schema-bundle.sh"
  echo "-- Verify:     bash scripts/test-schema-bundle.sh"
  echo "--"
  echo "-- Apply to a FRESH project via the Supabase SQL Editor."
  echo "-- Wrapped in a transaction: it either fully applies or fully rolls back."
  echo
  echo "BEGIN;"
  echo

  # The prelude ALTERs profiles, tracks, feed_items and user_interactions, so it
  # must come after the last migration that creates them, and before the first
  # that assumes the added columns exist.
  PRELUDE_AFTER=20260120_secure_2fa_secrets.sql

  for f in "${ORDER[@]}"; do
    echo
    echo "-- ============================================================"
    echo "-- $f"
    echo "-- ============================================================"
    fix_sql "supabase/migrations/$f"
    echo

    if [ "$f" = "$PRELUDE_AFTER" ]; then
      echo
      echo "-- ============================================================"
      echo "-- bundle-fixes/00-compat-prelude.sql"
      echo "-- ============================================================"
      cat supabase/bundle-fixes/00-compat-prelude.sql
      echo
    fi

    if [ "$f" = "20260122_reddit_forum.sql" ]; then
      echo
      echo "-- ============================================================"
      echo "-- bundle-fixes/03-forum-compat.sql"
      echo "-- ============================================================"
      cat supabase/bundle-fixes/03-forum-compat.sql
      echo
    fi

    # Must sit between the two playlist migrations.
    if [ "$f" = "20260122_playlists.sql" ]; then
      echo
      echo "-- ============================================================"
      echo "-- bundle-fixes/05-playlists-compat.sql"
      echo "-- ============================================================"
      cat supabase/bundle-fixes/05-playlists-compat.sql
      echo
    fi

    # Retention trigger replacing the rejected generated columns; needs the
    # harmonic_fingerprints table to exist first.
    if [ "$f" = "20260125_harmonic_analysis_core.sql" ]; then
      echo
      echo "-- ============================================================"
      echo "-- bundle-fixes/10-harmonic-retention.sql"
      echo "-- ============================================================"
      cat supabase/bundle-fixes/10-harmonic-retention.sql
      echo
    fi
  done

  echo
  echo "COMMIT;"
} > "$out"

echo "Wrote $out ($(wc -l < "$out") lines)"
