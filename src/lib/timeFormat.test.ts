import { describe, it, expect } from 'vitest';
import { formatTime, parseTimecode } from './timeFormat';

/**
 * Typed timecodes: what the section editor's timestamp boxes accept, and the
 * round trip with what they show.
 */

describe('parseTimecode', () => {
  it('reads minutes, seconds and milliseconds', () => {
    expect(parseTimecode('1:23.456')).toBe(83_456);
    expect(parseTimecode('0:00.000')).toBe(0);
    expect(parseTimecode('10:07.010')).toBe(607_010);
  });

  it('reads an hours field for a track long enough to need one', () => {
    expect(parseTimecode('1:02:03.004')).toBe(3_723_004);
  });

  it('takes the shorter forms people type', () => {
    expect(parseTimecode('1:23')).toBe(83_000);
    expect(parseTimecode('23')).toBe(23_000);
    expect(parseTimecode('23.4')).toBe(23_400);
    expect(parseTimecode(' 1:23.456 ')).toBe(83_456);
  });

  // A fraction of a second, so it reads the same either way round: .4 is four
  // tenths and 400ms at once.
  it('treats the fraction as a fraction of a second, not as digits of ms', () => {
    expect(parseTimecode('0:01.4')).toBe(1_400);
    expect(parseTimecode('0:01.45')).toBe(1_450);
    expect(parseTimecode('0:01.4567')).toBe(1_457);
  });

  it('is nothing at all rather than a guess when it is not a time', () => {
    for (const input of ['', '   ', 'abc', '1:', ':30', '1:2:3:4', '-5', '1,5', '0:1x.0']) {
      expect(parseTimecode(input), input).toBeNull();
    }
  });

  it('reads back exactly what the editor shows', () => {
    for (const ms of [0, 1, 999, 1_000, 83_456, 3_599_999]) {
      expect(parseTimecode(formatTime(ms, true)), String(ms)).toBe(ms);
    }
  });
});
