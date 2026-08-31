# Development

## Start the Development Server
```bash
bun run dev
```
The app will be available at: http://localhost:8080/clademusic/

The `/clademusic/` path is the dev default. On Vercel the app is served from the
root instead — see [Base path](deployment.md#base-path). Anything that builds an
absolute URL must go through `import.meta.env.BASE_URL` rather than assuming
either one.

## Type Checking
```bash
bun run typecheck
```

## Tests
```bash
bun run test                    # vitest, whole suite
npx vitest run <path>           # a single file
bun run test:e2e:smoke          # cypress smoke
```

## Toolchain

The repo is **bun-first**: `scripts/abort-if-not-bun.cjs` runs on `preinstall`
and rejects other package managers.

If `bun` is unavailable, `npx` works for one-off commands (`npx vite build`,
`npx vitest run`, `npx tsc --noEmit -p tsconfig.app.json`). Installing with npm
is a different matter — it resolves a different tree and leaves a
`package-lock.json` alongside `bun.lockb`. Two lockfiles that disagree mean CI
and your machine can build different dependency versions. Keep one.

## First-time database setup

The app needs a provisioned Supabase project. A fresh project has no schema and
every query fails with `PGRST205 — could not find the table`, which reads like a
connection problem but is not.

See **[Database Setup](DATABASE_SETUP.md)** for the CLI route, the SQL Editor
route (for when the CLI has no access to the project), verification queries and
seeding.

## Environment

Copy `.env.example` to `.env`. `.env` is gitignored; only `VITE_`-prefixed
variables reach the client bundle.

The Supabase client degrades gracefully: with no URL/key it returns a disabled
stub rather than throwing, so the app loads and every query quietly errors.
If data is missing app-wide, check the env vars before suspecting the database.

Note that only `.env*.local` and bare `.env` are gitignored — a file like
`.env.backup-2026` is **not** ignored. Name backups `.env.backup.local`.

## Architecture notes

- [Harmonic Analysis Architecture](HARMONIC_ANALYSIS_ARCHITECTURE.md) — relative
  theory, hybrid pipeline, similarity engine
- [Harmonic Loop](HARMONIC_LOOP.md) — Web Audio playback of progressions
- [Player Architecture](PLAYER_ARCHITECTURE.md) — unified Spotify/YouTube player

## Conventions

- Harmony is stored **relatively** (Roman numerals). Absolute keys are derived
  for display only — never persist absolute chords.
- Never call `navigate()` during render; put it in an effect. Routing during
  render updates the router mid-render and can loop.
- Interactive controls need a 44px minimum touch target on mobile.
- Layout heights should use `dvh`, not `vh` — mobile browser chrome makes `vh`
  taller than the visible viewport, cutting off content.
