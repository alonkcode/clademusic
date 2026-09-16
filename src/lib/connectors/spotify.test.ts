import { describe, it, expect } from 'vitest';
import { normalizeSpotifyTrack } from './spotify';

/**
 * search-spotify returns Spotify's own Web API track objects. The previous
 * normaliser read `title`, `artist` and `providers.spotify.provider_track_id`
 * - a shape the function never produced - so every field came back
 * undefined. These pin the mapping against the shape it actually sends.
 */
const RAW = {
  id: '4u7EnebtmKWzUH433cf5Qv',
  name: 'Bohemian Rhapsody',
  artists: [{ name: 'Queen' }],
  album: {
    name: 'A Night at the Opera',
    images: [
      { url: 'https://i.scdn.co/image/large', height: 640 },
      { url: 'https://i.scdn.co/image/small', height: 64 },
    ],
  },
  duration_ms: 354320,
  external_ids: { isrc: 'GBUM71029604' },
  external_urls: { spotify: 'https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv' },
  preview_url: 'https://p.scdn.co/mp3-preview/abc',
  uri: 'spotify:track:4u7EnebtmKWzUH433cf5Qv',
};

describe('normalizeSpotifyTrack', () => {
  it('maps a raw Spotify track onto the shared shape', () => {
    expect(normalizeSpotifyTrack(RAW)).toEqual({
      title: 'Bohemian Rhapsody',
      artists: ['Queen'],
      album: 'A Night at the Opera',
      duration_ms: 354320,
      artwork_url: 'https://i.scdn.co/image/large',
      isrc: 'GBUM71029604',
      provider_track_id: '4u7EnebtmKWzUH433cf5Qv',
      provider: 'spotify',
      url_web: 'https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv',
      url_app: 'spotify:track:4u7EnebtmKWzUH433cf5Qv',
      url_preview: 'https://p.scdn.co/mp3-preview/abc',
    });
  });

  it('keeps every credited artist, in order', () => {
    const track = { ...RAW, artists: [{ name: 'Queen' }, { name: 'David Bowie' }] };
    expect(normalizeSpotifyTrack(track).artists).toEqual(['Queen', 'David Bowie']);
  });

  it('takes the largest artwork, which Spotify lists first', () => {
    expect(normalizeSpotifyTrack(RAW).artwork_url).toBe('https://i.scdn.co/image/large');
  });

  it('tolerates a track with no artwork, isrc or preview', () => {
    const sparse = {
      ...RAW,
      album: { name: 'Unknown', images: [] },
      external_ids: undefined,
      preview_url: undefined,
    };
    const got = normalizeSpotifyTrack(sparse);
    expect(got.artwork_url).toBeUndefined();
    expect(got.isrc).toBeUndefined();
    expect(got.url_preview).toBeUndefined();
    expect(got.provider_track_id).toBe(RAW.id);
  });

  it('builds links from the id when Spotify omits them', () => {
    const bare = { ...RAW, external_urls: undefined, uri: undefined } as unknown as typeof RAW;
    const got = normalizeSpotifyTrack(bare);
    expect(got.url_web).toBe(`https://open.spotify.com/track/${RAW.id}`);
    expect(got.url_app).toBe(`spotify:track:${RAW.id}`);
  });
});
