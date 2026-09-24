import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A whole capture, end to end: a fake tab-audio stream feeding the real
 * useLiveChordDetection and useAnalyzeTrack, with time advanced by fake timers.
 *
 * Regression: "Heard 0:00 of about 1:30 needed" never moved while the tempo
 * was detected and the player was playing. The chord detector's silence gate
 * was tuned for unit-scale test numbers and called every real capture silence
 * (see SILENCE_ENERGY_THRESHOLD), so there were no chord spans, so no key, so
 * no payload - and progress, which is derived from the payload, stayed at zero.
 * The tempo detector does not depend on level, which is why it alone worked.
 *
 * The spectrum is built the way a real AnalyserNode reports one: in dB, with
 * the loudest bin of a typical mastered track near -38 dB (a full-scale sine is
 * only about -13.5 dB after the analyser's window).
 */

const mocks = vi.hoisted(() => ({
  player: { positionMs: 0, isPlaying: true, canonicalTrackId: 'youtube:dQw4w9WgXcQ' } as {
    positionMs: number;
    isPlaying: boolean;
    canonicalTrackId: string;
  },
  submit: vi.fn(),
}));

vi.mock('@/player/PlayerContext', () => ({ usePlayer: () => mocks.player }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/api/detectionRuns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/detectionRuns')>()),
  submitDetectionRun: mocks.submit,
}));

const { useAnalyzeTrack } = await import('./useAnalyzeTrack');

const midiHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
/** C, G, Am, F - two seconds each. */
const CHORDS = [
  [48, 52, 55],
  [43, 47, 50],
  [45, 48, 52],
  [41, 45, 48],
];

/** dB of the loudest bin. -38 is a typical track; the spec says nothing on a quiet one. */
let strongestDb = -38;
let silent = false;
let startedAtSec = 0;
const audioSec = () => performance.now() / 1000 - startedAtSec;

class FakeAnalyser {
  fftSize = 2048;
  smoothingTimeConstant = 0;
  constructor(private sampleRate: number) {}
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getFloatFrequencyData(out: Float32Array) {
    if (silent) {
      out.fill(-Infinity); // what a real analyser reports for exact silence
      return;
    }
    out.fill(-100);
    const now = audioSec();
    if (this.fftSize >= 8192) {
      // the chord analyser: partials of the chord sounding now
      const binHz = this.sampleRate / this.fftSize;
      for (const midi of CHORDS[Math.floor(now / 2) % CHORDS.length]) {
        for (const harmonic of [1, 2, 3, 4]) {
          const bin = Math.round((midiHz(midi) * harmonic) / binHz);
          if (bin < out.length) out[bin] = Math.max(out[bin], strongestDb - 6 * (harmonic - 1));
        }
      }
    } else {
      // the onset analyser: a broadband burst on each beat of 120 bpm
      out.fill(now % 0.5 < 0.08 ? -45 : -90);
    }
  }
}

class FakeAudioContext {
  sampleRate = 48000;
  state = 'running';
  get currentTime() {
    return audioSec();
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  createAnalyser() {
    return new FakeAnalyser(this.sampleRate);
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

const target = {
  provider: 'youtube',
  providerTrackId: 'dQw4w9WgXcQ',
  canonicalTrackId: 'youtube:dQw4w9WgXcQ',
  title: 'A song',
  artist: 'Someone',
  durationMs: 240_000,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Start a capture, then let `seconds` of a playing track go by, the player reporting every 250ms. */
async function capture(seconds: number, { startPositionMs = 0 }: { startPositionMs?: number } = {}) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
  startedAtSec = performance.now() / 1000;
  mocks.player.positionMs = startPositionMs;
  mocks.player.isPlaying = true;

  vi.stubGlobal('MediaStream', class { constructor(public tracks: unknown[]) {} });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  const track = { addEventListener() {}, stop() {} };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getDisplayMedia: vi.fn(async () => ({
        getAudioTracks: () => [track],
        getVideoTracks: () => [],
        getTracks: () => [track],
      })),
    },
  });

  const { result, rerender } = renderHook(() => useAnalyzeTrack(target), { wrapper });
  await act(async () => {
    await result.current.start();
  });

  const stepMs = 250;
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += stepMs) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
      mocks.player.positionMs += stepMs;
      rerender();
    });
  }
  return result.current;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mocks.submit.mockReset();
  strongestDb = -38;
  silent = false;
});

describe('a live capture of real-level audio', () => {
  it('hears chords and a key, and the "Heard" counter moves', async () => {
    mocks.submit.mockResolvedValue({ runId: 'r', promoted: false, reason: 'insufficient_coverage' });

    const analysis = await capture(30);

    expect(analysis.live.chord).not.toBeNull();
    expect(analysis.live.detectedKey).not.toBeNull();
    expect(analysis.live.tempo?.bpm).toBeCloseTo(120, 0);
    expect(analysis.progress.chords).toBeGreaterThan(0);
    // ~30 s of listening: the counter reads something close to that, not 0:00.
    expect(analysis.progress.coverageMs).toBeGreaterThan(20_000);
    expect(analysis.progress.coverageMs).toBeLessThan(40_000);
  });

  it('still hears it with the player turned well down', async () => {
    strongestDb = -55;

    const analysis = await capture(30);

    expect(analysis.live.chord).not.toBeNull();
    expect(analysis.progress.coverageMs).toBeGreaterThan(20_000);
  });

  it('counts only what was listened to when the capture starts partway through the song', async () => {
    // Two minutes in. Section detection starts its first section at 0:00, which
    // used to credit those unheard two minutes and satisfy the coverage bar
    // after a few seconds of listening.
    const analysis = await capture(30, { startPositionMs: 120_000 });

    expect(analysis.progress.coverageMs).toBeGreaterThan(20_000);
    expect(analysis.progress.coverageMs).toBeLessThan(40_000);
  });

  it('reports nothing heard for a shared tab that is playing silence', async () => {
    silent = true;

    const analysis = await capture(20);

    expect(analysis.live.chord).toBeNull();
    expect(analysis.progress.coverageMs).toBe(0);
  });
});
