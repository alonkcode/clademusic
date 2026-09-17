import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAnimatedSeekbar } from './useAnimatedSeekbar';

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
