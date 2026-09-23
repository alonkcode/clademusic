import { describe, it, expect } from 'vitest';
import { AUTO_PROMOTION, evaluateAutoPromotion, requiredCoverageMs } from './autoPromotion';

/** n sections, each with `chordsEach` chords. */
const sections = (n: number, chordsEach: number) =>
  Array.from({ length: n }, () => ({ chords: Array.from({ length: chordsEach }, () => ({})) }));

const good = {
  key: { confidence: 0.8 },
  sections: sections(4, 5),
  coveredFromMs: 0,
  coveredToMs: 120_000,
};

describe('requiredCoverageMs', () => {
  it('is the absolute floor when the length is unknown', () => {
    expect(requiredCoverageMs(undefined)).toBe(AUTO_PROMOTION.MIN_COVERAGE_MS);
    expect(requiredCoverageMs(null)).toBe(AUTO_PROMOTION.MIN_COVERAGE_MS);
    expect(requiredCoverageMs(0)).toBe(AUTO_PROMOTION.MIN_COVERAGE_MS);
  });

  it('is capped at the floor for a long song', () => {
    expect(requiredCoverageMs(300_000)).toBe(90_000);
  });

  it('eases to 60% of a short track', () => {
    expect(requiredCoverageMs(100_000)).toBe(60_000);
    expect(requiredCoverageMs(40_000)).toBe(24_000);
  });
});

describe('evaluateAutoPromotion', () => {
  it('accepts a capture that clears every threshold', () => {
    const verdict = evaluateAutoPromotion(good, 240_000);
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBe('ok');
    expect(verdict.progress.ratio).toBe(1);
  });

  it('asks the listener to keep going when too little of the song was heard', () => {
    const verdict = evaluateAutoPromotion({ ...good, coveredToMs: 45_000 }, 240_000);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('insufficient_coverage');
    expect(verdict.progress.coverageMs).toBe(45_000);
    expect(verdict.progress.requiredCoverageMs).toBe(90_000);
    expect(verdict.progress.ratio).toBeCloseTo(0.5, 3);
  });

  it('measures coverage from where the capture started, not from zero', () => {
    const verdict = evaluateAutoPromotion({ ...good, coveredFromMs: 100_000, coveredToMs: 150_000 }, 240_000);
    expect(verdict.progress.coverageMs).toBe(50_000);
    expect(verdict.ok).toBe(false);
  });

  it('accepts a short track once 60% of it has been heard', () => {
    const verdict = evaluateAutoPromotion({ ...good, coveredToMs: 61_000 }, 100_000);
    expect(verdict.ok).toBe(true);
  });

  it('needs enough chord changes', () => {
    const verdict = evaluateAutoPromotion({ ...good, sections: sections(2, 3) }, 240_000);
    expect(verdict.reason).toBe('too_few_chords');
    expect(verdict.progress.chords).toBe(6);
  });

  it('needs more than one section', () => {
    const verdict = evaluateAutoPromotion({ ...good, sections: sections(1, 12) }, 240_000);
    expect(verdict.reason).toBe('too_few_sections');
  });

  it('needs a key at all', () => {
    const verdict = evaluateAutoPromotion({ ...good, key: null }, 240_000);
    expect(verdict.reason).toBe('no_key');
    expect(verdict.progress.ratio).toBe(0);
  });

  it('needs a key the detector stood behind', () => {
    const verdict = evaluateAutoPromotion({ ...good, key: { confidence: 0.3 } }, 240_000);
    expect(verdict.reason).toBe('low_key_confidence');
    expect(verdict.progress.ratio).toBeCloseTo(0.6, 3);
  });

  it('reports the shortfall the listener can act on first: coverage before key', () => {
    const verdict = evaluateAutoPromotion({ ...good, key: null, coveredToMs: 10_000 }, 240_000);
    expect(verdict.reason).toBe('insufficient_coverage');
  });

  it('sits exactly on each threshold without tipping over', () => {
    const verdict = evaluateAutoPromotion(
      {
        key: { confidence: AUTO_PROMOTION.MIN_KEY_CONFIDENCE },
        sections: sections(AUTO_PROMOTION.MIN_SECTIONS, AUTO_PROMOTION.MIN_CHORDS / AUTO_PROMOTION.MIN_SECTIONS),
        coveredFromMs: 0,
        coveredToMs: AUTO_PROMOTION.MIN_COVERAGE_MS,
      },
      null
    );
    expect(verdict.ok).toBe(true);
  });
});
