import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { PlayerProvider, usePlayer } from '@/player/PlayerContext';
import { installFakeSpotify } from '@/test/fakeSpotify';
import { SpotifyWebPlayer } from './SpotifyWebPlayer';

/**
 * The quicklink-to-Spotify path, end to end: the real PlayerProvider and
 * SpotifyWebPlayer against a fake SDK device and Web API. These pin what the
 * listener experiences - one click starts the song, the transport tells the
 * truth about it, and a bad moment at Spotify never drops them to the preview.
 */

const timing = vi.hoisted(() => ({ verifyTimeoutMs: 150 }));

vi.mock('@/lib/env', () => ({ isTestEnv: false }));
vi.mock('@/api/playEvents', () => ({
  recordPlayEvent: vi.fn(async () => {}),
  recordPlayHistory: vi.fn(async () => {}),
}));
vi.mock('@/services/spotifyAuthService', () => ({
  getValidAccessToken: vi.fn(async () => 'test-token'),
  forceRefreshAccessToken: vi.fn(async () => 'fresh-token'),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
// Real waits would make every failure test take seconds; only the order of
// events matters here.
vi.mock('./spotifyPlayback', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./spotifyPlayback')>();
  class FastSession extends mod.SpotifyPlaybackSession {
    constructor(options: ConstructorParameters<typeof mod.SpotifyPlaybackSession>[0]) {
      super({
        ...options,
        retryDelaysMs: [0, 0, 0, 0],
        readyTimeoutMs: 300,
        verifyTimeoutMs: timing.verifyTimeoutMs,
        verifyIntervalMs: 10,
      });
    }
  }
  return { ...mod, SpotifyPlaybackSession: FastSession };
});

type Ctx = ReturnType<typeof usePlayer>;

let fake: ReturnType<typeof installFakeSpotify>;
const onFallback = vi.fn();
const onNotice = vi.fn();

function Harness({ onCtx }: { onCtx: (ctx: Ctx) => void }) {
  const ctx = usePlayer();
  useEffect(() => {
    onCtx(ctx);
  });
  // Bound to the context the way the drawer binds it, so a new quicklink is a
  // new providerTrackId.
  return <SpotifyWebPlayer providerTrackId={ctx.trackId} onFallback={onFallback} onNotice={onNotice} />;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  onFallback.mockClear();
  onNotice.mockClear();
  timing.verifyTimeoutMs = 150;
  fake = installFakeSpotify();
});

afterEach(() => {
  fake.restore();
  vi.restoreAllMocks();
});

/** Like the drawer: the SDK player exists only while Spotify is the active provider,
 *  so switching to YouTube unmounts it and coming back mounts a new one. */
function DrawerHarness({ onCtx }: { onCtx: (ctx: Ctx) => void }) {
  const ctx = usePlayer();
  useEffect(() => {
    onCtx(ctx);
  });
  return ctx.provider === 'spotify' ? (
    <SpotifyWebPlayer providerTrackId={ctx.trackId} onFallback={onFallback} onNotice={onNotice} />
  ) : null;
}

async function setup(Root: typeof Harness = Harness) {
  let latest: Ctx | null = null;
  const view = render(
    <PlayerProvider>
      <Root onCtx={(c) => (latest = c)} />
    </PlayerProvider>
  );
  await waitFor(() => expect(latest).toBeTruthy());
  return { get: () => latest!, unmount: view.unmount };
}

/**
 * openPlayer is queued and applied a tick later, so an assertion made right
 * after calling it can be about the state BEFORE the click - "not starting"
 * then passes vacuously. Resolves once the request has actually been applied.
 */
const quicklink = async (get: () => Ctx, id: string, autoplay = true) => {
  const before = get().playRequestId;
  act(() => {
    get().openPlayer({
      canonicalTrackId: `canonical-${id}`,
      provider: 'spotify',
      providerTrackId: id,
      title: 'Fake Track',
      artist: 'Fake Artist',
      autoplay,
    });
  });
  await waitFor(() => expect(get().playRequestId).toBeGreaterThan(before));
};

const settled = { timeout: 3_000 };

describe('a Spotify quicklink click', () => {
  it('starts the song from a single click, showing "starting" until the device confirms', async () => {
    // A device that takes a moment to come up, so "starting" can be seen.
    fake.world.readyDelayMs = 150;
    const { get } = await setup();

    await quicklink(get, 'track-a');
    expect(get().isStarting).toBe(true);
    expect(get().isPlaying).toBe(true);

    await waitFor(() => expect(get().isStarting).toBe(false), settled);
    expect(fake.world.trackId).toBe('track-a');
    expect(fake.world.plays).toHaveLength(1);
    expect(get().isPlaying).toBe(true);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('keeps the transport on "starting" - not back to "play" - while the device is still loading', async () => {
    // The device accepts the track but reports `paused` for a while before
    // audio begins. Relaying that flipped play back to "play" moments after the
    // click, which is what read as play turning to pause.
    timing.verifyTimeoutMs = 3_000;
    fake.world.adoptPaused = true;
    const { get } = await setup();

    await quicklink(get, 'track-a');
    await waitFor(() => expect(fake.world.plays).toHaveLength(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1_200));
    });

    expect(get().isPlaying).toBe(true);
    expect(get().isStarting).toBe(true);

    fake.world.paused = false;
    await waitFor(() => expect(get().isStarting).toBe(false), settled);
    expect(get().isPlaying).toBe(true);
  });

  it('does not advance the progress bar over a device that has not started', async () => {
    timing.verifyTimeoutMs = 3_000;
    fake.world.adoptPaused = true;
    const { get } = await setup();

    await quicklink(get, 'track-a');
    await waitFor(() => expect(fake.world.plays).toHaveLength(1));
    const before = get().positionMs;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });

    // The device's own position is 1000 in the fake; nothing else may move it.
    expect(get().positionMs).toBeLessThanOrEqual(Math.max(before, 1_000));
  });

  it('reports a pause once the start has settled', async () => {
    const { get } = await setup();
    await quicklink(get, 'track-a');
    await waitFor(() => expect(get().isStarting).toBe(false), settled);

    // Paused at the device (another Spotify client, say) after it was playing.
    fake.world.paused = true;

    await waitFor(() => expect(get().isPlaying).toBe(false), settled);
  });

  it('is retried after a 404 right at connect, without a second click', async () => {
    // Spotify often does not know a freshly announced device yet. The first
    // click used to be silently dropped and the second one "worked".
    fake.world.playResponses = [{ status: 404 }];
    const { get } = await setup();

    await quicklink(get, 'track-a');

    await waitFor(() => expect(get().isStarting).toBe(false), settled);
    expect(fake.world.plays).toHaveLength(2);
    expect(fake.world.trackId).toBe('track-a');
    expect(get().isPlaying).toBe(true);
    expect(onFallback).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('stays in full playback through a bad moment at Spotify, says so, and works on retry', async () => {
    // Any thrown error or failed refresh used to drop the session to the free
    // preview for good.
    fake.world.playResponses = Array.from({ length: 5 }, () => ({ status: 503 }));
    const { get } = await setup();

    await quicklink(get, 'track-a');
    await waitFor(() => expect(get().isStarting).toBe(false), settled);

    expect(onFallback).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/try again/i));
    // The transport is honest: nothing is playing.
    await waitFor(() => expect(get().isPlaying).toBe(false), settled);

    // Spotify is back; pressing play starts the song.
    act(() => get().togglePlayPause());
    await waitFor(() => expect(fake.world.trackId).toBe('track-a'), settled);
    await waitFor(() => expect(get().isStarting).toBe(false), settled);
    expect(get().isPlaying).toBe(true);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('falls back to the preview only for a failure that retrying cannot fix', async () => {
    fake.world.playResponses = [{ status: 403, body: { error: { reason: 'PREMIUM_REQUIRED' } } }];
    const { get } = await setup();

    await quicklink(get, 'track-a');

    await waitFor(() => expect(onFallback).toHaveBeenCalledWith(expect.stringMatching(/premium/i)), settled);
    expect(get().isStarting).toBe(false);
  });

  it('builds one device and ends on the newer song when a second click lands mid-connect', async () => {
    // Clicking again because nothing has happened yet is what used to create a
    // second player, and leave the old song playing.
    fake.world.connectDelayMs = 80;
    fake.world.readyDelayMs = 100;
    const { get } = await setup();

    await quicklink(get, 'track-a');
    await quicklink(get, 'track-b');

    await waitFor(() => expect(get().isStarting).toBe(false), settled);
    expect(fake.players()).toHaveLength(1);
    expect(fake.world.trackId).toBe('track-b');
    expect(fake.world.plays.at(-1)?.uri).toBe('spotify:track:track-b');
  });

  it('lifts an earlier mute for the next quicklink, so the new song is audible', async () => {
    // Opening a track resets the UI to unmuted but used to leave the device at
    // the 0 the mute had put it at: playing, and silent.
    const { get } = await setup();
    await quicklink(get, 'track-a');
    await waitFor(() => expect(get().isStarting).toBe(false), settled);

    act(() => get().toggleMute());
    await waitFor(() => expect(fake.world.volumes.at(-1)).toBe(0));

    await quicklink(get, 'track-b');
    await waitFor(() => expect(fake.world.trackId).toBe('track-b'), settled);

    expect(get().isMuted).toBe(false);
    expect(fake.world.volumes.at(-1)).toBeGreaterThan(0);
  });

  it('opened paused, waits for play to be pressed', async () => {
    const { get } = await setup();

    await quicklink(get, 'track-a', false);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(fake.world.plays).toHaveLength(0);
    expect(get().isStarting).toBe(false);

    act(() => get().togglePlayPause());
    await waitFor(() => expect(fake.world.plays).toHaveLength(1), settled);
    await waitFor(() => expect(get().isStarting).toBe(false), settled);
    expect(get().isPlaying).toBe(true);
  });

  it('silences its device when it goes away, but leaves the one player connected', async () => {
    const { get, unmount } = await setup();
    await quicklink(get, 'track-a');
    await waitFor(() => expect(get().isStarting).toBe(false), settled);

    unmount();

    expect(fake.world.pauseCalls).toBeGreaterThanOrEqual(1);
    expect(fake.players().every((p) => p.disconnectCalls === 0)).toBe(true);
  });
});

describe('switching to YouTube and back', () => {
  const openYouTube = async (get: () => Ctx) => {
    const before = get().playRequestId;
    act(() => {
      get().openPlayer({
        canonicalTrackId: 'canonical-yt',
        provider: 'youtube',
        providerTrackId: 'yt-video',
        title: 'Fake Track',
        artist: 'Fake Artist',
        autoplay: true,
      });
    });
    await waitFor(() => expect(get().playRequestId).toBeGreaterThan(before));
  };

  it('starts Spotify again on the way back, on the same device, with no error', async () => {
    // Coming back used to build a second SDK player. The SDK gives one working
    // player per page, so the second announced a device nothing was behind: the
    // start was retried, then reported as "Spotify didn't respond".
    const { get } = await setup(DrawerHarness);
    await quicklink(get, 'track-a');
    await waitFor(() => expect(get().isStarting).toBe(false), settled);

    await openYouTube(get);
    // Spotify is silenced the moment YouTube takes over.
    await waitFor(() => expect(fake.world.pauseCalls).toBeGreaterThanOrEqual(1));

    await quicklink(get, 'track-a');
    await waitFor(() => expect(get().isStarting).toBe(false), settled);

    expect(fake.players()).toHaveLength(1);
    expect(fake.world.plays.map((p) => p.deviceId)).toEqual(['device-1', 'device-1']);
    expect(fake.world.trackId).toBe('track-a');
    expect(get().isPlaying).toBe(true);
    expect(onNotice).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('restores the volume a mute set on the way out', async () => {
    const { get } = await setup(DrawerHarness);
    await quicklink(get, 'track-a');
    await waitFor(() => expect(get().isStarting).toBe(false), settled);

    await openYouTube(get); // silences Spotify: the device is muted to 0
    await waitFor(() => expect(fake.world.volumes.at(-1)).toBe(0));

    await quicklink(get, 'track-a');
    await waitFor(() => expect(get().isStarting).toBe(false), settled);

    expect(fake.world.volumes.at(-1)).toBeGreaterThan(0);
  });
});

describe('pressing play', () => {
  it('issues a real start when the device never got the track', async () => {
    const { get } = await setup();
    await quicklink(get, 'track-a');
    await waitFor(() => expect(get().isStarting).toBe(false), settled);

    // The device lost the track. resume() is a no-op on such a device, so the
    // press has to re-issue the request or the button does nothing at all.
    fake.world.trackId = null;
    fake.world.paused = true;
    const putsBefore = fake.world.plays.length;
    act(() => get().togglePlayPause());
    await act(() => get().togglePlayPause());

    await waitFor(() => expect(fake.world.plays.length).toBeGreaterThan(putsBefore), settled);
    expect(fake.world.resumeCalls).toBe(0);
  });

  it('resumes instead of restarting when Spotify relinked the track', async () => {
    const { get } = await setup();
    await quicklink(get, 'track-a');
    await waitFor(() => expect(get().isStarting).toBe(false), settled);

    // The device did load the track, under a market substitute's id.
    fake.world.trackId = 'substitute-id';
    fake.world.linkedFromId = 'track-a';
    fake.world.paused = true;
    const putsBefore = fake.world.plays.length;
    act(() => get().togglePlayPause());
    await act(() => get().togglePlayPause());

    // Re-issuing the request would restart the song from 0:00 on every pause -> play.
    await waitFor(() => expect(fake.world.resumeCalls).toBe(1), settled);
    expect(fake.world.plays).toHaveLength(putsBefore);
  });
});
