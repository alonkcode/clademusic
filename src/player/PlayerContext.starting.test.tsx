import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerContext';

/**
 * `isPlaying` is optimistic - true the instant a track is opened - so on its
 * own it cannot tell "starting" from "playing". `isStarting` can, and every
 * spinner and "playing" claim in the UI reads it.
 */

vi.mock('@/api/playEvents', () => ({
  recordPlayEvent: vi.fn(async () => {}),
  recordPlayHistory: vi.fn(async () => {}),
}));

type Ctx = ReturnType<typeof usePlayer>;

let latest: Ctx;

function Probe() {
  const ctx = usePlayer();
  useEffect(() => {
    latest = ctx;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  render(
    <PlayerProvider>
      <Probe />
    </PlayerProvider>
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** openPlayer is queued; let it land. */
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const open = async (provider: 'spotify' | 'youtube', autoplay = true) => {
  act(() => {
    latest.openPlayer({
      canonicalTrackId: 'c1',
      provider,
      providerTrackId: 'track-1',
      title: 'Title',
      artist: 'Artist',
      autoplay,
    });
  });
  await flush();
};

describe('isStarting', () => {
  it('is set, together with the track, when Spotify is opened to play', async () => {
    await open('spotify');

    expect(latest.trackId).toBe('track-1');
    expect(latest.isPlaying).toBe(true);
    expect(latest.isStarting).toBe(true);
  });

  it('is not set for a provider that never confirms a start', async () => {
    await open('youtube');

    expect(latest.isPlaying).toBe(true);
    expect(latest.isStarting).toBe(false);
  });

  it('is not set when Spotify is opened paused', async () => {
    await open('spotify', false);

    expect(latest.isPlaying).toBe(false);
    expect(latest.isStarting).toBe(false);
  });

  it('is cleared by the provider once it has confirmed', async () => {
    await open('spotify');

    act(() => latest.updatePlaybackState({ isStarting: false }));

    expect(latest.isStarting).toBe(false);
    expect(latest.isPlaying).toBe(true);
  });

  it('is cleared by pausing', async () => {
    await open('spotify');

    act(() => latest.togglePlayPause());

    expect(latest.isPlaying).toBe(false);
    expect(latest.isStarting).toBe(false);
  });

  it('is cleared by closing the player', async () => {
    await open('spotify');

    act(() => latest.closePlayer());
    await flush();

    expect(latest.isStarting).toBe(false);
  });

  it('cannot stick: a provider that never reports back is timed out', async () => {
    await open('spotify');
    expect(latest.isStarting).toBe(true);

    await advance(29_000);
    expect(latest.isStarting).toBe(true);

    await advance(2_000);
    expect(latest.isStarting).toBe(false);
  });

  it('gives a newer request its own full window', async () => {
    await open('spotify');
    await advance(20_000);
    await open('spotify');

    await advance(20_000);
    expect(latest.isStarting).toBe(true);

    await advance(11_000);
    expect(latest.isStarting).toBe(false);
  });
});

describe('the playback clock', () => {
  it('holds still while a start is unconfirmed, then runs', async () => {
    // The bar used to advance over a device that had not begun, which read as
    // "playing, but no sound".
    await open('spotify');
    await advance(1_000);
    expect(latest.positionMs).toBe(0);

    act(() => latest.updatePlaybackState({ isStarting: false }));
    await advance(1_000);

    expect(latest.positionMs).toBeGreaterThanOrEqual(750);
  });

  it('still runs immediately for a provider that has no start to confirm', async () => {
    await open('youtube');
    await advance(1_000);

    expect(latest.positionMs).toBeGreaterThanOrEqual(750);
  });
});
