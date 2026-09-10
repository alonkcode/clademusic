/**
 * Turns a tempo plus a playback position into "how lit is the beat dot right
 * now". Kept as pure functions, separate from the component that draws it, so
 * the timing can be tested at exact positions instead of by watching pixels.
 *
 * Everything here is a function of the PLAYBACK position, never of wall-clock
 * time since mount. That is what keeps the flash on the music: the component
 * re-anchors to the provider's real position on every update, so a seek, a
 * pause, or a buffering stall moves the flash with the audio rather than
 * letting a free-running timer drift out of phase with it.
 */

/** Below/above this, the value is treated as bad data rather than a tempo. */
export const MIN_BPM = 20;
export const MAX_BPM = 400;

/** Longest a single flash lasts, however slow the tempo. */
const MAX_FLASH_MS = 110;
/** At fast tempos the flash shortens so it still fully clears between beats. */
const FLASH_DUTY = 0.4;

export function isUsableBpm(bpm: number | null | undefined): bpm is number {
  return typeof bpm === 'number' && Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM;
}

export function beatIntervalMs(bpm: number): number {
  return 60000 / bpm;
}

/**
 * How long the flash takes to fade. Capped in absolute terms so a slow track
 * doesn't hold a long smear, and capped again as a FRACTION of the beat so a
 * fast one always returns to dark before the next onset - without that second
 * cap the flashes run together above ~270bpm and the dot just looks
 * permanently on, which is the opposite of showing the rhythm.
 */
export function flashDecayMs(intervalMs: number): number {
  return Math.min(MAX_FLASH_MS, intervalMs * FLASH_DUTY);
}

/**
 * 1 exactly on a beat onset, falling linearly to 0 across the decay window,
 * and flat 0 for the rest of the beat - so it is lit ON the beat and only on
 * the beat, rather than pulsing continuously like a sine.
 */
export function beatFlashIntensity(positionMs: number, bpm: number | null | undefined): number {
  if (!isUsableBpm(bpm) || !Number.isFinite(positionMs)) return 0;
  const interval = beatIntervalMs(bpm);
  const sinceOnset = Math.max(0, positionMs) % interval;
  const decay = flashDecayMs(interval);
  if (sinceOnset >= decay) return 0;
  return 1 - sinceOnset / decay;
}

/** Which beat the position falls in, counting from the track's start. */
export function beatIndexAt(positionMs: number, bpm: number | null | undefined): number {
  if (!isUsableBpm(bpm) || !Number.isFinite(positionMs)) return 0;
  return Math.floor(Math.max(0, positionMs) / beatIntervalMs(bpm));
}
