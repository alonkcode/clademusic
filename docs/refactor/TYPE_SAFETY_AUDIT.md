# Type Safety Audit

Audited 2026-09-28 against the working tree. See [REFACTOR_REGISTER.md](REFACTOR_REGISTER.md) for IDs.

## Baseline

| Check | Command | Result |
|-------|---------|--------|
| Typecheck (what CI runs) | `tsc --noEmit` (`bun run typecheck`) | **exit 0, checks nothing** (see T3) |
| Typecheck (real) | `tsc --noEmit -p tsconfig.app.json` | **44 errors in 13 files** |
| Lint | `eslint .` | 0 errors, 114 warnings (67 `react-hooks/exhaustive-deps`, 44 `react-refresh/only-export-components`) |

Errors by file: `services/similarityEngine.ts` 17, `services/billing.ts` 5, `pages/ProfilePage.tsx` 4,
`hooks/api/useThemes.ts` 4, `hooks/api/usePlayEvents.ts` 3, `services/harmonicAnalysis.ts` 2,
`hooks/api/useTestRuns.ts` 2, `test/comprehensive-qa.test.tsx` 2, and one each in `audioAnalysis.ts`,
`SearchPage.tsx`, `PlaylistDetailPage.tsx`, `admin/UserManagementPanel.tsx`, `api/detectionRuns.ts`.

## Findings, by leverage

### T1 — The Supabase client is `any` everywhere (Critical)

`src/integrations/supabase/client.ts:62-73`:

```ts
export const supabase = hasSupabaseConfig
  ? createClient<Database>(…)          // SupabaseClient<Database>
  : createDisabledClient(…);           // returns `… as any` (line 59)
```

`SupabaseClient<Database> | any` collapses to `any`, so **all 53 importers get an untyped client**.
No `.from('table')`, `.select()`, `.insert()`, `.rpc()` or `.functions.invoke()` call in the app is
type-checked. The three `TS2347 Untyped function calls may not accept type arguments` errors
(`api/detectionRuns.ts:258`, `hooks/api/useTestRuns.ts:19,28`) are symptoms of this.

**Fix:** type the disabled stub as the real client: `as unknown as SupabaseClient<Database>`, and
document it, since the Proxy mimics the surface at runtime. That's a one-file change, **but do T2
first**, or the newly typed client will reject every query against the 25 tables missing from
`types.ts`.

### T2 — Generated DB types are stale (Critical, pairs with T1)

`src/integrations/supabase/types.ts` was last regenerated in `63060682` (2026-01-25). Migrations run to
`20260923153000`. **25 of the 39 tables the code queries are not in it:**

`chat_messages`, `chat_rooms`, `credits`, `external_tracks`, `forum_comments`, `forum_members`,
`forum_posts`, `forum_votes`, `forums`, `notifications`, `playback_events`, `playlist_collaborators`,
`playlist_tracks`, `playlists`, `profiles_public`, `provider_accounts`, `stripe_prices`,
`subscription_events`, `subscriptions`, `theme_presets`, `track_comment_likes`, `track_provider_links`,
`track_sections`, `user_presence`, `user_themes`.

`hooks/api/useThemes.ts:5-8` is the one file that indexes `Database['public']['Tables'][…]` directly,
so it's the only place the staleness shows up as errors today.

**Fix:** `supabase gen types typescript` against the linked project (or the local schema bundle, but
note `supabase/schema_bundle.sql` is also known to be stale). Commit it separately. Then T1.

### T3 — CI's typecheck is a no-op (Critical, process)

`package.json` `typecheck` is `tsc --noEmit`. The root `tsconfig.json` has `"files": []` plus project
`references`, and plain `tsc` (not `tsc -b`) type-checks nothing: it exits 0. So the 44 real errors
never block a deploy.

**Fix:** after the error count is 0 (or with a baseline filter), change the script to
`tsc --noEmit -p tsconfig.app.json`. Changing it before then turns CI red on existing errors.

### T4 — Compiler and lint strictness are off

- `tsconfig.app.json`: `"strict": false`, `"noImplicitAny": false`. Root tsconfig also has
  `"strictNullChecks": false`.
- `eslint.config.js:24`: `"@typescript-eslint/no-explicit-any": "off"`, so the AGENTS.md "no `any`"
  rule isn't enforced.

**Fix:** turn on `no-explicit-any` as `warn` first (it reports and never blocks), then work through
T5. Enabling `strict` is a separate, much larger project: measure it with a throwaway
`tsc -p … --strict` run before committing to it.

### T5 — Explicit `any` in source (72 occurrences, 28 files, tests excluded)

| Where | Count | Kind | Priority |
|-------|-------|------|----------|
| `player/embeddedPlayer/usePlayerHarmony.ts:72-84` | 7 | `(fingerprint as any)?.detected_key / detected_mode / cadence_type / confidence_score / roman_progression` | **High, easy.** Harmony→player boundary. The casts are **redundant**: `useHarmonicFingerprint` already returns `HarmonicFingerprint \| null`, and that type (`types/harmony.ts:21-39`) declares all five fields. Removing them brings back checking at this boundary. The real gap is upstream: `useHarmonicFingerprint.ts:29` asserts the untyped row `as HarmonicFingerprint` without validating it (T1/T2). File is dirty (uncommitted). |
| `hooks/useDryHooks.ts` | 7 | `voteData: any`, `useState<any[]>`, `error: any` | None. The file is an orphan (delete, see X1). |
| `components/admin/UserManagementPanel.tsx` | 6 | row mapping | Orphan. |
| `hooks/api/useNearbyListeners.ts:143-198` | 5 | `(loc: any)`, `activityFilter: any[]` | Medium. Goes away with T1+T2. |
| `components/LiveChat.tsx` | 5 | row mapping | Medium. Goes away with T1+T2. |
| `integrations/supabase/client.ts:30,34,55,59` | 4 | Proxy stub | **External boundary.** Keep internal `any` but fix the export type (T1). |
| `pages/ProfilePage.tsx:203,210` | 4 | `(track: any)` in play handlers | Medium. |
| `hooks/api/usePlaylists.ts:42,54` | 2 | `track?: any; user?: any` joins | Medium. Goes away with T2. |
| `hooks/api/useAdmin.ts:145,178` | 2 | `(r: any)` | Low. |
| `player/EmbeddedPlayerDrawer.tsx:295,504` | 2 | `DetailsPanel: any` (motion.div vs div), `provider as any` | Low. Dirty file. |
| `player/PlayerContext.tsx:954` | 1 | `(window as any).__PLAYER_DEBUG_STATE__` | Low. Declare it on `Window` in a `.d.ts`. |
| `types/index.ts:202` | 1 | `metadata?: Record<string, any>` | Low. Use `Record<string, unknown>`. |
| `lib/trackComments.ts:20` | 1 | `normalizeComment(row: any, …)` | External boundary (DB row). Type it once T2 lands. |
| others | 1–2 each | `api/tasteDNA.ts:74`, `api/trackSections.ts:19`, `lib/unifiedSearch.ts`, `lib/env.ts`, `services/spotifyIframeApi.ts`, `UniversalPlayerHost.tsx:65` (`import.meta as any`), `FeedPage`, `SearchPage`, `TrackDetailPage`, `PlaylistDetailPage`, `BillingPage`, `ScrollingComments`, `useInteractions`, `useRequireAuth` | Low. |

No `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck` in non-test source. There are 8
`eslint-disable-next-line react-hooks/exhaustive-deps`.

### T6 — Type drift that already hides wrong code

| Location | Error | What it means |
|----------|-------|---------------|
| `services/similarityEngine.ts:340-372` | `cadence_types`, `modes`, `loop_lengths` not on `SimilarityFilters` | The engine filters on fields the type (`types/harmony.ts:224`) doesn't declare. One of the two is out of date. **Harmony logic: see H1.** |
| `services/similarityEngine.ts:148` | `shared_progression_shape` not in `string[]` | Result shape disagrees with its type. |
| `services/similarityEngine.ts:508` | `'dominant'` not a `ChordQuality` (did you mean `'dominant7'`) | `simplifyQuality` returns a value outside the union. |
| `services/similarityEngine.ts:492/522` | `normalizeProgression` exported twice | **Module does not compile** (esbuild: "Multiple exports with the same name"). See H1. |
| `services/harmonicAnalysis.ts:293-294` | `reanalyze_after` not on `HarmonicFingerprint` | Service reads a column the type lacks. |
| `services/audioAnalysis.ts:78` | `Mode` not assignable to the 7-mode union | Two `Mode` definitions disagree. |
| `services/billing.ts:85-139` | Comparing `'PREMIUM_MONTHLY'` to `'premium_monthly'` | **These comparisons are always false.** Case mismatch between plan keys. File is an orphan, so not live. |
| `hooks/api/usePlayEvents.ts:83,142,144` | property on `unknown` | Joined row not narrowed. |
| `pages/ProfilePage.tsx:912,950-951` | `track.spotifyId` / `youtubeId` not on `Track` | Written as `track.spotifyId \|\| track.spotify_id`, so it works at runtime through the fallback. The camelCase branch is dead. |
| `pages/SearchPage.tsx:750` | `external_url` not on `Track` | Same pattern. |
| `pages/PlaylistDetailPage.tsx:251` | `TrackCard` missing `isActive`, `onInteraction` | Required props not passed. Check what `TrackCard` does without them. |
| `components/admin/UserManagementPanel.tsx:56` | object passed where `string` expected | Orphan. |
| `test/comprehensive-qa.test.tsx:23,107` | expected 1 argument, got 0 | Test drift. |

## Suggested order

1. **T2** regenerate DB types (separate commit, no behavior change).
2. **T1** type the disabled client. Expect a burst of new errors: triage them, because each one is a
   query the compiler couldn't see before.
3. Fix the remaining T6 items outside harmony (`usePlayEvents`, `ProfilePage`, `SearchPage`,
   `PlaylistDetailPage`, test drift).
4. **T3** point `typecheck` at `tsconfig.app.json` once the count is 0 (or is baseline-filtered).
5. **T4** turn on `no-explicit-any: warn`. Burn down T5 by priority.
6. Harmony T6 items (`similarityEngine`, `harmonicAnalysis`, `audioAnalysis`) only under a single owner
   and with fixture validation (see H1).
