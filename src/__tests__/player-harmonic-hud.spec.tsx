import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { EmbeddedPlayerDrawer } from '@/player/EmbeddedPlayerDrawer';

/**
 * HarmonicHUD (the rotating chord readout) already existed, but was only
 * ever mounted inside the feed's TrackCard - nowhere else the universal
 * player itself appears. Since the player is mounted once, globally, giving
 * it the same readout is what makes chords show up on every page a track
 * can play from, not just the feed.
 */

const mockPlayerContext = {
  isOpen: true,
  provider: 'youtube' as const,
  trackId: 'yt-1',
  canonicalTrackId: '11111111-1111-1111-1111-111111111111',
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
  registerProviderControls: vi.fn(),
  updatePlaybackState: vi.fn(),
};

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
  useTrack: () => ({
    data: {
      id: mockPlayerContext.canonicalTrackId,
      progression_roman: ['I', 'V', 'vi', 'IV'],
      detected_key: 'C',
      detected_mode: 'major',
    },
  }),
}));

vi.mock('@/hooks/api/useHarmonicFingerprint', () => ({
  useHarmonicFingerprint: () => ({ data: null }),
}));

vi.mock('@/hooks/api/useSpotifyConnect', () => ({
  useConnectSpotify: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/api/useSpotifyUser', () => ({
  useSpotifyConnected: () => ({ data: false }),
}));

function renderPlayer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <EmbeddedPlayerDrawer />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EmbeddedPlayerDrawer chord readout', () => {
  it('does not show the chord readout in the default compact bar', () => {
    renderPlayer();

    expect(screen.queryByRole('tablist', { name: /song sections/i })).not.toBeInTheDocument();
  });

  it('shows the rotating chord readout once expanded', () => {
    renderPlayer();

    fireEvent.click(screen.getByLabelText(/show video and expand player/i));

    // The progression row renders each chord as a roman-numeral badge (the
    // active one also appears as the current-chord subtitle, hence AllBy).
    const progression = ['I', 'V', 'vi', 'IV'];
    for (const numeral of progression) {
      expect(screen.getAllByText(numeral).length).toBeGreaterThan(0);
    }
  });
});
