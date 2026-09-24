import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { EmbeddedPlayerDrawer } from '@/player/EmbeddedPlayerDrawer';

/**
 * When Spotify answers 403 for the account (the app is in Development Mode
 * and the account is not on its allowlist), Reconnect can never succeed:
 * OAuth works, /me is refused again, and the button comes straight back.
 * The docked player has to say what is wrong instead of offering it.
 */

const state = vi.hoisted(() => ({
  provider: 'spotify' as 'spotify' | 'youtube',
  connected: false,
  blocked: false,
}));

vi.mock('@/player/PlayerContext', () => ({
  usePlayer: () => ({
    isOpen: true,
    provider: state.provider,
    trackId: 'track-1',
    canonicalTrackId: null,
    trackTitle: 'Test Track',
    trackArtist: 'Test Artist',
    lastKnownTitle: 'Test Track',
    lastKnownArtist: 'Test Artist',
    playRequestId: 1,
    positionMs: 0,
    durationMs: 180000,
    volume: 0.7,
    isMuted: false,
    isPlaying: true,
    isCinema: false,
    enterCinema: vi.fn(),
    exitCinema: vi.fn(),
    togglePlayPause: vi.fn(),
    setVolumeLevel: vi.fn(),
    toggleMute: vi.fn(),
    seekToMs: vi.fn(),
    clearSeek: vi.fn(),
    currentSectionId: null,
    loopSectionId: null,
    setCurrentSection: vi.fn(),
    setLoopSection: vi.fn(),
    closePlayer: vi.fn(),
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
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('@/hooks/api/useAdmin', () => ({
  useIsAdmin: () => ({ data: false }),
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
  useSpotifyConnected: () => ({ data: state.connected }),
  useSpotifyBlocked: () => ({ data: state.blocked }),
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

describe('EmbeddedPlayerDrawer Spotify account state', () => {
  beforeEach(() => {
    state.provider = 'spotify';
    state.connected = false;
    state.blocked = false;
  });

  it('says Spotify blocked the account, and offers no Reconnect, when Spotify answers 403', () => {
    state.blocked = true;

    renderPlayer();

    expect(screen.getByText('Spotify blocked this account')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /reconnect spotify/i })).toBeNull();
  });

  it('still offers Reconnect when Spotify is simply not connected', () => {
    renderPlayer();

    expect(screen.getByRole('button', { name: /reconnect spotify/i })).toBeTruthy();
    expect(screen.queryByText('Spotify blocked this account')).toBeNull();
  });

  it('shows neither when Spotify is connected', () => {
    state.connected = true;

    renderPlayer();

    expect(screen.queryByRole('button', { name: /reconnect spotify/i })).toBeNull();
    expect(screen.queryByText('Spotify blocked this account')).toBeNull();
  });

  it('says nothing about Spotify while a YouTube track is playing', () => {
    state.provider = 'youtube';
    state.blocked = true;

    renderPlayer();

    expect(screen.queryByText('Spotify blocked this account')).toBeNull();
    expect(screen.queryByRole('button', { name: /reconnect spotify/i })).toBeNull();
  });
});
