import { describe, it, expect } from 'vitest';
import { sectionDisplayNames, sectionStartSeconds } from './sections';
import type { TrackSection } from '@/types';

/**
 * Regression: clicking a section chip (e.g. "Verse" at a real 0:21.4)
 * highlighted the PREVIOUS section instead. Root cause was
 * sectionStartSeconds flooring to whole seconds before seeking - 21437ms
 * became 21s, i.e. 21000ms, landing 437ms BEFORE the section's real start
 * and squarely back inside the previous section's own window.
 */
describe('sectionStartSeconds', () => {
  const section = (start_ms: number): TrackSection => ({ start_ms } as TrackSection);

  it('preserves sub-second precision instead of flooring', () => {
    expect(sectionStartSeconds(section(21437))).toBeCloseTo(21.437);
  });

  it('round-trips back to the exact original start_ms in milliseconds', () => {
    const startMs = 65321;
    expect(sectionStartSeconds(section(startMs)) * 1000).toBeCloseTo(startMs);
  });

  it('still returns 0 for an exact whole-second boundary', () => {
    expect(sectionStartSeconds(section(0))).toBe(0);
  });
});

describe('sectionDisplayNames', () => {
  const named = (...labels: TrackSection['label'][]) =>
    sectionDisplayNames(labels.map((label) => ({ label })));

  it('numbers a label only where it repeats, in playing order', () => {
    expect(named('intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro')).toEqual([
      'Intro',
      'Verse 1',
      'Chorus 1',
      'Verse 2',
      'Chorus 2',
      'Bridge',
      'Chorus 3',
      'Outro',
    ]);
  });

  it('leaves a lone section unnumbered', () => {
    expect(named('verse', 'chorus')).toEqual(['Verse', 'Chorus']);
  });

  it('uses the readable name for hyphenated labels', () => {
    expect(named('pre-chorus', 'pre-chorus')).toEqual(['Pre-Chorus 1', 'Pre-Chorus 2']);
  });

  it('counts occurrences rather than trusting a stored ordinal', () => {
    // ordinal defaults to 1 in the table, so rows saved before it existed
    // would all read "Verse 1" if it were used.
    const rows = [
      { label: 'verse' as const, ordinal: 1 },
      { label: 'verse' as const, ordinal: 1 },
    ];
    expect(sectionDisplayNames(rows)).toEqual(['Verse 1', 'Verse 2']);
  });

  it('returns nothing for nothing', () => {
    expect(sectionDisplayNames([])).toEqual([]);
  });
});
