/**
 * The editing model behind marking a song's sections by ear.
 *
 * Sections tile a track end to end, so what is actually being edited is the
 * set of BOUNDARIES between them: a section's end is simply the next one's
 * start. Storing them as independent start/end pairs would let a careless
 * edit leave a gap or an overlap, and useActiveSection resolves an overlap by
 * first match - so the chips would highlight the wrong part with nothing
 * obviously wrong in the data. Keeping boundaries as the source of truth
 * makes that unrepresentable rather than merely discouraged.
 *
 * Kept free of React so the rules can be tested directly.
 */

export const SECTION_LABELS = [
  'intro',
  'verse',
  'pre-chorus',
  'chorus',
  'bridge',
  'breakdown',
  'drop',
  'outro',
] as const;

export type SectionLabel = (typeof SECTION_LABELS)[number];

/** One boundary: where a section starts, and what it is. */
export interface SectionMarker {
  startMs: number;
  label: SectionLabel;
}

export interface DraftSection {
  label: SectionLabel;
  /** Which occurrence of this label it is, in playing order. */
  ordinal: number;
  startMs: number;
  endMs: number;
}

/**
 * Sections shorter than this are almost certainly a slip - a double tap, or
 * marking a boundary that has just been marked - rather than a real part of
 * the song. Being unable to create one beats having to notice and undo it.
 */
export const MIN_SECTION_MS = 1000;

const clampInt = (value: number) => Math.max(0, Math.round(value));

/** A draft always starts at zero, so a track is fully covered from the off. */
export function emptyDraft(label: SectionLabel = 'intro'): SectionMarker[] {
  return [{ startMs: 0, label }];
}

/** Existing saved sections back into an editable draft. */
export function draftFromSections(
  sections: Array<{ label: string; start_ms: number }>
): SectionMarker[] {
  const markers = sections
    .filter((s) => (SECTION_LABELS as readonly string[]).includes(s.label))
    .map((s) => ({ startMs: clampInt(s.start_ms), label: s.label as SectionLabel }))
    .sort((a, b) => a.startMs - b.startMs);

  if (markers.length === 0) return emptyDraft();
  // Whatever the stored data said, the first section owns the start of the
  // track: a draft that began at 8s would silently drop the first 8 seconds.
  markers[0] = { ...markers[0], startMs: 0 };
  return markers;
}

/**
 * Mark a boundary at the playhead.
 *
 * Refuses rather than crowds: too close to an existing boundary, at or past
 * the end of the track, and the draft comes back unchanged. The new section
 * inherits the label of the one it split, because the listener is usually
 * about to say what it is and a wrong guess is no better than a repeat.
 */
export function addBoundary(
  draft: SectionMarker[],
  atMs: number,
  durationMs: number
): SectionMarker[] {
  const at = clampInt(atMs);
  if (!Number.isFinite(at) || at < MIN_SECTION_MS) return draft;
  if (durationMs > 0 && at > durationMs - MIN_SECTION_MS) return draft;
  if (draft.some((m) => Math.abs(m.startMs - at) < MIN_SECTION_MS)) return draft;

  const previous = [...draft].reverse().find((m) => m.startMs < at);
  const inserted: SectionMarker = { startMs: at, label: previous?.label ?? 'verse' };
  return [...draft, inserted].sort((a, b) => a.startMs - b.startMs);
}

/** Remove a boundary. The first one is the start of the track and stays. */
export function removeBoundary(draft: SectionMarker[], index: number): SectionMarker[] {
  if (index <= 0 || index >= draft.length) return draft;
  return draft.filter((_, i) => i !== index);
}

export function setLabel(
  draft: SectionMarker[],
  index: number,
  label: SectionLabel
): SectionMarker[] {
  if (index < 0 || index >= draft.length) return draft;
  return draft.map((m, i) => (i === index ? { ...m, label } : m));
}

/**
 * Nudge a boundary, kept inside its neighbours so the order can never invert
 * - dragging one past the next would otherwise turn a section inside out.
 * The first boundary is pinned to the start of the track.
 */
export function moveBoundary(
  draft: SectionMarker[],
  index: number,
  toMs: number,
  durationMs: number
): SectionMarker[] {
  if (index <= 0 || index >= draft.length) return draft;

  const lowerBound = draft[index - 1].startMs + MIN_SECTION_MS;
  const upperBound =
    index + 1 < draft.length
      ? draft[index + 1].startMs - MIN_SECTION_MS
      : (durationMs > 0 ? durationMs : Number.MAX_SAFE_INTEGER) - MIN_SECTION_MS;

  if (upperBound < lowerBound) return draft;
  const next = Math.min(Math.max(clampInt(toMs), lowerBound), upperBound);
  return draft.map((m, i) => (i === index ? { ...m, startMs: next } : m));
}

/**
 * Turn boundaries into the sections that get stored: each ends where the next
 * begins, the last at the end of the track, and each labelled with which
 * occurrence it is so "Verse 2" means the second verse.
 */
export function toSections(draft: SectionMarker[], durationMs: number): DraftSection[] {
  const ordered = [...draft].sort((a, b) => a.startMs - b.startMs);
  const end = durationMs > 0 ? clampInt(durationMs) : 0;
  const seen = new Map<SectionLabel, number>();

  return ordered
    .map((marker, i) => {
      const endMs = i + 1 < ordered.length ? ordered[i + 1].startMs : end;
      return { label: marker.label, startMs: marker.startMs, endMs };
    })
    .filter((s) => s.endMs > s.startMs)
    .map((s) => {
      const ordinal = (seen.get(s.label) ?? 0) + 1;
      seen.set(s.label, ordinal);
      return { ...s, ordinal };
    });
}

/** Why this draft cannot be saved yet, or null when it can. */
export function draftProblem(draft: SectionMarker[], durationMs: number): string | null {
  if (durationMs <= 0) {
    return "The player hasn't reported this track's length yet, so the last section has no end.";
  }
  const sections = toSections(draft, durationMs);
  if (sections.length === 0) return 'Mark at least one section before saving.';
  if (sections.some((s) => s.endMs - s.startMs < MIN_SECTION_MS)) {
    return 'One section is shorter than a second.';
  }
  return null;
}
