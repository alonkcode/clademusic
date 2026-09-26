import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QuickStreamButtons } from './QuickStreamButtons';

/**
 * The quicklink has to answer a press at once and then tell the truth: a
 * spinner while the start is unconfirmed, "playing" only once a device has
 * confirmed it, and nothing that looks like a hang or a lie in between.
 */

const player = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const searchSpotifyPublic = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/player/PlayerContext', () => ({ usePlayer: () => player.value }));
vi.mock('@/services/spotifySearchService', () => ({ searchSpotifyPublic }));
vi.mock('@/services/youtubeSearchService', () => ({ searchYouTubeVideos: vi.fn(async () => []) }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

const openPlayer = vi.fn();

const set = (state: Record<string, unknown> = {}) => {
  player.value = { openPlayer, playRequestId: 1, ...state };
};

const view = (track: { spotifyId?: string; youtubeId?: string } = { spotifyId: 's1' }) => (
  <QuickStreamButtons track={track} trackTitle="Song" trackArtist="Band" canonicalTrackId="c1" />
);

const spotifyButton = () => document.querySelector('[data-provider="spotify"]') as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
  openPlayer.mockClear();
  searchSpotifyPublic.mockReset();
  toastError.mockClear();
  set();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Spotify quicklink', () => {
  it('starts the song immediately on click, asking to autoplay', () => {
    render(view());

    fireEvent.click(spotifyButton());

    expect(openPlayer).toHaveBeenCalledTimes(1);
    expect(openPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'spotify', providerTrackId: 's1', autoplay: true })
    );
  });

  it('answers the press at once: busy, spinner, and announced', () => {
    render(view());
    expect(spotifyButton().dataset.state).toBe('idle');

    fireEvent.click(spotifyButton());

    expect(spotifyButton().dataset.state).toBe('starting');
    expect(spotifyButton().getAttribute('aria-busy')).toBe('true');
    expect(spotifyButton().getAttribute('aria-label')).toBe('Starting Song in Spotify');
    expect(spotifyButton().querySelector('svg.animate-spin')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Starting Song in Spotify');
  });

  it('keeps showing "starting" until the player has confirmed - not for a fixed 1.2 seconds', () => {
    const { rerender } = render(view());
    fireEvent.click(spotifyButton());

    // The player has taken the request up and is still connecting.
    set({ playRequestId: 2, provider: 'spotify', trackId: 's1', isPlaying: true, isStarting: true, durationMs: 0 });
    rerender(view());
    expect(spotifyButton().dataset.state).toBe('starting');
  });

  it('shows "playing" - equalizer bars - once the device has confirmed', () => {
    const { rerender } = render(view());
    fireEvent.click(spotifyButton());

    set({ playRequestId: 2, provider: 'spotify', trackId: 's1', isPlaying: true, isStarting: false, durationMs: 200_000 });
    rerender(view());

    expect(spotifyButton().dataset.state).toBe('playing');
    expect(spotifyButton().getAttribute('aria-busy')).toBe('false');
    expect(spotifyButton().getAttribute('aria-label')).toBe('Song is playing in Spotify');
    expect(spotifyButton().querySelector('svg')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Now playing Song');
  });

  it('does not restart a song that is already confirmed playing', () => {
    set({ provider: 'spotify', trackId: 's1', isPlaying: true, isStarting: false, durationMs: 200_000 });
    render(view());

    fireEvent.click(spotifyButton());

    expect(openPlayer).not.toHaveBeenCalled();
  });

  it('does not claim "playing" for the guest embed, which can never confirm', () => {
    // isPlaying is optimistic there and durationMs never arrives.
    set({ provider: 'spotify', trackId: 's1', isPlaying: true, isStarting: false, durationMs: 0 });
    render(view());

    expect(spotifyButton().dataset.state).toBe('idle');
  });

  it('does not claim "playing" for a paused track, and a click plays it', () => {
    set({ provider: 'spotify', trackId: 's1', isPlaying: false, isStarting: false, durationMs: 200_000 });
    render(view());
    expect(spotifyButton().dataset.state).toBe('idle');

    fireEvent.click(spotifyButton());

    expect(openPlayer).toHaveBeenCalledTimes(1);
  });

  it("is not affected by another track's start", () => {
    set({ provider: 'spotify', trackId: 'someone-else', isPlaying: true, isStarting: true, durationMs: 0 });
    render(view());

    expect(spotifyButton().dataset.state).toBe('idle');
  });

  it('never spins forever if the player does not take the request up', () => {
    vi.useFakeTimers();
    render(view());
    fireEvent.click(spotifyButton());
    expect(spotifyButton().dataset.state).toBe('starting');

    act(() => {
      vi.advanceTimersByTime(8_100);
    });

    expect(spotifyButton().dataset.state).toBe('idle');
  });

  it('finds a track it has no id for, then plays it', async () => {
    searchSpotifyPublic.mockResolvedValue({ tracks: [{ spotify_id: 'found-1' }] });
    render(view({ youtubeId: 'y1' }));

    await act(async () => {
      fireEvent.click(spotifyButton());
    });

    expect(spotifyButton().dataset.state).toBe('starting');
    expect(openPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'spotify', providerTrackId: 'found-1', autoplay: true })
    );
  });

  it('stops the spinner and says so when the track cannot be found', async () => {
    searchSpotifyPublic.mockResolvedValue({ tracks: [] });
    render(view({ youtubeId: 'y1' }));

    await act(async () => {
      fireEvent.click(spotifyButton());
    });

    expect(spotifyButton().dataset.state).toBe('idle');
    expect(openPlayer).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('find'));
  });

  it('stops the spinner and says so when the lookup fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    searchSpotifyPublic.mockRejectedValue(new Error('offline'));
    render(view({ youtubeId: 'y1' }));

    await act(async () => {
      fireEvent.click(spotifyButton());
    });

    expect(spotifyButton().dataset.state).toBe('idle');
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('search failed'));
  });
});
