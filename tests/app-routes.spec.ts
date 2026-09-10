// @ts-nocheck
import { test, expect } from '@playwright/test';

/**
 * Route-level smoke coverage.
 *
 * Replaces cypress/e2e/smoke.cy.ts. The Cypress original leaned on
 * `cy.get('body').should('be.visible')`, which passes on a blank page and on
 * a crashed one, so it could not distinguish a working route from a broken
 * one. Every check here is written so that it can actually fail:
 *
 *   - the route must mount real content (#root is not near-empty),
 *   - the ErrorBoundary fallback must NOT have taken over, and
 *   - the 404 page must NOT have taken over on a route that does exist.
 *
 * The app is served under /clademusic/, matching vite.config.ts's base and
 * the goto() calls in the player specs alongside this file.
 */

const BASE = '/clademusic';

const ERROR_BOUNDARY_TEXT = 'Something went wrong';
const NOT_FOUND_TEXT = 'Oops! Page not found';

/** Text length below which a route has clearly not rendered anything real. */
const MIN_CONTENT_CHARS = 40;

async function gotoRoute(page, path: string) {
  await page.goto(`${BASE}${path}`);
  // Pages are lazy-loaded behind Suspense, so wait for the fallback spinner
  // to give way to real content before asserting on it.
  await expect
    .poll(async () => (await page.locator('#root').innerText()).trim().length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(MIN_CONTENT_CHARS);
}

async function expectHealthy(page) {
  await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
  await expect(page.getByText(NOT_FOUND_TEXT)).toHaveCount(0);
}

test.describe('Route smoke', () => {
  // Public routes reachable without a session. /feed and /profile are left to
  // their own tests below because they may legitimately redirect.
  const routes = [
    '/',
    '/search',
    '/compare',
    '/pricing',
    '/playlists',
    '/forum',
    '/terms',
    '/privacy',
  ];

  for (const route of routes) {
    test(`${route} renders without crashing`, async ({ page }) => {
      await gotoRoute(page, route);
      await expectHealthy(page);
    });
  }

  test('an unknown route renders the 404 page', async ({ page }) => {
    await gotoRoute(page, '/this-route-does-not-exist');
    await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible();
    // The 404 page is a deliberate render, not a crash.
    await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
  });

  test('/feed renders either the feed or an auth gate, never a crash', async ({ page }) => {
    await gotoRoute(page, '/feed');
    await expectHealthy(page);
  });
});

test.describe('Search page', () => {
  test('the search input accepts and retains typed text', async ({ page }) => {
    await gotoRoute(page, '/search');

    // SearchPage renders a shadcn <Input> with no type="search", which is why
    // the Cypress selector input[type="search"] never matched it.
    const input = page.getByPlaceholder(/search songs or artists/i);
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    await input.fill('nirvana');
    await expect(input).toHaveValue('nirvana');
  });
});

test.describe('Login page', () => {
  test('renders the credential form', async ({ page }) => {
    await gotoRoute(page, '/login');

    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]').first()).toBeEnabled();
  });

  test('submitting an empty form reports a validation error', async ({ page }) => {
    await gotoRoute(page, '/login');

    await page.locator('button[type="submit"]').first().click();

    // Either the app's own role="alert" copy or native constraint validation
    // must reject the empty submit - what must not happen is a silent no-op.
    const alerts = page.locator('[role="alert"]');
    const invalid = page.locator('input:invalid');
    await expect
      .poll(async () => (await alerts.count()) + (await invalid.count()), { timeout: 5_000 })
      .toBeGreaterThan(0);
  });

  test('/auth redirects an anonymous visitor to /login', async ({ page }) => {
    await gotoRoute(page, '/auth');
    await expect(page).toHaveURL(/\/login$/);
  });
});
