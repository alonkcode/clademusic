import { describe, expect, it } from 'vitest';
import { parseProgressionQuery, progressionContainsSequence } from './progressionSearch';

describe('parseProgressionQuery', () => {
  it('splits on dashes, the original required format', () => {
    expect(parseProgressionQuery('vi-IV-I-V')).toEqual(['vi', 'IV', 'I', 'V']);
  });

  it('splits on plain spaces - no dashes required', () => {
    expect(parseProgressionQuery('vi I IV V')).toEqual(['vi', 'I', 'IV', 'V']);
  });

  it('splits on commas and mixed separators', () => {
    expect(parseProgressionQuery('vi, IV,I - V')).toEqual(['vi', 'IV', 'I', 'V']);
  });

  it('preserves case - vi and VI are different chords', () => {
    expect(parseProgressionQuery('vi VI')).toEqual(['vi', 'VI']);
  });

  it('returns empty for blank input', () => {
    expect(parseProgressionQuery('   ')).toEqual([]);
  });
});

describe('progressionContainsSequence', () => {
  const loop = ['I', 'V', 'vi', 'IV'];

  it('matches the full progression', () => {
    expect(progressionContainsSequence(loop, ['I', 'V', 'vi', 'IV'])).toBe(true);
  });

  it('matches a contiguous partial run', () => {
    expect(progressionContainsSequence(loop, ['V', 'vi'])).toBe(true);
  });

  it('does not match the same chords out of order', () => {
    // V then I never actually occurs in this loop - I is followed by V, not
    // the reverse. A set-based ("contains all of these somewhere") match
    // would wrongly say yes here.
    expect(progressionContainsSequence(loop, ['V', 'I'])).toBe(false);
  });

  it('matches across the loop seam (last chord wrapping to the first)', () => {
    // IV is the last chord; the loop repeats, so IV is immediately followed
    // by I again.
    expect(progressionContainsSequence(loop, ['IV', 'I'])).toBe(true);
  });

  it('is case-sensitive: "vi" and "VI" are different chords', () => {
    expect(progressionContainsSequence(loop, ['VI'])).toBe(false);
    expect(progressionContainsSequence(loop, ['vi'])).toBe(true);
  });

  it('an empty query matches anything (no filter applied yet)', () => {
    expect(progressionContainsSequence(loop, [])).toBe(true);
  });

  it('a query longer than the loop cannot match', () => {
    expect(progressionContainsSequence(['I', 'V'], ['I', 'V', 'vi', 'IV'])).toBe(false);
  });

  it('matches a single chord present in the loop', () => {
    expect(progressionContainsSequence(loop, ['vi'])).toBe(true);
    expect(progressionContainsSequence(loop, ['iii'])).toBe(false);
  });
});
