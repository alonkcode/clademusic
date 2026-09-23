/**
 * When is a live capture good enough to become a track's saved analysis
 * without anyone reviewing it?
 *
 * Pure and free of Deno APIs, like detectionPayload.ts, so the edge function
 * (which decides) and the browser (which shows the listener how close they are
 * and knows when to submit) run the SAME code. Two copies of these numbers
 * would drift, and the visible failure would be a panel that says "saving..."
 * for a capture the server keeps turning down.
 *
 * This is policy, not safety. The database separately refuses to overwrite a
 * track that already has an analysis (auto_promote_detection_run), so a
 * threshold set too low here can waste a listener's capture but cannot damage
 * curated data.
 */

export const AUTO_PROMOTION = {
  /** The key estimate has to be something the detector actually stood behind. */
  MIN_KEY_CONFIDENCE: 0.5,
  /** Enough chord changes to show a progression rather than a couple of guesses. */
  MIN_CHORDS: 8,
  /** Structure, not just one repeating loop. */
  MIN_SECTIONS: 2,
  /** Absolute floor on how much of the song was heard... */
  MIN_COVERAGE_MS: 90_000,
  /** ...eased for short tracks: 60% of the song is enough when 90 s would be all of it. */
  MIN_COVERAGE_FRACTION: 0.6,
  /** Mirrors the 0.6 in _promote_detection_run_core: a tempo below this is not stored. */
  MIN_TEMPO_CONFIDENCE: 0.6,
} as const;

export type AutoPromotionReason =
  | 'ok'
  | 'no_key'
  | 'low_key_confidence'
  | 'too_few_sections'
  | 'too_few_chords'
  | 'insufficient_coverage';

export interface AutoPromotionInput {
  key?: { confidence: number } | null;
  sections: ReadonlyArray<{ chords: ReadonlyArray<unknown> }>;
  coveredFromMs: number;
  coveredToMs: number;
}

export interface AutoPromotionProgress {
  keyConfidence: number;
  chords: number;
  sections: number;
  coverageMs: number;
  requiredCoverageMs: number;
  /** 0..1 - how close the weakest requirement is to being met. For a progress bar. */
  ratio: number;
}

export interface AutoPromotionVerdict {
  ok: boolean;
  reason: AutoPromotionReason;
  progress: AutoPromotionProgress;
}

/** How much of the song has to have been heard, given its length when known. */
export function requiredCoverageMs(durationMs?: number | null): number {
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) {
    return Math.min(
      AUTO_PROMOTION.MIN_COVERAGE_MS,
      Math.round(durationMs * AUTO_PROMOTION.MIN_COVERAGE_FRACTION)
    );
  }
  return AUTO_PROMOTION.MIN_COVERAGE_MS;
}

const ratioOf = (have: number, need: number) => (need <= 0 ? 1 : Math.max(0, Math.min(1, have / need)));

export function evaluateAutoPromotion(
  input: AutoPromotionInput,
  durationMs?: number | null
): AutoPromotionVerdict {
  const chords = input.sections.reduce((sum, s) => sum + s.chords.length, 0);
  const sections = input.sections.length;
  const coverageMs = Math.max(0, input.coveredToMs - input.coveredFromMs);
  const required = requiredCoverageMs(durationMs);
  const keyConfidence = input.key ? input.key.confidence : 0;

  const progress: AutoPromotionProgress = {
    keyConfidence,
    chords,
    sections,
    coverageMs,
    requiredCoverageMs: required,
    ratio: Math.min(
      ratioOf(coverageMs, required),
      ratioOf(chords, AUTO_PROMOTION.MIN_CHORDS),
      ratioOf(sections, AUTO_PROMOTION.MIN_SECTIONS),
      input.key ? ratioOf(keyConfidence, AUTO_PROMOTION.MIN_KEY_CONFIDENCE) : 0
    ),
  };

  // Order is the order a listener can act on it: coverage is fixed by just
  // listening longer, the key by the music itself.
  let reason: AutoPromotionReason = 'ok';
  if (coverageMs < required) reason = 'insufficient_coverage';
  else if (chords < AUTO_PROMOTION.MIN_CHORDS) reason = 'too_few_chords';
  else if (sections < AUTO_PROMOTION.MIN_SECTIONS) reason = 'too_few_sections';
  else if (!input.key) reason = 'no_key';
  else if (keyConfidence < AUTO_PROMOTION.MIN_KEY_CONFIDENCE) reason = 'low_key_confidence';

  return { ok: reason === 'ok', reason, progress };
}
