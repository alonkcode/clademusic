import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSdkPlayer, installFakeSpotify } from '@/test/fakeSpotify';
import {
  SpotifyPlaybackSession,
  loadSpotifyWebPlaybackSdk,
  stateHasTrack,
  type PlayRequest,
  type SpotifySessionOptions,
} from './spotifyPlayback';

/**
 * The failure modes behind "sometimes plays, sometimes needs several clicks,
 * sometimes plays the previous song, sometimes drops to preview" - each driven
 * against a fake device and Web API that can be told to misbehave.
 */

let fake: ReturnType<typeof installFakeSpotify>;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = installFakeSpotify();
});

afterEach(() => {
  fake.restore();
  vi.restoreAllMocks();
});

function makeSession(overrides: Partial<SpotifySessionOptions> = {}) {
  return new SpotifyPlaybackSession({
    getToken: vi.fn(async () => 'token'),
    getVolume: () => 0.5,
    // Real waits would make these tests take seconds; the ORDER of events is
    // what is under test, not the durations.
    retryDelaysMs: [0, 0, 0, 0],
    readyTimeoutMs: 150,
    verifyTimeoutMs: 80,
    verifyIntervalMs: 5,
    ...overrides,
  });
}

function request(trackId: string, overrides: Partial<PlayRequest> = {}): PlayRequest {
  return { uri: `spotify:track:${trackId}`, trackId, positionMs: 0, isCurrent: () => true, ...overrides };
}

describe('stateHasTrack', () => {
  const state = (id: string, linkedFrom?: string) => ({
    paused: false,
    track_window: { current_track: { id, linked_from: linkedFrom ? { id: linkedFrom } : undefined } },
  });

  it('matches the requested id', () => {
    expect(stateHasTrack(state('a'), 'a')).toBe(true);
    expect(stateHasTrack(state('a'), 'b')).toBe(false);
  });

  it('matches a relinked substitute through linked_from', () => {
    expect(stateHasTrack(state('substitute', 'a'), 'a')).toBe(true);
  });

  it('is false with no state, no track, or no requested id', () => {
    expect(stateHasTrack(null, 'a')).toBe(false);
    expect(stateHasTrack({ paused: true }, 'a')).toBe(false);
    expect(stateHasTrack(state('a'), null)).toBe(false);
  });
});

describe('connecting', () => {
  it('builds one player no matter how many callers ask while it connects', async () => {
    // A second click during the first connect used to build a second device,
    // after which pause/resume talked to a different one than was playing.
    fake.world.connectDelayMs = 40;
    fake.world.readyDelayMs = 30;
    const session = makeSession();

    const ids = await Promise.all([session.ensureDevice(), session.ensureDevice(), session.ensureDevice()]);

    expect(ids).toEqual(['device-1', 'device-1', 'device-1']);
    expect(fake.players()).toHaveLength(1);
    expect(fake.players()[0].connectCalls).toBe(1);
  });

  it('shares that one player between concurrent play requests', async () => {
    fake.world.connectDelayMs = 40;
    fake.world.readyDelayMs = 30;
    const session = makeSession();

    const [a, b] = await Promise.all([session.play(request('a')), session.play(request('b'))]);

    expect(fake.players()).toHaveLength(1);
    expect([a.status, b.status]).toEqual(['started', 'started']);
  });

  it('abandons the wait when disposed while still connecting, and the next session adopts the one player', async () => {
    fake.world.readyDelayMs = 60;
    const session = makeSession();

    const pending = session.ensureDevice();
    const settled = pending.catch((e) => e);
    await vi.waitFor(() => expect(fake.players()).toHaveLength(1));
    session.dispose();

    expect(await settled).toBeInstanceOf(Error);

    // Not an orphan: it is the page's only player, and it finishes connecting.
    expect(await makeSession().ensureDevice()).toBe('device-1');
    expect(fake.players()).toHaveLength(1);
    expect(fake.players()[0].connectCalls).toBe(1);
  });

  it('reconnects the same player once when it never announces a device, then reports unavailable', async () => {
    // Never a second Player: it would announce a device nothing is behind.
    fake.world.readyDelayMs = -1;
    const session = makeSession({ retryDelaysMs: [0] });

    const outcome = await session.play(request('a'));

    expect(outcome.status).toBe('unavailable');
    expect(fake.players()).toHaveLength(1);
    expect(fake.players()[0].connectCalls).toBeGreaterThan(1);
    expect(fake.players()[0].disconnectCalls).toBeGreaterThanOrEqual(1);
  });

  it('does not remember a failed SDK script load', async () => {
    // The rejection used to be cached, so one dropped request at startup broke
    // Spotify for the rest of the tab's life.
    fake.restore();
    const scriptSrc = 'https://sdk.scdn.co/spotify-player.js';

    const first = loadSpotifyWebPlaybackSdk();
    const script = document.querySelector(`script[src="${scriptSrc}"]`) as HTMLScriptElement;
    script.onerror?.(new Event('error'));
    await expect(first).rejects.toThrow('Failed to load');
    expect(document.querySelector(`script[src="${scriptSrc}"]`)).toBeNull();

    const second = loadSpotifyWebPlaybackSdk();
    window.Spotify = { Player: FakeSdkPlayer as never };
    window.onSpotifyWebPlaybackSDKReady?.();
    await expect(second).resolves.toBeUndefined();

    document.querySelector(`script[src="${scriptSrc}"]`)?.remove();
  });
});

describe('starting a track', () => {
  it('starts on the first request and reports it only once the device confirms', async () => {
    const session = makeSession();

    const outcome = await session.play(request('a', { positionMs: 42_000 }));

    expect(outcome).toEqual({ status: 'started' });
    expect(fake.world.plays).toEqual([{ deviceId: 'device-1', uri: 'spotify:track:a', positionMs: 42_000 }]);
    expect(fake.world.trackId).toBe('a');
  });

  it('brings the device volume in line with the UI before starting', async () => {
    // Opening a track resets the UI's mute flag, but the device kept the 0 an
    // earlier mute left it at - so it played, silently, under an unmuted UI.
    let volume = 0;
    const session = makeSession({ getVolume: () => volume });
    await session.play(request('a'));
    volume = 0.8;
    await session.play(request('b'));

    expect(fake.world.volumes.slice(-2)).toEqual([0, 0.8]);
  });

  it('points playback at the device once, not on every request', async () => {
    const session = makeSession();
    await session.play(request('a'));
    await session.play(request('b'));

    expect(fake.world.transfers).toBe(1);
  });

  it('counts a relinked substitute track as started', async () => {
    const session = makeSession();
    const outcome = session.play(request('a'));
    // The device answers under a market substitute's id.
    await vi.waitFor(() => expect(fake.world.plays).toHaveLength(1));
    fake.world.trackId = 'substitute';
    fake.world.linkedFromId = 'a';
    fake.world.paused = false;

    expect((await outcome).status).toBe('started');
  });
});

describe('transient failures are retried, not dropped', () => {
  it('retries a 404 - the device not being registered yet - and starts', async () => {
    // Right after `ready` Spotify often does not know the device yet. This used
    // to be logged and forgotten: the click did nothing and the next one worked.
    fake.world.playResponses = [{ status: 404 }];
    const session = makeSession();

    const outcome = await session.play(request('a'));

    expect(outcome.status).toBe('started');
    expect(fake.world.plays).toHaveLength(2);
    // The device is re-registered before the retry.
    expect(fake.world.transfers).toBe(2);
  });

  it('reconnects the device if it keeps being not found', async () => {
    fake.world.playResponses = [{ status: 404 }, { status: 404 }, { status: 404 }];
    const session = makeSession();

    const outcome = await session.play(request('a'));

    expect(outcome.status).toBe('started');
    expect(fake.players()).toHaveLength(1);
    expect(fake.players()[0].disconnectCalls).toBeGreaterThanOrEqual(1);
    expect(fake.players()[0].connectCalls).toBeGreaterThan(1);
  });

  it('asks for a freshly refreshed token after a 401, then starts', async () => {
    fake.world.playResponses = [{ status: 401 }];
    const getToken = vi.fn(async (force?: boolean) => (force ? 'fresh-token' : 'stale-token'));
    const session = makeSession({ getToken });

    const outcome = await session.play(request('a'));

    expect(outcome.status).toBe('started');
    expect(getToken).toHaveBeenCalledWith(true);
  });

  it('waits out a 429 and retries', async () => {
    fake.world.playResponses = [{ status: 429, headers: { 'Retry-After': '0.05' } }];
    const session = makeSession();
    const before = Date.now();

    const outcome = await session.play(request('a'));

    expect(outcome.status).toBe('started');
    expect(Date.now() - before).toBeGreaterThanOrEqual(45);
    expect(fake.world.plays).toHaveLength(2);
  });

  it('retries a dropped connection', async () => {
    fake.world.playResponses = ['throw'];
    const session = makeSession();

    expect((await session.play(request('a'))).status).toBe('started');
    expect(fake.world.plays).toHaveLength(2);
  });

  it('retries a 5xx', async () => {
    fake.world.playResponses = [{ status: 503 }, { status: 502 }];
    const session = makeSession();

    expect((await session.play(request('a'))).status).toBe('started');
  });

  it('retries a token that could not be had, instead of dropping to preview', async () => {
    // One failed refresh returned null, and null was treated as "connection
    // expired" - straight to the free preview embed.
    const getToken = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue('token');
    const session = makeSession({ getToken });

    const outcome = await session.play(request('a'));

    expect(outcome.status).toBe('started');
    expect(getToken).toHaveBeenCalledWith(true);
  });

  it('treats a 403 that is not about Premium as passing', async () => {
    // "Restriction violated" also comes back when a command lands mid-transition.
    fake.world.playResponses = [{ status: 403, body: { error: { message: 'Player command failed: Restriction violated' } } }];
    const session = makeSession();

    expect((await session.play(request('a'))).status).toBe('started');
  });

  it('gives up as unavailable - not failed - and stays usable', async () => {
    fake.world.playResponses = Array.from({ length: 5 }, () => ({ status: 503 }));
    const onFatal = vi.fn();
    const session = makeSession({ onFatal });

    const outcome = await session.play(request('a'));

    expect(outcome.status).toBe('unavailable');
    expect(onFatal).not.toHaveBeenCalled();
    // Spotify recovers; the very next request works on the same session.
    expect((await session.play(request('b'))).status).toBe('started');
  });

  it('does not retry an answer that retrying cannot change', async () => {
    fake.world.playResponses = [{ status: 400 }];
    const session = makeSession();

    expect((await session.play(request('a'))).status).toBe('unavailable');
    expect(fake.world.plays).toHaveLength(1);
  });
});

describe('permanent failures', () => {
  it('reports a Premium refusal as failed, without retrying', async () => {
    fake.world.playResponses = [{ status: 403, body: { error: { reason: 'PREMIUM_REQUIRED' } } }];
    const session = makeSession();

    const outcome = await session.play(request('a'));

    expect(outcome).toMatchObject({ status: 'failed', failure: { code: 'premium' } });
    expect(fake.world.plays).toHaveLength(1);
  });

  it('reports an SDK that cannot initialise as failed, and tells the caller', async () => {
    fake.world.readyDelayMs = -1;
    const onFatal = vi.fn();
    const session = makeSession({ onFatal, readyTimeoutMs: 1_000 });

    const outcome = session.play(request('a'));
    await vi.waitFor(() => expect(fake.players()).toHaveLength(1));
    fake.players()[0].emit('initialization_error', { message: 'no EME' });

    expect(await outcome).toMatchObject({ status: 'failed', failure: { code: 'init' } });
    expect(onFatal).toHaveBeenCalledTimes(1);
  });

  it('reports Premium account errors from the SDK as failed', async () => {
    fake.world.readyDelayMs = -1;
    const session = makeSession({ readyTimeoutMs: 1_000 });

    const outcome = session.play(request('a'));
    await vi.waitFor(() => expect(fake.players()).toHaveLength(1));
    fake.players()[0].emit('account_error', { message: 'premium required' });

    expect(await outcome).toMatchObject({ status: 'failed', failure: { code: 'premium' } });
  });
});

describe('the device has to actually start', () => {
  it('re-issues the request when it was accepted but the device did not switch', async () => {
    // A 204 only means Spotify accepted the command. The previous song kept
    // playing under the new title until something checked.
    fake.world.adoptOnPlay = false;
    fake.world.trackId = 'previous';
    fake.world.paused = false;
    const session = makeSession();

    const outcome = session.play(request('a'));
    await vi.waitFor(() => expect(fake.world.plays.length).toBeGreaterThanOrEqual(2));
    // It takes on a later attempt.
    fake.world.adoptOnPlay = true;

    expect((await outcome).status).toBe('started');
    expect(fake.world.trackId).toBe('a');
  });

  it('reports unavailable when the device never switches', async () => {
    fake.world.adoptOnPlay = false;
    const session = makeSession();

    expect((await session.play(request('a'))).status).toBe('unavailable');
    expect(fake.world.plays.length).toBe(5);
  });

  it('reports blocked - and does not re-issue - when the device has the track but sits paused', async () => {
    // The browser's autoplay policy refused audio. Another request would hit
    // the same wall; pressing play (a gesture) resumes what is already loaded.
    fake.world.adoptPaused = true;
    const session = makeSession();

    expect((await session.play(request('a'))).status).toBe('blocked');
    expect(fake.world.plays).toHaveLength(1);
  });

  it('stops waiting for confirmation once the listener has paused', async () => {
    fake.world.adoptPaused = true;
    let wants = true;
    const session = makeSession({ verifyTimeoutMs: 1_000 });

    const outcome = session.play(request('a', { wantsPlaying: () => wants }));
    await vi.waitFor(() => expect(fake.world.plays).toHaveLength(1));
    wants = false;

    expect((await outcome).status).toBe('started');
  });
});

describe('overlapping requests', () => {
  it('abandons the older request when a newer one arrives, and the newer one wins', async () => {
    // An older request finishing last is what restored the previous song.
    // The first request's only attempt fails, and it is then sleeping through a
    // long retry delay when the newer request arrives.
    fake.world.playResponses = [{ status: 503 }];
    let current = 'a';
    const session = makeSession({ retryDelaysMs: [400] });

    const first = session.play(request('a', { isCurrent: () => current === 'a' }));
    await vi.waitFor(() => expect(fake.world.plays.length).toBeGreaterThanOrEqual(1));
    current = 'b';
    const second = session.play(request('b', { isCurrent: () => current === 'b' }));

    expect((await first).status).toBe('superseded');
    expect((await second).status).toBe('started');
    expect(fake.world.plays.map((p) => p.uri)).toEqual(['spotify:track:a', 'spotify:track:b']);
    expect(fake.world.trackId).toBe('b');
  });

  it('abandons in-flight work when released, and can still play afterwards', async () => {
    fake.world.readyDelayMs = 50;
    const session = makeSession();

    const first = session.play(request('a'));
    await vi.waitFor(() => expect(fake.players()).toHaveLength(1));
    session.release();

    expect((await first).status).toBe('superseded');

    fake.world.readyDelayMs = 0;
    expect((await session.play(request('b'))).status).toBe('started');
    expect(fake.players()).toHaveLength(1);
  });

  it('resolves everything as superseded once disposed', async () => {
    const session = makeSession();
    session.dispose();

    expect((await session.play(request('a'))).status).toBe('superseded');
    expect(fake.world.plays).toHaveLength(0);
  });
});

describe('switching away and back (the SDK gives one working Player per page)', () => {
  it('a later session plays on the same player instead of building a second one', async () => {
    // The drawer unmounts the Spotify player when YouTube takes over and mounts a
    // new one when the listener comes back. A second Player would announce a
    // device with no audio engine: the play request 404s, or is accepted and
    // nothing is heard.
    const first = makeSession();
    expect((await first.play(request('a'))).status).toBe('started');
    first.dispose();

    const second = makeSession();
    const outcome = await second.play(request('b'));

    expect(outcome.status).toBe('started');
    expect(fake.players()).toHaveLength(1);
    expect(fake.world.plays.map((p) => p.deviceId)).toEqual(['device-1', 'device-1']);
    expect(fake.world.trackId).toBe('b');
  });

  it('lets go of the player silenced but still connected', async () => {
    const session = makeSession();
    await session.play(request('a'));

    session.release();

    // Left playing it would carry on underneath the YouTube video that replaced it.
    expect(fake.world.pauseCalls).toBeGreaterThanOrEqual(1);
    expect(fake.players()[0].disconnectCalls).toBe(0);
  });

  it('does not let a session that has let go stop what the next one is playing', async () => {
    const first = makeSession();
    await first.play(request('a'));
    const second = makeSession();
    await second.play(request('b'));
    const pausesBefore = fake.world.pauseCalls;

    first.release(); // a late teardown from the provider that was switched away from

    expect(fake.world.pauseCalls).toBe(pausesBefore);
    expect(fake.players()[0].disconnectCalls).toBe(0);
    expect(fake.world.trackId).toBe('b');
  });

  it('reports a fatal error to the session holding the player, not to one that let go', async () => {
    const firstFatal = vi.fn();
    const secondFatal = vi.fn();
    const first = makeSession({ onFatal: firstFatal });
    await first.play(request('a'));
    first.release();
    const second = makeSession({ onFatal: secondFatal });
    await second.ensureDevice();

    fake.players()[0].emit('authentication_error', { message: 'expired' });

    expect(secondFatal).toHaveBeenCalledTimes(1);
    expect(firstFatal).not.toHaveBeenCalled();
  });
});
