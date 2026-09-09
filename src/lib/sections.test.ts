import { describe, it, expect } from 'vitest';
import { sectionStartSeconds } from './sections';
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
