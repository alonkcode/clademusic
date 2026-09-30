# Refactor Register

Audit date: 2026-09-28. Scope: **audit only.** No source code was changed.
Companion documents:
[DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) ·
[DRY_INVENTORY.md](DRY_INVENTORY.md) ·
[TYPE_SAFETY_AUDIT.md](TYPE_SAFETY_AUDIT.md)

## Baseline (run 2026-09-28 against the working tree, including ~40 uncommitted files from other sessions)

`bun` isn't on PATH in this environment, so the tools were run directly from `node_modules/.bin`.

| Check | Command | Result |
|-------|---------|--------|
| Unit tests | `vitest run` | **89 files, 1047 tests, all passed** |
| Lint | `eslint .` | **0 errors**, 114 warnings (67 `react-hooks/exhaustive-deps`, 44 `react-refresh/only-export-components`) |
| Typecheck (CI script) | `tsc --noEmit` | exit 0, but **checks nothing** (T3) |
| Typecheck (real) | `tsc --noEmit -p tsconfig.app.json` | **44 errors / 13 files** |
| Build | `vite build` | **passed** |
| E2E smoke | `playwright test tests/app-routes.spec.ts` | **not run**: needs `bun` for its `webServer`. Run it before starting on B1/A1/A2. |

## Legend

- **Severity:** Critical (hides or causes incorrect behavior), High (maintainability or user-visible
  inconsistency), Medium (tech debt), Low (nit).
- **Risk:** High (touches harmony/similarity/audio pipeline or player transport), Medium (UI/data
  logic), Low (utils, types, dead code).
- **Blocked:** a file the item must edit has uncommitted changes from another session (per AGENTS.md
  shared-workspace rules, wait or coordinate).
- **Owner:** unassigned throughout. Per AGENTS.md, one owner per area, and only one agent in
  harmony/similarity at a time.

## Register

| ID | Category | Location | Issue | Sev | Effort | Risk | Blocked | Status |
|----|----------|----------|-------|-----|--------|------|---------|--------|
| **T1** | Types | `integrations/supabase/client.ts:59-73` | Exported `supabase` is `any` (`SupabaseClient<Database> \| any`), so **no DB query in 53 files is type-checked** | Critical | Low (1 file) + triage | Medium | – | Open. Do after T2. |
| **T2** | Types | `integrations/supabase/types.ts` | Stale since 2026-01-25. **25 of 39 queried tables missing** | Critical | Low (regen) | Low | – | Open |
| **T3** | Process | `package.json` `typecheck` | `tsc --noEmit` on a references-only root is a no-op, so CI can't catch type errors | Critical | Low | Low | – | Open. Flip once T6 is 0. |
| **H1** | Harmony / types | `services/similarityEngine.ts` | **Doesn't compile** (duplicate `normalizeProgression` export, `:492` + `:522`). 17 tsc errors: filters on fields `SimilarityFilters` lacks, returns `'dominant'` outside `ChordQuality`. No tests. Docs say tests call it (`ARCHITECTURE_SUMMARY.md:139`), which is false. Not imported, so not live. | High | Medium | **High** | – | Open. Single owner. Needs a decision on the filter contract before it's wired in. |
| **D3** | DRY / security | `lib/connectors/youtube.ts` vs `services/youtubeSearchService.ts` | Two search stacks. One calls googleapis **from the browser with `VITE_YOUTUBE_API_KEY`**, and the other deliberately goes through the edge function | High | Medium | Medium | Yes (`youtubeSearchService.ts`) | Open. **First confirm whether `VITE_YOUTUBE_API_KEY` is set in any deployed env.** |
| **T6** | Types | 13 files (see type audit) | 44 compile errors, several hiding wrong code (e.g. `billing.ts` case-mismatched plan comparisons always false; `PlaylistDetailPage` missing required `TrackCard` props) | High | Medium | Low–Medium | partly | Open |
| **D1** | DRY | `lib/timeFormat`, `lib/formatters`, `lib/sections`, `embeddedPlayer/constants`, 3 components | 9+ time formatters. **Two `formatDuration`s with different output**, two `formatTime`s with **different units** | High | Low | Low | partly | Open |
| **B1** | God object | `player/PlayerContext.tsx` (1,055 lines, 37 `useCallback`, 12 effects) | Transport, provider registry, UI chrome (minimize/cinema/mini-position/hidden) and queue in one context. 23 `usePlayer()` consumers re-render together. Queue was already partly extracted (`2c0d25c2`). | High | High | **High** | **Yes** | Open. Next step: split UI-chrome state into its own context. Measure re-renders with the React profiler first. |
| **G1** | Cycle | `PlayerContext.tsx` ⇄ `universal/UniversalPlayerHost.tsx` | Only runtime import cycle, caused by one 8-line DOM helper | Medium | Low | Low | **Yes** | Open. Move the helper to a leaf module. |
| **G2** | Layering | `lib/harmony/chordClock.ts:1` → `player/embeddedPlayer/beatClock.ts` | Pure harmony module depends on `player/` | Medium | Low | Medium | – | Open. Move `beatIntervalMs`/`isUsableBpm` into `lib/harmony`. |
| **G3** | Layering | `lib/connectors/spotify.ts` | Supabase I/O inside `lib/` | Low | Medium | Low | – | Open. Resolve with D3. |
| **G4** | Layering | `LiveChat.tsx`, `ScrollingComments.tsx` (+9 auth/admin files) | Components run their own queries and realtime subscriptions | Medium | Medium | Medium | – | Open. Do the two heavy ones. Auth pages are fine as-is. |
| **G5** | Layering | 6 components/pages → `services/*` | UI calls services directly instead of through hooks | Low | Low | Low | partly | Open |
| **G6** | Architecture | `api/`, `services/`, `hooks/api/`, `hooks/`, `components/`, `pages/` | Data access spread across 5 layers. `api/` vs `services/` split undocumented | Medium | – (decision) | – | – | **Needs decision.** Proposed rule in the dependency-graph doc. |
| **A1** | Arch rule | `components/ui/button.tsx:19-23` | Button sizes are **40px default/icon, 36px `sm`**, all under the 44px mobile rule. 34 `size="icon"` + 72 `size="sm"` uses | High | Low (primitive) | Medium (layout shift) | – | Open. Fix at the primitive (`max-md:min-h-11` or similar), then verify in a real browser at 390×844. |
| **A2** | Arch rule | ~30 files | 43 `h-screen` + 5 `h-[NNvh]`. AGENTS.md requires `dvh`. Tailwind 3.4.17 supports `h-dvh` | Medium | Low (mechanical) | Low–Medium | partly (`TrackDetailPage`) | Open. Good `haiku-worker` sweep once unblocked. |
| **A3** | Arch rule | pages/components | `navigate()` during render: **none found.** 10 call sites checked, all in effects or handlers | – | – | – | – | Closed (no issue) |
| **H2** | Harmony storage | `api/detectionRuns.ts:193-194`, `_shared/detectionPayload.ts:31,310` | Each detected chord is persisted with both `numeral` (relative) **and** `rootPitchClass` (absolute), plus `key.tonic`. `rootPitchClass` is derivable from numeral + tonic. | ? | – | High | – | **Question for owner:** is `rootPitchClass` intentional redundancy (e.g. an audit trail of raw detection), or absolute data persisted against the relative-storage rule? Not a verdict. |
| **T4** | Types | `tsconfig.app.json`, `eslint.config.js:24` | `strict: false`, `noImplicitAny: false`, `no-explicit-any: off` | Medium | Low (warn) / High (strict) | Low | – | Open. Turn on the lint rule as `warn` first. |
| **T5** | Types | 28 files, 72 `any`s | Top: `usePlayerHarmony.ts:72-84` (7 **redundant** `as any` casts on an already typed `HarmonicFingerprint`) | Medium | Low–Medium | Low | partly (`usePlayerHarmony` dirty) | Open |
| **D4** | DRY | `ScrollingComments`, `useDryHooks`, `hooks/api/useComments` | Three comment data paths. `useComments` + `lib/trackComments` is canonical | Medium | Medium | Medium | – | Open |
| **D6** | DRY / UX | `lib/sections.ts`, `CompactSongSections`, `SongSections`, `HarmonicHUD` | Section colours disagree between components (chorus green vs pink). Label map re-declared | Medium | Low | Low | partly (`HarmonicHUD`) | Open. The palette is a design call. |
| **D7** | DRY / types | `types/index.ts`, `lib/providers.ts`, … | Same type names with different shapes (`ProviderLink`, `AudioFeatures`, `PlayerState`, …). `ChordSpan`/`SectionProgression` are **deliberately** different (relative vs absolute): rename them, don't merge | Medium | Low | Low (harmony renames: High) | – | Open |
| **B2** | God component | `pages/ProfilePage.tsx` | 1,269 lines, one component, 40 imports | Medium | Medium | Medium | – | Open. Extract tab panels (recent/top/connections) into components. |
| **B3** | God component | `pages/SearchPage.tsx` | 929 lines, one component, 13 `useState`, calls both search stacks | Medium | Medium | Medium | – | Open. Do after D3. |
| **B4** | Large files | `EmbeddedPlayerDrawer.tsx` 756, `HarmonicHUD.tsx` 663, `TrackDetailPage.tsx` 665, `spotifyPlayback.ts` 764, `services/harmonicAnalysis.ts` 625 | Size alone isn't a defect. Review each only when a change lands there | Low | – | – | mostly | Watch |
| **D2** | DRY | `lib/formatters`, `lib/forum`, date-fns | Three relative-time styles | Low | Low | Low | – | Open |
| **D5** | DRY / dead | `hooks/useInteractions.ts:313,362` | Second `usePlaylists` and a `useLikedTracks`, both unused | Low | Low | Low | – | Open. Delete. |
| **D8** | DRY | 127 inline query keys vs `QUERY_KEYS` (6 uses) | Keys checked agree. Latent risk only | Low | – | Low | – | Migrate opportunistically |
| **D9** | – | 4× `clampInt` | Different semantics. **Not** duplication | – | – | – | – | Closed (leave) |
| **D10** | Dead | `lib/formatters`, `sections`, `constants`, `navigation`, `animations`, `preferences`, `providers` | ~45 exports with no outside callers | Low | Low | Low | – | Open |
| **X1** | Dead | 22 orphan modules (list in the dependency-graph doc) incl. `useDryHooks`, `UnifiedPlayer`, `SongSections`, `billing.ts` (imports uninstalled `stripe`) | No importers anywhere | Low | Low | Low | – | Open. **Keep** the documented-planned ones (`similarityEngine`, `useHarmonicAnalysis`, `AnalysisStatusBadge`). **Ask** about `TwoFactorSetup`/`TwoFactorVerify` (2FA UI can't be reached). |
| **L1** | Lint | 67 `exhaustive-deps` warnings (+8 disabled inline) | Some may be stale-closure bugs | Low | Medium | Medium | – | Triage the player/harmony hooks first |

## Recommended sequence

Each step is one reviewable change: verify it, then move on.

1. **T2 → T1** (regenerate types, then type the client). Highest leverage: it turns on checking for
   every query. Triage the new errors into T6.
2. **D3 env check.** Confirm `VITE_YOUTUBE_API_KEY` isn't set in Vercel. That's minutes, not a
   refactor.
3. **Quick, low-risk, unblocked cleanups:** D5, X1 (non-planned orphans), D10, D1 (time formatters +
   new `timeFormat.test.ts`), T5 on clean files, G2.
4. **T6 non-harmony errors → T3** (make the real typecheck the CI gate).
5. **A1** at the primitive, with a real-browser check at 390×844 / 375×667 / 360×640, plus the
   Playwright player specs.
6. **Wait for the uncommitted player/UI work to land**, then: G1, A2 sweep, D6 labels, B1 (UI-chrome
   context split, profiler-measured).
7. **Needs a decision first:** G6 (data-access rule), D3 (which search stack survives), D6 (palette),
   H2 (`rootPitchClass`).
8. **Harmony/similarity (H1, D7 harmony renames, harmony T6):** single owner. Per AGENTS.md, validate
   against the detection-run fixtures (`src/api/detectionRuns*.test.ts`, `src/lib/harmony/*.test.ts`,
   which exercise the DSP through the `lib/harmony` re-exports; `_shared/dsp` has no tests of its own)
   before calling it done.

## Verification per change

- Targeted: `node_modules/.bin/vitest run <path>`
- Types: `node_modules/.bin/tsc --noEmit -p tsconfig.app.json`, then compare against the 44-error baseline
  for the touched files. Don't compare raw totals, since other sessions change them.
- Lint: `node_modules/.bin/eslint <files>`
- Before merging a group: full `vitest run`, `eslint .`, `vite build`, and the Playwright player specs for
  anything under `src/player/` or touching layout.

## Not covered by this audit

- `supabase/functions/**` (Deno edge functions, including the shared DSP) was only traced where
  `src/` re-exports or calls into it.
- Runtime behavior: no profiling or browser runs were done. B1's re-render cost and A1's layout impact
  are inferred from code and need measuring.
- `src/data/*` seed files (large by nature) were excluded from the size ranking.
