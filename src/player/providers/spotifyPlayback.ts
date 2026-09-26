/**
 * The imperative half of Spotify Web Playback: it owns the SDK device and turns
 * "play this track" into audio coming out of it, reliably.
 *
 * SpotifyWebPlayer used to do all of this inside React effects, and every way it
 * could go wrong ended the same way - a silent no-op:
 *
 *  - The play request had no retry. Right after the SDK reports `ready`, Spotify
 *    often answers 404 (the device is not registered yet); a 429 or a 5xx is
 *    just as transient. The click was dropped, the previous track kept playing,
 *    and the next click "worked".
 *  - Creating the player was not single-flight. Clicking again while the first
 *    connect was still in flight built a second device, and pause/resume then
 *    talked to a different instance than the one making sound.
 *  - Any thrown error, or a null token from one failed refresh, dropped the whole
 *    session to the free preview embed.
 *  - Nothing checked that the device really started what was asked of it.
 *
 * Here creation is single-flight, every request is retried according to what
 * Spotify actually said, and a start only counts once the device reports the
 * requested track playing. Only failures that retrying cannot fix (no Premium,
 * revoked auth, an SDK that cannot initialise) are reported as fatal; everything
 * else ends in `unavailable`, which leaves the session usable for the next try.
 */

declare global {
  interface Window {
    // The SDK is an external script with no bundled types; its constructor and
    // event payloads are narrowed to SpotifyPlayerInstance below.
    Spotify?: { Player?: new (options: unknown) => SpotifyPlayerInstance };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

export interface SpotifyTrackInfo {
  id?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
  /** Set when Spotify relinked a track that isn't available in the listener's
   *  market: `id` is then the substitute and this is the one we asked for. */
  linked_from?: { id?: string | null } | null;
}

export interface SpotifyPlayerState {
  paused: boolean;
  position?: number;
  duration?: number;
  loading?: boolean;
  track_window?: { current_track?: SpotifyTrackInfo | null };
}

type SdkEventData = { device_id?: string; message?: string };

export interface SpotifyPlayerInstance {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  getCurrentState: () => Promise<SpotifyPlayerState | null>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  addListener: (event: string, cb: (data: SdkEventData) => void) => boolean;
  removeListener: (event: string, cb?: (data: SdkEventData) => void) => boolean;
  /** Unlocks audio after the browser's autoplay policy blocks a /play call
   *  with no preceding user gesture. Newer SDK versions only. */
  activateElement?: () => Promise<void>;
}

/** True when the device's current track is the one asked for, including the
 *  relinked case where Spotify reports a substitute id. */
export function stateHasTrack(state: SpotifyPlayerState | null | undefined, trackId: string | null | undefined): boolean {
  const current = state?.track_window?.current_track;
  return !!trackId && !!current && (current.id === trackId || current.linked_from?.id === trackId);
}

// ---------------------------------------------------------------------------
// SDK script
// ---------------------------------------------------------------------------

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const SDK_LOAD_TIMEOUT_MS = 15_000;
let sdkPromise: Promise<void> | null = null;

export function loadSpotifyWebPlaybackSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.Spotify?.Player) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  const load = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Spotify Web Playback SDK load timeout')), SDK_LOAD_TIMEOUT_MS);
    const ready = () => {
      clearTimeout(timeout);
      resolve();
    };

    const existing = document.querySelector(`script[src="${SDK_URL}"]`);
    if (existing) {
      // The script tag is already there; wait for the SDK to appear on window.
      const check = () => {
        if (window.Spotify?.Player) return ready();
        setTimeout(check, 50);
      };
      check();
      return;
    }

    window.onSpotifyWebPlaybackSDKReady = ready;
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load Spotify Web Playback SDK'));
    };
    document.body.appendChild(script);
  });

  // A failed load must not be remembered. Caching the rejection made one
  // dropped request at startup break Spotify for the rest of the tab's life,
  // because every later attempt was handed the same rejected promise.
  sdkPromise = load.catch((err) => {
    sdkPromise = null;
    document.querySelector(`script[src="${SDK_URL}"]`)?.remove();
    throw err;
  });
  return sdkPromise;
}

function spotifyApi(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Failures that retrying cannot fix. The caller falls back to the preview embed. */
export type SpotifyFailureCode = 'premium' | 'auth' | 'init';
export interface SpotifyFailure {
  code: SpotifyFailureCode;
  message: string;
}

export type PlayOutcome =
  /** The device reports the requested track playing. */
  | { status: 'started' }
  /** The device has the track loaded but is paused - the browser's autoplay
   *  policy refused to start audio without a gesture. Pressing play resumes it. */
  | { status: 'blocked' }
  /** A newer request (or a teardown) replaced this one; it owns the transport now. */
  | { status: 'superseded' }
  /** Every retry failed for a reason that may pass (network, rate limit, an
   *  unregistered device). The session stays usable; trying again may work. */
  | { status: 'unavailable'; message: string }
  | { status: 'failed'; failure: SpotifyFailure };

export interface PlayRequest {
  uri: string;
  trackId: string;
  positionMs: number;
  /** False once a newer request has replaced this one. */
  isCurrent: () => boolean;
  /** False if the listener has paused since - there is then nothing to confirm. */
  wantsPlaying?: () => boolean;
}

export interface SpotifySessionOptions {
  /** A usable access token, or null if none can be had. `forceRefresh` asks for
   *  a new one even when the cached one still looks valid (after a 401). */
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  /** Level the device should be at, mute already folded in as 0. */
  getVolume: () => number;
  onFatal?: (failure: SpotifyFailure) => void;
  onAutoplayBlocked?: () => void;
  playerName?: string;
  /** Wait before each retry, in order; its length is the retry budget. */
  retryDelaysMs?: readonly number[];
  /** How long to wait for the device to announce itself. */
  readyTimeoutMs?: number;
  /** How long to wait for the device to reflect an accepted play request. */
  verifyTimeoutMs?: number;
  verifyIntervalMs?: number;
  /** Hard ceiling on one request, across all its retries. */
  deadlineMs?: number;
}

class SpotifyFatalError extends Error {
  constructor(readonly failure: SpotifyFailure) {
    super(failure.message);
  }
}
class SessionReleasedError extends Error {}

const SUPERSEDED: PlayOutcome = { status: 'superseded' };
const MAX_RETRY_AFTER_MS = 5_000;

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers?.get?.('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : 1_000;
}

async function isPremiumRefusal(res: Response): Promise<boolean> {
  const body = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
  const error = body?.error as { reason?: string; message?: string } | undefined;
  return error?.reason === 'PREMIUM_REQUIRED' || /premium/i.test(error?.message ?? '');
}

export class SpotifyPlaybackSession {
  private player: SpotifyPlayerInstance | null = null;
  private deviceId: string | null = null;
  private devicePromise: Promise<string> | null = null;
  private readonly readyWaiters = new Set<(id: string | null) => void>();
  private transferredTo: string | null = null;
  /** Plays are serialised: a newer request must not reach Spotify before an
   *  older one has been answered, or the older one could land last and restore
   *  the previous song. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Bumped by release(); work started under an older generation is abandoned. */
  private generation = 0;
  private disposed = false;
  private fatal: SpotifyFailure | null = null;

  private readonly retryDelaysMs: readonly number[];
  private readonly readyTimeoutMs: number;
  private readonly verifyTimeoutMs: number;
  private readonly verifyIntervalMs: number;
  private readonly deadlineMs: number;

  constructor(private readonly opts: SpotifySessionOptions) {
    this.retryDelaysMs = opts.retryDelaysMs ?? [250, 700, 1_500, 2_500];
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 8_000;
    this.verifyTimeoutMs = opts.verifyTimeoutMs ?? 6_000;
    this.verifyIntervalMs = opts.verifyIntervalMs ?? 250;
    this.deadlineMs = opts.deadlineMs ?? 25_000;
  }

  // -- device ---------------------------------------------------------------

  /**
   * Resolves with the id of a connected, announced device. Single-flight: every
   * concurrent caller shares one connect, so a second click during the first
   * one's setup cannot create a second player.
   */
  ensureDevice(): Promise<string> {
    if (this.fatal) return Promise.reject(new SpotifyFatalError(this.fatal));
    if (this.disposed) return Promise.reject(new SessionReleasedError());
    if (this.player && this.deviceId) return Promise.resolve(this.deviceId);
    if (!this.devicePromise) {
      const generation = this.generation;
      const attempt: Promise<string> = this.connectDevice(generation).finally(() => {
        if (this.devicePromise === attempt) this.devicePromise = null;
      });
      this.devicePromise = attempt;
    }
    return this.devicePromise;
  }

  private assertLive(generation: number) {
    if (this.disposed || generation !== this.generation) throw new SessionReleasedError();
  }

  private async connectDevice(generation: number): Promise<string> {
    await loadSpotifyWebPlaybackSdk();
    // Two rounds: a first connect that never yields a device (a stale instance,
    // a dropped websocket) is thrown away and rebuilt once before giving up.
    for (let round = 0; round < 2; round++) {
      this.assertLive(generation);
      if (!this.player) {
        const instance = this.createPlayer();
        // Assigned before connect(): the SDK may announce `ready` from inside it.
        this.player = instance;
        let connected = false;
        try {
          connected = await instance.connect();
        } catch {
          connected = false;
        }
        this.assertLive(generation);
        if (!connected) {
          this.dropPlayer(instance);
          continue;
        }
      }
      const id = await this.waitForReady(this.readyTimeoutMs);
      this.assertLive(generation);
      if (this.fatal) throw new SpotifyFatalError(this.fatal);
      if (id) return id;
      if (this.player) this.dropPlayer(this.player);
    }
    throw new Error('Spotify device did not become ready');
  }

  private createPlayer(): SpotifyPlayerInstance {
    const PlayerCtor = window.Spotify?.Player;
    if (!PlayerCtor) throw new Error('Spotify SDK not available');

    const instance = new PlayerCtor({
      name: this.opts.playerName ?? 'Clade Player',
      volume: this.opts.getVolume(),
      // The SDK asks for a token whenever it needs one. A null from the first
      // try is usually a refresh that lost a race, so ask once more, forcing it.
      getOAuthToken: (cb: (token: string) => void) => {
        void (async () => {
          const token = (await this.opts.getToken().catch(() => null)) ?? (await this.opts.getToken(true).catch(() => null));
          if (token) cb(token);
        })();
      },
    });

    // Every listener ignores events from an instance that has been replaced.
    const current = () => this.player === instance;

    instance.addListener('ready', ({ device_id }) => {
      if (!current() || !device_id) return;
      if (this.deviceId !== device_id) this.transferredTo = null;
      this.deviceId = device_id;
      this.notifyReady(device_id);
    });
    instance.addListener('not_ready', ({ device_id }) => {
      // The SDK reconnects on its own and announces `ready` again; until then
      // there is no device to send commands to.
      if (current() && device_id === this.deviceId) this.deviceId = null;
    });
    instance.addListener('initialization_error', (e) => {
      console.error('[Spotify Web Player] init error', e);
      this.setFatal({ code: 'init', message: 'Spotify player failed to initialize.' });
    });
    instance.addListener('authentication_error', (e) => {
      console.error('[Spotify Web Player] auth error', e);
      this.setFatal({ code: 'auth', message: 'Spotify authentication failed. Reconnect Spotify.' });
    });
    // Common: non-premium accounts cannot use Web Playback SDK.
    instance.addListener('account_error', (e) => {
      console.error('[Spotify Web Player] account error', e);
      this.setFatal({ code: 'premium', message: 'Spotify Premium is required for full-track playback. Using preview mode.' });
    });
    // Emitted for transient and stale failures as well as permanent ones, so it
    // is not a reason to give up the device. A start that does not take is
    // caught by verifyStart instead.
    instance.addListener('playback_error', (e) => {
      console.error('[Spotify Web Player] playback error', e);
    });
    // Not an error: the browser's autoplay policy refused the start because no
    // gesture preceded it. The device has the track and resumes on a press.
    instance.addListener('autoplay_failed', () => {
      this.opts.onAutoplayBlocked?.();
    });

    return instance;
  }

  private setFatal(failure: SpotifyFailure) {
    if (this.fatal) return;
    this.fatal = failure;
    this.notifyReady(null);
    this.opts.onFatal?.(failure);
  }

  private waitForReady(ms: number): Promise<string | null> {
    if (this.deviceId) return Promise.resolve(this.deviceId);
    return new Promise((resolve) => {
      const done = (id: string | null) => {
        clearTimeout(timer);
        this.readyWaiters.delete(done);
        resolve(id);
      };
      const timer = setTimeout(() => done(null), ms);
      this.readyWaiters.add(done);
    });
  }

  private notifyReady(id: string | null) {
    for (const waiter of [...this.readyWaiters]) waiter(id);
  }

  private dropPlayer(instance: SpotifyPlayerInstance) {
    try {
      instance.disconnect();
    } catch {
      // already gone
    }
    if (this.player === instance) {
      this.player = null;
      this.deviceId = null;
      this.transferredTo = null;
    }
  }

  // -- playback -------------------------------------------------------------

  /**
   * Starts `req.uri` on the device and resolves once that is confirmed, or says
   * why it could not be. Never rejects.
   */
  play(req: PlayRequest): Promise<PlayOutcome> {
    const generation = this.generation;
    const run = this.chain.then(() => this.runPlay(req, generation));
    this.chain = run.catch(() => undefined);
    return run.catch((err): PlayOutcome => {
      if (err instanceof SpotifyFatalError) return { status: 'failed', failure: err.failure };
      if (err instanceof SessionReleasedError) return SUPERSEDED;
      console.error('[Spotify Web Player] play failed', err);
      return { status: 'unavailable', message: 'Spotify player failed to start.' };
    });
  }

  private live(req: PlayRequest, generation: number) {
    return !this.disposed && generation === this.generation && req.isCurrent();
  }

  private async runPlay(req: PlayRequest, generation: number): Promise<PlayOutcome> {
    const deadline = Date.now() + this.deadlineMs;
    let lastMessage = "Spotify didn't respond.";
    let forceRefresh = false;
    let extraDelayMs = 0;

    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      if (!this.live(req, generation)) return SUPERSEDED;
      if (attempt > 0) {
        await this.sleep(Math.max(this.retryDelaysMs[attempt - 1], extraDelayMs), () => this.live(req, generation));
        extraDelayMs = 0;
        if (!this.live(req, generation)) return SUPERSEDED;
      }
      if (Date.now() > deadline) break;

      let deviceId: string;
      try {
        deviceId = await this.ensureDevice();
      } catch (err) {
        if (err instanceof SpotifyFatalError) return { status: 'failed', failure: err.failure };
        if (err instanceof SessionReleasedError) return SUPERSEDED;
        lastMessage = 'Spotify device not ready.';
        continue;
      }
      if (!this.live(req, generation)) return SUPERSEDED;

      const token = await this.opts.getToken(forceRefresh).catch(() => null);
      forceRefresh = false;
      if (!token) {
        // No token is usually a refresh that failed for now, not a revoked
        // grant - so it is retried like any other transient failure.
        forceRefresh = true;
        lastMessage = 'Spotify connection missing or expired. Reconnect Spotify.';
        continue;
      }
      if (!this.live(req, generation)) return SUPERSEDED;

      await this.transferOnce(token, deviceId);
      await this.applyVolume();
      if (!this.live(req, generation)) return SUPERSEDED;

      let res: Response;
      try {
        res = await spotifyApi(token, `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
          method: 'PUT',
          body: JSON.stringify({ uris: [req.uri], position_ms: req.positionMs }),
        });
      } catch (err) {
        console.warn('[Spotify Web Player] play request failed', err);
        lastMessage = 'Could not reach Spotify.';
        continue;
      }

      if (res.ok || res.status === 204) {
        const verdict = await this.verifyStart(req, generation);
        if (verdict === 'playing') return { status: 'started' };
        if (verdict === 'blocked') return { status: 'blocked' };
        if (verdict === 'superseded') return SUPERSEDED;
        lastMessage = 'Spotify accepted the request but the player did not start.';
        continue;
      }

      console.warn('[Spotify Web Player] play failed', res.status);
      lastMessage = `Spotify answered ${res.status}.`;
      if (res.status === 401) {
        forceRefresh = true;
      } else if (res.status === 404) {
        // The device is not (or no longer) known to Spotify. Re-register it, and
        // if that keeps failing rebuild the player from scratch.
        this.transferredTo = null;
        if (attempt >= 2 && this.player) this.dropPlayer(this.player);
      } else if (res.status === 429) {
        extraDelayMs = retryAfterMs(res);
      } else if (res.status === 403) {
        if (await isPremiumRefusal(res)) {
          return {
            status: 'failed',
            failure: { code: 'premium', message: 'Spotify Premium is required for full-track playback. Using preview mode.' },
          };
        }
        // Any other 403 ("restriction violated", a command sent mid-transition)
        // passes; treating it as permanent dropped working sessions to preview.
      } else if (res.status < 500) {
        // Any other 4xx will not change on retry.
        return { status: 'unavailable', message: lastMessage };
      }
    }
    return { status: 'unavailable', message: lastMessage };
  }

  /** Points playback at this device once per device id. Failure is harmless: the
   *  play request names the device itself, and a 404 there re-arms this. */
  private async transferOnce(token: string, deviceId: string) {
    if (this.transferredTo === deviceId) return;
    try {
      const res = await spotifyApi(token, '/me/player', {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [deviceId], play: false }),
      });
      if (res.ok || res.status === 204) this.transferredTo = deviceId;
      else console.warn('[Spotify Web Player] transfer failed', res.status);
    } catch (err) {
      console.warn('[Spotify Web Player] transfer failed', err);
    }
  }

  /** The UI can say "unmuted" while the device is still at the 0 an earlier mute
   *  left it (opening a track resets the UI's mute flag but not the device), so
   *  the device is brought in line with the UI before every start. */
  private async applyVolume() {
    try {
      await this.player?.setVolume(Math.max(0, Math.min(1, this.opts.getVolume())));
    } catch {
      // best effort
    }
  }

  private async verifyStart(req: PlayRequest, generation: number): Promise<'playing' | 'blocked' | 'superseded' | 'missing'> {
    const until = Date.now() + this.verifyTimeoutMs;
    let sawTrackPaused = false;
    do {
      if (!this.live(req, generation)) return 'superseded';
      // The listener paused while this was starting: nothing left to confirm.
      if (req.wantsPlaying && !req.wantsPlaying()) return 'playing';
      const state = await this.currentState();
      if (stateHasTrack(state, req.trackId)) {
        if (!state?.paused) return 'playing';
        sawTrackPaused = true;
      }
      await this.sleep(this.verifyIntervalMs, () => this.live(req, generation));
    } while (Date.now() < until);
    return sawTrackPaused ? 'blocked' : 'missing';
  }

  private async sleep(ms: number, keepWaiting: () => boolean) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (!keepWaiting()) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(0, end - Date.now()))));
    }
  }

  // -- passthroughs ---------------------------------------------------------
  // The player context calls these without awaiting them, so a rejection here
  // would surface as an unhandled promise rejection with nobody to act on it.

  private async safely(label: string, call: () => Promise<void> | undefined) {
    try {
      await call();
    } catch (err) {
      console.warn(`[Spotify Web Player] ${label} failed`, err);
    }
  }

  async currentState(): Promise<SpotifyPlayerState | null> {
    if (!this.player) return null;
    return this.player.getCurrentState().catch(() => null);
  }

  resume() {
    return this.safely('resume', () => this.player?.resume());
  }

  pause() {
    return this.safely('pause', () => this.player?.pause());
  }

  seek(positionMs: number) {
    return this.safely('seek', () => this.player?.seek(Math.max(0, positionMs)));
  }

  setVolume(volume: number) {
    return this.safely('setVolume', () => this.player?.setVolume(Math.max(0, Math.min(1, volume))));
  }

  activateElement() {
    return this.safely('activateElement', () => this.player?.activateElement?.());
  }

  // -- lifecycle ------------------------------------------------------------

  /** Disconnects the device but leaves the session usable: the next play
   *  builds a fresh one. Work in flight under the old device is abandoned. */
  release() {
    this.generation++;
    this.devicePromise = null;
    this.notifyReady(null);
    const instance = this.player;
    this.player = null;
    this.deviceId = null;
    this.transferredTo = null;
    try {
      instance?.disconnect();
    } catch {
      // already gone
    }
  }

  /** Final: disconnects, and every later call resolves as superseded. */
  dispose() {
    this.disposed = true;
    this.release();
  }
}
