#!/usr/bin/env bash
#
# Apply supabase/schema_bundle.sql to a throwaway Postgres container to prove it
# works on an empty database. Requires Docker.
#
#   bash scripts/test-schema-bundle.sh
#
# Exits non-zero on the first SQL error, printing the failing line.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # keep Git Bash from rewriting container paths

cd "$(dirname "$0")/.."

CONTAINER=clade-schema-test
IMAGE=postgres:17

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=clade \
  "$IMAGE" >/dev/null

printf 'waiting for postgres'
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  printf '.'; sleep 2
done
echo

docker cp scripts/supabase-shim.sql   "$CONTAINER:/tmp/shim.sql"   >/dev/null
docker cp supabase/schema_bundle.sql  "$CONTAINER:/tmp/bundle.sql" >/dev/null

echo "--- applying Supabase shim (auth schema, roles) ---"
docker exec "$CONTAINER" psql -U postgres -d clade -q -v ON_ERROR_STOP=1 -f /tmp/shim.sql

echo "--- applying schema_bundle.sql ---"
# Capture on the host - the redirect below is a host-side redirect, so reading
# the file back inside the container would look in the wrong filesystem.
log=$(mktemp)
if docker exec "$CONTAINER" psql -U postgres -d clade -q -v ON_ERROR_STOP=1 -f /tmp/bundle.sql >"$log" 2>&1; then
  echo "BUNDLE APPLIED CLEANLY"
  grep -i 'NOTICE' "$log" | sed 's/^/  (notice) /' | head -10 || true
else
  echo "BUNDLE FAILED. First error:"
  grep -iE 'ERROR' "$log" | head -3
  echo "--- context ---"
  tail -15 "$log"
  rm -f "$log"
  exit 1
fi
rm -f "$log"

echo
echo "--- sanity checks ---"
docker exec "$CONTAINER" psql -U postgres -d clade -c "
SELECT t.name AS expected_table,
       to_regclass('public.' || t.name) IS NOT NULL AS exists
FROM (VALUES
  ('profiles'),('user_roles'),('user_credits'),('tracks'),
  ('track_provider_links'),('track_connections'),('feed_items'),
  ('play_events'),('track_comments'),('user_interactions'),
  ('harmonic_fingerprints'),('forum_posts'),('playlists')
) AS t(name) ORDER BY 2, 1;"

docker exec "$CONTAINER" psql -U postgres -d clade -c "
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgname = 'on_auth_user_created' AND NOT tgisinternal;"

echo "--- signup trigger smoke test ---"
# Signing up as `postgres` proves almost nothing: a superuser bypasses RLS, so
# any trigger that writes to an RLS-protected table appears to work and then
# fails on a real signup. GoTrue runs as supabase_auth_admin, which does NOT
# bypass RLS, so create that role and insert as it.
docker exec "$CONTAINER" psql -U postgres -d clade -q -c "
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin LOGIN PASSWORD 'x' NOINHERIT;
  END IF;
END \$\$;
GRANT USAGE ON SCHEMA auth, public TO supabase_auth_admin;
GRANT ALL ON ALL TABLES IN SCHEMA auth   TO supabase_auth_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO supabase_auth_admin;"

if docker exec -e PGPASSWORD=x "$CONTAINER" \
     psql -U supabase_auth_admin -h 127.0.0.1 -d clade -q -v ON_ERROR_STOP=1 -c \
     "INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('smoke@example.com', '{\"display_name\":\"Smoke Test\"}'::jsonb);" 2>/tmp/signup_err
then
  echo "signup OK (as supabase_auth_admin, RLS enforced)"
else
  echo "SIGNUP FAILED - this is the 'Database error saving new user' path:"
  cat /tmp/signup_err
  exit 1
fi

docker exec "$CONTAINER" psql -U postgres -d clade -c "
SELECT
  (SELECT count(*) FROM public.profiles)        AS profiles,
  (SELECT count(*) FROM public.user_roles)      AS roles,
  (SELECT count(*) FROM public.user_credits)    AS credits,
  (SELECT count(*) FROM public.playlists)       AS auto_playlists;"

echo
echo "Container '$CONTAINER' left running. Remove with: docker rm -f $CONTAINER"
