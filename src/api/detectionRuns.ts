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
import type { SectionProgression } from '@/lib/harmony/chordTimeline';
import { toRomanNumeral, toRomanProgression, type KeyEstimate } from '@/lib/harmony/keyEstimation';

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

export interface DetectionRunPayload {
  trackId: string;
  analysisVersion: string;
  key: { tonic: number; mode: 'major' | 'minor'; confidence: number } | null;
  coveredFromMs: number;
  coveredToMs: number;
  idempotencyKey: string;
  sections: DetectionSectionPayload[];
}

export interface IngestResult {
  runId: string;
  sectionCount?: number;
  chordCount?: number;
  deduplicated?: boolean;
}

const toMs = (sec: number) => Math.max(0, Math.round(sec * 1000));

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
  trackId: string;
  sectionProgressions: SectionProgression[];
  detectedKey: KeyEstimate | null;
  analysisVersion?: string;
  idempotencyKey?: string;
}): DetectionRunPayload | null {
  const { trackId, sectionProgressions, detectedKey } = args;
  if (!trackId || !detectedKey || sectionProgressions.length === 0) return null;

  const ordered = [...sectionProgressions].sort((a, b) => a.section.startSec - b.section.startSec);

  // "Verse 1", "Verse 2": which occurrence of this label it is, counted in
  // playing order. Derived here rather than parsed out of the display label,
  // which is text meant for a human.
  const seen = new Map<string, number>();

  const sections = ordered.map((sp) => {
    const label = sp.section.type;
    const ordinal = (seen.get(label) ?? 0) + 1;
    seen.set(label, ordinal);

    const startMs = toMs(sp.section.startSec);
    const endMs = Math.max(startMs + 1, toMs(sp.section.endSec));

    const chords = sp.chords.map((c) => {
      const cStart = toMs(c.startSec);
      return {
        numeral: toRomanNumeral(c, detectedKey),
        rootPitchClass: c.root,
        quality: c.quality,
        startMs: cStart,
        endMs: Math.max(cStart + 1, toMs(c.endSec)),
        confidence: Math.round(Math.min(1, Math.max(0, c.confidence)) * 1000) / 1000,
      };
    });

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
      loopLengthBars: null, // needs a tempo to know; see the BPM phase
      confidence,
      chords,
    };
  });

  const coveredFromMs = sections[0].startMs;
  const coveredToMs = sections[sections.length - 1].endMs;
  if (coveredToMs <= coveredFromMs) return null;

  return {
    trackId,
    analysisVersion: args.analysisVersion ?? DETECTION_ANALYSIS_VERSION,
    key: {
      tonic: detectedKey.tonic,
      mode: detectedKey.mode,
      confidence: Math.round(Math.min(1, Math.max(0, detectedKey.confidence)) * 1000) / 1000,
    },
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
