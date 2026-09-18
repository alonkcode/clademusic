import { describe, it, expect } from 'vitest';
import {
  addBoundary,
  draftFromSections,
  draftProblem,
  emptyDraft,
  MIN_SECTION_MS,
  moveBoundary,
  removeBoundary,
  setLabel,
  toSections,
  type SectionMarker,
} from './sectionDraft';

const DURATION = 200_000;

const draft = (...markers: Array<[number, string]>): SectionMarker[] =>
  markers.map(([startMs, label]) => ({ startMs, label: label as SectionMarker['label'] }));

describe('emptyDraft', () => {
  it('covers the track from the very start', () => {
    expect(emptyDraft()).toEqual([{ startMs: 0, label: 'intro' }]);
  });
});

describe('draftFromSections', () => {
  it('turns saved sections back into boundaries', () => {
    const got = draftFromSections([
      { label: 'verse', start_ms: 8000 },
      { label: 'intro', start_ms: 0 },
      { label: 'chorus', start_ms: 40000 },
    ]);
    expect(got).toEqual(draft([0, 'intro'], [8000, 'verse'], [40000, 'chorus']));
  });

  // Otherwise the opening of the track would silently belong to nothing.
  it('pins the first boundary to zero even if the data did not', () => {
    expect(draftFromSections([{ label: 'verse', start_ms: 8000 }])[0].startMs).toBe(0);
  });

  it('ignores labels the editor cannot represent', () => {
    expect(draftFromSections([{ label: 'solo', start_ms: 0 }])).toEqual(emptyDraft());
  });

  it('falls back to a single section when there is nothing stored', () => {
    expect(draftFromSections([])).toEqual(emptyDraft());
  });
});

describe('addBoundary', () => {
  it('marks a boundary at the playhead', () => {
    const got = addBoundary(emptyDraft(), 30_000, DURATION);
    expect(got.map((m) => m.startMs)).toEqual([0, 30_000]);
  });

  it('keeps boundaries in playing order however they were marked', () => {
    let d = emptyDraft();
    d = addBoundary(d, 90_000, DURATION);
    d = addBoundary(d, 30_000, DURATION);
    expect(d.map((m) => m.startMs)).toEqual([0, 30_000, 90_000]);
  });

  it('inherits the label of the section it splits', () => {
    const d = addBoundary(draft([0, 'chorus']), 30_000, DURATION);
    expect(d[1].label).toBe('chorus');
  });

  // A double tap on the mark button is the obvious way to get this wrong.
  it('refuses a boundary on top of an existing one', () => {
    const d = addBoundary(emptyDraft(), 30_000, DURATION);
    expect(addBoundary(d, 30_000 + MIN_SECTION_MS - 1, DURATION)).toBe(d);
  });

  it('refuses a boundary at the very start of the track', () => {
    const d = emptyDraft();
    expect(addBoundary(d, 200, DURATION)).toBe(d);
  });

  it('refuses a boundary at or past the end of the track', () => {
    const d = emptyDraft();
    expect(addBoundary(d, DURATION, DURATION)).toBe(d);
    expect(addBoundary(d, DURATION + 5000, DURATION)).toBe(d);
  });

  it('rounds a fractional playhead to whole milliseconds', () => {
    expect(addBoundary(emptyDraft(), 30_000.6, DURATION)[1].startMs).toBe(30_001);
  });
});

describe('removeBoundary', () => {
  it('removes a boundary, merging its section into the one before', () => {
    const d = draft([0, 'intro'], [30_000, 'verse'], [90_000, 'chorus']);
    expect(removeBoundary(d, 1).map((m) => m.startMs)).toEqual([0, 90_000]);
  });

  it('will not remove the start of the track', () => {
    const d = draft([0, 'intro'], [30_000, 'verse']);
    expect(removeBoundary(d, 0)).toBe(d);
  });
});

describe('setLabel', () => {
  it('relabels one section without touching its neighbours', () => {
    const d = draft([0, 'intro'], [30_000, 'verse']);
    expect(setLabel(d, 1, 'chorus')).toEqual(draft([0, 'intro'], [30_000, 'chorus']));
  });
});

describe('moveBoundary', () => {
  it('nudges a boundary', () => {
    const d = draft([0, 'intro'], [30_000, 'verse'], [90_000, 'chorus']);
    expect(moveBoundary(d, 1, 35_000, DURATION)[1].startMs).toBe(35_000);
  });

  // Dragging one boundary past the next would turn a section inside out.
  it('cannot be pushed past the following boundary', () => {
    const d = draft([0, 'intro'], [30_000, 'verse'], [90_000, 'chorus']);
    expect(moveBoundary(d, 1, 200_000, DURATION)[1].startMs).toBe(90_000 - MIN_SECTION_MS);
  });

  it('cannot be pulled before the preceding boundary', () => {
    const d = draft([0, 'intro'], [30_000, 'verse'], [90_000, 'chorus']);
    expect(moveBoundary(d, 1, 0, DURATION)[1].startMs).toBe(MIN_SECTION_MS);
  });

  it('keeps the last boundary inside the track', () => {
    const d = draft([0, 'intro'], [30_000, 'verse']);
    expect(moveBoundary(d, 1, DURATION + 10_000, DURATION)[1].startMs).toBe(DURATION - MIN_SECTION_MS);
  });

  it('will not move the start of the track', () => {
    const d = draft([0, 'intro'], [30_000, 'verse']);
    expect(moveBoundary(d, 0, 5000, DURATION)).toBe(d);
  });
});

describe('toSections', () => {
  it('ends each section where the next begins, and the last at the track end', () => {
    const d = draft([0, 'intro'], [30_000, 'verse'], [90_000, 'chorus']);
    expect(toSections(d, DURATION)).toEqual([
      { label: 'intro', ordinal: 1, startMs: 0, endMs: 30_000 },
      { label: 'verse', ordinal: 1, startMs: 30_000, endMs: 90_000 },
      { label: 'chorus', ordinal: 1, startMs: 90_000, endMs: DURATION },
    ]);
  });

  it('numbers repeats so the second verse is Verse 2', () => {
    const d = draft([0, 'verse'], [30_000, 'chorus'], [60_000, 'verse'], [90_000, 'chorus']);
    expect(toSections(d, DURATION).map((s) => `${s.label} ${s.ordinal}`)).toEqual([
      'verse 1',
      'chorus 1',
      'verse 2',
      'chorus 2',
    ]);
  });

  it('leaves no gaps or overlaps between sections', () => {
    const sections = toSections(draft([0, 'intro'], [30_000, 'verse'], [90_000, 'chorus']), DURATION);
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i].startMs).toBe(sections[i - 1].endMs);
    }
  });

  it('drops a trailing boundary that the track is not long enough to contain', () => {
    const d = draft([0, 'intro'], [30_000, 'verse']);
    expect(toSections(d, 30_000).map((s) => s.label)).toEqual(['intro']);
  });
});

describe('draftProblem', () => {
  it('passes a sound draft', () => {
    expect(draftProblem(draft([0, 'intro'], [30_000, 'verse']), DURATION)).toBeNull();
  });

  it('explains that an unknown track length has no end to save against', () => {
    expect(draftProblem(emptyDraft(), 0)).toMatch(/length/i);
  });

  it('explains an empty draft', () => {
    expect(draftProblem([], DURATION)).toMatch(/at least one/i);
  });
});
