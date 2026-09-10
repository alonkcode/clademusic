/**
 * Supabase Edge Function: ingest-detection
 *
 * Stores the result of one live chord-detection capture.
 *
 * This is the ONLY write path into detection_runs and friends. The tables are
 * closed to clients by RLS on purpose, so that everything landing in them has
 * been through the validation below first - the payload is produced in a
 * browser by code anyone can edit, and what it becomes is the app's harmonic
 * data. A run is stored as evidence, not as truth: it lands with status
 * 'pending' and only becomes canonical when it is promoted after review.
 *
 * POST body: see IngestPayload.
 * Returns:   { runId, sectionCount, chordCount, deduplicated }
 */

import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SECTION_LABELS = new Set([
  'intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'outro', 'breakdown', 'drop',
]);

/**
 * Caps, so that a bad or hostile client cannot turn one request into an
 * unbounded write. A real song has tens of sections and hundreds of chords;
 * these are far above anything genuine and far below anything harmful.
 */
const MAX_SECTIONS = 64;
const MAX_CHORDS_PER_SECTION = 512;
const MAX_TOTAL_CHORDS = 2048;
const MAX_NUMERAL_LEN = 12;
/** 6 hours. Longer than any track, short enough to reject a nonsense clock. */
const MAX_TRACK_MS = 6 * 60 * 60 * 1000;

interface ChordInput {
  numeral: string;
  rootPitchClass: number;
  quality: 'major' | 'minor';
  startMs: number;
  endMs: number;
  confidence?: number | null;
}

interface SectionInput {
  label: string;
  ordinal: number;
  startMs: number;
  endMs: number;
  progressionRoman: string[];
  loopLengthBars?: number | null;
  confidence?: number | null;
  chords: ChordInput[];
}

interface IngestPayload {
  trackId: string;
  analysisVersion: string;
  key?: { tonic: number; mode: 'major' | 'minor'; confidence: number } | null;
  coveredFromMs: number;
  coveredToMs: number;
  idempotencyKey?: string;
  sections: SectionInput[];
}

class BadRequest extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

function validate(raw: unknown): IngestPayload {
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // Contributions are attributed, so an anonymous caller has nothing to
    // contribute. The user client exists only to identify the caller; every
    // write below goes through the service client.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let payload: IngestPayload;
    try {
      payload = validate(await req.json());
    } catch (err) {
      if (err instanceof BadRequest) return json({ error: err.message }, 400);
      return json({ error: 'Malformed JSON body' }, 400);
    }

    // A clean 400 beats a foreign-key 500 from deep inside the insert.
    const { data: track, error: trackError } = await service
      .from('tracks')
      .select('id')
      .eq('id', payload.trackId)
      .maybeSingle();
    if (trackError) throw trackError;
    if (!track) return json({ error: 'Unknown track' }, 400);

    // Idempotency: a client that retries an ingest it is unsure landed gets
    // the original run back rather than a duplicate of it.
    if (payload.idempotencyKey) {
      const { data: existing } = await service
        .from('detection_runs')
        .select('id')
        .eq('idempotency_key', payload.idempotencyKey)
        .maybeSingle();
      if (existing) {
        return json({ runId: existing.id, deduplicated: true }, 200);
      }
    }

    const { data: run, error: runError } = await service
      .from('detection_runs')
      .insert({
        track_id: payload.trackId,
        user_id: user.id,
        analysis_version: payload.analysisVersion,
        source: 'live-capture',
        detected_tonic: payload.key?.tonic ?? null,
        detected_mode: payload.key?.mode ?? null,
        key_confidence: payload.key?.confidence ?? null,
        covered_from_ms: payload.coveredFromMs,
        covered_to_ms: payload.coveredToMs,
        idempotency_key: payload.idempotencyKey ?? null,
        status: 'pending',
      })
      .select('id')
      .single();
    if (runError) {
      // Lost a race against a concurrent retry with the same key.
      if (runError.code === '23505' && payload.idempotencyKey) {
        const { data: raced } = await service
          .from('detection_runs')
          .select('id')
          .eq('idempotency_key', payload.idempotencyKey)
          .maybeSingle();
        if (raced) return json({ runId: raced.id, deduplicated: true }, 200);
      }
      throw runError;
    }

    const runId = run.id as string;

    // One insert for all sections, one for all chords - not one per row.
    const { data: insertedSections, error: sectionsError } = await service
      .from('detection_run_sections')
      .insert(
        payload.sections.map((s) => ({
          run_id: runId,
          label: s.label,
          ordinal: s.ordinal,
          start_ms: s.startMs,
          end_ms: s.endMs,
          progression_roman: s.progressionRoman,
          loop_length_bars: s.loopLengthBars,
          confidence: s.confidence,
        }))
      )
      .select('id, start_ms');
    if (sectionsError) {
      // The run is meaningless without its sections; don't leave a husk
      // behind for the review queue to trip over.
      await service.from('detection_runs').delete().eq('id', runId);
      throw sectionsError;
    }

    // Sections come back keyed by their start, which is unique within a run.
    const sectionIdByStart = new Map<number, string>(
      (insertedSections ?? []).map((s) => [s.start_ms as number, s.id as string])
    );

    const chordRows = payload.sections.flatMap((s) =>
      s.chords.map((c) => ({
        run_id: runId,
        section_id: sectionIdByStart.get(s.startMs) ?? null,
        numeral: c.numeral,
        root_pitch_class: c.rootPitchClass,
        quality: c.quality,
        start_ms: c.startMs,
        end_ms: c.endMs,
        confidence: c.confidence,
      }))
    );

    if (chordRows.length > 0) {
      const { error: chordsError } = await service.from('detection_run_chords').insert(chordRows);
      if (chordsError) {
        await service.from('detection_runs').delete().eq('id', runId);
        throw chordsError;
      }
    }

    return json(
      {
        runId,
        sectionCount: payload.sections.length,
        chordCount: chordRows.length,
        deduplicated: false,
      },
      201
    );
  } catch (err) {
    console.error('[ingest-detection] failed', err);
    return json({ error: 'Ingest failed' }, 500);
  }
});
