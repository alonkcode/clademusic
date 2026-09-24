import { describe, it, expect } from 'vitest';
import { chordHoldBeats, chordIndexAt, snapToBeat, FALLBACK_BPM } from './chordClock';

describe('chordHoldBeats', () => {
  it('spreads the loop\'s bars across its chords in 4/4', () => {
    expect(chordHoldBeats(4, 4)).toBe(4); // a bar per chord
    expect(chordHoldBeats(4, 8)).toBe(8); // two bars per chord
    expect(chordHoldBeats(4, 2)).toBe(2); // two chords per bar
    expect(chordHoldBeats(8, 4)).toBe(2);
  });

  it('falls back when the bar count or chord count is unusable', () => {
    expect(chordHoldBeats(4, undefined)).toBe(4);
    expect(chordHoldBeats(4, null, 2)).toBe(2);
    expect(chordHoldBeats(4, 0)).toBe(4);
    expect(chordHoldBeats(4, Number.NaN)).toBe(4);
    expect(chordHoldBeats(0, 4)).toBe(4);
  });
});

describe('snapToBeat', () => {
  it('lands on the nearest multiple of one beat from 0', () => {
    // 120bpm: a beat is exactly 500ms.
    expect(snapToBeat(18000, 120)).toBe(18000);
    expect(snapToBeat(18200, 120)).toBe(18000);
    expect(snapToBeat(18300, 120)).toBe(18500);
  });
});

describe('chordIndexAt', () => {
  const base = { chordCount: 4, beatsPerChord: 4, sectionStartMs: 0 };

  it('steps every beatsPerChord beats of the tempo', () => {
    // 120bpm, 4 beats/chord = 2000ms per chord.
    expect(chordIndexAt({ ...base, bpm: 120, positionMs: 0 })).toBe(0);
    expect(chordIndexAt({ ...base, bpm: 120, positionMs: 1999 })).toBe(0);
    expect(chordIndexAt({ ...base, bpm: 120, positionMs: 2000 })).toBe(1);
    expect(chordIndexAt({ ...base, bpm: 120, positionMs: 7999 })).toBe(3);
    expect(chordIndexAt({ ...base, bpm: 120, positionMs: 8000 })).toBe(0); // wraps
  });

  it('honours a half-length hold', () => {
    // 2 beats/chord at 120bpm = 1000ms.
    expect(chordIndexAt({ ...base, beatsPerChord: 2, bpm: 120, positionMs: 1000 })).toBe(1);
  });

  it('changes chord exactly on a beat of the global grid, whatever the section start', () => {
    // 171bpm: one beat = 350.877ms. A verse curated to start at a whole 18s is
    // not on that grid; the chord changes must still be.
    const bpm = 171;
    const beatMs = 60000 / bpm;
    const input = { ...base, bpm, sectionStartMs: 18000 };

    const anchor = Math.round(18000 / beatMs) * beatMs;
    const firstChange = anchor + 4 * beatMs;

    expect(chordIndexAt({ ...input, positionMs: firstChange - 1 })).toBe(0);
    expect(chordIndexAt({ ...input, positionMs: firstChange + 1 })).toBe(1);

    // ...and that change is a beat flash: a whole number of beats from 0.
    const beatsFromZero = firstChange / beatMs;
    expect(Math.abs(beatsFromZero - Math.round(beatsFromZero))).toBeLessThan(1e-9);
  });

  it('does not go negative before the section\'s snapped anchor', () => {
    // Snapping forward means the raw start can precede the anchor by up to
    // half a beat; that stretch is still the section's first chord.
    expect(chordIndexAt({ ...base, bpm: 120, sectionStartMs: 18200, positionMs: 18200 })).toBe(0);
    expect(chordIndexAt({ ...base, bpm: 120, sectionStartMs: 18300, positionMs: 18300 })).toBe(0);
  });

  it('uses real per-chord timings exactly, ignoring tempo and the beat grid', () => {
    const input = {
      ...base,
      bpm: 999,
      sectionStartMs: 1000,
      timings: [0, 2000, 5000, 8000],
    };
    expect(chordIndexAt({ ...input, positionMs: 1000 + 5400 })).toBe(2);
    expect(chordIndexAt({ ...input, positionMs: 1000 + 7999 })).toBe(2);
    expect(chordIndexAt({ ...input, positionMs: 1000 + 8000 })).toBe(3);
  });

  it('ignores timings that do not line up one-for-one with the chords', () => {
    const idx = chordIndexAt({ ...base, bpm: 120, positionMs: 2500, timings: [0, 100] });
    expect(idx).toBe(1); // tempo grid: 2500ms / 2000ms per chord
  });

  it('sizes a guessed rate from the fallback tempo without pretending it has a beat grid', () => {
    const msPerChord = (60000 / FALLBACK_BPM) * 4;
    // A start that is nowhere near a beat of the fallback tempo stays where it is.
    const sectionStartMs = 1234;
    expect(chordIndexAt({ ...base, sectionStartMs, positionMs: sectionStartMs + msPerChord - 1 })).toBe(0);
    expect(chordIndexAt({ ...base, sectionStartMs, positionMs: sectionStartMs + msPerChord })).toBe(1);
  });

  it('treats an out-of-range tempo as unknown rather than dividing by it', () => {
    const msPerChord = (60000 / FALLBACK_BPM) * 4;
    expect(chordIndexAt({ ...base, bpm: 0, positionMs: msPerChord })).toBe(1);
    expect(chordIndexAt({ ...base, bpm: 5000, positionMs: msPerChord })).toBe(1);
  });

  it('returns 0 with nothing to index', () => {
    expect(chordIndexAt({ ...base, chordCount: 0, bpm: 120, positionMs: 5000 })).toBe(0);
  });
});
