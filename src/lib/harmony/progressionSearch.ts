/**
 * Chord-progression search matching.
 *
 * Roman-numeral case is musically meaningful here (I = major tonic, i = minor
 * tonic), so unlike a text search this never case-folds the input - "vi" and
 * "VI" are different chords and must stay different.
 */

/**
 * Split a typed query like "vi-IV-I-V", "vi, IV, I, V" or "vi I IV V" into
 * individual chord tokens. Dashes, commas and whitespace are all accepted
 * separators, so none of them are actually required.
 */
export function parseProgressionQuery(query: string): string[] {
  return query
    .trim()
    .split(/[-–—,\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Does `progression` contain `query` as a contiguous run of chords, in order?
 *
 * A progression loops, so a query that spans the seam - the last chord
 * followed by the first - is still a real match (e.g. querying "IV I" against
 * the loop [I, V, vi, IV] should match: IV is immediately followed by I when
 * the loop repeats). Checked by searching within the progression doubled,
 * restricting the start index to the original length so a match isn't
 * artificially found twice.
 *
 * An empty query matches everything (no filter applied yet); a query longer
 * than the progression itself cannot match a shorter loop.
 */
export function progressionContainsSequence(progression: string[], query: string[]): boolean {
  if (query.length === 0) return true;
  if (query.length > progression.length) return false;

  const doubled = [...progression, ...progression];
  for (let start = 0; start < progression.length; start++) {
    let matched = true;
    for (let i = 0; i < query.length; i++) {
      if (doubled[start + i] !== query[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}
