import { vi } from 'vitest';

/**
 * A stand-in for Spotify's Web Playback SDK device AND the Web API in front of
 * it, behaving the way the real pair does closely enough to drive the player:
 * the device announces itself, a successful play request makes it switch to the
 * requested track, and any response can be scripted to fail.
 *
 * It also reproduces the one SDK quirk that matters for switching providers. The
 * real SDK has a single hidden iframe per page, holding a single audio engine
 * that belongs to the FIRST Player constructed. Every later `new Player()`
 * re-initialises the iframe under a fresh device id and, from then on, `ready`
 * announces that id to the newest Player only - a device with no engine behind
 * it, which the Web API cannot find (404). Here that is: the first Player is the
 * real device (`world.deviceId`), later ones are "ghosts", and only the newest
 * instance hears events.
 */

export interface ScriptedResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface FakeSpotifyWorld {
  deviceId: string;
  /** How long connect() takes to resolve - a real SDK spends network time here,
   *  which is the window in which a second click can build a second player. */
  connectDelayMs: number;
  /** ms after connect() before the device announces `ready`; -1 = it never does. */
  readyDelayMs: number;
  /** What the device currently reports. */
  paused: boolean;
  trackId: string | null;
  linkedFromId?: string;
  /** Whether an accepted play request makes the device switch to that track. */
  adoptOnPlay: boolean;
  /** ...and whether it then sits paused (autoplay blocked, or still loading). */
  adoptPaused: boolean;
  /** Consumed one per play request, in order; after that every request is a 204. */
  playResponses: Array<ScriptedResponse | 'throw'>;
  plays: Array<{ deviceId: string | null; uri: string; positionMs: number }>;
  transfers: number;
  resumeCalls: number;
  pauseCalls: number;
  /** Every volume the device was set to, oldest first. */
  volumes: number[];
}

export type FakeSdkListener = (data: Record<string, unknown>) => void;

export class FakeSdkPlayer {
  static world: FakeSpotifyWorld;
  static instances: FakeSdkPlayer[] = [];

  listeners = new Map<string, FakeSdkListener>();
  connectCalls = 0;
  disconnectCalls = 0;

  /** The id this instance is announced under: the real device for the first
   *  Player of the page, a ghost for every later one. */
  readonly id: string;

  constructor(public options: unknown) {
    const { world, instances } = FakeSdkPlayer;
    this.id = instances.length === 0 ? world.deviceId : `${world.deviceId}-ghost-${instances.length}`;
    instances.push(this);
  }

  emit(event: string, data: Record<string, unknown> = {}) {
    this.listeners.get(event)?.(data);
  }

  async connect() {
    const world = FakeSdkPlayer.world;
    this.connectCalls += 1;
    if (world.connectDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, world.connectDelayMs));
    // The SDK routes the iframe's events to the newest Player, whichever one
    // asked to connect, and announces that Player's id.
    // Scoped to this install: a timer left over from an earlier test must not
    // announce a device into the next one.
    const instances = FakeSdkPlayer.instances;
    const announce = () => {
      if (FakeSdkPlayer.instances !== instances) return;
      const newest = instances.at(-1);
      newest?.emit('ready', { device_id: newest.id });
    };
    if (world.readyDelayMs === 0) announce();
    else if (world.readyDelayMs > 0) setTimeout(announce, world.readyDelayMs);
    return true;
  }

  disconnect() {
    this.disconnectCalls += 1;
  }

  async getCurrentState() {
    const world = FakeSdkPlayer.world;
    if (!world.trackId) return null;
    return {
      paused: world.paused,
      position: 1_000,
      duration: 200_000,
      track_window: {
        current_track: {
          id: world.trackId,
          name: 'Fake Track',
          artists: [{ name: 'Fake Artist' }],
          album: { name: 'Fake Album' },
          linked_from: world.linkedFromId ? { id: world.linkedFromId } : undefined,
        },
      },
    };
  }

  async pause() {
    FakeSdkPlayer.world.pauseCalls += 1;
  }

  async resume() {
    FakeSdkPlayer.world.resumeCalls += 1;
  }

  async seek() {}

  async setVolume(volume: number) {
    FakeSdkPlayer.world.volumes.push(volume);
  }

  async activateElement() {}

  addListener(event: string, cb: FakeSdkListener) {
    this.listeners.set(event, cb);
    return true;
  }

  removeListener(event: string) {
    this.listeners.delete(event);
    return true;
  }
}

const response = (status: number, extra: Partial<ScriptedResponse> = {}) => {
  const headers = extra.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => extra.body ?? null,
    // openPlayer also records a play event, which reads .text() off the response.
    text: async () => '',
  } as unknown as Response;
};

export function installFakeSpotify(overrides: Partial<FakeSpotifyWorld> = {}) {
  const world: FakeSpotifyWorld = {
    deviceId: 'device-1',
    connectDelayMs: 0,
    readyDelayMs: 0,
    paused: true,
    trackId: null,
    adoptOnPlay: true,
    adoptPaused: false,
    playResponses: [],
    plays: [],
    transfers: 0,
    resumeCalls: 0,
    pauseCalls: 0,
    volumes: [],
    ...overrides,
  };
  FakeSdkPlayer.world = world;
  FakeSdkPlayer.instances = [];
  // A new class per install: to the code under test that is a freshly loaded SDK
  // script, so a Player kept from an earlier test is not carried into this one.
  window.Spotify = { Player: class extends FakeSdkPlayer {} as never };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('/me/player/play')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { uris?: string[]; position_ms?: number };
        const uri = body.uris?.[0] ?? '';
        const deviceId = new URL(href).searchParams.get('device_id');
        world.plays.push({ deviceId, uri, positionMs: body.position_ms ?? 0 });
        // A ghost device has no engine, so Spotify does not know it.
        if (deviceId !== world.deviceId) return response(404, { body: { error: { status: 404, message: 'Device not found' } } });
        const scripted = world.playResponses.shift();
        if (scripted === 'throw') throw new TypeError('Failed to fetch');
        const res = scripted ?? { status: 204 };
        if (res.status >= 200 && res.status < 300 && world.adoptOnPlay) {
          world.trackId = uri.split(':').pop() ?? null;
          world.linkedFromId = undefined;
          world.paused = world.adoptPaused;
        }
        return response(res.status, res);
      }
      if (href.endsWith('/me/player')) {
        world.transfers += 1;
        const target = (JSON.parse(String(init?.body ?? '{}')) as { device_ids?: string[] }).device_ids?.[0];
        return response(target === world.deviceId ? 204 : 404);
      }
      return response(204);
    })
  );

  return {
    world,
    players: () => FakeSdkPlayer.instances,
    restore() {
      vi.unstubAllGlobals();
      delete window.Spotify;
      FakeSdkPlayer.instances = [];
    },
  };
}
