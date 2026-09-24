import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSectionSync } from './useSectionSync';

/**
 * The provider reports position in steps (every 250ms on the Spotify embed
 * path). useSectionSync extrapolates between reports on the frame clock so a
 * chord change lands on its beat instead of up to a quarter second after it.
 * That loop is switched off under isTestEnv everywhere else, so it is driven
 * here by hand: a fake frame queue and a fake performance clock.
 */

const mocks = vi.hoisted(() => ({
  player: {
    canonicalTrackId: 'track-1',
    isPlaying: true,
    positionMs: 0,
    seekTo: vi.fn(),
  },
}));

vi.mock('@/lib/env', () => ({ isTestEnv: false }));
vi.mock('@/player/PlayerContext', () => ({ usePlayer: () => mocks.player }));
vi.mock('@/hooks/useSectionSelection', () => ({ useSectionSelection: () => null }));

let clock = 0;
let nextFrameId = 1;
const frames = new Map<number, FrameRequestCallback>();

/** Fires every queued frame once, as the browser would on its next paint. */
function paint() {
  const queued = [...frames.values()];
  frames.clear();
  act(() => queued.forEach((cb) => cb(clock)));
}

// Hoisted so every render sees the same references, as real callers do (track
// fields and memoised hook output) - an inline literal would hand the hook a
// new section list each render and correctly invalidate anything it cached.
const PROGRESSION = ['I', 'V', 'vi', 'IV'];
const NO_SECTIONS: never[] = [];

function mountAt(positionMs: number, isPlaying = true) {
  mocks.player.positionMs = positionMs;
  mocks.player.isPlaying = isPlaying;
  // 120bpm, 4 beats/chord: a chord every 2000ms, no sections.
  return renderHook(() =>
    useSectionSync({ trackId: 'track-1', progression: PROGRESSION, sections: NO_SECTIONS, bpm: 120 })
  );
}

describe('useSectionSync frame clock', () => {
  beforeEach(() => {
    clock = 1000;
    nextFrameId = 1;
    frames.clear();
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mocks.player.isPlaying = true;
  });

  it('moves to the next chord between provider reports, as soon as its beat arrives', () => {
    const { result } = mountAt(1900);
    expect(result.current.liveChordIndex).toBe(0);

    // No new report from the provider, but 150ms of real time has passed: the
    // playhead is at 2050ms, past the 2000ms chord change.
    clock += 150;
    paint();
    expect(result.current.liveChordIndex).toBe(1);
  });

  it('does not re-render or change anything until a chord boundary is crossed', () => {
    const { result } = mountAt(1000);
    const before = result.current;

    clock += 500;
    paint();
    expect(result.current.liveChordIndex).toBe(0);
    expect(result.current).toBe(before); // same object: no state was touched
  });

  it('re-anchors to a fresh report, so a seek shows the right chord within a frame', () => {
    const { result, rerender } = mountAt(1900);
    clock += 150;
    paint();
    expect(result.current.liveChordIndex).toBe(1);

    // The listener seeks; the provider reports a position in the third chord.
    mocks.player.positionMs = 4500;
    rerender();
    paint();
    expect(result.current.liveChordIndex).toBe(2);
  });

  it('runs no frame loop while the track is not playing', () => {
    const { result } = mountAt(1900, false);
    expect(frames.size).toBe(0);
    expect(result.current.isLiveSynced).toBe(false);
    expect(result.current.liveChordIndex).toBe(0);
  });

  it('cancels its frame loop on unmount', () => {
    const { unmount } = mountAt(1900);
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });
});
