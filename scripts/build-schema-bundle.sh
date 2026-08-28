#!/usr/bin/env bash
#
# Bundle every migration in supabase/migrations into one ordered SQL file that
# can be pasted into the Supabase SQL Editor to provision a FRESH project.
#
# Use this when the Supabase CLI cannot reach the target project (no account
# access) and `supabase db push` is therefore unavailable.
#
# Note: CREATE INDEX CONCURRENTLY is rewritten to plain CREATE INDEX. The
# concurrent form exists to avoid locking a live table and is forbidden inside a
# transaction block; on an empty project it buys nothing and would abort the
# bundle. The migrations themselves are left untouched.
set -euo pipefail

cd "$(dirname "$0")/.."
out=supabase/schema_bundle.sql

{
  echo "-- GENERATED FILE - do not edit by hand."
  echo "-- Source: supabase/migrations/*.sql (CLI lexicographic order)"
  echo "-- Regenerate: bash scripts/build-schema-bundle.sh"
  echo "-- Apply to a fresh project via the Supabase SQL Editor."
  echo
  echo "BEGIN;"
  echo

  for f in $(ls supabase/migrations | sort); do
    echo
    echo "-- ============================================================"
    echo "-- $f"
    echo "-- ============================================================"
    # Only the CREATE INDEX form is rewritten; REFRESH MATERIALIZED VIEW
    # CONCURRENTLY inside function bodies is left alone (it runs at call time,
    # not at build time).
    sed 's/CREATE INDEX CONCURRENTLY/CREATE INDEX/g' "supabase/migrations/$f"
    echo
  done

  echo
  echo "COMMIT;"
} > "$out"

echo "Wrote $out ($(wc -l < "$out") lines)"
