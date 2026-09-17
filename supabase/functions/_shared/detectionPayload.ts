/**
 * Validation for the ingest-detection payload, kept free of Deno APIs and
 * remote imports so that it can be imported by the edge function AND by the
 * client test suite.
 *
 * That second import is the point. The browser builds this payload
 * (src/api/detectionRuns.ts) and the server validates it; if the two ever
 * disagree, every Save fails in production with nothing in the unit tests to
 * say so. A test that feeds the real builder's output through this real
 * validator pins the contract between them.
 */

export const SECTION_LABELS = new Set([
  'intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'outro', 'breakdown', 'drop',
]);

/**
 * Caps, so that a bad or hostile client cannot turn one request into an
 * unbounded write. A real song has tens of sections and hundreds of chords;
 * these are far above anything genuine and far below anything harmful.
 */
export const MAX_SECTIONS = 64;
export const MAX_CHORDS_PER_SECTION = 512;
export const MAX_TOTAL_CHORDS = 2048;
export const MAX_NUMERAL_LEN = 12;
/** 6 hours. Longer than any track, short enough to reject a nonsense clock. */
export const MAX_TRACK_MS = 6 * 60 * 60 * 1000;

export interface ChordInput {
  numeral: string;
  rootPitchClass: number;
  quality: 'major' | 'minor';
  startMs: number;
  endMs: number;
  confidence?: number | null;
}

export interface SectionInput {
  label: string;
  ordinal: number;
  startMs: number;
  endMs: number;
  progressionRoman: string[];
  loopLengthBars?: number | null;
  confidence?: number | null;
  chords: ChordInput[];
}

export interface IngestPayload {
  trackId: string;
  analysisVersion: string;
  key?: { tonic: number; mode: 'major' | 'minor'; confidence: number } | null;
  coveredFromMs: number;
  coveredToMs: number;
  idempotencyKey?: string;
  sections: SectionInput[];
}

export class BadRequest extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function intInRange(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new BadRequest(`${field} must be an integer`);
  }
  if (value < min || value > max) throw new BadRequest(`${field} must be between ${min} and ${max}`);
  return value;
}

/** Confidences are optional everywhere; absent is different from zero. */
function optionalUnitInterval(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new BadRequest(`${field} must be between 0 and 1`);
  }
  // The column is numeric(4,3); rounding here rather than letting Postgres
  // reject a long float keeps the error surface in one place.
  return Math.round(value * 1000) / 1000;
}

export function validate(raw: unknown): IngestPayload {
  if (!raw || typeof raw !== 'object') throw new BadRequest('body must be a JSON object');
  const body = raw as Record<string, unknown>;

  const trackId = body.trackId;
  if (typeof trackId !== 'string' || !UUID_RE.test(trackId)) {
    throw new BadRequest('trackId must be a uuid');
  }

  const analysisVersion = body.analysisVersion;
  if (typeof analysisVersion !== 'string' || !analysisVersion || analysisVersion.length > 32) {
    throw new BadRequest('analysisVersion must be a short non-empty string');
  }

  const coveredFromMs = intInRange(body.coveredFromMs, 0, MAX_TRACK_MS, 'coveredFromMs');
  const coveredToMs = intInRange(body.coveredToMs, 0, MAX_TRACK_MS, 'coveredToMs');
  if (coveredToMs <= coveredFromMs) throw new BadRequest('coveredToMs must be after coveredFromMs');

  let key: IngestPayload['key'] = null;
  if (body.key !== undefined && body.key !== null) {
    const k = body.key as Record<string, unknown>;
    if (k.mode !== 'major' && k.mode !== 'minor') throw new BadRequest('key.mode must be major or minor');
    key = {
      tonic: intInRange(k.tonic, 0, 11, 'key.tonic'),
      mode: k.mode,
      confidence: optionalUnitInterval(k.confidence, 'key.confidence') ?? 0,
    };
  }

  const idempotencyKey =
    typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0
      ? body.idempotencyKey.slice(0, 128)
      : undefined;

  if (!Array.isArray(body.sections)) throw new BadRequest('sections must be an array');
  if (body.sections.length === 0) throw new BadRequest('sections must not be empty');
  if (body.sections.length > MAX_SECTIONS) {
    throw new BadRequest(`sections must contain at most ${MAX_SECTIONS} entries`);
  }

  let totalChords = 0;
  let previousEnd = -1;

  const sections: SectionInput[] = (body.sections as unknown[]).map((rawSection, i) => {
    if (!rawSection || typeof rawSection !== 'object') {
      throw new BadRequest(`sections[${i}] must be an object`);
    }
    const s = rawSection as Record<string, unknown>;

    if (typeof s.label !== 'string' || !SECTION_LABELS.has(s.label)) {
      throw new BadRequest(`sections[${i}].label is not a known section type`);
    }
    const ordinal = intInRange(s.ordinal ?? 1, 1, 99, `sections[${i}].ordinal`);
    const startMs = intInRange(s.startMs, 0, MAX_TRACK_MS, `sections[${i}].startMs`);
    const endMs = intInRange(s.endMs, 0, MAX_TRACK_MS, `sections[${i}].endMs`);
    if (endMs <= startMs) throw new BadRequest(`sections[${i}] must end after it starts`);

    // Sections describe one timeline, so they must arrive in order and must
    // not overlap. Anything else is a client bug, and storing it would put
    // a track into a state the section-seek UI cannot render.
    if (startMs < previousEnd) throw new BadRequest(`sections[${i}] overlaps the previous section`);
    previousEnd = endMs;

    if (!Array.isArray(s.progressionRoman)) {
      throw new BadRequest(`sections[${i}].progressionRoman must be an array`);
    }
    const progressionRoman = (s.progressionRoman as unknown[]).map((n, j) => {
      if (typeof n !== 'string' || !n || n.length > MAX_NUMERAL_LEN) {
        throw new BadRequest(`sections[${i}].progressionRoman[${j}] is not a numeral`);
      }
      return n;
    });

    if (!Array.isArray(s.chords)) throw new BadRequest(`sections[${i}].chords must be an array`);
    if (s.chords.length > MAX_CHORDS_PER_SECTION) {
      throw new BadRequest(`sections[${i}].chords exceeds ${MAX_CHORDS_PER_SECTION}`);
    }
    totalChords += s.chords.length;
    if (totalChords > MAX_TOTAL_CHORDS) throw new BadRequest(`too many chords in one run`);

    let previousChordEnd = -1;
    const chords: ChordInput[] = (s.chords as unknown[]).map((rawChord, j) => {
      if (!rawChord || typeof rawChord !== 'object') {
        throw new BadRequest(`sections[${i}].chords[${j}] must be an object`);
      }
      const c = rawChord as Record<string, unknown>;
      if (typeof c.numeral !== 'string' || !c.numeral || c.numeral.length > MAX_NUMERAL_LEN) {
        throw new BadRequest(`sections[${i}].chords[${j}].numeral is not a numeral`);
      }
      if (c.quality !== 'major' && c.quality !== 'minor') {
        throw new BadRequest(`sections[${i}].chords[${j}].quality must be major or minor`);
      }
      const cStart = intInRange(c.startMs, 0, MAX_TRACK_MS, `sections[${i}].chords[${j}].startMs`);
      const cEnd = intInRange(c.endMs, 0, MAX_TRACK_MS, `sections[${i}].chords[${j}].endMs`);
      if (cEnd <= cStart) throw new BadRequest(`sections[${i}].chords[${j}] must end after it starts`);
      if (cStart < previousChordEnd) {
        throw new BadRequest(`sections[${i}].chords[${j}] overlaps the previous chord`);
      }
      previousChordEnd = cEnd;

      return {
        numeral: c.numeral,
        rootPitchClass: intInRange(c.rootPitchClass, 0, 11, `sections[${i}].chords[${j}].rootPitchClass`),
        quality: c.quality,
        startMs: cStart,
        endMs: cEnd,
        confidence: optionalUnitInterval(c.confidence, `sections[${i}].chords[${j}].confidence`),
      };
    });

    return {
      label: s.label,
      ordinal,
      startMs,
      endMs,
      progressionRoman,
      loopLengthBars:
        s.loopLengthBars === undefined || s.loopLengthBars === null
          ? null
          : intInRange(s.loopLengthBars, 1, 64, `sections[${i}].loopLengthBars`),
      confidence: optionalUnitInterval(s.confidence, `sections[${i}].confidence`),
      chords,
    };
  });

  return {
    trackId,
    analysisVersion,
    key,
    coveredFromMs,
    coveredToMs,
    idempotencyKey,
    sections,
  };
}
