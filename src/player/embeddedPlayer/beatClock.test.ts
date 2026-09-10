import { describe, expect, it } from 'vitest';
import { beatFlashIntensity, beatIndexAt, beatIntervalMs, flashDecayMs, isUsableBpm } from './beatClock';

describe('isUsableBpm', () => {
  it('rejects missing, non-finite and out-of-range tempos', () => {
    expect(isUsableBpm(undefined)).toBe(false);
    expect(isUsableBpm(null)).toBe(false);
    expect(isUsableBpm(0)).toBe(false);
    expect(isUsableBpm(NaN)).toBe(false);
    expect(isUsableBpm(Infinity)).toBe(false);
    expect(isUsableBpm(19)).toBe(false);
    expect(isUsableBpm(401)).toBe(false);
    expect(isUsableBpm(120)).toBe(true);
  });
});

describe('beatIntervalMs', () => {
  it('is 500ms at 120bpm', () => {
    expect(beatIntervalMs(120)).toBe(500);
    expect(beatIntervalMs(60)).toBe(1000);
  });
});

describe('beatFlashIntensity', () => {
  it('is fully lit exactly on each onset', () => {
    // 120bpm -> a beat every 500ms.
    expect(beatFlashIntensity(0, 120)).toBe(1);
    expect(beatFlashIntensity(500, 120)).toBe(1);
    expect(beatFlashIntensity(1000, 120)).toBe(1);
    expect(beatFlashIntensity(30_000, 120)).toBe(1);
  });

  it('decays to zero across the flash window and then stays dark', () => {
    const decay = flashDecayMs(500); // 110ms at 120bpm
    expect(beatFlashIntensity(decay / 2, 120)).toBeCloseTo(0.5, 5);
    expect(beatFlashIntensity(decay, 120)).toBe(0);
    // Dark for the whole rest of the beat - "on the beat and only the beat".
    expect(beatFlashIntensity(200, 120)).toBe(0);
    expect(beatFlashIntensity(300, 120)).toBe(0);
    expect(beatFlashIntensity(499, 120)).toBe(0);
  });

  it('always clears before the next onset, even at extreme tempo', () => {
    for (const bpm of [20, 60, 90, 120, 174, 240, 400]) {
      const interval = beatIntervalMs(bpm);
      expect(flashDecayMs(interval)).toBeLessThan(interval);
      // Just before the next beat the dot must be fully dark.
      expect(beatFlashIntensity(interval - 0.001, bpm)).toBe(0);
    }
  });

  it('is silent for an unusable tempo rather than flashing arbitrarily', () => {
    expect(beatFlashIntensity(0, undefined)).toBe(0);
    expect(beatFlashIntensity(0, 0)).toBe(0);
    expect(beatFlashIntensity(NaN, 120)).toBe(0);
  });

  it('treats a negative position as the track start', () => {
    expect(beatFlashIntensity(-50, 120)).toBe(1);
  });
});

describe('beatIndexAt', () => {
  it('counts beats from the start of the track', () => {
    expect(beatIndexAt(0, 120)).toBe(0);
    expect(beatIndexAt(499, 120)).toBe(0);
    expect(beatIndexAt(500, 120)).toBe(1);
    expect(beatIndexAt(2000, 120)).toBe(4);
  });
});
