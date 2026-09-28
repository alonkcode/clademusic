import { describe, it, expect } from 'vitest';
import {
  addChord,
  chordChoices,
  chordSpansBySection,
  draftChordsFromSections,
  moveChord,
  MIN_CHORD_MS,
  removeChord,
  replaceChord,
  splitChord,
  toChordColumns,
  type ChordMarker,
} from './chordDraft';
import { parseRomanChord } from './theory';
import { toSections, type SectionMarker } from './sectionDraft';

const DURATION = 60_000;

const sectionsOf = (...markers: Array<[number, string]>) =>
  toSections(
    markers.map(([startMs, label]) => ({ startMs, label: label as SectionMarker['label'] })),
    DURATION
  );

/** verse 0-20s, chorus 20-60s */
const SECTIONS = sectionsOf([0, 'verse'], [20_000, 'chorus']);

const chords = (...items: Array<[number, string]>): ChordMarker[] =>
  items.map(([startMs, numeral]) => ({ startMs, numeral }));

describe('draftChordsFromSections', () => {
  it('turns section-relative timings into track time', () => {
    const got = draftChordsFromSections([
      { start_ms: 0, end_ms: 20_000, chords: ['I', 'V'], chord_timings: [0, 10_000] },
      { start_ms: 20_000, end_ms: 60_000, chords: ['vi'], chord_timings: [0] },
    ]);
    expect(got).toEqual(chords([0, 'I'], [10_000, 'V'], [20_000, 'vi']));
  });

  it('keeps chords in playing order however the sections arrived', () => {
    const got = draftChordsFromSections([
      { start_ms: 20_000, end_ms: 60_000, chords: ['vi'], chord_timings: [0] },
      { start_ms: 0, end_ms: 20_000, chords: ['I'], chord_timings: [0] },
    ]);
    expect(got.map((c) => c.numeral)).toEqual(['I', 'vi']);
  });

  it('has nothing to import from sections without chords', () => {
    expect(draftChordsFromSections([{ start_ms: 0 }, { start_ms: 5000, chords: [] }])).toEqual([]);
  });

  // The database's CHECK and chordIndexAt both require one timing per chord.
  it('spreads chords evenly, once each, when the timings cannot be trusted', () => {
    const got = draftChordsFromSections([
      { start_ms: 0, end_ms: 20_000, chords: ['I', 'V'], chord_timings: [0] },
      { start_ms: 20_000, end_ms: 60_000, chords: ['vi', 'IV'], chord_timings: [] },
    ]);
    expect(got).toEqual(chords([0, 'I'], [10_000, 'V'], [20_000, 'vi'], [40_000, 'IV']));
  });

  it('has no way to place untimed chords in a section with no end', () => {
    expect(draftChordsFromSections([{ start_ms: 0, chords: ['I', 'V'] }])).toEqual([]);
  });

  it('drops a timing that lands past the end of the section it came from', () => {
    const got = draftChordsFromSections([
      { start_ms: 0, end_ms: 20_000, chords: ['I', 'V'], chord_timings: [0, 25_000] },
    ]);
    expect(got).toEqual(chords([0, 'I']));
  });

  it('keeps one chord when two claim the same instant', () => {
    const got = draftChordsFromSections([
      { start_ms: 0, end_ms: 20_000, chords: ['I', 'V'], chord_timings: [5000, 5000] },
    ]);
    expect(got).toEqual(chords([5000, 'I']));
  });
});

describe('chordSpansBySection', () => {
  it('holds each chord until the next, and the last until its section ends', () => {
    const spans = chordSpansBySection(chords([0, 'I'], [10_000, 'V'], [20_000, 'vi']), SECTIONS);
    expect(spans[0].map((s) => [s.numeral, s.startMs, s.endMs])).toEqual([
      ['I', 0, 10_000],
      ['V', 10_000, 20_000],
    ]);
    expect(spans[1].map((s) => [s.numeral, s.startMs, s.endMs])).toEqual([['vi', 20_000, 60_000]]);
  });

  it('starts a section on its first chord even if that chord was stored later', () => {
    const spans = chordSpansBySection(chords([22_500, 'vi']), SECTIONS);
    expect(spans[1][0]).toMatchObject({ numeral: 'vi', startMs: 20_000, endMs: 60_000 });
  });

  it('leaves a section with no chords empty, and does not borrow from a neighbour', () => {
    const spans = chordSpansBySection(chords([5000, 'I']), SECTIONS);
    expect(spans[1]).toEqual([]);
  });

  it('follows a moved boundary: the chord stays put and changes section', () => {
    const c = chords([0, 'I'], [22_000, 'V']);
    // Boundary later than the chord - it now belongs to the verse.
    const moved = sectionsOf([0, 'verse'], [25_000, 'chorus']);
    expect(chordSpansBySection(c, moved).map((s) => s.map((x) => x.numeral))).toEqual([['I', 'V'], []]);
    // ...and back earlier, it belongs to the chorus again.
    const back = sectionsOf([0, 'verse'], [15_000, 'chorus']);
    expect(chordSpansBySection(c, back).map((s) => s.map((x) => x.numeral))).toEqual([['I'], ['V']]);
  });

  it('reports each chord by its position in the flat list', () => {
    const spans = chordSpansBySection(chords([0, 'I'], [10_000, 'V'], [20_000, 'vi']), SECTIONS);
    expect(spans.flat().map((s) => s.index)).toEqual([0, 1, 2]);
  });
});

describe('toChordColumns', () => {
  it('stores onsets relative to the section, equal in length to the numerals', () => {
    const got = toChordColumns(chords([0, 'I'], [10_000, 'V'], [24_000, 'vi'], [40_000, 'IV']), SECTIONS);
    expect(got).toEqual([
      { progression_roman: ['I', 'V'], chord_timings: [0, 10_000] },
      { progression_roman: ['vi', 'IV'], chord_timings: [0, 20_000] },
    ]);
    for (const col of got) expect(col.chord_timings).toHaveLength(col.progression_roman.length);
  });

  it('stores nothing for a section without chords', () => {
    expect(toChordColumns([], SECTIONS)).toEqual([
      { progression_roman: [], chord_timings: [] },
      { progression_roman: [], chord_timings: [] },
    ]);
  });

  // What the listener hears is what is stored: chord 0 plays from the start.
  it('writes the first chord at zero even when it was stored later', () => {
    expect(toChordColumns(chords([22_500, 'vi']), SECTIONS)[1]).toEqual({
      progression_roman: ['vi'],
      chord_timings: [0],
    });
  });
});

describe('addChord', () => {
  it('adds a chord at the playhead that repeats the one it splits', () => {
    const got = addChord(chords([0, 'I'], [10_000, 'V']), 4000, SECTIONS);
    expect(got).toEqual(chords([0, 'I'], [4000, 'I'], [10_000, 'V']));
  });

  it('keeps the list in playing order', () => {
    const got = addChord(chords([0, 'I'], [10_000, 'V']), 15_000, SECTIONS);
    expect(got.map((c) => c.startMs)).toEqual([0, 10_000, 15_000]);
    expect(got[2].numeral).toBe('V');
  });

  it('gives an empty section its first chord, covering the section from its start', () => {
    const got = addChord([], 27_000, SECTIONS, 'vi');
    expect(got).toEqual(chords([20_000, 'vi']));
  });

  it('refuses a chord too close to the one before or after', () => {
    const c = chords([0, 'I'], [10_000, 'V']);
    expect(addChord(c, MIN_CHORD_MS - 1, SECTIONS)).toBe(c);
    expect(addChord(c, 10_000 + MIN_CHORD_MS - 1, SECTIONS)).toBe(c);
    expect(addChord(c, 10_000 - MIN_CHORD_MS + 1, SECTIONS)).toBe(c);
    expect(addChord(c, 10_000, SECTIONS)).toBe(c);
  });

  it('accepts a chord exactly MIN_CHORD_MS from its neighbours', () => {
    const got = addChord(chords([0, 'I'], [10_000, 'V']), MIN_CHORD_MS, SECTIONS);
    expect(got).toHaveLength(3);
  });

  it('refuses a playhead outside the track', () => {
    const c = chords([0, 'I']);
    expect(addChord(c, DURATION, SECTIONS)).toBe(c);
    expect(addChord(c, DURATION + 5000, SECTIONS)).toBe(c);
    expect(addChord(c, Number.NaN, SECTIONS)).toBe(c);
  });

  // Otherwise the section's opening seconds would go to the new chord.
  it("does not hand a section's opening to the new chord when the first was stored late", () => {
    const stored = chords([22_500, 'vi'], [30_000, 'IV']);
    const got = addChord(stored, 21_000, SECTIONS);
    const [first, second] = chordSpansBySection(got, SECTIONS)[1];
    expect([first.numeral, first.startMs, first.endMs]).toEqual(['vi', 20_000, 21_000]);
    expect([second.numeral, second.startMs, second.endMs]).toEqual(['vi', 21_000, 30_000]);
  });

  it('does not mutate what it was given', () => {
    const c = chords([0, 'I']);
    addChord(c, 5000, SECTIONS);
    expect(c).toEqual(chords([0, 'I']));
  });
});

describe('splitChord', () => {
  it('splits a chord into two equal halves that both keep the numeral', () => {
    const got = splitChord(chords([0, 'I'], [10_000, 'V']), 0, SECTIONS);
    expect(got).toEqual(chords([0, 'I'], [5000, 'I'], [10_000, 'V']));
  });

  it("splits the last chord of a section at the middle of what remains of the section", () => {
    const got = splitChord(chords([0, 'I'], [10_000, 'V']), 1, SECTIONS);
    expect(got.map((c) => c.startMs)).toEqual([0, 10_000, 15_000]);
    expect(got.map((c) => c.numeral)).toEqual(['I', 'V', 'V']);
  });

  it("treats a section's first chord as starting with the section", () => {
    const got = splitChord(chords([22_500, 'vi'], [30_000, 'IV']), 0, SECTIONS);
    const [first, second] = chordSpansBySection(got, SECTIONS)[1];
    expect([first.startMs, first.endMs]).toEqual([20_000, 25_000]);
    expect([second.startMs, second.endMs]).toEqual([25_000, 30_000]);
  });

  it('can be applied again for quarter-bars', () => {
    let c = chords([0, 'I'], [8000, 'V']);
    c = splitChord(c, 0, SECTIONS);
    c = splitChord(c, 0, SECTIONS);
    expect(c.map((x) => x.startMs)).toEqual([0, 2000, 4000, 8000]);
  });

  it('refuses when a half would be shorter than a chord can be', () => {
    const c = chords([0, 'I'], [2 * MIN_CHORD_MS - 1, 'V']);
    expect(splitChord(c, 0, SECTIONS)).toBe(c);
  });

  it('splits a chord exactly twice the minimum', () => {
    const c = chords([0, 'I'], [2 * MIN_CHORD_MS, 'V']);
    expect(splitChord(c, 0, SECTIONS)).toHaveLength(3);
  });

  it('does nothing for a chord that is in no section', () => {
    const c = chords([DURATION + 1000, 'I']);
    expect(splitChord(c, 0, SECTIONS)).toBe(c);
    expect(splitChord(c, 5, SECTIONS)).toBe(c);
  });
});

describe('replaceChord', () => {
  it('changes the numeral and nothing else', () => {
    const got = replaceChord(chords([0, 'I'], [10_000, 'V']), 1, 'vi');
    expect(got).toEqual(chords([0, 'I'], [10_000, 'vi']));
  });

  it('ignores an unknown position or an empty numeral', () => {
    const c = chords([0, 'I']);
    expect(replaceChord(c, 3, 'V')).toBe(c);
    expect(replaceChord(c, -1, 'V')).toBe(c);
    expect(replaceChord(c, 0, '  ')).toBe(c);
  });
});

describe('removeChord', () => {
  it('lets the chord before it hold on through the freed time', () => {
    const got = removeChord(chords([0, 'I'], [10_000, 'V']), 1);
    expect(chordSpansBySection(got, SECTIONS)[0]).toEqual([
      { index: 0, numeral: 'I', startMs: 0, endMs: 20_000 },
    ]);
  });

  it('lets the next chord play from the start of a section whose first chord is removed', () => {
    const got = removeChord(chords([20_000, 'vi'], [30_000, 'IV']), 0);
    expect(chordSpansBySection(got, SECTIONS)[1]).toEqual([
      { index: 0, numeral: 'IV', startMs: 20_000, endMs: 60_000 },
    ]);
  });

  it('ignores an unknown position', () => {
    const c = chords([0, 'I']);
    expect(removeChord(c, 4)).toBe(c);
  });
});

describe('chordChoices', () => {
  it('offers all twenty-four major and minor triads, once each', () => {
    for (const mode of ['major', 'minor'] as const) {
      const numerals = chordChoices(mode).map((c) => c.numeral);
      expect(numerals).toHaveLength(24);
      expect(new Set(numerals).size).toBe(24);
    }
  });

  it("puts a major key's own triads first, spelled as detection spells them", () => {
    const inKey = chordChoices('major').filter((c) => c.inKey).map((c) => c.numeral);
    expect(inKey).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi']);
    expect(chordChoices('major').slice(0, inKey.length).every((c) => c.inKey)).toBe(true);
  });

  it("puts a minor key's own triads first", () => {
    const inKey = chordChoices('minor').filter((c) => c.inKey).map((c) => c.numeral);
    expect(inKey).toEqual(['i', 'III', 'iv', 'v', 'VI', 'VII']);
  });

  it('lists borrowed chords after the in-key ones', () => {
    const rest = chordChoices('major').filter((c) => !c.inKey).map((c) => c.numeral);
    expect(rest).toContain('bVII');
    expect(rest).toContain('bVI');
    expect(rest).toContain('iv');
  });

  // The numerals go on to be sounded and named; one that will not parse would
  // sit in the picker and then do nothing anywhere else.
  it('only offers numerals the rest of the app can parse', () => {
    for (const mode of ['major', 'minor'] as const) {
      for (const { numeral } of chordChoices(mode)) {
        expect(parseRomanChord(numeral, mode), `${mode}: ${numeral}`).not.toBeNull();
      }
    }
  });
});

describe('moveChord', () => {
  /** verse 0-20s: I from the start, V at 5s, vi at 10s. */
  const VERSE = chords([0, 'I'], [5000, 'V'], [10_000, 'vi']);

  it('puts a chord exactly where it is asked to', () => {
    expect(moveChord(VERSE, 1, 7000, SECTIONS)).toEqual(chords([0, 'I'], [7000, 'V'], [10_000, 'vi']));
  });

  it('leaves the other chords, and the original list, alone', () => {
    const moved = moveChord(VERSE, 1, 7000, SECTIONS);
    expect(moved).not.toBe(VERSE);
    expect(VERSE[1].startMs).toBe(5000);
    expect(moved[0]).toEqual(VERSE[0]);
    expect(moved[2]).toEqual(VERSE[2]);
  });

  // Clamped rather than refused: a typed time outside the gap is a time that
  // was read or guessed slightly wrong, not an edit to throw away.
  it('holds a chord clear of the one before it', () => {
    expect(moveChord(VERSE, 1, 0, SECTIONS)[1].startMs).toBe(MIN_CHORD_MS);
  });

  it('holds a chord clear of the one after it', () => {
    expect(moveChord(VERSE, 1, 30_000, SECTIONS)[1].startMs).toBe(10_000 - MIN_CHORD_MS);
  });

  it('holds the last chord of a section inside that section', () => {
    expect(moveChord(VERSE, 2, 59_000, SECTIONS)[2].startMs).toBe(20_000 - MIN_CHORD_MS);
  });

  // It plays from the section's start whatever its onset says, so there is
  // nothing here to move - the boundary is what that edit means.
  it("refuses to move a section's first chord", () => {
    expect(moveChord(VERSE, 0, 2000, SECTIONS)).toBe(VERSE);
  });

  it('refuses when neither neighbour leaves room', () => {
    const crowded = chords([0, 'I'], [300, 'V'], [400, 'vi']);
    expect(moveChord(crowded, 1, 350, SECTIONS)).toBe(crowded);
  });

  it('has nothing to move for a chord outside every section, or no chord at all', () => {
    const past = chords([0, 'I'], [80_000, 'V']);
    expect(moveChord(past, 1, 30_000, SECTIONS)).toBe(past);
    expect(moveChord(VERSE, 9, 7000, SECTIONS)).toBe(VERSE);
    expect(moveChord(VERSE, 1, Number.NaN, SECTIONS)).toBe(VERSE);
  });

  it('stores the moved onset relative to its section', () => {
    const moved = moveChord(chords([0, 'I'], [25_000, 'V'], [30_000, 'vi']), 2, 33_000, SECTIONS);
    // The chorus starts at 20s, and its first chord plays from there.
    expect(toChordColumns(moved, SECTIONS)[1]).toEqual({
      progression_roman: ['V', 'vi'],
      chord_timings: [0, 13_000],
    });
  });
});
