import { describe, expect, it } from 'vitest';
import { pickPreferredProvider } from './providers';

describe('pickPreferredProvider', () => {
  it('prefers Spotify when both are available', () => {
    expect(pickPreferredProvider({ spotifyId: 's1', youtubeId: 'y1' })).toBe('spotify');
  });

  it('falls back to YouTube when Spotify is unavailable', () => {
    expect(pickPreferredProvider({ youtubeId: 'y1' })).toBe('youtube');
  });

  it('returns null when neither is available', () => {
    expect(pickPreferredProvider({})).toBeNull();
  });

  it('accepts a Spotify web URL as evidence of availability, not just an id', () => {
    expect(pickPreferredProvider({ urlSpotifyWeb: 'https://open.spotify.com/track/x', youtubeId: 'y1' })).toBe(
      'spotify'
    );
  });
});
