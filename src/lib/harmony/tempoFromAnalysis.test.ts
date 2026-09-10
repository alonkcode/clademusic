import { describe, expect, it } from 'vitest';
import type { TrackSection } from '@/types';
import { chordGapsMs, estimateTempoFromSections } from './tempoFromAnalysis';

/** Builds sections on an exact grid at a known tempo, so the estimator can be
 *  scored against ground truth rather than against a snapshot of itself. */
function buildTrack(opts: {
  bpm: number;
  beatsPerChord: number;
  barsPerSection: number;
  sectionCount: number;
}): TrackSection[] {
  const { bpm, beatsPerChord, barsPerSection, sectionCount } = opts;
  const beatMs = 60000 / bpm;
  const sectionMs = beatMs * 4 * barsPerSection;
  const chordMs = beatMs * beatsPerChord;

  return Array.from({ length: sectionCount }, (_, s) => {
    const start = s * sectionMs;
    const timings: number[] = [];
    for (let t = 0; t < sectionMs; t += chordMs) timings.push(start + t);
    return {
      id: `s${s}`,
      track_id: 't',
      label: 'verse',
      start_ms: start,
      end_ms: start + sectionMs,
      created_at: '',
      chords: timings.map(() => 'I'),
      chord_timings: timings,
    } as TrackSection;
  });
}

describe('chordGapsMs', () => {
  it('collects gaps between consecutive chord onsets', () => {
    const sections = buildTrack({ bpm: 120, beatsPerChord: 4, barsPerSection: 4, sectionCount: 1 });
    // 120bpm, 4 beats per chord -> a chord every 2000ms.
    expect(chordGapsMs(sections).every((g) => Math.abs(g - 2000) < 1e-6)).toBe(true);
  });

  it('ignores sections without at least two chord timings', () => {
    const sections = [
      { id: 'a', track_id: 't', label: 'intro', start_ms: 0, end_ms: 1000, created_at: '', chord_timings: [0] },
      { id: 'b', track_id: 't', label: 'verse', start_ms: 1000, end_ms: 2000, created_at: '' },
    ] as unknown as TrackSection[];
    expect(chordGapsMs(sections)).toEqual([]);
  });
});

describe('estimateTempoFromSections', () => {
  it.each([
    [90, 4],
    [120, 4],
    [128, 2],
    [140, 2],
    [174, 1],
  ])('recovers %ibpm when chords hold %i beats', (bpm, beatsPerChord) => {
    const sections = buildTrack({ bpm, beatsPerChord, barsPerSection: 8, sectionCount: 4 });
    const estimate = estimateTempoFromSections(sections);
    expect(estimate).not.toBeNull();
    expect(estimate!.bpm).toBeCloseTo(bpm, 0);
  });

  it('uses section lengths to resolve the half/double ambiguity', () => {
    // Chord gaps alone are equally consistent with 75 and 150; only the bar
    // alignment of the sections distinguishes them.
    const sections = buildTrack({ bpm: 150, beatsPerChord: 4, barsPerSection: 8, sectionCount: 4 });
    const estimate = estimateTempoFromSections(sections);
    expect(estimate!.bpm).toBeCloseTo(150, 0);
  });

  it('survives a chord held longer than the rest', () => {
    const sections = buildTrack({ bpm: 120, beatsPerChord: 4, barsPerSection: 8, sectionCount: 3 });
    // Drop one onset, so a single chord spans twice the usual gap.
    sections[0].chord_timings = sections[0].chord_timings!.filter((_, i) => i !== 2);
    expect(estimateTempoFromSections(sections)!.bpm).toBeCloseTo(120, 0);
  });

  it('returns null rather than guessing without enough evidence', () => {
    expect(estimateTempoFromSections(null)).toBeNull();
    expect(estimateTempoFromSections([])).toBeNull();
    const oneChord = buildTrack({ bpm: 120, beatsPerChord: 4, barsPerSection: 1, sectionCount: 1 });
    oneChord[0].chord_timings = [0];
    expect(estimateTempoFromSections(oneChord)).toBeNull();
  });

  it('returns null when chord gaps imply nothing musically plausible', () => {
    const sections = [
      {
        id: 'a', track_id: 't', label: 'verse', start_ms: 0, end_ms: 30_000, created_at: '',
        // ~11000ms apart -> ~5bpm at one beat per chord, far outside the range.
        chord_timings: [0, 11_000, 22_000, 33_000],
      },
    ] as unknown as TrackSection[];
    expect(estimateTempoFromSections(sections)).toBeNull();
  });

  it('rejects sections that do not line up as whole bars at any tempo', () => {
    const sections = [
      { id: 'a', track_id: 't', label: 'verse', start_ms: 0, end_ms: 7333, created_at: '', chord_timings: [0, 1013, 2027, 3041, 4055] },
      { id: 'b', track_id: 't', label: 'chorus', start_ms: 7333, end_ms: 15_111, created_at: '', chord_timings: [7333, 8419, 9505, 10_591] },
    ] as unknown as TrackSection[];
    const estimate = estimateTempoFromSections(sections);
    if (estimate) expect(estimate.barError).toBeLessThanOrEqual(0.16);
  });
});
