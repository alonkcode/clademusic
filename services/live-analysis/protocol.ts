/**
 * Wire contract between the browser and the live-analysis service.
 *
 * Shared by both sides, so it has no imports and no runtime APIs: it has to
 * load in the browser bundle, in Bun, and under Vitest.
 *
 * Direction of the bytes is the point of this design:
 *   client -> server   ~44 KB/s of 16-bit mono microphone audio at 22.05 kHz,
 *                      each chunk stamped with the player's position at capture
 *   server -> client   a few hundred bytes every 3 s (snapshot) plus a ~40-byte
 *                      event whenever the sounding chord changes
 * The client never receives audio, and the server never keeps any: a chunk is
 * analysed and dropped.
 */

export const PROTOCOL_VERSION = 1;

/** What the client asks the browser to capture at; the server accepts anything in range. */
export const ANALYSIS_SAMPLE_RATE = 22_050;
export const MIN_SAMPLE_RATE = 8_000;
export const MAX_SAMPLE_RATE = 48_000;

/** One audio frame never holds more than a second, whatever the rate. */
export const MAX_AUDIO_FRAME_SAMPLES = MAX_SAMPLE_RATE;
export const AUDIO_HEADER_BYTES = 10;
export const MAX_AUDIO_FRAME_BYTES = AUDIO_HEADER_BYTES + MAX_AUDIO_FRAME_SAMPLES * 2;
/** A Supabase access token is about 1 KB; nothing legitimate in a control message is bigger than this. */
export const MAX_CONTROL_BYTES = 8 * 1024;

/** WebSocket close codes in the application range. */
export const CLOSE = {
  NORMAL: 1000,
  BAD_REQUEST: 4400,
  UNAUTHORIZED: 4401,
  SESSION_EXPIRED: 4404,
  RATE_LIMITED: 4429,
  OVERLOADED: 4503,
  TOO_SLOW: 4508,
} as const;

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * What a live analysis can actually deliver. Deliberately the app's own
 * outputs (chords, sections, key, tempo) rather than a generic audio-analysis
 * menu: there is no spectrum, waveform or beat-event UI, so none is claimed.
 */
export interface AnalysisCapabilities {
  liveAnalysis: boolean;
  chords: boolean;
  sections: boolean;
  key: boolean;
  bpm: boolean;
  /** Results arrive while the music is still playing, not after it ends. */
  realtime: boolean;
}

export const MICROPHONE_CAPABILITIES: AnalysisCapabilities = {
  liveAnalysis: true,
  chords: true,
  sections: true,
  key: true,
  bpm: true,
  realtime: true,
};

export const NO_CAPABILITIES: AnalysisCapabilities = {
  liveAnalysis: false,
  chords: false,
  sections: false,
  key: false,
  bpm: false,
  realtime: false,
};

/** Providers Clade plays through. Playback is always the provider's own player. */
export const KNOWN_PROVIDERS = ['spotify', 'youtube', 'apple_music', 'deezer', 'soundcloud', 'amazon_music'] as const;
export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

export interface ProviderAnalysisCapability {
  provider: KnownProvider;
  /**
   * Whether the service can fetch this provider's audio itself. False for every
   * provider: none offers an official way to hand playable audio to a server
   * (Spotify's SDK and embeds are DRM-protected, YouTube's player exposes no
   * audio, and downloading either breaks their terms). It exists as a field so
   * a provider that ever does, through an official integration, is a one-line
   * change here rather than a new code path.
   */
  serverSideAudio: false;
  /** What the microphone route can report for this provider. */
  microphone: AnalysisCapabilities;
}

export function providerAnalysisCapability(provider: string): ProviderAnalysisCapability | null {
  if (!(KNOWN_PROVIDERS as readonly string[]).includes(provider)) return null;
  return { provider: provider as KnownProvider, serverSideAudio: false, microphone: MICROPHONE_CAPABILITIES };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'unsupported'
  | 'capacity'
  | 'rate_limited'
  | 'session_expired'
  | 'overloaded'
  | 'too_slow'
  | 'internal';

/** What the listener is told. Never a stack, an id or a provider detail. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  bad_request: 'Live analysis could not start from this device. Refresh and try again.',
  unauthorized: 'Sign in again to use live analysis.',
  unsupported: "Live analysis isn't available for this provider.",
  capacity: 'Live analysis is busy right now. Try again in a minute.',
  rate_limited: 'Too many analysis attempts. Wait a few minutes and try again.',
  session_expired: 'The connection was lost for too long. Start the analysis again.',
  overloaded: 'Live analysis is busy right now. Try again in a minute.',
  too_slow: 'Your connection is too slow to keep up with live analysis.',
  internal: 'Live analysis hit a problem. Try again.',
};

export const CLOSE_FOR_ERROR: Record<ErrorCode, number> = {
  bad_request: CLOSE.BAD_REQUEST,
  unauthorized: CLOSE.UNAUTHORIZED,
  unsupported: CLOSE.BAD_REQUEST,
  capacity: CLOSE.OVERLOADED,
  rate_limited: CLOSE.RATE_LIMITED,
  session_expired: CLOSE.SESSION_EXPIRED,
  overloaded: CLOSE.OVERLOADED,
  too_slow: CLOSE.TOO_SLOW,
  internal: CLOSE.OVERLOADED,
};

// ---------------------------------------------------------------------------
// Client -> server (JSON control messages)
// ---------------------------------------------------------------------------

export interface HelloMessage {
  type: 'hello';
  v: number;
  /** A Supabase access token. Sent here, not in the URL, so it never lands in a proxy log. */
  token: string;
  /** Only 'microphone' exists; anything else is answered with a clear "unsupported", not a parse error. */
  source: string;
  provider: string;
  trackId: string;
  sampleRate: number;
  /** Present on a reconnect: pick the same session back up. */
  resume?: { sessionId: string; resumeKey: string };
}

/** The player's state, reported when it changes and every couple of seconds while it does not. */
export interface SyncMessage {
  type: 'sync';
  positionMs: number;
  playing: boolean;
  playbackRate: number;
  /** Client wall clock, ms. Diagnostic only; the server never trusts it for ordering. */
  timestamp: number;
}

export interface StopMessage {
  type: 'stop';
}

export interface PingMessage {
  type: 'ping';
  t: number;
}

export type ClientMessage = HelloMessage | SyncMessage | StopMessage | PingMessage;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export interface ReadyMessage {
  type: 'ready';
  sessionId: string;
  /** Secret that, with the session id, lets this user resume after a dropped connection. */
  resumeKey: string;
  resumed: boolean;
  capabilities: AnalysisCapabilities;
  sampleRate: number;
  limits: { maxSessionSec: number; idleTimeoutSec: number; resumeWindowSec: number };
}

/** [root pitch class, 0 = major / 1 = minor] or null for "no chord". */
export type WireChord = [number, 0 | 1];

/** What is sounding now. Sent only when it changes. */
export interface ChordMessage {
  type: 'chord';
  posMs: number;
  chord: WireChord | null;
}

/** [root, minor, startMs, endMs, confidence 0-100] */
export type WireSpan = [number, 0 | 1, number, number, number];

export interface WireSection {
  /** intro | verse | chorus | bridge | outro */
  t: string;
  l: string;
  s: number;
  e: number;
}

/**
 * Everything derived from the audio so far, every few seconds and once more on
 * stop. Chord spans go as a delta: `spans` replaces the client's list from
 * index `spanStart` onward, which keeps a long song's snapshot the size of its
 * newest few chords. Sections, key and tempo are small and always complete.
 */
export interface SnapshotMessage {
  type: 'snapshot';
  posMs: number;
  /** Whether times are the song's own clock. False when the player reports no position. */
  aligned: boolean;
  spanStart: number;
  spans: WireSpan[];
  sections: WireSection[];
  key: { tonic: number; minor: 0 | 1; confidence: number } | null;
  tempo: { bpm: number; confidence: number } | null;
}

export type AnalysisStatus = 'analyzing' | 'paused';

export interface StateMessage {
  type: 'state';
  status: AnalysisStatus;
}

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
  /** The service closes the connection after a fatal error. */
  fatal: boolean;
}

export type StopReason = 'client' | 'idle_timeout' | 'paused_timeout' | 'max_duration' | 'shutdown' | 'error';

export interface StoppedMessage {
  type: 'stopped';
  reason: StopReason;
}

export interface PongMessage {
  type: 'pong';
  t: number;
}

export type ServerMessage =
  | ReadyMessage
  | ChordMessage
  | SnapshotMessage
  | StateMessage
  | ErrorMessage
  | StoppedMessage
  | PongMessage;

// ---------------------------------------------------------------------------
// Audio frames (client -> server, binary)
// ---------------------------------------------------------------------------

export interface AudioFrame {
  /** Increments by one per frame; a jump means frames were lost on the way. */
  seq: number;
  /** The player's position when the first sample was captured. Meaningless unless `positionValid`. */
  positionMs: number;
  playing: boolean;
  positionValid: boolean;
  samples: Int16Array;
}

const FLAG_PLAYING = 1;
const FLAG_POSITION_VALID = 2;

/**
 * Layout, little-endian:
 *   0   u8   version
 *   1   u8   flags (bit 0 playing, bit 1 position valid)
 *   2   u32  seq
 *   6   u32  positionMs
 *   10  i16* samples
 */
export function encodeAudioFrame(frame: AudioFrame): Uint8Array {
  const out = new Uint8Array(AUDIO_HEADER_BYTES + frame.samples.length * 2);
  const view = new DataView(out.buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, (frame.playing ? FLAG_PLAYING : 0) | (frame.positionValid ? FLAG_POSITION_VALID : 0));
  view.setUint32(2, frame.seq >>> 0, true);
  view.setUint32(6, Math.max(0, Math.min(0xffffffff, Math.round(frame.positionMs))), true);
  for (let i = 0; i < frame.samples.length; i++) view.setInt16(AUDIO_HEADER_BYTES + i * 2, frame.samples[i], true);
  return out;
}

/** null for anything that is not a well-formed frame; the caller drops it and counts it. */
export function decodeAudioFrame(data: ArrayBuffer | ArrayBufferView): AudioFrame | null {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  if (bytes.length < AUDIO_HEADER_BYTES || bytes.length > MAX_AUDIO_FRAME_BYTES) return null;
  if ((bytes.length - AUDIO_HEADER_BYTES) % 2 !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== PROTOCOL_VERSION) return null;
  const flags = view.getUint8(1);
  const count = (bytes.length - AUDIO_HEADER_BYTES) / 2;
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(AUDIO_HEADER_BYTES + i * 2, true);
  return {
    seq: view.getUint32(2, true),
    positionMs: view.getUint32(6, true),
    playing: (flags & FLAG_PLAYING) !== 0,
    positionValid: (flags & FLAG_POSITION_VALID) !== 0,
    samples,
  };
}

// ---------------------------------------------------------------------------
// Parsing untrusted JSON
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNumber = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Ids and provider names are plain tokens; anything else is refused before it reaches a log line. */
const TOKEN_CHARS = /^[A-Za-z0-9:_.-]+$/;

/** null unless `text` is a complete, in-range control message. */
export function parseClientMessage(text: string): ClientMessage | null {
  if (text.length > MAX_CONTROL_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;

  switch (raw.type) {
    case 'hello': {
      if (raw.v !== PROTOCOL_VERSION) return null;
      if (!isString(raw.token, 4096)) return null;
      if (!isString(raw.source, 32) || !TOKEN_CHARS.test(raw.source)) return null;
      if (!isString(raw.provider, 32) || !TOKEN_CHARS.test(raw.provider)) return null;
      if (!isString(raw.trackId, 128) || !TOKEN_CHARS.test(raw.trackId)) return null;
      if (!isNumber(raw.sampleRate, MIN_SAMPLE_RATE, MAX_SAMPLE_RATE) || !Number.isInteger(raw.sampleRate)) return null;
      let resume: HelloMessage['resume'];
      if (raw.resume !== undefined) {
        if (!isObject(raw.resume)) return null;
        if (!isString(raw.resume.sessionId, 64) || !TOKEN_CHARS.test(raw.resume.sessionId)) return null;
        if (!isString(raw.resume.resumeKey, 128) || !TOKEN_CHARS.test(raw.resume.resumeKey)) return null;
        resume = { sessionId: raw.resume.sessionId, resumeKey: raw.resume.resumeKey };
      }
      return {
        type: 'hello',
        v: PROTOCOL_VERSION,
        token: raw.token,
        source: raw.source,
        provider: raw.provider,
        trackId: raw.trackId,
        sampleRate: raw.sampleRate,
        ...(resume ? { resume } : {}),
      };
    }
    case 'sync': {
      if (!isNumber(raw.positionMs, 0, 24 * 60 * 60 * 1000)) return null;
      if (typeof raw.playing !== 'boolean') return null;
      if (!isNumber(raw.playbackRate, 0.25, 4)) return null;
      if (!isNumber(raw.timestamp, 0, Number.MAX_SAFE_INTEGER)) return null;
      return {
        type: 'sync',
        positionMs: raw.positionMs,
        playing: raw.playing,
        playbackRate: raw.playbackRate,
        timestamp: raw.timestamp,
      };
    }
    case 'stop':
      return { type: 'stop' };
    case 'ping':
      return isNumber(raw.t, 0, Number.MAX_SAFE_INTEGER) ? { type: 'ping', t: raw.t } : null;
    default:
      return null;
  }
}

/** The client's own parser for what the service sends; ignores anything it does not recognise. */
export function parseServerMessage(text: string): ServerMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'ready':
    case 'chord':
    case 'snapshot':
    case 'state':
    case 'error':
    case 'stopped':
    case 'pong':
      return raw as unknown as ServerMessage;
    default:
      return null;
  }
}
