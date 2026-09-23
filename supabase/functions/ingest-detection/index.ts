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
 * 'pending'. It becomes canonical either when an admin promotes it after
 * review, or - for a track with NO existing analysis - straight away, if it
 * clears the thresholds in _shared/autoPromotion.ts. The database, not this
 * function, refuses to overwrite an analysis that already exists.
 *
 * A capture may name its track by UUID, or by provider id (`trackRef`) when
 * the catalog has never seen it; in that case the row is found or created
 * here, server-side, so a client can never write to `tracks` itself.
 *
 * POST body: see IngestPayload.
 * Returns:   { runId, trackId, sectionCount, chordCount, deduplicated,
 *              promoted, reason }
 */

import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';
import { corsHeaders } from '../_shared/cors.ts';
import { BadRequest, validate, type IngestPayload } from '../_shared/detectionPayload.ts';
import { evaluateAutoPromotion } from '../_shared/autoPromotion.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * A ceiling on captures per person per day. A real listener analyses a handful
 * of tracks; the point is that a valid trackRef makes this function create a
 * catalog row, and that must not be a free way to fill the table.
 */
const MAX_RUNS_PER_USER_PER_DAY = 30;

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

    // Idempotency first: a client that retries an ingest it is unsure landed
    // gets the original run back rather than a duplicate of it - before the
    // rate limit, so a retry is never punished for the run it already made.
    if (payload.idempotencyKey) {
      const { data: existing } = await service
        .from('detection_runs')
        .select('id, track_id, status')
        .eq('idempotency_key', payload.idempotencyKey)
        .maybeSingle();
      if (existing) {
        return json(
          {
            runId: existing.id,
            trackId: existing.track_id,
            deduplicated: true,
            promoted: existing.status === 'promoted',
            reason: existing.status === 'promoted' ? 'promoted' : 'run_not_pending',
          },
          200
        );
      }
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentRuns, error: countError } = await service
      .from('detection_runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);
    if (countError) throw countError;
    if ((recentRuns ?? 0) >= MAX_RUNS_PER_USER_PER_DAY) {
      return json({ error: 'Daily analysis limit reached. Try again tomorrow.' }, 429);
    }

    // Which catalog row is this about? A real UUID that exists wins. Anything
    // else - no id at all, or a seed id that was never a row - is resolved (and
    // created if the catalog has never seen it) from the provider reference.
    // A clean 400 beats a foreign-key 500 from deep inside the insert.
    let trackId: string | null = null;
    let trackDurationMs: number | null = payload.trackRef?.durationMs ?? null;

    if (payload.trackId) {
      const { data: track, error: trackError } = await service
        .from('tracks')
        .select('id, duration_ms')
        .eq('id', payload.trackId)
        .maybeSingle();
      if (trackError) throw trackError;
      if (track) {
        trackId = track.id as string;
        trackDurationMs = (track.duration_ms as number | null) ?? trackDurationMs;
      }
    }

    if (!trackId) {
      if (!payload.trackRef) return json({ error: 'Unknown track' }, 400);
      const ref = payload.trackRef;
      const { data: resolvedId, error: resolveError } = await service.rpc('resolve_or_create_track', {
        p_provider: ref.provider,
        p_provider_id: ref.providerTrackId,
        p_title: ref.title,
        p_artist: ref.artist,
        p_album: ref.album ?? null,
        p_duration_ms: ref.durationMs ?? null,
        p_isrc: ref.isrc ?? null,
      });
      if (resolveError || !resolvedId) throw resolveError ?? new Error('resolve_or_create_track returned nothing');
      trackId = resolvedId as string;

      const { data: resolved } = await service
        .from('tracks')
        .select('duration_ms')
        .eq('id', trackId)
        .maybeSingle();
      trackDurationMs = (resolved?.duration_ms as number | null) ?? trackDurationMs;
    }

    const { data: run, error: runError } = await service
      .from('detection_runs')
      .insert({
        track_id: trackId,
        user_id: user.id,
        analysis_version: payload.analysisVersion,
        source: 'live-capture',
        detected_tonic: payload.key?.tonic ?? null,
        detected_mode: payload.key?.mode ?? null,
        key_confidence: payload.key?.confidence ?? null,
        tempo_bpm: payload.tempo?.bpm ?? null,
        tempo_confidence: payload.tempo?.confidence ?? null,
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
          .select('id, track_id, status')
          .eq('idempotency_key', payload.idempotencyKey)
          .maybeSingle();
        if (raced) {
          return json(
            {
              runId: raced.id,
              trackId: raced.track_id,
              deduplicated: true,
              promoted: raced.status === 'promoted',
              reason: raced.status === 'promoted' ? 'promoted' : 'run_not_pending',
            },
            200
          );
        }
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
          // The payload field keeps its name because the deployed client
          // already sends it; the column was renamed to say what it holds.
          loop_roman: s.progressionRoman,
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

    // The run is safely stored as evidence; from here on nothing can lose it.
    // Ask for it to become canonical only if it is good enough on its own
    // terms. The database has the final word: a track that already has an
    // analysis answers 'already_analysed' and the run simply stays pending for
    // the ordinary admin review.
    let promoted = false;
    let reason: string = 'promoted';
    const verdict = evaluateAutoPromotion(payload, trackDurationMs);
    if (!verdict.ok) {
      reason = verdict.reason;
    } else {
      const { data: outcome, error: promoteError } = await service.rpc('auto_promote_detection_run', {
        p_run_id: runId,
      });
      if (promoteError) {
        // Not fatal: the evidence is stored, and an admin can still promote it.
        console.error('[ingest-detection] auto-promote failed', promoteError);
        reason = 'promotion_error';
      } else {
        const row = Array.isArray(outcome) ? outcome[0] : outcome;
        promoted = Boolean(row?.promoted);
        reason = (row?.reason as string | undefined) ?? (promoted ? 'promoted' : 'unknown');
      }
    }

    return json(
      {
        runId,
        trackId,
        sectionCount: payload.sections.length,
        chordCount: chordRows.length,
        deduplicated: false,
        promoted,
        reason,
      },
      201
    );
  } catch (err) {
    console.error('[ingest-detection] failed', err);
    return json({ error: 'Ingest failed' }, 500);
  }
});
