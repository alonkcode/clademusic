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
import { BadRequest, validate, type IngestPayload } from '../_shared/detectionPayload.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
