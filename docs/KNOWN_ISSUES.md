# Known Issues

This page tracks user-visible problems that are either unresolved or have important operational notes.

---

## Open

### Spotify
- **403 on `api.spotify.com/v1/me` after connecting**
  - Usually means the Spotify app is in **Development Mode** and the current user is not on the allowlist in the Spotify Developer Dashboard.
- **QuickStream sometimes plays the previous track**
  - Symptoms: after playing track A, selecting track B starts track A again unless the page is refreshed.
- **When Spotify is connected, preview audio still plays instead of full track**
  - Expected: Spotify-connected users should get full playback (where supported by auth + account type).

### Billing / Monetization
- **Three inconsistent pricing models coexist in the codebase.** The public
  `/pricing` marketing page, the real `/billing` page (backed by Stripe +
  `billing-webhook`), and an unused, dead `src/services/billing.ts` all
  define different plan names and prices. Only `/billing`'s Free/Starter/Pro
  is actually wired to payments. Needs a product decision, not just a code
  fix — see [MONETIZATION.md §5](MONETIZATION.md#5-known-inconsistency-three-pricing-models-in-one-codebase).
- **Credits are granted and displayed but never spent.** No feature in the
  app currently checks or deducts a user's credit balance, so paying for
  Starter/Pro doesn't unlock anything a Free user can't already do. See
  [MONETIZATION.md §4](MONETIZATION.md#4-the-credits-system-what-actually-happens-today).

### Development tooling
- **`bun run typecheck` silently checks zero files.** The root `tsconfig.json`
  is solution-style (`"files": []` + `references`), and plain `tsc --noEmit`
  on it builds nothing without `-b`. Confirmed by injecting an obvious type
  error and re-running it — it reported nothing. Pointing directly at
  `tsconfig.app.json` (or `tsc -b`) instead hits a real, separate breakage:
  `@types/node`'s `globals.d.ts` fails to parse under the installed
  TypeScript version (a version-mismatch problem). Not fixed — it's a
  dependency-version change, riskier than a docs/link pass, and wants a
  deliberate decision rather than a side-effect fix.

---

## Recently Resolved

### Unreleased (2026-08-31)
- Player redesigned to dock as a fixed, full-width bar at the bottom of the
  screen (like Spotify) with a compact video miniplayer, replacing the
  floating/draggable/resizable panel
- Seekbar no longer freezes at 0:00 or drifts out of sync on YouTube tracks
- Section chips no longer light up from another track's playback position
- Fixed `ReferenceError: supabase is not defined` when connecting Last.fm
- Live chord detection's silence gate fixed (was comparing an
  always-unit-normalized vector against itself, so it could never actually
  detect a quiet passage)
- Added automatic verse/chorus section-boundary detection from live-captured
  audio (self-similarity + novelty-curve segmentation)
- Fixed ~18 dead footer links (About/Contact/Careers/Blog/FAQ/Docs/etc. -
  none of those pages exist) across nearly every page in the app
- Fixed forum navigation: clicking a post or forum changed the URL but
  showed the same unfiltered listing; "Create Post"/"Create Forum"/"Join"
  went nowhere useful

### 1.0.1 (2026-02-04)
- Prevented “blank screen” crashes by adding app/route/player error boundaries
- Fixed build-breaking hidden characters accidentally committed into source files

