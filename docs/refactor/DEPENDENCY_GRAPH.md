# Dependency Graph Audit

Audited 2026-09-28 against the working tree (including uncommitted work from other sessions).
Part of the refactor audit: see [REFACTOR_REGISTER.md](REFACTOR_REGISTER.md) for priorities and IDs.

## Method

`madge` is not installed, and installing it would touch `bun.lockb`. The graph was built with a
throwaway script (outside the repo) that:

- walks every non-test `.ts`/`.tsx` under `src/` (308 files),
- resolves `@/…` and relative specifiers, both static `import`/`export … from` and dynamic `import()`,
- runs Tarjan's SCC on **runtime** edges (`import type` is erased at compile time, so it cannot cause a
  load-order cycle),
- reports cross-layer edges on runtime + type edges.

It does not follow `export *` into `supabase/functions/_shared/dsp` (the DSP lives there since
`b6256815`; `src/lib/harmony/*` re-exports it).

## Intended layering

```
pages → components → hooks (hooks/api) → services / api → lib (lib/harmony) → types
                   ↘ player ↗
```

`lib/` and `lib/harmony/` should be pure (no I/O, no React, no `player/`). `services/` and `api/` own
data access. Components and pages read data through hooks.

## Import cycles

Only one runtime cycle exists.

| ID | Cycle | Cause | Fix | Blocked? |
|----|-------|-------|-----|----------|
| G1 | `player/PlayerContext.tsx` ⇄ `player/universal/UniversalPlayerHost.tsx` | `PlayerContext` imports `focusUniversalPlayerFrame` (`UniversalPlayerHost.tsx:50`, an 8-line DOM helper) and calls it at `PlayerContext.tsx:746,875`; the host imports `usePlayer` back. | Move `focusUniversalPlayerFrame` and the `IFRAME_ID` constant into a leaf module (e.g. `player/universal/frameFocus.ts`) and import it from both. No behavior change. | Yes: both files have uncommitted changes. |

It works today only because `focusUniversalPlayerFrame` is not called while the modules load. That is
fragile rather than broken.

## Layer violations

| ID | Edge | Evidence | Fix |
|----|------|----------|-----|
| G2 | `lib/harmony` → `player` | `lib/harmony/chordClock.ts:1` imports `beatIntervalMs`, `isUsableBpm` from `player/embeddedPlayer/beatClock.ts` | Those two are pure tempo math. Move them (with `MIN_BPM`/`MAX_BPM`) into `lib/harmony/` and have `beatClock.ts` import from there. Harmony-adjacent, but it's a move with no logic change: re-run `chordClock.test.ts` and `beatClock.test.ts`. |
| G3 | I/O inside `lib/` | `lib/connectors/spotify.ts:16,96-179` calls `supabase.auth`, `supabase.functions.invoke('search-spotify')`, `supabase.from('external_tracks')` | Connectors are adapters, not pure utilities. Either move `lib/connectors/` + `lib/unifiedSearch.ts` under `services/`, or accept them as an adapter sub-layer and write that down. See D3 first, because one of the two search stacks may be deleted. |
| — | `hooks` → `components` | `hooks/use-toast.ts` → `components/ui/toast.tsx` (type-only) | shadcn convention. Leave it. |

### UI importing data access directly

**Components/pages → Supabase client** (11 files): `AdminPerformanceDashboard`, `LiveChat` (12 refs),
`MaintenanceGate`, `MusicTasteSurvey`, `ScrollingComments` (7 refs), `TwoFactorSetup`,
`TwoFactorVerify`, `BillingPage`, `ConfirmEmailPage`, `ResetPasswordPage`, `SpotifyCallbackPage`.

Auth-flow pages (`ConfirmEmailPage`, `ResetPasswordPage`, `SpotifyCallbackPage`) call `supabase.auth.*`
once each. Moving those is low value. The real targets are `LiveChat` and `ScrollingComments`, which run
their own queries and realtime subscriptions inside the component (G4).

**Components/pages → `services/`** (6 files): `AnalysisStatusBadge` → `harmonicAnalysis`;
`CompactSongSections`, `QuickStreamButtons`, `SearchPage`, `TrackDetailPage` → `youtubeSearchService` /
`spotifySearchService`; `ProfilePage` → `lastfmService` (G5).

## Data access is spread across five layers (G6)

Files that reference `supabase` directly, by layer (import lines excluded):

| Layer | Files | Heaviest |
|-------|-------|----------|
| `hooks/api/` | 20 | `useThemes` 14, `useAdmin` 13, `usePlaylists` 13, `useComments` 12, `useFollowing` 11 |
| `hooks/` | 5 | `useInteractions` 12, `useAuth` 11, `useDryHooks` 8 |
| `components/` | 7 | `LiveChat` 12, `ScrollingComments` 7 |
| `pages/` | 4 | `ResetPasswordPage` 5 |
| `services/` | 11 | `billing` 15, `forumService` 15, `harmonicAnalysis` 8 |
| `api/` | 4 | `tasteDNA` 5, `playEvents` 4 |
| `lib/` | 2 | `connectors/spotify` 5, `unifiedSearch` 2 |

`src/api/` (4 modules: `detectionRuns`, `playEvents`, `tasteDNA`, `trackSections`) and `src/services/`
do the same job, and nothing documents which new code should use. The most common pattern in practice
is a TanStack hook querying Supabase inline.

**Recommendation.** Don't do a big-bang move. Write down one rule (proposed: *"`hooks/api/*` may query
Supabase directly for simple CRUD. Multi-step or shared logic lives in `services/`. `src/api/` merges
into `services/`."*), then apply it only when a file is touched for another reason. Moving 20+ hooks
buys nothing until T1 (typed client) lands, because the queries are unchecked wherever they live.

## Fan-in (most-imported runtime modules)

| Importers | Module |
|-----------|--------|
| 83 | `lib/utils.ts` (`cn`) |
| 53 | `integrations/supabase/client.ts` (typed `any`, see T1) |
| 46 | `hooks/useAuth.tsx` |
| 37 | `types/index.ts` |
| 21 | `player/PlayerContext.tsx` (see B1) |

## Orphans (no importer in `src/`, tests, `supabase/functions`, or `scripts/`)

Split by whether the docs say they are planned:

- **Documented as not-yet-wired** (`docs/ARCHITECTURE_SUMMARY.md:83,139,262`): `services/similarityEngine.ts`,
  `hooks/useHarmonicAnalysis.ts`, `components/AnalysisStatusBadge.tsx`. Keep them, but see H1.
- **Security TODO references** (`docs/SECURITY_FIXES_SUMMARY.md:58,143`): `TwoFactorSetup.tsx`,
  `TwoFactorVerify.tsx`. The 2FA UI can't be reached. Confirm with the owner whether that's intended.
- **No references anywhere (dead-code candidates):** `components/UnifiedPlayer.tsx`, `FloatingPlayer.tsx`,
  `SongSections.tsx`, `SectionYouTubeSnippet.tsx`, `YouTubeEmbed.tsx`, `WatchCard.tsx`, `PlayButton.tsx`,
  `HarmonicLoop.tsx`, `FeedSidebar.tsx`, `NavLink.tsx`, `NearbyListenersPanel.tsx`, `SampleConnections.tsx`,
  `admin/UserManagementPanel.tsx`, `landing/LoadingAnimation.tsx`, `ui/ProviderBadge.tsx`,
  `hooks/useDryHooks.ts`, `hooks/useRequireAuth.ts`, `hooks/api/index.ts` (barrel nobody imports),
  `lib/geolocation.ts`, `lib/logger.ts`, `data/seedTracksWithProviders.ts`, `services/billing.ts`
  (imports the server-side `stripe` SDK, which isn't installed. TS2307).
- Unused shadcn primitives under `components/ui/` (accordion, calendar, carousel, chart, command, drawer,
  form, sidebar, table, …): generator output, harmless, tree-shaken. Leave them.

Per AGENTS.md, delete only after confirming each one is unused. That is what this list establishes for
imports. Still grep for string/dynamic references before removing.
