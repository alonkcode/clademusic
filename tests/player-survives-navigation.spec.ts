// @ts-nocheck
import { test, expect } from '@playwright/test';

// "Navigating to links shouldn't stop the player" - the docked player
// (EmbeddedPlayerDrawer, via PlayerVisibilityGate) is mounted once above
// <Routes> in App.tsx specifically so client-side route changes never
// unmount it. This asserts that invariant against a real route change
// (not the test harness's own render, and not a full page reload).
test('the docked player keeps playing the same track across a client-side route change', async ({ page }) => {
  await page.route('**/*.supabase.co/**', (route) => route.fulfill({ status: 200, body: '{}' }));
  await page.route('**open.spotify.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>spotify</body></html>' })
  );

  await page.goto('/clademusic/__e2e__/player');

  const spotifyButtons = page.locator('[data-provider="spotify"]');
  await spotifyButtons.first().click();
  await expect(page.getByText('E2E Track A')).toBeVisible();

  const universalHost = page.locator('#universal-player');
  await expect(universalHost).toHaveCount(1);
  const providerFrame = page.frameLocator('#universal-player').locator('iframe#provider');
  await expect(providerFrame).toHaveAttribute('src', /open\.spotify\.com\/embed\/track\/4uLU6hMCjMI75M1A2tKUQC/);

  // Tag the live iframe node so we can prove it's the *same* DOM node after
  // navigating, not a fresh one that happens to look identical.
  await universalHost.evaluate((el) => el.setAttribute('data-marker', 'still-alive'));

  await page.locator('[data-e2e-nav-away]').click();
  await expect(page).toHaveURL(/\/compare$/);
  await expect(page.locator('body')).toBeVisible();

  // The player bar and its iframe must still be the exact node from before -
  // proof the route change never unmounted the global player tree.
  await expect(universalHost).toHaveCount(1);
  await expect(universalHost).toHaveAttribute('data-marker', 'still-alive');
  await expect(providerFrame).toHaveAttribute('src', /open\.spotify\.com\/embed\/track\/4uLU6hMCjMI75M1A2tKUQC/);

  // Now the real navigation path the user actually complained about: the
  // BottomNav hamburger sheet, on a real page (ComparePage renders it).
  await page.locator('[aria-label="Open navigation"]').click();
  await page.locator('nav a[href$="/search"]').click();
  await expect(page).toHaveURL(/\/search$/);

  await expect(universalHost).toHaveCount(1);
  await expect(universalHost).toHaveAttribute('data-marker', 'still-alive');
  await expect(providerFrame).toHaveAttribute('src', /open\.spotify\.com\/embed\/track\/4uLU6hMCjMI75M1A2tKUQC/);
});
