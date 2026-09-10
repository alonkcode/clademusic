# Testing

Two suites, split by whether a test needs a real browser.

| Suite | Owns | Location | Config |
|-------|------|----------|--------|
| Vitest | Unit, hook and component tests | `src/**/*.{test,spec}.{ts,tsx}` | `vitest.config.ts` |
| Playwright | Anything needing a browser | `tests/*.spec.ts` | `playwright.config.ts` |

Vitest explicitly excludes `tests/`, so the two never overlap.

## Unit and component tests (Vitest)

```bash
bun run test          # single run
bun run test:watch    # watch mode
```

Run `bun run test`, **not** `bun test`. The bare form invokes Bun's own test
runner rather than Vitest, which means it skips `src/test/setup.ts` and the
jsdom environment.

## Browser tests (Playwright)

```bash
bun run test:pw:install   # one-time: download the Chromium build
bun run test:e2e          # every spec in tests/
bun run test:e2e:smoke    # route smoke only
bun run test:pw:ui        # interactive runner
bun run test:pw:headed    # watch it drive a real browser
```

Playwright starts its own dev server on `:4173` through the `webServer` block
in `playwright.config.ts`, so there is no separate "start the server first"
step. The app is served under `/clademusic/`, which is why specs navigate to
`/clademusic/...` rather than `/`.

### What lives there

- **`tests/app-routes.spec.ts`** — route smoke. Every public route must mount
  real content, must not fall through to the `ErrorBoundary`, and must not
  fall through to the 404 page. Also covers the search input, the login form,
  empty-submit validation, and the `/auth` → `/login` redirect.
- **`tests/player-*.spec.ts`, `tests/universal-player.spec.ts`,
  `tests/quicklink-resume-position.spec.ts`** — universal-player invariants:
  only one playback surface exists at a time, provider switching is atomic,
  the player outlives navigation, z-index dominance, no per-card iframes.
  These drive the dedicated `/__e2e__/player` harness route.

### Writing a test that can actually fail

The Cypress suite this replaced had 44 of 80 tests that asserted nothing —
they computed a variable and dropped it — plus a common
`cy.get('body').should('be.visible')` that passes on a blank page and on a
crashed one. Prefer an assertion that distinguishes a working page from a
broken one, and sanity-check a new test by deliberately breaking what it
covers to confirm it goes red.

## CI

| Workflow | Runs |
|----------|------|
| `ci.yml` | lint, typecheck, Playwright, Vitest, build |
| `deploy.yml` | the full suite, then the production deploy |
| `pr.yml` | path-filtered quality checks |
| `qa-hourly.yml` | scheduled Playwright + Vitest runs, reported to `/functions/v1/test-runs` |
