# 🎵 Clade

**Find Your Harmony**

A TikTok-style music discovery platform that finds songs by **harmonic progression**, not genre. Tracks are analyzed and matched on their chord structure — progression shape, cadence, loop length, modal color — so "sounds like this" means something concrete instead of a genre tag.

![React](https://img.shields.io/badge/React-18-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-5-purple?logo=vite)
![Supabase](https://img.shields.io/badge/Supabase-Backend-green?logo=supabase)
![TailwindCSS](https://img.shields.io/badge/Tailwind-CSS-cyan?logo=tailwindcss)
![Bun](https://img.shields.io/badge/Bun-required-black?logo=bun)

Live: **https://kaospan.github.io/clademusic/**

## ✨ Features

### 🎶 Harmonic analysis & discovery
- **Relative theory first** — progressions stored as Roman numerals (`I-V-vi-IV`), never absolute chords; keys are derived only for display
- **Hybrid pipeline** — cache-first lookup, async job queue for new tracks, provisional results so the UI never blocks
- **Confidence scoring** — every analysis carries a High/Medium/Low/Provisional label
- **Similarity engine** — progression shape (50%), cadence (20%), loop length (15%), modal color (10%), tempo (5%)
- **Live chord detection** — chords read off captured tab audio in real time (`src/lib/harmony/chordDetection.ts`)
- **Automatic section detection** — verse/chorus/bridge/intro/outro segmentation via self-similarity + Foote novelty (`src/lib/harmony/sectionDetection.ts`)
- **Harmonic loop playback** — hear a progression looped in any key through the Web Audio engine (`src/lib/harmony/LoopEngine.ts`)

### 🎧 Playback
- **Docked bottom bar** — fixed, full-width player like Spotify's desktop client; expanding it slides a details panel (chord readout, section chips, video miniplayer) up above the bar
- **YouTube & Spotify** — embedded playback, with Spotify Web Playback for premium accounts and an embed preview otherwise
- **Section navigation** — tap a chip to jump straight to a verse, chorus, or bridge
- **Quick stream links** — one tap out to Apple Music, Deezer, SoundCloud

### 👥 Social
- Following feed, live comments, track comments, emoji reactions
- Nearby listeners, live chat, playlists, and a Reddit-style forum
- Play history and a taste-DNA profile

### 🔗 Track connections
Sample detection, cover versions, and remix lineage, with a network view per track.

### 💳 Accounts & billing
Supabase auth (email/password + reset), optional TOTP two-factor, Spotify OAuth linking, premium plans with checkout/webhook edge functions, and a role-protected admin dashboard.

## 🚀 Quick start

### Prerequisites
- **[Bun](https://bun.sh) 1.0+** — required. A `preinstall` guard (`scripts/abort-if-not-bun.cjs`) aborts `npm install` / `yarn install`; only `bun install` works.
- Git

```bash
git clone https://github.com/kaospan/clademusic.git
cd clademusic
bun install
cp .env.example .env.local   # then fill in your keys
bun run dev
```

Open **http://localhost:8080/clademusic/** — the dev server runs on port 8080 and the app is served under the `/clademusic/` base path.

> Without Supabase credentials the app still boots: the client falls back to a
> disabled stub that returns errors instead of throwing, so the UI renders but
> anything that reads or writes data stays empty.

### Environment variables

Copy `.env.example` to `.env.local`. Only `VITE_`-prefixed variables reach the browser.

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase client key |
| `VITE_SUPABASE_ANON_KEY` | — | Legacy fallback, used only when the publishable key is unset |
| `VITE_SPOTIFY_CLIENT_ID` | optional | Spotify OAuth / Web Playback |
| `VITE_SPOTIFY_REDIRECT_URI` | optional | `http://localhost:8080/clademusic/spotify-callback` in dev |
| `VITE_YOUTUBE_API_KEY` | optional | YouTube search |
| `VITE_LASTFM_API_KEY` | optional | Last.fm metadata and history import |
| `VITE_BASE_PATH` | optional | Overrides the deploy base path (see [Deployment](#-deployment)) |

### Database

The schema lives in `supabase/migrations/`. Provision a project either with the
CLI (`supabase link` + `supabase db push`) or by pasting the generated, ordered
SQL parts from `bash scripts/build-sql-editor-parts.sh` into the Supabase SQL
editor — full walkthrough in [docs/DATABASE_SETUP.md](docs/DATABASE_SETUP.md).

```bash
bun run seed          # populate sample tracks, provider links, connections
bun run seed:reset    # wipe seeded rows first
```

Seeding reads `SUPABASE_SERVICE_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`) from the environment.

## 🏗️ Project structure

```
src/
├── api/                 # Thin data-access wrappers (playEvents, tasteDNA, trackSections)
├── chat/                # Local bot chat
├── components/
│   ├── landing/         # Hero, features grid, pricing preview, interactive demo
│   ├── layout/          # ResponsiveLayout
│   ├── shared/          # PageLayout, ErrorBoundary, EmptyState, LoadingSpinner, brand marks
│   ├── ui/              # shadcn/ui primitives + GlassCard, ChartErrorBoundary
│   └── *.tsx            # Feature components (HarmonicHUD, TrackCard, SongSections, ...)
├── data/                # Seed and historical track datasets
├── hooks/
│   ├── api/             # React Query data hooks
│   └── *.ts             # useAuth, useHarmonicAnalysis, useLiveChordDetection, useSectionSync
├── integrations/
│   └── supabase/        # Generated client + database types
├── lib/
│   ├── connectors/      # Provider connectors (spotify, youtube, stubs)
│   ├── harmony/         # Theory engine: chordDetection, sectionDetection,
│   │                    #   progressionSearch, sectionVariant, theory, LoopEngine
│   └── *.ts             # animations, constants, env, formatters, providers, sections, security
├── pages/               # Route components (lazy-loaded in App.tsx)
├── player/
│   ├── controller/      # Player interfaces
│   ├── embeddedPlayer/  # Seekbar, transport, layout, harmony, active-section hooks
│   ├── providers/       # YouTube / Spotify adapters and embeds
│   ├── universal/       # UniversalPlayerHost, embed-src builder, provider switching
│   ├── PlayerContext.tsx
│   └── EmbeddedPlayerDrawer.tsx
├── services/            # harmonicAnalysis, similarityEngine, recommendation, billing,
│                        #   spotify*, youtubeSearch, lastfm, trackService
├── types/               # harmony.ts, index.ts
├── test/                # Vitest setup + integration-style suites
└── __tests__/           # Player and section regression specs

supabase/
├── functions/           # Edge functions: harmonic-analysis, billing-*, search-*, 2FA, email
├── migrations/          # Ordered schema migrations
└── bundle-fixes/        # Compatibility patches for generated SQL bundles

tests/                   # Playwright specs (player invariants + route smoke)
docs/                    # Architecture, setup, and process documentation
scripts/                 # Seeding, SQL bundling, asset generation, QA tooling
```

## 🛠️ Tech stack

| Category | Technology |
|----------|------------|
| **Framework** | React 18 + TypeScript (strict) |
| **Build** | Vite 5 |
| **Package manager** | Bun (enforced) |
| **Styling** | Tailwind CSS + shadcn/ui (Radix primitives) |
| **Animation** | Framer Motion |
| **State** | TanStack Query + React Context |
| **Routing** | React Router 6 |
| **Backend** | Supabase — Postgres, Auth, Realtime, Edge Functions (Deno) |
| **Charts** | Recharts |
| **Music theory** | Custom harmonic engine + Web Audio |
| **Testing** | Vitest (unit/component), Playwright (browser E2E) |

## 📱 Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/feed` | TikTok-style track discovery |
| `/search` | Search by name, artist, or progression (e.g. `I-V-vi-IV`) |
| `/compare` | Side-by-side harmonic comparison |
| `/track/:trackId` | Metadata, credits, sections, harmonically similar tracks |
| `/album/:albumId`, `/artist/:artistId` | Album and artist pages |
| `/connections/:trackId` | Samples, covers, remix lineage |
| `/playlists`, `/playlist/:playlistId` | Playlists |
| `/forum`, `/forum/:forumName`, `/forum/post/:postId` | Community forum |
| `/following` | Activity from people you follow |
| `/profile` | Taste DNA, connected services, play history |
| `/auth`, `/login`, `/signup`, `/reset-password` | Authentication |
| `/spotify-callback` | Spotify OAuth return |
| `/survey` | Music taste onboarding |
| `/pricing`, `/billing` | Plans and subscription management |
| `/terms`, `/privacy` | Legal |
| `/admin`, `/admin/performance` | Admin dashboards (role-protected) |

## 🔧 Development

```bash
bun run dev          # dev server at http://localhost:8080/clademusic/
bun run lint         # ESLint
bun run typecheck    # tsc --noEmit
bun run build        # production build to dist/
bun run preview      # serve the production build
```

### Testing

```bash
bun run test              # Vitest (src/**/*.{test,spec}.{ts,tsx})
bun run test:watch        # Vitest in watch mode

bun run test:e2e          # Playwright, all specs in tests/
bun run test:e2e:smoke    # Playwright, route smoke only (tests/app-routes.spec.ts)
bun run test:pw:install   # one-time: install the Chromium browser
bun run test:pw:ui        # interactive Playwright runner
```

> Run `bun run test`, not `bun test` — the bare form invokes Bun's own test
> runner instead of Vitest and will not pick up the jsdom setup.

Two suites cover different ground. Vitest owns `src/` (and explicitly excludes
`tests/`). Playwright owns everything that needs a real browser: the
universal-player invariants and the route smoke coverage, both in `tests/`. It
starts its own dev server on `:4173` via the `webServer` block in
`playwright.config.ts`, so no separate server step is needed.

## 📦 Deployment

The base path is resolved in `vite.config.ts`: `VITE_BASE_PATH` when set,
otherwise `/` on Vercel and `/clademusic/` everywhere else.

### GitHub Pages (default)

Pushes to `main` deploy automatically via `.github/workflows/deploy.yml` — set
**Settings → Pages → Source → GitHub Actions**. The workflow lints, typechecks,
runs Vitest and Playwright, builds, and publishes `dist/`.

Manual deploy, if you need one:

```bash
bun run deploy    # builds, writes dist/.nojekyll, pushes to the gh-pages branch
```

For the manual route, point **Settings → Pages → Source** at the `gh-pages`
branch. The `.nojekyll` file keeps Pages from running Jekyll over the build
output.

### Vercel

`vercel.json` sets the framework, `bun run build`, an SPA rewrite to
`index.html`, and immutable caching for `/assets/*`. Vercel builds set `VERCEL`,
so the base path becomes `/` automatically.

Supply the `VITE_*` variables as build-time environment variables on whichever
host you use — Vite inlines them at build time, so they must be present when the
build runs, not at runtime.

## 🤖 CI

| Workflow | Trigger | Does |
|----------|---------|------|
| `ci.yml` | push to `main`/`develop`, PRs to `main` | lint, typecheck, Playwright + Vitest, build artifact |
| `pr.yml` | PRs | path-filtered quality checks for `src/` and `supabase/` changes |
| `deploy.yml` | push to `main`, PRs, manual | full test suite, then production deploy |
| `qa-hourly.yml` | hourly cron, manual | scheduled smoke/sanity/performance runs |

## 📚 Documentation

Start at [docs/index.md](docs/index.md). Highlights:

- [Harmonic Analysis Architecture](docs/HARMONIC_ANALYSIS_ARCHITECTURE.md) — the core system design
- [Player Architecture](docs/PLAYER_ARCHITECTURE.md) — docked bar, provider switching, universal host
- [Database Setup](docs/DATABASE_SETUP.md) — provisioning Supabase from empty
- [Development](docs/development.md) · [Testing](docs/testing.md) · [Deployment](docs/deployment.md)
- [Known Issues](docs/KNOWN_ISSUES.md) · [Roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your change, then run `bun run lint`, `bun run typecheck`, and `bun run test`
4. Commit and push
5. Open a Pull Request — see [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md) for what reviewers check

## 📄 License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  Made with 🎵 by <a href="https://github.com/kaospan">kaospan</a>
</p>
