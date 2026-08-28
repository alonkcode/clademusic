# Database Setup

How to provision a Supabase project for this app from an empty state.

## Which project am I pointing at?

Check before doing anything — there have been several project refs in play:

```bash
grep VITE_SUPABASE_URL .env          # what the app uses
grep project_id supabase/config.toml # what the CLI is linked to
```

These can disagree. `.env` wins for the running app; `config.toml` wins for
`supabase db push`. A quick way to tell whether a project has any schema:

```bash
curl -s -H "apikey: $KEY" "$URL/rest/v1/tracks?select=id&limit=1"
```

`PGRST205 — could not find the table` means the project is empty, not broken.

## Route A — Supabase CLI (preferred)

Requires the CLI to be authenticated as an account that owns the project.

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push        # applies supabase/migrations in order
```

If `npx supabase projects api-keys --project-ref <ref>` returns **403**, the
logged-in account cannot see that project and `db push` will not work. Either
log in as the owning account, or use Route B.

## Route B — SQL Editor (no CLI access needed)

Generated, paste-sized SQL split at migration boundaries:

```bash
bash scripts/build-sql-editor-parts.sh
```

Writes `supabase/sql-editor/`:

| File | Contents |
|------|----------|
| `01-core-schema.sql` | profiles, roles, credits, tracks, base RLS |
| `02-tracks-and-security.sql` | sections, locations RLS, security fixes, 2FA |
| `03-social.sql` | reactions, chat, playlists, forum, comments, interactions |
| `04-performance-and-billing.sql` | indexes, perf tracking, themes, premium billing |
| `05-harmonic-and-telemetry.sql` | test runs, billing core, harmonic analysis, telemetry |
| `06-harden-signup.sql` | signup trigger hardening + backfill |
| `99-verify.sql` | post-install checks |

Paste each whole file into the SQL Editor **in numeric order** — later parts
depend on earlier tables. Each part is wrapped in `BEGIN/COMMIT`, so a failure
leaves nothing half-applied and tells you exactly which part broke.

`scripts/build-schema-bundle.sh` produces the same thing as one 4,400-line file
if you prefer a single paste.

### Why the generators rewrite CONCURRENTLY

`CREATE INDEX CONCURRENTLY` **cannot run inside a transaction block**, so it
would abort a `BEGIN/COMMIT` bundle. The concurrent form exists only to avoid
locking a live table, which is meaningless on an empty project, so the
generators rewrite it to plain `CREATE INDEX`. Files in `supabase/migrations/`
are never modified — only the generated output.

`REFRESH MATERIALIZED VIEW CONCURRENTLY` inside function bodies is left alone;
it runs when the function is called, not at build time.

## Verify

Run `supabase/sql-editor/99-verify.sql`, one block at a time (the SQL Editor
only shows the last result set). What to look for:

- **Expected tables** — every row should be `true`.
- **`on_auth_user_created`** — must exist with `tgenabled = 'O'`. Without it,
  new users get no profile row.
- **Hardening flags** — both `true`, confirming part 06 applied.
- **Missing profiles/roles/credits** — all `0`.

## Seed

Easiest: paste **`supabase/sql-editor/07-seed.sql`** into the SQL Editor. It
needs no keys (SQL Editor statements run as the table owner, so RLS is not in
the way), inserts 47 tracks with chord progressions plus their provider links
and feed rows, and is safe to re-run — it upserts on `(external_id, provider)`.

Regenerate it from the TypeScript seed data with:

```bash
node scripts/build-seed-sql.mjs
```

Alternatively, via PostgREST:

```bash
export VITE_SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_KEY=<service-role-key>
node scripts/seed.js            # add --reset to clear first
```

Two traps in `scripts/seed.js`:

1. It **hardcodes a fallback project URL**. If `VITE_SUPABASE_URL` is unset it
   will happily seed the wrong project. Always export it first.
2. It prefers `SUPABASE_SERVICE_KEY`. The publishable/anon key is subject to RLS
   and will be rejected on insert.

## The signup trigger

`public.handle_new_user()` fires `AFTER INSERT ON auth.users` and provisions
`profiles`, `user_roles` and `user_credits`.

It runs **in the same transaction as the user insert**, so any failure inside it
rolls back the entire signup. GoTrue then returns the opaque *"Database error
saving new user"* — the single most common way Supabase registration breaks.

`20260828120000_harden_signup_trigger.sql` addresses this:

- every insert is `ON CONFLICT DO NOTHING`, so a retried signup cannot collide;
- each is wrapped in its own exception handler that logs a `WARNING` rather than
  propagating, so provisioning can never block account creation;
- users left without rows by the old trigger are backfilled.

If profiles still go missing, look for `handle_new_user:` warnings in the
Supabase logs — the account will now exist even when provisioning failed.
