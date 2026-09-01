import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlayerProvider } from '@/player/PlayerContext';
import SearchPage from '@/pages/SearchPage';

/**
 * With nothing typed, the "Results" section used to be the entire local
 * seedTracks catalog - unfiltered, in source order (so the same first
 * track led every visit) - under a heading that read exactly like an
 * actual search had run. It should show nothing until there's a query.
 */

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, guestMode: true }),
}));

vi.mock('@/hooks/api/useSpotifyUser', () => ({
  useSpotifyConnected: () => ({ data: false }),
}));

vi.mock('@/services/spotifySearchService', () => ({
  searchSpotify: vi.fn().mockResolvedValue({ tracks: [], total: 0 }),
  searchSpotifyPublic: vi.fn().mockResolvedValue({ tracks: [], total: 0 }),
}));

vi.mock('@/services/youtubeSearchService', () => ({
  searchYouTubeVideos: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/components/TrackThumbnail', () => ({
  TrackThumbnail: () => null,
}));

function renderSearchPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlayerProvider>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SearchPage />
        </MemoryRouter>
      </PlayerProvider>
    </QueryClientProvider>
  );
}

describe('SearchPage with an empty search box', () => {
  it('shows no "Results" section - not the whole local catalog', () => {
    renderSearchPage();

    expect(screen.queryByText(/^Results \(/)).not.toBeInTheDocument();
    // Blinding Lights is seedTracks[0]; it should not be forced into view by
    // an implicit "show everything" search result.
    expect(screen.queryByText('Blinding Lights')).not.toBeInTheDocument();
  });

  it('still shows a Trending Tracks section for something to browse', () => {
    renderSearchPage();

    expect(screen.getByText('Trending Tracks')).toBeInTheDocument();
  });
});
