import { describe, expect, it } from 'vitest';
import { describeSpotifyFallback } from './spotifyFallbackNotice';

const DEV_MODE_REASON =
  'Spotify playback not permitted (403). Using preview mode. If this account should have full access, add it under the Spotify Developer Dashboard → your app → Users and Access.';

describe('describeSpotifyFallback', () => {
  it('names Development Mode for a 403, and tells only an admin how to fix it', () => {
    const admin = describeSpotifyFallback(DEV_MODE_REASON, true);
    expect(admin.title).toBe('Spotify app in Development Mode');
    expect(admin.description).toBe(DEV_MODE_REASON);

    for (const notAdmin of [false, undefined]) {
      const listener = describeSpotifyFallback(DEV_MODE_REASON, notAdmin);
      expect(listener.title).toBe('Spotify app in Development Mode');
      // A listener has no access to the dashboard the raw reason points at.
      expect(listener.description).not.toContain('Developer Dashboard');
    }
  });

  it('also treats a bare mention of the developer dashboard as a Development Mode block', () => {
    expect(describeSpotifyFallback('Add this user in the developer dashboard', true).title).toBe(
      'Spotify app in Development Mode'
    );
  });

  it('says Premium is required for an account error', () => {
    const notice = describeSpotifyFallback('Spotify Premium is required for full-track playback. Using preview mode.', false);
    expect(notice.title).toBe('Spotify Premium required');
    expect(notice.description).toContain('Premium is required');
  });

  it('falls back to a generic title and passes the reason through', () => {
    const notice = describeSpotifyFallback('Spotify device not ready. Using preview mode.', false);
    expect(notice).toEqual({
      title: 'Falling back to Spotify preview',
      description: 'Spotify device not ready. Using preview mode.',
    });
  });
});
