import { describe, expect, it, vi } from 'vitest';
import {
  AUDIO_HEADER_BYTES,
  CLOSE_FOR_ERROR,
  ERROR_MESSAGES,
  MAX_AUDIO_FRAME_BYTES,
  MAX_AUDIO_FRAME_SAMPLES,
  MAX_CONTROL_BYTES,
  PROTOCOL_VERSION,
  decodeAudioFrame,
  encodeAudioFrame,
  parseClientMessage,
  parseServerMessage,
  providerAnalysisCapability,
  type ErrorCode,
} from '../../../services/live-analysis/protocol';
import { supabaseTokenVerifier } from '../../../services/live-analysis/supabaseAuth';

/**
 * The wire format and its parsers are the only place untrusted bytes enter the
 * service, so they are tested for what they refuse as much as what they accept.
 */

describe('audio frames', () => {
  const samples = Int16Array.of(0, 1, -1, 32767, -32768, 1234);

  it('round-trips samples, flags, position and sequence number exactly', () => {
    const decoded = decodeAudioFrame(encodeAudioFrame({ seq: 7, positionMs: 61_234, playing: true, positionValid: true, samples }));
    expect(decoded).not.toBeNull();
    expect(decoded!.seq).toBe(7);
    expect(decoded!.positionMs).toBe(61_234);
    expect(decoded!.playing).toBe(true);
    expect(decoded!.positionValid).toBe(true);
    expect(Array.from(decoded!.samples)).toEqual(Array.from(samples));
  });

  it('keeps the two flags independent', () => {
    for (const [playing, positionValid] of [[true, false], [false, true], [false, false]] as const) {
      const d = decodeAudioFrame(encodeAudioFrame({ seq: 0, positionMs: 0, playing, positionValid, samples }))!;
      expect([d.playing, d.positionValid]).toEqual([playing, positionValid]);
    }
  });

  it('carries the largest sequence number, and clamps a nonsense position instead of wrapping it', () => {
    const d = decodeAudioFrame(encodeAudioFrame({ seq: 0xffffffff, positionMs: -5, playing: true, positionValid: true, samples }))!;
    expect(d.seq).toBe(0xffffffff);
    expect(d.positionMs).toBe(0);
    const big = decodeAudioFrame(encodeAudioFrame({ seq: 1, positionMs: 1e15, playing: true, positionValid: true, samples }))!;
    expect(big.positionMs).toBe(0xffffffff);
  });

  it('is a fraction of the size of the PCM it carries plus a 10-byte header', () => {
    const bytes = encodeAudioFrame({ seq: 0, positionMs: 0, playing: true, positionValid: true, samples: new Int16Array(2205) });
    expect(bytes.length).toBe(AUDIO_HEADER_BYTES + 2205 * 2);
  });

  it('reads a frame that is a view into a larger buffer, as a runtime\'s pooled Buffer is', () => {
    const frame = encodeAudioFrame({ seq: 3, positionMs: 500, playing: true, positionValid: true, samples });
    const pool = new Uint8Array(64 + frame.length);
    pool.set(frame, 33); // odd offset, like a pooled network buffer
    const d = decodeAudioFrame(pool.subarray(33, 33 + frame.length));
    expect(d?.seq).toBe(3);
    expect(Array.from(d!.samples)).toEqual(Array.from(samples));
  });

  it('refuses anything that is not a whole, current-version frame', () => {
    const good = encodeAudioFrame({ seq: 0, positionMs: 0, playing: true, positionValid: true, samples });
    expect(decodeAudioFrame(new Uint8Array(0))).toBeNull();
    expect(decodeAudioFrame(good.subarray(0, AUDIO_HEADER_BYTES - 1))).toBeNull();
    expect(decodeAudioFrame(good.subarray(0, good.length - 1))).toBeNull(); // half a sample
    const wrongVersion = good.slice();
    wrongVersion[0] = PROTOCOL_VERSION + 1;
    expect(decodeAudioFrame(wrongVersion)).toBeNull();
  });

  it('refuses a frame larger than one second of audio', () => {
    const ok = encodeAudioFrame({ seq: 0, positionMs: 0, playing: true, positionValid: true, samples: new Int16Array(MAX_AUDIO_FRAME_SAMPLES) });
    expect(ok.length).toBe(MAX_AUDIO_FRAME_BYTES);
    expect(decodeAudioFrame(ok)).not.toBeNull();
    expect(decodeAudioFrame(new Uint8Array(MAX_AUDIO_FRAME_BYTES + 2))).toBeNull();
  });
});

describe('parseClientMessage', () => {
  const hello = {
    type: 'hello',
    v: PROTOCOL_VERSION,
    token: 'a.b.c',
    source: 'microphone',
    provider: 'spotify',
    trackId: 'spotify:abc123',
    sampleRate: 22_050,
  };
  const parse = (o: unknown) => parseClientMessage(JSON.stringify(o));

  it('accepts a well-formed hello, with and without resume', () => {
    expect(parse(hello)).toMatchObject({ type: 'hello', provider: 'spotify', sampleRate: 22_050 });
    const withResume = parse({ ...hello, resume: { sessionId: 'session-1', resumeKey: 'abcDEF0123' } });
    expect(withResume).toMatchObject({ resume: { sessionId: 'session-1', resumeKey: 'abcDEF0123' } });
  });

  it('passes an unfamiliar source through so the service can answer "unsupported" rather than "bad request"', () => {
    expect(parse({ ...hello, source: 'provider-audio' })).toMatchObject({ source: 'provider-audio' });
  });

  it('refuses a hello with anything out of range or the wrong type', () => {
    const bad = [
      { ...hello, v: 99 },
      { ...hello, token: '' },
      { ...hello, token: 'x'.repeat(5000) },
      { ...hello, sampleRate: 100 },
      { ...hello, sampleRate: 500_000 },
      { ...hello, sampleRate: 22_050.5 },
      { ...hello, sampleRate: '22050' },
      { ...hello, provider: undefined },
      { ...hello, trackId: 't'.repeat(200) },
      { ...hello, resume: 'yes' },
      { ...hello, resume: { sessionId: 'ok' } },
    ];
    for (const b of bad) expect(parse(b)).toBeNull();
  });

  it('refuses ids that could carry markup, log-line breaks or path tricks', () => {
    for (const trackId of ['<script>alert(1)</script>', 'a b', 'line\nbreak', '../../etc/passwd', 'x;drop', 'é']) {
      expect(parse({ ...hello, trackId })).toBeNull();
    }
    expect(parse({ ...hello, provider: 'spotify\nFAKE LOG LINE' })).toBeNull();
    expect(parse({ ...hello, resume: { sessionId: 'a\nb', resumeKey: 'k' } })).toBeNull();
  });

  it('accepts real track ids: uuids, provider-prefixed ids, YouTube ids with dashes and underscores', () => {
    for (const trackId of ['3f2b1c9e-8a4d-4c1e-9b7a-1d2e3f4a5b6c', 'spotify:4uLU6hMCjMI75M1A2tKUQC', 'youtube:dQw4w9WgXcQ', 'youtube:a-b_c-D_1']) {
      expect(parse({ ...hello, trackId })).not.toBeNull();
    }
  });

  it('validates sync ranges', () => {
    const sync = { type: 'sync', positionMs: 1000, playing: true, playbackRate: 1, timestamp: 1_700_000_000_000 };
    expect(parse(sync)).toMatchObject({ type: 'sync', positionMs: 1000 });
    for (const bad of [
      { ...sync, positionMs: -1 },
      { ...sync, positionMs: Number.POSITIVE_INFINITY },
      { ...sync, positionMs: null },
      { ...sync, playing: 'yes' },
      { ...sync, playbackRate: 0 },
      { ...sync, playbackRate: 100 },
      { ...sync, timestamp: 'now' },
    ]) {
      expect(parse(bad)).toBeNull();
    }
  });

  it('accepts stop and ping, and refuses unknown types, non-objects and garbage', () => {
    expect(parse({ type: 'stop' })).toEqual({ type: 'stop' });
    expect(parse({ type: 'ping', t: 5 })).toEqual({ type: 'ping', t: 5 });
    expect(parse({ type: 'ping', t: 'x' })).toBeNull();
    for (const bad of [{ type: 'shutdown' }, {}, [], 'hello', 42, null]) expect(parse(bad)).toBeNull();
    expect(parseClientMessage('{not json')).toBeNull();
    expect(parseClientMessage('')).toBeNull();
  });

  it('refuses an oversized control message before parsing it', () => {
    const big = JSON.stringify({ type: 'ping', t: 1, pad: 'x'.repeat(MAX_CONTROL_BYTES) });
    expect(parseClientMessage(big)).toBeNull();
  });

  it('does not pick up extra properties a client sneaks into a message', () => {
    const parsed = parse({ ...hello, isAdmin: true, userId: 'someone-else' }) as unknown as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('isAdmin');
    expect(parsed).not.toHaveProperty('userId');
  });
});

describe('parseServerMessage', () => {
  it('passes known message types and drops everything else', () => {
    expect(parseServerMessage('{"type":"chord","posMs":1,"chord":[0,0]}')?.type).toBe('chord');
    expect(parseServerMessage('{"type":"something-new"}')).toBeNull();
    expect(parseServerMessage('nope')).toBeNull();
    expect(parseServerMessage('[]')).toBeNull();
  });
});

describe('providers and errors', () => {
  it('states, for every provider Clade plays through, that the service cannot fetch its audio', () => {
    for (const p of ['spotify', 'youtube', 'apple_music', 'deezer', 'soundcloud', 'amazon_music']) {
      const cap = providerAnalysisCapability(p);
      expect(cap?.serverSideAudio).toBe(false);
      expect(cap?.microphone.liveAnalysis).toBe(true);
    }
  });

  it('claims only what the app can show: no spectrum, waveform or beat events', () => {
    const caps = providerAnalysisCapability('spotify')!.microphone;
    expect(Object.keys(caps).sort()).toEqual(['bpm', 'chords', 'key', 'liveAnalysis', 'realtime', 'sections']);
  });

  it('does not know a provider Clade does not play through', () => {
    expect(providerAnalysisCapability('napster')).toBeNull();
    expect(providerAnalysisCapability('')).toBeNull();
  });

  it('has a listener-safe message and a close code for every error code', () => {
    const codes = Object.keys(ERROR_MESSAGES) as ErrorCode[];
    expect(codes.sort()).toEqual(Object.keys(CLOSE_FOR_ERROR).sort());
    for (const code of codes) {
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(10);
      expect(ERROR_MESSAGES[code]).not.toMatch(/stack|exception|undefined|null|ECONN|\.ts|supabase|token/i);
      expect(CLOSE_FOR_ERROR[code]).toBeGreaterThanOrEqual(4000);
    }
  });

  it('names a provider limitation as one, not as a generic failure', () => {
    expect(ERROR_MESSAGES.unsupported).toBe("Live analysis isn't available for this provider.");
    expect(ERROR_MESSAGES.unsupported).not.toMatch(/failed/i);
  });
});

describe('supabaseTokenVerifier', () => {
  const make = (respond: () => Response | Promise<Response>) => {
    const fetchImpl = vi.fn(async () => respond()) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    return { fetchImpl, verify: supabaseTokenVerifier({ supabaseUrl: 'https://ref.supabase.co/', anonKey: 'publishable', fetchImpl }) };
  };

  it('returns the user id Supabase reports', async () => {
    const { verify } = make(() => new Response(JSON.stringify({ id: 'user-123', email: 'x@y.z' }), { status: 200 }));
    expect(await verify('tok')).toBe('user-123');
  });

  it('asks Supabase with the token in the header, never in the URL, and does not double the slash', async () => {
    const { verify, fetchImpl } = make(() => new Response(JSON.stringify({ id: 'u' }), { status: 200 }));
    await verify('secret-token');
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ref.supabase.co/auth/v1/user');
    expect(url).not.toContain('secret-token');
    expect(init.headers).toMatchObject({ apikey: 'publishable', Authorization: 'Bearer secret-token' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('says "not valid" (null) for a rejected token', async () => {
    for (const status of [401, 403]) {
      const { verify } = make(() => new Response('{}', { status }));
      expect(await verify('bad')).toBeNull();
    }
  });

  it('throws, rather than saying "not valid", when it cannot tell: an outage is not a sign-out', async () => {
    const { verify } = make(() => new Response('oops', { status: 503 }));
    await expect(verify('tok')).rejects.toThrow();
    const failing = supabaseTokenVerifier({
      supabaseUrl: 'https://ref.supabase.co',
      anonKey: 'k',
      fetchImpl: (async () => {
        throw new TypeError('network down');
      }) as unknown as typeof fetch,
    });
    await expect(failing('tok')).rejects.toThrow();
  });

  it('treats a 200 with no usable id as not valid', async () => {
    for (const body of ['{}', '{"id":""}', '{"id":42}']) {
      const { verify } = make(() => new Response(body, { status: 200 }));
      expect(await verify('tok')).toBeNull();
    }
  });
});
