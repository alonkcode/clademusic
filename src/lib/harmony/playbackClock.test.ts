import { describe, it, expect } from 'vitest';
import { PlaybackClock, RESYNC_TOLERANCE_MS } from './playbackClock';

describe('PlaybackClock', () => {
  it('has no estimate before the first report', () => {
    expect(new PlaybackClock().positionSec(1000)).toBeNull();
  });

  // The whole reason this exists: Spotify Premium relays every 500ms, and
  // timestamping frames with the raw value snapped chords to half-seconds.
  it('interpolates between reports at a finer resolution than the provider', () => {
    const clock = new PlaybackClock();
    clock.report(10_000, true, 0);
    expect(clock.positionSec(120)).toBeCloseTo(10.12, 5);
    expect(clock.positionSec(240)).toBeCloseTo(10.24, 5);
    expect(clock.positionSec(360)).toBeCloseTo(10.36, 5);
  });

  it('holds still while paused', () => {
    const clock = new PlaybackClock();
    clock.report(10_000, false, 0);
    expect(clock.positionSec(5_000)).toBe(10);
  });

  // Re-anchoring on every report would snap time backwards whenever a report
  // lagged, which ChordTimeline reads as a seek and splits the timeline at.
  it('never runs backwards over a slightly late report', () => {
    const clock = new PlaybackClock();
    clock.report(10_000, true, 0);
    const before = clock.positionSec(500)!;
    clock.report(10_300, true, 500); // 200ms behind the estimate - ordinary lag
    const after = clock.positionSec(500)!;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('is monotonic across a long run of jittery reports', () => {
    const clock = new PlaybackClock();
    clock.report(0, true, 0);
    let last = -Infinity;
    for (let t = 0; t <= 60_000; t += 120) {
      if (t % 500 === 0) {
        // Reports arrive late by a varying amount, as real polling does.
        const lag = (t / 500) % 3 === 0 ? 300 : 80;
        clock.report(Math.max(0, t - lag), true, t);
      }
      const now = clock.positionSec(t)!;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('follows a genuine seek forwards', () => {
    const clock = new PlaybackClock();
    clock.report(10_000, true, 0);
    clock.report(90_000, true, 1_000);
    expect(clock.positionSec(1_000)).toBe(90);
  });

  it('follows a genuine seek backwards', () => {
    const clock = new PlaybackClock();
    clock.report(90_000, true, 0);
    clock.report(5_000, true, 1_000);
    expect(clock.positionSec(1_000)).toBe(5);
  });

  it('treats a disagreement just inside the tolerance as jitter, not a seek', () => {
    const clock = new PlaybackClock();
    clock.report(10_000, true, 0);
    clock.report(10_000 + 1_000 + RESYNC_TOLERANCE_MS - 1, true, 1_000);
    expect(clock.positionSec(1_000)).toBe(11);
  });

  it('resumes from where a pause left it, not from wall-clock time since', () => {
    const clock = new PlaybackClock();
    clock.report(10_000, true, 0);
    clock.report(12_000, false, 2_000); // paused at 12s
    clock.report(12_000, true, 60_000); // resumed a minute later
    expect(clock.positionSec(61_000)).toBe(13);
  });

  it('ignores a non-finite report', () => {
    const clock = new PlaybackClock();
    clock.report(10_000, true, 0);
    clock.report(Number.NaN, true, 500);
    expect(clock.positionSec(500)).toBe(10.5);
  });

  describe('aligned', () => {
    it('is false before playback has reported any movement', () => {
      const clock = new PlaybackClock();
      clock.report(0, true, 0);
      expect(clock.aligned).toBe(false);
    });

    it('becomes true once a playing provider reports a moving position', () => {
      const clock = new PlaybackClock();
      clock.report(10_000, true, 0);
      clock.report(10_500, true, 500);
      expect(clock.aligned).toBe(true);
    });

    // The guest Spotify embed: playing, but its position never changes.
    it('stays false for a provider whose position never moves', () => {
      const clock = new PlaybackClock();
      clock.report(0, true, 0);
      clock.report(0, true, 5_000);
      clock.report(0, true, 10_000);
      expect(clock.aligned).toBe(false);
    });

    it('does not count movement that happened while paused', () => {
      const clock = new PlaybackClock();
      clock.report(10_000, false, 0);
      clock.report(40_000, false, 100); // scrubbing a paused track
      expect(clock.aligned).toBe(false);
    });

    it('forgets on reset, so one track cannot vouch for the next', () => {
      const clock = new PlaybackClock();
      clock.report(10_000, true, 0);
      clock.report(10_500, true, 500);
      clock.reset();
      expect(clock.aligned).toBe(false);
      expect(clock.positionSec(1_000)).toBeNull();
    });
  });
});
