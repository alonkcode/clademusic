import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useActiveSection } from './useActiveSection';
import type { TrackSection } from '@/types';

/**
 * Regression: clicking section chip #3 highlighted #2, chip #4 ("chorus")
 * highlighted #3 ("verse"). Root cause was Array.find()'s first-match
 * semantics against a [start_ms, end_ms) window: real analyzed section
 * boundaries aren't always perfectly contiguous, and wherever one section's
 * end overlapped the next one's start, seeking exactly to the next
 * section's start_ms still matched the PRECEDING section first.
 */
function section(id: string, label: string, start_ms: number, end_ms: number): TrackSection {
  return { id, label, start_ms, end_ms } as TrackSection;
}

const noop = () => {};

describe('useActiveSection', () => {
  it('picks the clicked section even when its start overlaps the previous section end', () => {
    const sections = [
      section('s1', 'verse', 0, 30000),
      section('s2', 'verse', 30000, 60500), // overlaps s3 by 500ms
      section('s3', 'chorus', 60000, 90000),
    ];

    const { result } = renderHook(() =>
      useActiveSection({
        sections,
        positionMs: 60000, // exactly s3's start_ms, still inside s2's [30000,60500) window
        currentSectionId: null,
        loopSectionId: null,
        seekToMs: noop,
      })
    );

    expect(result.current.activeSection?.id).toBe('s3');
  });

  it('still picks the last section that has actually started with clean, non-overlapping boundaries', () => {
    const sections = [
      section('s1', 'intro', 0, 20000),
      section('s2', 'verse', 20000, 50000),
      section('s3', 'chorus', 50000, 80000),
    ];

    const { result: mid } = renderHook(() =>
      useActiveSection({ sections, positionMs: 35000, currentSectionId: null, loopSectionId: null, seekToMs: noop })
    );
    expect(mid.current.activeSection?.id).toBe('s2');

    const { result: before } = renderHook(() =>
      useActiveSection({ sections, positionMs: 0, currentSectionId: null, loopSectionId: null, seekToMs: noop })
    );
    expect(before.current.activeSection?.id).toBe('s1');
  });

  it('returns null before the first section has started', () => {
    const sections = [section('s1', 'intro', 5000, 20000)];

    const { result } = renderHook(() =>
      useActiveSection({ sections, positionMs: 1000, currentSectionId: null, loopSectionId: null, seekToMs: noop })
    );

    expect(result.current.activeSection).toBeNull();
  });
});
