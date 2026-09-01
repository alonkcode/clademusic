import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTrackCoverArt } from './useTrackCoverArt';

const searchSpotifyPublic = vi.fn();
vi.mock('@/services/spotifySearchService', () => ({
  searchSpotifyPublic: (...args: unknown[]) => searchSpotifyPublic(...args),
}));

function renderHook(track: Parameters<typeof useTrackCoverArt>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result: string | undefined;
  function Probe() {
    result = useTrackCoverArt(track);
    return null;
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  return { get: () => result };
}

describe('useTrackCoverArt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the track\'s own cover_url without searching, when it looks real', async () => {
    const hook = renderHook({ cover_url: 'https://i.scdn.co/image/real-cover', title: 'A', artist: 'B' });

    expect(hook.get()).toBe('https://i.scdn.co/image/real-cover');
    expect(searchSpotifyPublic).not.toHaveBeenCalled();
  });

  it('treats a seed-catalog Unsplash placeholder as no cover, and searches instead', async () => {
    searchSpotifyPublic.mockResolvedValue({
      tracks: [{ cover_url: 'https://i.scdn.co/image/found-it' }],
      total: 1,
    });

    const hook = renderHook({
      cover_url: 'https://images.unsplash.com/photo-placeholder',
      title: 'Hotel California',
      artist: 'Eagles',
    });

    await waitFor(() => expect(hook.get()).toBe('https://i.scdn.co/image/found-it'));
    expect(searchSpotifyPublic).toHaveBeenCalledWith('Hotel California Eagles', 1);
  });

  it('searches when there is no cover_url at all', async () => {
    searchSpotifyPublic.mockResolvedValue({
      tracks: [{ cover_url: 'https://i.scdn.co/image/wonderwall' }],
      total: 1,
    });

    const hook = renderHook({ title: 'Wonderwall', artist: 'Oasis' });

    await waitFor(() => expect(hook.get()).toBe('https://i.scdn.co/image/wonderwall'));
  });

  it('does not search without a title, and stays undefined', () => {
    const hook = renderHook({ artist: 'Nobody' });

    expect(hook.get()).toBeUndefined();
    expect(searchSpotifyPublic).not.toHaveBeenCalled();
  });

  it('resolves to undefined, not a crash, when the search finds nothing', async () => {
    searchSpotifyPublic.mockResolvedValue({ tracks: [], total: 0 });

    const hook = renderHook({ title: 'Totally Obscure Song', artist: 'Nobody' });

    await waitFor(() => expect(searchSpotifyPublic).toHaveBeenCalled());
    expect(hook.get()).toBeUndefined();
  });
});
