import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Track } from '@/types';
import FeedPage from '@/pages/FeedPage';

/**
 * Tapping the docked player's title navigates to /feed asking for one
 * specific song. Two things have to hold for that to land: the feed must be
 * able to show a song its own ranked list never contained (anything started
 * from search, a playlist, a profile or the queue), and it must honour the
 * request even when nothing about playback changed.
 */

const FEED_TRACKS: Track[] = [
  { id: 't1', title: 'First Song', artist: 'A' },
  { id: 't2', title: 'Second Song', artist: 'B' },
  { id: 't3', title: 'Third Song', artist: 'C' },
];

const OFF_FEED_TRACK: Track = {
  id: 'spotify:offfeed',
  title: 'Started From Search',
  artist: 'D',
};

const mockPlayer = {
  openPlayer: vi.fn(),
  canonicalTrackId: null as string | null,
};

vi.mock('@/player/PlayerContext', () => ({
  usePlayer: () => mockPlayer,
}));

// The card itself is exercised by its own specs; here it only has to say
// which track the feed decided to show.
vi.mock('@/components/TrackCard', () => ({
  TrackCard: ({ track }: { track: Track }) => <div data-testid="track-card">{track.title}</div>,
}));

vi.mock('@/components/BottomNav', () => ({ BottomNav: () => null }));
vi.mock('@/components/GuestBanner', () => ({ GuestBanner: () => null }));
vi.mock('@/components/FeedSkeleton', () => ({ FeedSkeleton: () => null }));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/shared', () => ({
  CladeBrand: () => null,
  ProfileCircle: () => null,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    loading: false,
    guestMode: false,
    enterGuestMode: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSystemSettings', () => ({ useSetting: () => false }));
vi.mock('@/hooks/api/useLastFm', () => ({ useLastFmRecentTracks: () => ({ data: [] }) }));
vi.mock('@/hooks/api/usePlayEvents', () => ({ usePlayHistory: () => ({ data: [] }) }));
vi.mock('@/hooks/api/useSpotifyUser', () => ({
  useSpotifyRecommendations: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/hooks/api/useFeed', () => ({
  usePersonalizedFeed: () => ({ data: { tracks: FEED_TRACKS }, isLoading: false, error: null }),
}));

// Mirrors the real hook's contract: it only fetches when the feed asks it to,
// and every one of its sources returns a row whose id IS the canonical id.
vi.mock('@/hooks/api/useTracks', () => ({
  useTrack: (id: string | undefined, enabled: boolean) => ({
    data: enabled && id === OFF_FEED_TRACK.id ? OFF_FEED_TRACK : undefined,
  }),
}));

function renderFeed(state?: { focusTrackId: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{ pathname: '/feed', state }]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <FeedPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('FeedPage showing the song the player asked for', () => {
  it('shows the playing song even when the ranked feed never contained it', () => {
    mockPlayer.canonicalTrackId = OFF_FEED_TRACK.id;

    renderFeed({ focusTrackId: OFF_FEED_TRACK.id });

    expect(screen.getByTestId('track-card')).toHaveTextContent('Started From Search');
  });

  // Without this the tap would be a no-op in its most common case: the
  // listener has swiped a few cards on, and nothing about playback changes
  // when they tap the title, so the player-follows-feed effect never fires.
  // waitFor, not a bare assertion: the card lives inside an AnimatePresence
  // with mode="wait", so the outgoing card is held on screen until its exit
  // animation finishes and only then is the incoming one mounted.
  it('jumps to the requested song when playback itself has not changed', async () => {
    mockPlayer.canonicalTrackId = null;

    renderFeed({ focusTrackId: 't3' });

    await waitFor(() => expect(screen.getByTestId('track-card')).toHaveTextContent('Third Song'));
  });

  // The jump must not become a leash: once it has landed, the feed's own
  // navigation has to keep working.
  it('leaves the listener free to swipe on after the jump', async () => {
    mockPlayer.canonicalTrackId = null;

    renderFeed({ focusTrackId: 't1' });
    expect(screen.getByTestId('track-card')).toHaveTextContent('First Song');

    fireEvent.keyDown(window, { key: 'ArrowDown' });

    await waitFor(() => expect(screen.getByTestId('track-card')).toHaveTextContent('Second Song'));
  });

  it('is an ordinary feed when the player has asked for nothing', () => {
    mockPlayer.canonicalTrackId = null;

    renderFeed();

    expect(screen.getByTestId('track-card')).toHaveTextContent('First Song');
  });
});
