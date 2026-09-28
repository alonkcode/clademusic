import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerContext';
import type { Track } from '@/types';

/**
 * playFromQueue, nextTrack and previousTrack all move playback to a queue
 * entry, and must agree on what that means: which provider plays it, and that
 * an entry that cannot be played anywhere leaves everything as it was.
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

const youtubeTrack: Track = { id: 'yt', title: 'On YouTube', youtube_id: 'yt-id' };
const spotifyTrack: Track = { id: 'sp', title: 'On Spotify', spotify_id: 'sp-id' };
const unplayable: Track = { id: 'none', title: 'Nowhere to play' };

/** Starts the player with `tracks` queued, restored from storage as on a real page load. */
function mountWithQueue(tracks: Track[]) {
  localStorage.setItem('clade_queue_v1', JSON.stringify({ queue: tracks, queueIndex: tracks.length ? 0 : -1 }));
  render(
    <PlayerProvider>
      <Probe />
    </PlayerProvider>
  );
}

/**
 * Queue navigation happens while something is already playing, which is also
 * what gives the player the title it insists on having whenever it is open.
 */
async function mountPlaying(tracks: Track[]) {
  mountWithQueue(tracks);
  act(() =>
    latest.openPlayer({
      canonicalTrackId: tracks[0].id,
      provider: 'youtube',
      providerTrackId: 'yt-id',
      title: 'Now playing',
    })
  );
  await waitFor(() => expect(latest.provider).toBe('youtube'));
}

beforeEach(() => {
  localStorage.clear();
});

describe('moving playback to a queue entry', () => {
  it('plays the entry on the provider it has an id for, and only that provider is open', async () => {
    await mountPlaying([youtubeTrack, spotifyTrack]);

    act(() => latest.playFromQueue(1));
    expect(latest).toMatchObject({
      queueIndex: 1,
      canonicalTrackId: 'sp',
      provider: 'spotify',
      trackId: 'sp-id',
      spotifyOpen: true,
      youtubeOpen: false,
    });

    act(() => latest.playFromQueue(0));
    expect(latest).toMatchObject({
      queueIndex: 0,
      canonicalTrackId: 'yt',
      provider: 'youtube',
      trackId: 'yt-id',
      spotifyOpen: false,
      youtubeOpen: true,
    });
  });

  it('leaves playback alone for a missing entry or one with no playable provider', async () => {
    await mountPlaying([youtubeTrack, unplayable]);
    act(() => latest.playFromQueue(0));
    const before = { ...latest };

    act(() => latest.playFromQueue(1));
    act(() => latest.playFromQueue(7));
    act(() => latest.playFromQueue(-1));

    expect(latest).toMatchObject({
      queueIndex: before.queueIndex,
      canonicalTrackId: before.canonicalTrackId,
      provider: before.provider,
      trackId: before.trackId,
    });
  });

  it('steps forward and back, wrapping at both ends', async () => {
    await mountPlaying([youtubeTrack, spotifyTrack]);
    act(() => latest.playFromQueue(0));

    act(() => latest.nextTrack());
    expect(latest.queueIndex).toBe(1);
    act(() => latest.nextTrack());
    expect(latest.queueIndex).toBe(0);

    act(() => latest.previousTrack());
    expect(latest.queueIndex).toBe(1);
    act(() => latest.previousTrack());
    expect(latest.queueIndex).toBe(0);
    expect(latest.canonicalTrackId).toBe('yt');
  });

  it('does nothing when the queue is empty', () => {
    mountWithQueue([]);

    act(() => latest.nextTrack());
    act(() => latest.previousTrack());

    expect(latest).toMatchObject({ queueIndex: -1, provider: null, trackId: null });
  });
});
