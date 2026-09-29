import { describe, it, expect } from 'vitest';
import {
  applySpanDelta,
  decodeChord,
  decodeKey,
  decodeSection,
  decodeSpan,
  decodeTempo,
} from './wireDecode';
import type { WireSpan } from '../../../services/live-analysis/protocol';

/**
 * The wire carries milliseconds and 0-100 confidences; the app's harmony types
 * are seconds and 0-1. A slip either way still produces a well-formed object,
 * so nothing but an assertion on the numbers catches it.
 */
describe('wire decoding', () => {
  it('converts a chord span from milliseconds to seconds and 0-1 confidence', () => {
    expect(decodeSpan([9, 1, 12_000, 15_500, 87])).toEqual({
      root: 9,
      quality: 'minor',
      startSec: 12,
      endSec: 15.5,
      confidence: 0.87,
    });
  });

  it('reads the minor flag as a quality, not a truthy number', () => {
    expect(decodeSpan([0, 0, 0, 1_000, 50]).quality).toBe('major');
    expect(decodeChord([4, 1])?.quality).toBe('minor');
    expect(decodeChord(null)).toBeNull();
  });

  it('converts sections to seconds and keeps the label', () => {
    expect(decodeSection({ t: 'chorus', l: 'Chorus 1', s: 60_000, e: 90_000 })).toEqual({
      type: 'chorus',
      label: 'Chorus 1',
      startSec: 60,
      endSec: 90,
    });
  });

  it('falls back to verse for a section type outside the union', () => {
    // `t` is a plain string on the wire; a future server value must not leak
    // into DetectedSectionType and break everything that switches on it.
    expect(decodeSection({ t: 'breakdown', l: 'x', s: 0, e: 1_000 }).type).toBe('verse');
  });

  it('converts key and tempo, and clamps a confidence that is out of range', () => {
    expect(decodeKey({ tonic: 7, minor: 1, confidence: 64 })).toEqual({
      tonic: 7,
      mode: 'minor',
      confidence: 0.64,
    });
    expect(decodeTempo({ bpm: 121.6, confidence: 140 })).toEqual({ bpm: 121.6, confidence: 1 });
    expect(decodeKey(null)).toBeNull();
    expect(decodeTempo(null)).toBeNull();
  });
});

describe('applySpanDelta', () => {
  const held = [decodeSpan([0, 0, 0, 1_000, 90]), decodeSpan([7, 0, 1_000, 2_000, 90])];

  it('replaces from spanStart rather than appending', () => {
    // The server re-sends the tail because the last span keeps growing while
    // the chord is still sounding. Appending would duplicate it every snapshot.
    const next: WireSpan[] = [[7, 0, 1_000, 3_000, 95]];
    const result = applySpanDelta(held, 1, next);
    expect(result).toHaveLength(2);
    expect(result[1].endSec).toBe(3);
  });

  it('appends when the delta starts at the end of what is held', () => {
    const result = applySpanDelta(held, 2, [[9, 1, 2_000, 3_000, 80]]);
    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({ root: 9, quality: 'minor' });
  });

  it('replaces everything when the server resends from zero', () => {
    expect(applySpanDelta(held, 0, [[5, 0, 0, 4_000, 70]])).toEqual([decodeSpan([5, 0, 0, 4_000, 70])]);
  });

  it('drops a delta that cannot be placed rather than leaving a hole', () => {
    // spanStart past the end means frames were missed. Keeping our list and
    // ignoring this snapshot is recoverable; splicing it on is not.
    expect(applySpanDelta(held, 5, [[0, 0, 5_000, 6_000, 50]])).toBe(held);
    expect(applySpanDelta(held, -1, [])).toBe(held);
  });
});
