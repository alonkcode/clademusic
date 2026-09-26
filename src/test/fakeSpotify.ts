import { vi } from 'vitest';

/**
 * A stand-in for Spotify's Web Playback SDK device AND the Web API in front of
 * it, behaving the way the real pair does closely enough to drive the player:
 * the device announces itself, a successful play request makes it switch to the
 * requested track, and any response can be scripted to fail.
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

  constructor(public options: unknown) {
    FakeSdkPlayer.instances.push(this);
  }

  emit(event: string, data: Record<string, unknown> = {}) {
    this.listeners.get(event)?.(data);
  }

  async connect() {
    const world = FakeSdkPlayer.world;
    this.connectCalls += 1;
    if (world.connectDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, world.connectDelayMs));
    if (world.readyDelayMs === 0) this.emit('ready', { device_id: world.deviceId });
    else if (world.readyDelayMs > 0) setTimeout(() => this.emit('ready', { device_id: world.deviceId }), world.readyDelayMs);
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
  window.Spotify = { Player: FakeSdkPlayer as never };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('/me/player/play')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { uris?: string[]; position_ms?: number };
        const uri = body.uris?.[0] ?? '';
        world.plays.push({
          deviceId: new URL(href).searchParams.get('device_id'),
          uri,
          positionMs: body.position_ms ?? 0,
        });
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
        return response(204);
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
