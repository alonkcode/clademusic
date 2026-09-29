import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { EmbeddedPlayerDrawer } from '@/player/EmbeddedPlayerDrawer';

/**
 * The docked player is mounted once, globally, so its title is the only thing
 * on every page that names what is actually playing. Tapping it takes the
 * main content back to that song's feed card - cover, metadata and the split
 * section chips - rather than leaving the listener to find it by hand.
 */

const CANONICAL_ID = '11111111-1111-1111-1111-111111111111';

const mockPlayerContext = {
  isOpen: true,
  provider: 'youtube' as const,
  trackId: 'yt-1',
  canonicalTrackId: CANONICAL_ID,
  trackTitle: 'Test Track',
  trackArtist: 'Test Artist',
  lastKnownTitle: 'Test Track',
  lastKnownArtist: 'Test Artist',
  positionMs: 0,
  durationMs: 180000,
  volume: 0.7,
  isMuted: false,
  isPlaying: true,
  isMinimized: false,
  isMini: false,
  isCinema: false,
  miniPosition: { x: 0, y: 0 },
  enterCinema: vi.fn(),
  exitCinema: vi.fn(),
  togglePlayPause: vi.fn(),
  setVolumeLevel: vi.fn(),
  toggleMute: vi.fn(),
  seekTo: vi.fn(),
  seekToMs: vi.fn(),
  clearSeek: vi.fn(),
  seekToSec: null,
  currentSectionId: null,
  loopSectionId: null,
  setCurrentSection: vi.fn(),
  setLoopSection: vi.fn(),
  closePlayer: vi.fn(),
  collapseToMini: vi.fn(),
  restoreFromMini: vi.fn(),
  setMiniPosition: vi.fn(),
  queue: [],
  queueIndex: -1,
  playFromQueue: vi.fn(),
  removeFromQueue: vi.fn(),
  reorderQueue: vi.fn(),
  clearQueue: vi.fn(),
  shuffleQueue: vi.fn(),
  nextTrack: vi.fn(),
  previousTrack: vi.fn(),
  isHidden: false,
  toggleHidden: vi.fn(),
  registerProviderControls: vi.fn(),
  updatePlaybackState: vi.fn(),
};

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/player/PlayerContext', () => ({
  usePlayer: () => mockPlayerContext,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/hooks/api/useTrackSections', () => ({
  useTrackSections: () => ({ data: [] }),
}));

vi.mock('@/hooks/api/useTracks', () => ({
  useTrack: () => ({ data: null }),
}));

vi.mock('@/hooks/api/useHarmonicFingerprint', () => ({
  useHarmonicFingerprint: () => ({ data: null }),
}));

vi.mock('@/hooks/api/useSpotifyConnect', () => ({
  useConnectSpotify: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/api/useSpotifyUser', () => ({
  useSpotifyConnected: () => ({ data: false }),
  useSpotifyBlocked: () => ({ data: false }),
}));

function renderPlayer(initialPath = '/search') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[initialPath]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <EmbeddedPlayerDrawer />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EmbeddedPlayerDrawer track title', () => {
  beforeEach(() => {
    navigateMock.mockClear();
  });

  it('sends the feed to the playing song when the title is tapped', () => {
    renderPlayer();

    fireEvent.click(screen.getByLabelText('Track title'));

    expect(navigateMock).toHaveBeenCalledWith('/feed', {
      state: { focusTrackId: CANONICAL_ID },
      replace: false,
    });
  });

  // Tapping the title while already on the feed is the common case (swipe a
  // few cards away, then tap to get back). Pushing there would stack an
  // identical /feed entry per tap for the back button to walk through.
  it('replaces rather than pushes when the feed is already the open page', () => {
    renderPlayer('/feed');

    fireEvent.click(screen.getByLabelText('Track title'));

    expect(navigateMock).toHaveBeenCalledWith('/feed', {
      state: { focusTrackId: CANONICAL_ID },
      replace: true,
    });
  });

  // The same block is a horizontal swipe target for prev/next track. A flick
  // past the tap slop usually suppresses the click engines synthesize after a
  // touch, but not on every engine - so swiping to the next track must not
  // also throw the listener over to the feed.
  it('does not navigate on the click that can follow a swipe to the next track', () => {
    renderPlayer();

    const title = screen.getByLabelText('Track title');
    const swipeBlock = title.parentElement as HTMLElement;

    fireEvent.touchStart(swipeBlock, { touches: [{ clientX: 200, clientY: 40 }] });
    fireEvent.touchEnd(swipeBlock, { changedTouches: [{ clientX: 40, clientY: 44 }] });
    fireEvent.click(title);

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
