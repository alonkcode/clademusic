# Changelog

All notable changes to Clade will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Harmonic Loop (Aug 28, 2026)
- **Audible chord progressions** — any track's Roman-numeral progression plays
  back as real synthesised chords, transposable to all 12 keys, tempo-locked to
  the track BPM. Turns Clade's relative-harmony data from metadata into
  something you can compare by ear.
  - `src/lib/harmony/theory.ts` — numeral parsing (accidentals, qualities,
    modal context) and octave-preserving voice leading
  - `src/lib/harmony/LoopEngine.ts` — Web Audio lookahead scheduler; timing
    rides the audio clock so it cannot drift with React renders
  - `src/hooks/useHarmonicLoop.ts`, `src/components/HarmonicLoop.tsx`
  - Surfaced through `HarmonyCard` (feed, compare page, player drawer)
  - 14 unit tests; see [docs/HARMONIC_LOOP.md](docs/HARMONIC_LOOP.md)

### Added — Database provisioning
- `scripts/build-sql-editor-parts.sh` and `scripts/build-schema-bundle.sh`
  generate paste-ready SQL for the Supabase SQL Editor, for when the CLI has no
  access to the target project. Includes `99-verify.sql` post-install checks.
- [docs/DATABASE_SETUP.md](docs/DATABASE_SETUP.md)
- `vercel.json` — SPA rewrite and asset caching.

### Fixed — Authentication
- **"Database error saving new user"** — `handle_new_user()` ran three unguarded
  inserts inside the signup transaction, so any single failure rolled back the
  entire account creation. Inserts are now idempotent and individually
  exception-handled; orphaned users are backfilled.
  (`supabase/migrations/20260828120000_harden_signup_trigger.sql`)
- **Signup reported success for unconfirmed accounts** — it told users they
  could sign in when email confirmation left the account inert. Now reports the
  confirmation requirement.
- **Duplicate emails reported as new accounts** — Supabase returns success for
  existing emails by design (anti-enumeration); detected via empty `identities`.
- **Confirmation links 404'd on GitHub Pages** — `emailRedirectTo` ignored
  `BASE_URL`.
- **`navigate()` called during render** in `AuthPage`, which updates the router
  mid-render and can loop.
- Added missing `autoComplete` attributes and a reveal-toggle aria-label.

### Fixed — Feed, player, hosting
- Feed stage used `100vh`, clipped by mobile browser chrome; now `dvh` with a
  min-height floor.
- Three overlapping guest CTAs consolidated into one dismissible banner.
- Player controls were 28px on mobile, below the 44px minimum touch target.
- Desktop feed arrows moved `md:` → `lg:` to stop colliding on tablets.
- Vite `base` is now resolved per host — `/clademusic/` on Pages, `/` on Vercel
  (`VERCEL`), overridable with `VITE_BASE_PATH`. It was hardcoded, so every
  asset would have 404'd on Vercel.

### Changed
- Renamed "HarmonyFeed" → "CladeMusic" in the UI (feed header, auth pages,
  share text).
- **REBRAND TO CLADE** — Simplified brand name from "CladeAI" to "Clade"
  - New tagline: "Find Your Harmony"
  - Updated all documentation (README, docs, TASKS, CHANGELOG)
  - Changed GitHub Pages base path from `/cladeai/` to `/clademusic/`
  - Updated localStorage key to `clade_search_history`
  - New meta tags: "Clade - Find Your Harmony"
  - Cleaner, more memorable brand identity
  - Modern, tech-forward feel that scales well

### Added
- Harmonic analysis architecture with relative theory-first approach
- Hybrid analysis pipeline (cache → async job → ML processing)
- Similarity engine for finding tracks by harmonic structure
- Confidence scoring system (0.0-1.0) with provisional flags
- Analysis status badge UI component
- Model versioning for analysis results
- Responsive desktop layouts with multi-column grids
- Desktop sidebar with track metadata and keyboard shortcuts
- Adaptive breakpoints (sm/md/lg/xl/2xl: 640px-1536px+)
- ResponsiveLayout component library (ResponsiveContainer, ResponsiveGrid, DesktopColumns)
- FeedSidebar component with progress tracking
- Song credits metadata (songwriter, producer, label, release_date)
- Multiple genre tags support (genres array)
- formatBPM utility for tempo display
- capitalize utility for text formatting
- ProviderBadge reusable component
- GlassCard reusable component
- Comprehensive documentation (HARMONIC_ANALYSIS_ARCHITECTURE.md, ARCHITECTURE_SUMMARY.md)

### Changed
- FeedPage now uses 3-column desktop layout with left sidebar
- SearchPage header uses ResponsiveContainer for adaptive width
- ProfilePage shows song credits in play history
- Button text now responsive (hidden on mobile, shown on desktop)
- Typography scales with viewport (text-sm to lg:text-base)

### Fixed
- Play history now shows clickable track links instead of IDs
- Active player z-index properly managed (100 for active, 50 for inactive)
- Whitespace handling in file replacements

## [1.0.1] - 2026-02-04

### Added
- App-level error boundary + route-level reset to prevent blank screens on render errors
- Global `window` error + unhandled promise rejection handling with throttled toasts

### Changed
- Spotify OAuth callback now invalidates relevant React Query caches after token exchange (no refresh required)
- GitHub Pages deploy runs automatically on push to `main` via GitHub Actions

### Fixed
- Blank screen caused by accidental stray characters/merge markers committed into source files
- CI/CD deploy failures caused by lockfile drift with `bun install --frozen-lockfile`

## [1.0.0] - 2026-01-21

### Added
- Queue management system with 6 operations (play next, play later, move, remove, clear, reorder)
- 3-dot track menu (TrackMenu component)
- Jump-to-time section navigation with seekTo functionality
- BPM metadata display with formatBPM formatter
- Genre metadata with larger font display
- Song credits (songwriter, producer, label, release date)
- Click-through play history with relative timestamps
- DRY refactoring with reusable components

### Changed
- Track type extended with tempo, genre, genres, songwriter, producer, label, release_date
- Sections now support chord progressions with timing
- ChordBadge size variants (sm/md/lg)

### Fixed
- Floating player z-index issues (active players on top)
- Profile page showing track IDs instead of track info in history
- Play history timestamps now use formatRelativeTime

## [0.9.0] - 2025-12

### Added
- Initial music feed with swipeable track cards
- Spotify OAuth integration
- YouTube video discovery and playback
- Floating picture-in-picture players
- Search by chord progression
- Track detail page with sections, chords, videos tabs
- Following system and activity feed
- Dark mode with glass morphism effects
- Bottom navigation for mobile
- Skeleton loading states

### Infrastructure
- React 18 + TypeScript setup
- Vite 5 build system
- Tailwind CSS + shadcn/ui
- Supabase backend (Auth, Postgres)
- TanStack Query for data fetching
- Framer Motion for animations

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| Unreleased | 2026-01 | Harmonic analysis architecture, responsive desktop UI |
| 1.0.1 | 2026-02-04 | Error boundaries, Spotify callback refresh, CI/CD deploy fixes |
| 1.0.0 | 2026-01-21 | Queue management, song credits, DRY refactoring |
| 0.9.0 | 2025-12 | Initial release with core features |

---

**Legend**:
- `Added` - New features
- `Changed` - Changes to existing functionality
- `Deprecated` - Soon-to-be removed features
- `Removed` - Removed features
- `Fixed` - Bug fixes
- `Security` - Security improvements
