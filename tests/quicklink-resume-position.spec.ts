// @ts-nocheck
import { test, expect } from '@playwright/test';

// The Spotify/YouTube quicklinks hand the same track from one provider to the
// other. That handoff has to continue where the listener actually was, not
// restart at 0:00.
//
// It used to restart, for two compounding reasons: PlayerContext.positionMs
// only ever moved when a provider reported it (and the embed path reports
// nothing - guest Spotify has no API to report through), so the handoff read
// 0; and EmbeddedPlayerDrawer built the embed request without startSec at all,
// so even a correct position never reached buildEmbedSrc.
test.describe('Quicklink provider handoff', () => {
  test('resumes at the position it was handed, and does not churn the embed', async ({ page }) => {
    await page.goto('/clademusic/__e2e__/player');

    const trackA = page.locator('.rounded-lg.border').first();
    const providerSrc = () =>
      page.evaluate(
        () =>
          document
            .querySelector('#universal-player')
            ?.contentDocument?.querySelector('#provider')
            ?.getAttribute('src') || null
      );

    await trackA.locator('[data-provider="youtube"]').click();
    await expect.poll(providerSrc, { timeout: 15000 }).toContain('youtube-nocookie.com/embed/');

    // A fresh play starts at the beginning - nothing to resume yet.
    expect(await providerSrc()).not.toMatch(/[?&]start=/);

    // Hand it to the other provider and back.
    await trackA.locator('[data-provider="spotify"]').click();
    await expect.poll(providerSrc, { timeout: 15000 }).toContain('open.spotify.com/embed/track');

    // Put a real position on the clock the way a reporting provider does, by
    // relaying one state message from inside the player frame.
    //
    // This used to just wait 4s and let PlayerContext's own optimistic clock
    // tick. That only worked because the app kept counting over an embed that
    // had never started - YouTube refuses to play a licensed video from a CI
    // runner or from localhost, and the player now correctly stops its clock
    // when the embed reports it cannot play. So waiting measured nothing and
    // the handoff read 0.
    //
    // Done on the SPOTIFY leg on purpose: YouTube answers a blocked video with
    // onError, and handling that resets the position to where the load was
    // asked to start. Reporting a position on the leg that has no such error
    // is what the handoff actually reads, and does not race it.
    const playerFrame = page.frames().find((f) => f.url().includes('universal-player.html'));
    expect(playerFrame, 'universal player frame should exist').toBeTruthy();
    await playerFrame!.evaluate(() => {
      window.parent.postMessage(
        { type: 'universal-player:state', payload: { positionMs: 12_000, durationMs: 210_000, isPlaying: true } },
        window.location.origin
      );
    });
    await page.waitForTimeout(500);

    await trackA.locator('[data-provider="youtube"]').click();
    await expect.poll(providerSrc, { timeout: 15000 }).toContain('youtube-nocookie.com/embed/');

    const resumed = await providerSrc();
    const startParam = resumed?.match(/[?&]start=(\d+)/)?.[1];
    expect(startParam, 'YouTube embed should carry a start offset after a handoff').toBeTruthy();
    expect(Number(startParam)).toBeGreaterThan(0);

    // The start offset lands in the iframe's src, and the host reloads the
    // frame whenever that src changes - so a position tracked live rather than
    // snapshotted would rewrite it several times a second and restart playback
    // continuously. Same src throughout means the snapshot is holding.
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(700);
      const src = await providerSrc();
      if (src) seen.add(src);
    }
    expect(seen.size, 'embed src must not change during playback').toBe(1);
  });
});
