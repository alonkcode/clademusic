/**
 * Detection Runs API
 *
 * Sends the result of a live capture to the server, where it is stored as one
 * `detection_run` - raw evidence about a track, pending review.
 *
 * The tables behind this are closed to clients by RLS, so this necessarily
 * goes through the ingest-detection edge function rather than a direct
 * insert. The payload builder is kept pure and separate from the call so the
 * mapping - which is where the real complexity is - can be tested without a
 * network or a database.
 */

import { supabase } from '@/integrations/supabase/client';
import type { ChordSpan, SectionProgression } from '@/lib/harmony/chordTimeline';
import { toRomanNumeral, toRomanProgression, type KeyEstimate } from '@/lib/harmony/keyEstimation';
import { AUTO_PROMOTION } from '@/lib/harmony/autoPromotion';

/** Bumped whenever the detection pipeline changes shape enough to invalidate
 *  older runs. Stored on every run so they can be found and re-derived. */
export const DETECTION_ANALYSIS_VERSION = '1.0.0';

export interface DetectionChordPayload {
  numeral: string;
  rootPitchClass: number;
  quality: 'major' | 'minor';
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface DetectionSectionPayload {
  label: string;
  ordinal: number;
  startMs: number;
  endMs: number;
  progressionRoman: string[];
  loopLengthBars: number | null;
  confidence: number | null;
  chords: DetectionChordPayload[];
}

/**
 * How the server finds - or creates - the catalog row for a track the player
 * only holds a provider id for. See TrackRefInput in the ingest validator.
 */
export interface DetectionTrackRef {
  provider: 'spotify' | 'youtube';
  providerTrackId: string;
  title: string;
  artist: string;
  album?: string | null;
  durationMs?: number | null;
  isrc?: string | null;
}

export interface DetectionTempo {
  bpm: number;
  confidence: number;
}

export interface DetectionRunPayload {
  /** Omitted for a track with no catalog row yet; `trackRef` identifies it instead. */
  trackId?: string;
  trackRef?: DetectionTrackRef;
  analysisVersion: string;
  key: { tonic: number; mode: 'major' | 'minor'; confidence: number } | null;
  tempo?: DetectionTempo;
  coveredFromMs: number;
  coveredToMs: number;
  idempotencyKey: string;
  sections: DetectionSectionPayload[];
}

export interface IngestResult {
  runId: string;
  /** The catalog row the capture was attached to - created by the server if it was new. */
  trackId?: string;
  sectionCount?: number;
  chordCount?: number;
  deduplicated?: boolean;
  /** True when the capture became the track's saved analysis. */
  promoted?: boolean;
  /** Why not, when it did not: a policy shortfall or 'already_analysed'. */
  reason?: string;
}

const toMs = (sec: number) => Math.max(0, Math.round(sec * 1000));

/**
 * How many 4/4 bars one cycle of a section's loop lasts, from the tempo.
 *
 * Only answered when the section really does repeat (two full cycles) and the
 * measured cycle lands near a whole number of bars: a loop that comes out at
 * 3.6 bars is a sign the tempo or the loop is wrong, and storing a rounded
 * guess would be worse than storing nothing. The median cycle is used so one
 * stretched or clipped repeat cannot move the answer.
 */
export function estimateLoopBars(chords: ChordSpan[], loopLength: number, bpm: number): number | null {
  if (!Number.isFinite(bpm) || bpm <= 0 || loopLength < 1) return null;
  const cycles = Math.floor(chords.length / loopLength);
  if (cycles < 2) return null;

  const durations: number[] = [];
  for (let k = 0; k < cycles; k++) {
    const first = chords[k * loopLength];
    const last = chords[(k + 1) * loopLength - 1];
    durations.push(last.endSec - first.startSec);
  }
  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const cycleSec = durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;

  const bars = (cycleSec * bpm) / 240;
  const rounded = Math.round(bars);
  if (rounded < 1 || rounded > 64 || Math.abs(bars - rounded) > 0.25) return null;
  return rounded;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Map a finished capture into the shape the ingest function accepts.
 *
 * Returns null when there is nothing worth sending. A run without a key is
 * one of those cases and not an edge case worth forcing through: every
 * numeral stored is relative to the key, so without one there is nothing to
 * write that the rest of the app could read back.
 *
 * `idempotencyKey` is generated here but is meant to be held by the caller
 * and reused when retrying, so a request that may or may not have landed can
 * be sent again safely.
 */
export function buildDetectionRunPayload(args: {
  /** A real catalog UUID, when the track has one. */
  trackId?: string;
  /** Identifies the track when there is no catalog row (or none the client can trust). */
  trackRef?: DetectionTrackRef | null;
  sectionProgressions: SectionProgression[];
  detectedKey: KeyEstimate | null;
  /** Measured BPM. Sent as evidence when present; used for loop lengths only when confident. */
  tempo?: DetectionTempo | null;
  analysisVersion?: string;
  idempotencyKey?: string;
}): DetectionRunPayload | null {
  const { trackId, trackRef, sectionProgressions, detectedKey } = args;
  if ((!trackId && !trackRef) || !detectedKey || sectionProgressions.length === 0) return null;

  const tempo =
    args.tempo && Number.isFinite(args.tempo.bpm) && args.tempo.bpm >= 40 && args.tempo.bpm <= 240
      ? {
          bpm: Math.round(args.tempo.bpm * 10) / 10,
          confidence: Math.round(Math.min(1, Math.max(0, args.tempo.confidence)) * 1000) / 1000,
        }
      : null;
  const trustedBpm = tempo && tempo.confidence >= AUTO_PROMOTION.MIN_TEMPO_CONFIDENCE ? tempo.bpm : null;

  // Anything that rounds to zero whole milliseconds is dropped, not stretched.
  //
  // This used to bump such a span's end forward by 1ms so it would pass the
  // server's end-after-start check - but the next span starts at that same
  // millisecond, so the bump made the two overlap, and the server rejects an
  // entire run over one overlap. A chord clipped at a section edge can easily
  // be a sub-millisecond sliver, so that failed real Saves. Dropping is also
  // simply correct: nothing audible happens in less than a millisecond.
  //
  // With the stretch gone, overlap is impossible: the source spans never
  // overlap, and rounding is monotonic, so one span's end can never round
  // past the next one's start.
  const ordered = [...sectionProgressions]
    .sort((a, b) => a.section.startSec - b.section.startSec)
    .map((sp) => ({ sp, startMs: toMs(sp.section.startSec), endMs: toMs(sp.section.endSec) }))
    .filter(({ startMs, endMs }) => endMs > startMs);

  // "Verse 1", "Verse 2": which occurrence of this label it is, counted in
  // playing order. Derived here rather than parsed out of the display label,
  // which is text meant for a human - and counted after dropping, so the
  // numbering has no gaps.
  const seen = new Map<string, number>();

  const sections = ordered.map(({ sp, startMs, endMs }) => {
    const label = sp.section.type;
    const ordinal = (seen.get(label) ?? 0) + 1;
    seen.set(label, ordinal);

    const chords = sp.chords
      .map((c) => ({
        numeral: toRomanNumeral(c, detectedKey),
        rootPitchClass: c.root,
        quality: c.quality,
        startMs: toMs(c.startSec),
        endMs: toMs(c.endSec),
        confidence: Math.round(Math.min(1, Math.max(0, c.confidence)) * 1000) / 1000,
      }))
      .filter((c) => c.endMs > c.startMs);

    // The mean of what the detector thought of the chords it heard here -
    // a section built from shaky readings should not look as solid as one
    // built from clear ones.
    const confidence =
      chords.length > 0
        ? Math.round((chords.reduce((sum, c) => sum + c.confidence, 0) / chords.length) * 1000) / 1000
        : null;

    return {
      label,
      ordinal,
      startMs,
      endMs,
      progressionRoman: toRomanProgression(sp.loop, detectedKey),
      loopLengthBars: trustedBpm ? estimateLoopBars(sp.chords, sp.loop.length, trustedBpm) : null,
      confidence,
      chords,
    };
  });

  if (sections.length === 0) return null;

  // Coverage is how much of the song was actually listened to. The first
  // section's own start is not that: section detection always begins its first
  // segment at 0:00, so a capture started two minutes in would have been
  // credited with those two unheard minutes - enough to clear the coverage bar
  // on the first few seconds of listening and save a track's analysis, for
  // everyone, from a fragment of it. The first chord heard is the honest start.
  const firstHeardMs = Math.min(...sections.flatMap((s) => s.chords.map((c) => c.startMs)));
  const coveredFromMs = Number.isFinite(firstHeardMs)
    ? Math.max(sections[0].startMs, firstHeardMs)
    : sections[0].startMs;
  const coveredToMs = sections[sections.length - 1].endMs;
  if (coveredToMs <= coveredFromMs) return null;

  return {
    // Only present keys are sent: the server treats a present-but-empty
    // trackId as malformed rather than as absent.
    ...(trackId ? { trackId } : {}),
    ...(trackRef ? { trackRef } : {}),
    analysisVersion: args.analysisVersion ?? DETECTION_ANALYSIS_VERSION,
    key: {
      tonic: detectedKey.tonic,
      mode: detectedKey.mode,
      confidence: Math.round(Math.min(1, Math.max(0, detectedKey.confidence)) * 1000) / 1000,
    },
    ...(tempo ? { tempo } : {}),
    coveredFromMs,
    coveredToMs,
    idempotencyKey: args.idempotencyKey ?? newIdempotencyKey(),
    sections,
  };
}

/** Send a built payload. Throws with the server's message on failure. */
export async function submitDetectionRun(payload: DetectionRunPayload): Promise<IngestResult> {
  const { data, error } = await supabase.functions.invoke<IngestResult>('ingest-detection', {
    body: payload,
  });

  if (error) throw new Error(error.message || 'Could not save this analysis.');
  if (!data?.runId) throw new Error('Ingest returned no run id.');
  return data;
}
