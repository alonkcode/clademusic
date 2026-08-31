import type { SongSectionType } from '@/types';

/**
 * Section-aware variation of a track's base progression.
 *
 * Clade's analysis pipeline stores ONE progression per track today — there is
 * no per-section harmonic analysis yet. Rather than show the identical loop
 * under every section label (which would make "switch sections" a no-op),
 * this applies a small set of well-documented songwriting conventions so the
 * progression genuinely changes with the section, in a way that is musically
 * defensible rather than arbitrary.
 *
 * This is a heuristic, not analysis — it never overwrites `progression_roman`
 * and nothing here claims the result was detected from audio.
 */
export function sectionVariant(
  base: string[],
  type: SongSectionType,
  mode: 'major' | 'minor' | 'unknown' = 'major'
): string[] {
  if (base.length === 0) return base;

  switch (type) {
    case 'chorus':
      // Choruses very commonly restart the same four-chord loop from a later
      // point (I-V-vi-IV becomes vi-IV-I-V) rather than introduce new harmony.
      return rotate(base, 1);

    case 'pre-chorus':
      // Pre-choruses build toward the chorus; landing the last chord on V
      // (the dominant) is the standard way to create that lift.
      return withLastChord(base, 'V');

    case 'bridge':
      // Bridges frequently borrow a chord from the parallel mode for
      // contrast: bVI in a major song, or the major VI in a minor one.
      return withSecondChord(base, mode === 'minor' ? 'VI' : 'bVI');

    case 'breakdown':
    case 'drop':
      // Stripped back to the tonic-dominant skeleton.
      return base.length > 1 ? [base[0], base[Math.min(3, base.length - 1)]] : base;

    case 'outro':
      // Resolve toward the top of the loop on the way out.
      return rotate(base, base.length - 1);

    case 'intro':
    case 'verse':
    default:
      return base;
  }
}

function rotate(arr: string[], n: number): string[] {
  const k = ((n % arr.length) + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

function withLastChord(base: string[], chord: string): string[] {
  const copy = [...base];
  copy[copy.length - 1] = chord;
  return copy;
}

function withSecondChord(base: string[], chord: string): string[] {
  if (base.length < 2) return base;
  const copy = [...base];
  copy[1] = chord;
  return copy;
}
