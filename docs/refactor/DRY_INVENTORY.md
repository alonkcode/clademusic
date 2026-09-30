# DRY Inventory

Audited 2026-09-28 against the working tree. See [REFACTOR_REGISTER.md](REFACTOR_REGISTER.md) for IDs.

Each cluster gives the canonical location, the callers to migrate, and the order. "Status" is where
the cluster stands now. Nothing has been migrated yet.

---

## D1 — Time/duration formatting: 9 implementations, one name collision (High)

| Location | Name | Input | Output | Callers |
|----------|------|-------|--------|---------|
| `lib/timeFormat.ts:10` | `formatTime(ms, withMs?)` | ms | `m:ss[.mmm]`, clamps ≥0 | `CompactSongSections`, `TrackDetailPage` |
| `lib/timeFormat.ts:27` | `formatTimeFromSeconds(s, withMs?)` | s | `m:ss[.mmm]`, **no clamp** | `AudioPreview`, `SongSections` (orphan) |
| `lib/timeFormat.ts:42` | `formatDuration(ms)` | ms | **`3m 45s`** | `TrackDetailPage` |
| `lib/timeFormat.ts:58` | `formatDurationFull(ms)` | ms | alias of `formatTime` | `AlbumPage`, `ArtistPage` |
| `lib/formatters.ts:11` | `formatDuration(ms)` | ms | **`3:45`** | none |
| `lib/formatters.ts:20` | `formatDurationFromSeconds(s)` | s | `m:ss` | none |
| `lib/sections.ts:39` | `formatMs(ms)` | ms | `m:ss.mmm` | internal only |
| `lib/sections.ts:51` | `formatSeconds(s)` | s | `m:ss.mmm` | internal only |
| `player/embeddedPlayer/constants.ts:14` | `formatTime(s)` | **s** | `m:ss` | `EmbeddedPlayerDrawer` |
| `components/SectionEditor.tsx:60` | local `formatMs` | ms | `m:ss`, **rounds** | local |
| `components/admin/DetectionRunsPanel.tsx:40` | local `formatMs` | ms | `m:ss`, **rounds** | local |
| `components/AudioPreview.tsx:138` | local `formatTime` | s | `m:ss` | **dead**: declared, never called (the file uses `formatTimeFromSeconds`) |

**Hazards.**

- Two exported `formatDuration`s produce **different formats** (`3m 45s` vs `3:45`). Auto-import can
  pick either one.
- Two exported `formatTime`s take **different units** (ms in `lib/timeFormat`, seconds in the player's
  `constants.ts`). Passing the wrong unit is off by 1000× without a type error.
- Floor versus round: `SectionEditor`/`DetectionRunsPanel` round (`0:59.6` → `1:00`), everything else
  floors. Consolidating changes displayed values by up to one second in those two places. Pick one
  deliberately. Section boundaries likely want floor, to match `formatMs`.

**Plan.** Canonical module is `lib/timeFormat.ts`. Rename the collisions so each name says its unit:
`formatClockMs`, `formatClockSeconds`, `formatDurationCompactMs`. Keep the old names as re-exports for
one change. Move `lib/sections.formatMs/formatSeconds` onto it. Delete `lib/formatters`'
`formatDuration`/`formatDurationFromSeconds` (no callers). Replace the two local `formatMs` copies and delete `AudioPreview`'s dead local `formatTime`. Add a
`timeFormat.test.ts`, since the module has none today. Risk is low: pure functions, visible output.
`EmbeddedPlayerDrawer` and `SectionEditor` are dirty (uncommitted), so migrate them last.

## D2 — Relative time ("2h ago"): three styles (Medium)

- `date-fns` `formatDistanceToNow` in ~10 files (`LiveChat`, `TrackComments`, `NotificationList`,
  `FollowingPage`, `PlaylistsPage`, `PlaylistDetailPage`, `NearbyListenersSheet`, …)
- `lib/formatters.ts:29` `formatRelativeTime`, used only by `ProfilePage` (3 calls)
- `lib/forum.ts:61` `timeAgo`, used by `ForumCommentThread` and `PostCard`. It's tested and injectable
  (`now` param), and it outputs compact `5m ago`.

The formats differ on purpose (compact vs `about 2 hours ago`), so full unification is a product call.
The low-risk step: move `timeAgo` into `lib/timeFormat.ts` as the compact variant and point
`ProfilePage` at either it or date-fns. That leaves one hand-written helper instead of two.

## D3 — Two provider search stacks (High, includes a key-exposure risk)

| Concern | Stack A: `lib/unifiedSearch.ts` + `lib/connectors/*` | Stack B: `services/*SearchService.ts` |
|---------|------------------------------------------------------|----------------------------------------|
| Used by | `hooks/api/useSearch.ts` | `SearchPage`, `TrackDetailPage`, `QuickStreamButtons`, `CompactSongSections` |
| Spotify | `SpotifyConnector` → `search-spotify` edge fn | `searchSpotify`/`searchSpotifyPublic` → same edge fn |
| YouTube | `YouTubeConnector` → **`googleapis.com` from the browser with `VITE_YOUTUBE_API_KEY`** (`lib/connectors/youtube.ts:73,100,196`; key read at `lib/unifiedSearch.ts:34`) | `search-youtube` edge fn, server-side key. Its header comment explains why the direct call was dropped. |
| Result type | `NormalizedTrack` | `Track` |
| `YouTubeSearchResult` | declared in `lib/connectors/youtube.ts:14` | declared again in `services/youtubeSearchService.ts:68` |

If `VITE_YOUTUBE_API_KEY` is set in any deployed env, stack A ships the key in the JS bundle and
bypasses the edge function's quota handling (`disableYouTubeSearch` on 401/403). **Check the deployed
env before anything else here.** If the key is unset, `YouTubeConnector.enabled` is false and unified
search silently returns no YouTube results.

**Plan.** First decide which stack survives, which is a product/owner call. Recommendation: keep stack
B's transport (edge functions) and stack A's normalization/registry shape. Make `YouTubeConnector` call
`search-youtube` via `youtubeSearchService`, so both stacks share one transport. Afterwards, stack A's
registry is the only public API. Medium risk: search results feed playback.
`youtubeSearchService.ts` is dirty (uncommitted).

## D4 — Track comments: three data paths (Medium)

- **Canonical:** `hooks/api/useComments.ts`. TanStack Query, realtime, like toggling, count. Backed by
  pure, tested helpers in `lib/trackComments.ts`.
- `components/ScrollingComments.tsx:80,128` queries `track_comments` / `chat_messages` and subscribes
  inside the component.
- `hooks/useDryHooks.ts` (`useVote`, `useComments`, and a `useQuery` that **shadows TanStack's name**).
  It's an orphan with 7 `any`s.

**Plan.** Delete `useDryHooks.ts` (X1). Move `ScrollingComments` onto `useTrackComments` +
`useTrackCommentsRealtime` for the track case, and keep the chat case separate. Low–medium risk.

## D5 — `usePlaylists` defined twice (Low effort, High confusion)

- `hooks/api/usePlaylists.ts:58` `usePlaylists(userId?)`. TanStack. Used by `PlaylistsPage`.
- `hooks/useInteractions.ts:362` `usePlaylists()`. Hand-rolled `useState`/`useEffect`. **No importers.**
- `hooks/useInteractions.ts:313` `useLikedTracks`. **No importers.**

**Plan.** Delete both unused hooks from `useInteractions.ts`, leaving `useInteractions` (used by
`TrackCard`). Low risk. `TrackCard` is dirty, but this edit doesn't touch it.

## D6 — Section label / colour maps disagree (Medium, user-visible)

| Location | What | Chorus colour |
|----------|------|---------------|
| `lib/sections.ts:61` `getSectionDisplayLabel` | labels (canonical, used by `sectionDisplayNames`) | – |
| `components/HarmonicHUD.tsx:43` `SECTION_LABEL` | same labels, re-declared | – |
| `lib/sections.ts:101` `getSectionColor` | `bg-*` palette. **No callers.** | pink |
| `lib/sections.ts:118` `getSectionGradient` | gradient palette. **No callers.** | pink |
| `components/CompactSongSections.tsx:39` | chip palette (live) | **green** |
| `components/SongSections.tsx:17,28` | gradient + emoji palette (orphan) | pink |

So the same section type gets a different colour depending on the component. **Plan:** make
`HarmonicHUD` use `getSectionDisplayLabel`. That's a label-only change with identical strings, so no
visible change (`HarmonicHUD` is dirty, so do it later). Choose one palette in `lib/sections.ts` (a
design call) and migrate `CompactSongSections`. Delete `SongSections.tsx` with the other orphans.

## D7 — Duplicate type declarations (Medium)

| Name | Locations | Same shape? | Action |
|------|-----------|-------------|--------|
| `MusicProvider` | `types/index.ts:2`, `lib/providers.ts:3` | Same members, different order | Keep `types/index.ts`. Re-export it from `lib/providers.ts`. |
| `ProviderLink` | `types/index.ts:55`, `lib/providers.ts:5` | **Different shapes, same name** | Rename the `lib/providers` one to `ProviderLinkDisplay` (it carries name/icon/color). |
| `PlayerState` | `types/index.ts:42`, `player/PlayerContext.tsx:27` | Different. The `types/index` one is unused. | Delete the unused one. |
| `AudioFeatures` | `types/harmony.ts:195`, `services/spotifyUserService.ts:224`, `services/audioAnalysis.ts:25` | Different (Spotify API shape vs analysis shape) | Rename the Spotify one `SpotifyAudioFeatures`. |
| `NearbyListener` | `types/index.ts:330`, `hooks/api/useNearbyListeners.ts:13` | check | Keep one. |
| `TrackConnection` | `types/index.ts:208`, `data/trackLineage.ts:17` | check | Keep one. |
| `Comment` | `types/index.ts:300`, `components/ScrollingComments.tsx:8` | local | Folds into D4. |
| `YouTubeSearchResult` | two, both module-private | – | Folds into D3. |
| `ChordSpan` | `lib/harmony/chordDraft.ts:32` (relative `numeral`, ms) vs `_shared/dsp/chordTimeline.ts:20` (absolute `root` pitch class, s) | **Intentionally different** | **Do not merge.** The split is the relative/absolute storage invariant. Rename for clarity: `NumeralSpan` vs `DetectedChordSpan`. Harmony area, single owner. |
| `SectionProgression` | `types/harmony.ts:120` (Roman, persisted) vs `_shared/dsp/chordTimeline.ts:36` (detected, absolute) | **Intentionally different** | Same as `ChordSpan`: rename, don't merge. |
| `ChordQuality` | `types/harmony.ts:65` (full) vs `_shared/dsp/chordDetection.ts:13` (`'major'\|'minor'`) | Different domains (detector vocabulary vs theory) | Rename the DSP one `TriadQuality`. |
| `Mode` | disagrees with the 7-mode union in `audioAnalysis.ts:78` (TS2322) | – | Folds into T6. |

## D8 — Query keys: constant exists but is rarely used (Low)

`lib/constants.ts:16` defines `QUERY_KEYS`, used by 4 hooks. The other **127 query keys are inline
literals.** The keys spot-checked (`'track-sections'`: `useTrackSections`, `useDetectionRuns`,
`useAnalyzeTrack`) agree, so nothing is broken. Invalidation mismatches are a latent risk only.
**Plan:** migrate a key into `QUERY_KEYS` when its hook is touched. Don't sweep.

## D9 — Small helpers that look duplicated but aren't (leave as-is)

`clampInt` has 4 local definitions (`chordDraft`, `sectionDraft`, `buildEmbedSrc`, `systemSettings`)
with **different semantics**: round vs floor, bounded vs ≥0, `unknown` input returning `null`. Merging
them would change behavior. Leave them local.

## D10 — Unused exports in shared `lib/` modules (Low)

Exports nothing outside their module uses (for internal-only helpers, just drop `export`):

- `lib/formatters.ts`: everything except `formatRelativeTime` (`formatDuration`,
  `formatDurationFromSeconds`, `formatNumber`, `formatBPM` **and** `formatBpm`, `formatCompactNumber`,
  `formatKeySignature`, `formatFileSize`, `truncate`, `capitalize`).
- `lib/sections.ts`: `sectionEndSeconds`, `sectionDurationSeconds`, `formatSeconds`, `getSectionColor`,
  `getSectionGradient`, `getSectionWidthPercent`, `getSectionStartPercent`.
- `lib/constants.ts`: `STORAGE_KEYS`, `LIMITS`, `CACHE_TIMES`, `API_ENDPOINTS`.
- `lib/navigation.ts`: `navigateToAlbum`, `getTrackUrl`, `getArtistUrl`, `getAlbumUrl`.
- `lib/animations.ts`: all but `fadeInUp`.
- `lib/preferences.ts`: all but `setPreferredProvider` / `getPreferredProvider`.
- `lib/providers.ts`: `pickPreferredProvider`, `generateSpotifyLinks`, `generateYoutubeLink`.

Found by name-matching against `src/` (tests excluded). Confirm each one before deleting.
