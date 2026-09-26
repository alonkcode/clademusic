/**
 * The editing model behind marking a song's chords by ear, alongside its
 * sections (see sectionDraft.ts).
 *
 * Chords are one flat, time-ordered list of onsets in TRACK time, not lists
 * nested inside sections. A chord's place in the song is a fact about the audio;
 * which section it belongs to is only a consequence of where the boundaries
 * are. Keeping the onsets absolute means moving a boundary can never drag a
 * chord onto the wrong part of the song - the chord stays where it was heard
 * and simply belongs to whichever section now contains it. That is the same
 * reason sections are edited as boundaries rather than start/end pairs.
 *
 * A chord holds until the next chord in its section, or until the section
 * ends. The first chord of a section always plays from the section's start:
 * chordIndexAt already treats "before the first timestamp" as chord 0, so that
 * is what a listener hears, and the editor shows the same thing rather than a
 * gap that does not exist.
 *
 * Kept free of React so the rules can be tested directly.
 */

import { scaleFor, toRomanNumeral } from './keyEstimation';
import type { DraftSection } from './sectionDraft';

/** One chord: where it starts in the track, and what it is (a Roman numeral). */
export interface ChordMarker {
  startMs: number;
  numeral: string;
}

/** A chord as it plays: onset, and the moment it gives way to the next one. */
export interface ChordSpan {
  /** Position in the flat chord list, which is what every edit addresses. */
  index: number;
  numeral: string;
  startMs: number;
  endMs: number;
}

/**
 * Chords closer together than this are almost certainly a slip - a double tap -
 * rather than a real change. Shorter than a beat at any usual tempo, so a
 * half-bar chord in a fast song is still possible.
 */
export const MIN_CHORD_MS = 250;

const clampInt = (value: number) => Math.max(0, Math.round(value));

/** Stored section as far as chords are concerned. */
export interface SectionChordSource {
  start_ms: number;
  end_ms?: number;
  chords?: string[] | null;
  /** Onsets in ms from the section's own start, one per chord. */
  chord_timings?: number[] | null;
}

/**
 * Saved sections' chords back into an editable list.
 *
 * Timings are honoured only when there is exactly one per chord, as the
 * database itself insists and chordIndexAt already assumes. A section with
 * chords but no usable timings (only possible for rows written by hand) has
 * none to honour, so its chords are spread evenly across it once each - a
 * visible starting point to correct, rather than silently dropping them.
 */
export function draftChordsFromSections(sections: SectionChordSource[]): ChordMarker[] {
  const markers: ChordMarker[] = [];

  for (const section of sections) {
    const numerals = (section.chords ?? []).map((n) => String(n).trim());
    if (numerals.length === 0 || numerals.some((n) => n === '')) continue;

    const start = clampInt(section.start_ms);
    const end = typeof section.end_ms === 'number' && section.end_ms > start ? section.end_ms : null;
    const timings = section.chord_timings ?? [];
    const timed =
      timings.length === numerals.length && timings.every((t) => Number.isFinite(t) && t >= 0);

    numerals.forEach((numeral, i) => {
      let startMs: number;
      if (timed) startMs = start + clampInt(timings[i]);
      else if (end !== null) startMs = start + Math.round((i * (end - start)) / numerals.length);
      else return;
      // A timing past the section's own end belongs to nothing it describes.
      if (end !== null && startMs >= end) return;
      markers.push({ startMs, numeral });
    });
  }

  markers.sort((a, b) => a.startMs - b.startMs);
  // Two chords at the same instant cannot both sound; keep the first.
  return markers.filter((m, i) => i === 0 || m.startMs !== markers[i - 1].startMs);
}

/**
 * The chords inside each section, as they play. Sections that hold no chord
 * get an empty list, and a chord past the last section's end belongs to none.
 */
export function chordSpansBySection(chords: ChordMarker[], sections: DraftSection[]): ChordSpan[][] {
  return sections.map((section) => {
    const inside: Array<{ index: number; marker: ChordMarker }> = [];
    chords.forEach((marker, index) => {
      if (marker.startMs >= section.startMs && marker.startMs < section.endMs) {
        inside.push({ index, marker });
      }
    });
    return inside.map(({ index, marker }, i) => ({
      index,
      numeral: marker.numeral,
      startMs: i === 0 ? section.startMs : marker.startMs,
      endMs: i + 1 < inside.length ? inside[i + 1].marker.startMs : section.endMs,
    }));
  });
}

/**
 * What gets stored for each section: numerals and onsets relative to the
 * section's own start, which is what useSectionSync subtracts before comparing.
 * The two arrays are always the same length - the table's CHECK requires it.
 */
export function toChordColumns(
  chords: ChordMarker[],
  sections: DraftSection[]
): Array<{ progression_roman: string[]; chord_timings: number[] }> {
  return chordSpansBySection(chords, sections).map((spans, i) => ({
    progression_roman: spans.map((s) => s.numeral),
    chord_timings: spans.map((s) => s.startMs - sections[i].startMs),
  }));
}

/**
 * Make each section's first chord begin exactly where the section does.
 *
 * It already plays from there, so this changes nothing anyone hears - but an
 * edit measures from a chord's onset, and a stale one would put a new chord's
 * neighbour in the wrong place: adding at 0:21 to a section whose first chord
 * is stored at 0:22.5 would hand the section's opening seconds to the new chord
 * instead of the one that was sounding.
 */
function anchorFirstChords(chords: ChordMarker[], sections: DraftSection[]): ChordMarker[] {
  const anchored = chords.slice();
  for (const spans of chordSpansBySection(chords, sections)) {
    if (spans.length === 0) continue;
    const first = spans[0];
    anchored[first.index] = { ...anchored[first.index], startMs: first.startMs };
  }
  return anchored;
}

const inOrder = (chords: ChordMarker[]) => chords.sort((a, b) => a.startMs - b.startMs);

/**
 * Add a chord at the playhead.
 *
 * Refuses rather than crowds, like addBoundary: outside every section, or so
 * close to a neighbouring chord that either side would be a sliver, and the
 * list comes back unchanged. The new chord repeats the one it splits - the
 * listener is about to say what it is, and a wrong guess is no better than a
 * repeat. A section with no chords yet gets its first one, which covers the
 * whole section by definition and so starts at the section's start.
 */
export function addChord(
  chords: ChordMarker[],
  atMs: number,
  sections: DraftSection[],
  fallbackNumeral = 'I'
): ChordMarker[] {
  const at = clampInt(atMs);
  const sectionIndex = sections.findIndex((s) => at >= s.startMs && at < s.endMs);
  if (!Number.isFinite(at) || sectionIndex < 0) return chords;

  const spans = chordSpansBySection(chords, sections)[sectionIndex];
  if (spans.length === 0) {
    return inOrder([...chords, { startMs: sections[sectionIndex].startMs, numeral: fallbackNumeral }]);
  }

  const sounding = spans.find((s) => at >= s.startMs && at < s.endMs);
  if (!sounding) return chords;
  if (at - sounding.startMs < MIN_CHORD_MS || sounding.endMs - at < MIN_CHORD_MS) return chords;

  return inOrder([...anchorFirstChords(chords, sections), { startMs: at, numeral: sounding.numeral }]);
}

/**
 * Split one chord into two of equal length - a bar into two half bars. Both
 * halves keep the numeral; changing the second is a separate replace, which is
 * what splitting a bar into two different chords actually is.
 */
export function splitChord(
  chords: ChordMarker[],
  index: number,
  sections: DraftSection[]
): ChordMarker[] {
  const span = chordSpansBySection(chords, sections)
    .flat()
    .find((s) => s.index === index);
  if (!span) return chords;

  const midpoint = Math.round((span.startMs + span.endMs) / 2);
  if (midpoint - span.startMs < MIN_CHORD_MS || span.endMs - midpoint < MIN_CHORD_MS) return chords;

  return inOrder([...anchorFirstChords(chords, sections), { startMs: midpoint, numeral: span.numeral }]);
}

/** Change what a chord is, leaving when it happens alone. */
export function replaceChord(chords: ChordMarker[], index: number, numeral: string): ChordMarker[] {
  if (index < 0 || index >= chords.length || numeral.trim() === '') return chords;
  return chords.map((c, i) => (i === index ? { ...c, numeral } : c));
}

/** Remove a chord. Its neighbour before it holds on through the freed time. */
export function removeChord(chords: ChordMarker[], index: number): ChordMarker[] {
  if (index < 0 || index >= chords.length) return chords;
  return chords.filter((_, i) => i !== index);
}

export interface ChordChoice {
  numeral: string;
  /** A triad the key's own scale produces, as opposed to a borrowed one. */
  inKey: boolean;
}

/**
 * Every major and minor triad on the twelve roots, spelled the way detection
 * spells them (so a replaced chord reads like a detected one), with the key's
 * own diatonic triads first.
 */
export function chordChoices(mode: 'major' | 'minor'): ChordChoice[] {
  const scale = scaleFor(mode);
  const key = { tonic: 0, mode };
  const choices: ChordChoice[] = [];

  for (let offset = 0; offset < 12; offset++) {
    const degree = scale.indexOf(offset);
    const above = (steps: number) => (scale[(degree + steps) % scale.length] - offset + 12) % 12;
    for (const quality of ['major', 'minor'] as const) {
      const inKey =
        degree >= 0 && above(4) === 7 && above(2) === (quality === 'major' ? 4 : 3);
      choices.push({ numeral: toRomanNumeral({ root: offset, quality }, key), inKey });
    }
  }

  // Array.prototype.sort is stable, so each group stays in order of pitch.
  return choices.sort((a, b) => Number(b.inKey) - Number(a.inKey));
}
