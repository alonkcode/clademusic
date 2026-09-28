import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAnimatedSeekbar, type SeekIntent } from './useAnimatedSeekbar';

/**
 * Regression: dragging the volume slider made the seekbar flick to 0:00 and
 * back. setVolumeLevel fired on every `input` event and sent both setVolume
 * and setMute down to the embed each time, so a single drag pushed a few
 * hundred commands into YouTube's widget API; the infoDelivery replies it
 * pushed back carried stale currentTime values, and this hook re-anchored on
 * the first one it saw.
 *
 * The RAF loop is disabled under isTestEnv, so what these exercise is purely
 * the authority re-anchoring logic - which is the part that was wrong.
 */
const DURATION = 240_000;

function setup(initialMs: number, isPlaying = true) {
  return renderHook(({ positionMs }) => useAnimatedSeekbar(positionMs, DURATION, isPlaying), {
    initialProps: { positionMs: initialMs },
  });
}

describe('useAnimatedSeekbar', () => {
  it('follows the provider forward', () => {
    const { result, rerender } = setup(30_000);
    rerender({ positionMs: 31_000 });
    expect(result.current).toBe(31_000);
  });

  it('ignores drift smaller than the tolerance', () => {
    const { result, rerender } = setup(30_000);
    rerender({ positionMs: 30_100 });
    expect(result.current).toBe(30_000);
  });

  it('ignores a one-off stale reading that jumps back to zero', () => {
    const { result, rerender } = setup(30_000);
    rerender({ positionMs: 0 });
    expect(result.current).toBe(30_000);
  });

  it('recovers on the next good reading after a stale one', () => {
    const { result, rerender } = setup(30_000);
    rerender({ positionMs: 0 }); // stale glitch, rejected
    rerender({ positionMs: 31_000 }); // real position, still moving forward
    expect(result.current).toBe(31_000);
  });

  it('accepts a rewind once a second reading corroborates it', () => {
    const { result, rerender } = setup(30_000);
    rerender({ positionMs: 5_000 });
    expect(result.current).toBe(30_000); // not yet believed
    rerender({ positionMs: 5_500 }); // seek was real, playback continued
    expect(result.current).toBe(5_500);
  });

  // A provider that is stalled but still ticking (a buffering YouTube frame
  // reports a barely-moving currentTime) is the case the re-anchor exists for:
  // the RAF animation runs away from it and has to be pulled back. Two
  // readings that agree is exactly what a stall looks like, so it corrects on
  // the second one. An EXACTLY repeated value is a different matter - React
  // does not re-run an effect keyed on [positionMs] when the value is
  // unchanged, so it never reaches this logic at all. That predates the
  // rewind guard and is not something the guard can change.
  it('still corrects against a stalled provider whose position barely moves', () => {
    const { result, rerender } = setup(30_000);
    rerender({ positionMs: 12_000 });
    expect(result.current).toBe(30_000);
    rerender({ positionMs: 12_050 });
    expect(result.current).toBe(12_050);
  });

  it('snaps without corroboration while paused', () => {
    const { result, rerender } = renderHook(
      ({ positionMs }) => useAnimatedSeekbar(positionMs, DURATION, false),
      { initialProps: { positionMs: 30_000 } }
    );
    rerender({ positionMs: 5_000 });
    expect(result.current).toBe(5_000);
  });

  it('ignores a non-finite reading rather than rendering NaN', () => {
    const { result, rerender } = setup(30_000);
    rerender({ positionMs: Number.NaN });
    expect(result.current).toBe(30_000);
  });
});

/**
 * Regression: a single click on the seekbar did not stick. The click seeks the
 * provider and optimistically moves the player's position to the target, but
 * the provider keeps reporting where it WAS for a moment (a poll already in
 * flight, an infoDelivery already on the wire). The bar treated the first
 * backward reading as suspect and the stale ones as truth, so the thumb went
 * back to the old spot after the click while the audio had already moved.
 */
describe('useAnimatedSeekbar - a seek made by the listener', () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now');
  const advance = (ms: number) => {
    now += ms;
  };

  function setupSeek(initialMs: number, isPlaying = true) {
    now = 1_000;
    clock.mockImplementation(() => now);
    return renderHook(
      ({ positionMs, seek }: { positionMs: number; seek: SeekIntent | null }) =>
        useAnimatedSeekbar(positionMs, DURATION, isPlaying, seek),
      { initialProps: { positionMs: initialMs, seek: null as SeekIntent | null } }
    );
  }

  afterEach(() => {
    clock.mockReset();
  });

  it('moves the bar to a backward seek at once, without waiting for a second reading', () => {
    const { result, rerender } = setupSeek(120_000);
    // What the click does: seek intent plus the optimistic position, one commit.
    rerender({ positionMs: 40_000, seek: { ms: 40_000 } });
    expect(result.current).toBe(40_000);
  });

  it('moves the bar to a forward seek at once', () => {
    const { result, rerender } = setupSeek(20_000);
    rerender({ positionMs: 158_000, seek: { ms: 158_000 } });
    expect(result.current).toBe(158_000);
  });

  it('ignores the provider still reporting the old position after a backward seek', () => {
    const { result, rerender } = setupSeek(120_000);
    const seek = { ms: 40_000 };
    rerender({ positionMs: 40_000, seek });
    advance(250);
    rerender({ positionMs: 120_250, seek }); // stale
    advance(250);
    rerender({ positionMs: 120_500, seek }); // stale again - two agreeing readings used to be believed
    expect(result.current).toBe(40_000);
  });

  it('ignores the provider still reporting the old position after a forward seek', () => {
    const { result, rerender } = setupSeek(20_000);
    const seek = { ms: 158_000 };
    rerender({ positionMs: 158_000, seek });
    advance(250);
    rerender({ positionMs: 20_250, seek });
    advance(250);
    rerender({ positionMs: 20_500, seek });
    expect(result.current).toBe(158_000);
  });

  it('follows the provider once it reports the new position', () => {
    const { result, rerender } = setupSeek(120_000);
    const seek = { ms: 40_000 };
    rerender({ positionMs: 40_000, seek });
    advance(250);
    rerender({ positionMs: 120_250, seek }); // stale, dropped
    advance(250);
    rerender({ positionMs: 41_500, seek }); // provider caught up, a bit ahead of the bar
    expect(result.current).toBe(41_500);
  });

  it('keeps the seek while paused, and ignores a stale reading then too', () => {
    const { result, rerender } = setupSeek(120_000, false);
    const seek = { ms: 40_000 };
    rerender({ positionMs: 40_000, seek });
    expect(result.current).toBe(40_000);
    advance(250);
    rerender({ positionMs: 120_000, seek });
    expect(result.current).toBe(40_000);
  });

  it('believes the provider again once the seek window has passed', () => {
    const { result, rerender } = setupSeek(120_000);
    const seek = { ms: 40_000 };
    rerender({ positionMs: 40_000, seek });
    advance(3_500); // provider never acted on the seek
    rerender({ positionMs: 120_000, seek });
    expect(result.current).toBe(120_000);
  });

  it('treats a second seek to the same spot as a new seek', () => {
    const { result, rerender } = setupSeek(120_000);
    const first = { ms: 40_000 };
    rerender({ positionMs: 40_000, seek: first });
    advance(3_500);
    rerender({ positionMs: 120_000, seek: first }); // window over, provider believed
    expect(result.current).toBe(120_000);

    const again = { ms: 40_000 }; // the listener clicks the same spot again
    rerender({ positionMs: 40_000, seek: again });
    expect(result.current).toBe(40_000);
    advance(250);
    rerender({ positionMs: 120_250, seek: again }); // stale
    expect(result.current).toBe(40_000);
  });
});
