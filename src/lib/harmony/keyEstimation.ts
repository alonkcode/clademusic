/**
 * Estimates what key a detected chord sequence is in, and converts absolute
 * chords into the Roman numerals Clade actually stores.
 *
 * The live detector produces absolute triads - C, G, Am - because template
 * matching has no notion of a tonic. Everything downstream of it is relative:
 * progressions are held as Roman numerals so that two songs in different keys
 * can be recognised as the same progression. This module is the bridge, and
 * without it live detection can never feed the rest of the app.
 *
 * `theory.ts` goes the other way (numeral -> pitches) and deliberately never
 * touches absolute chords, which is why this lives on its own.
 */

import type { ChordRef, ChordSpan } from './chordTimeline';
import type { ChordQuality } from './chordDetection';

export interface KeyEstimate {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  mode: 'major' | 'minor';
  /**
   * 0-1. Combines how much of the song sits on chords diatonic to this key
   * with how clearly it beat the runner-up - a song that fits C major and A
   * minor almost equally well is reported as uncertain, because it is.
   */
  confidence: number;
}

/** Semitones above the tonic for each Roman numeral, per mode. */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/**
 * How much weight a chord carries as evidence for a key, by its interval above
 * the tonic and its quality. The tonic triad is the strongest signal, then the
 * dominant and subdominant that define the key's cadences, then the remaining
 * diatonic triads. Anything not listed is not diatonic and counts for nothing.
 */
const MAJOR_KEY_WEIGHTS: Record<string, number> = {
  '0:major': 3.0, // I
  '7:major': 2.2, // V
  '5:major': 2.0, // IV
  '9:minor': 1.6, // vi
  '2:minor': 1.3, // ii
  '4:minor': 1.0, // iii
};

const MINOR_KEY_WEIGHTS: Record<string, number> = {
  '0:minor': 3.0, // i
  '7:major': 2.0, // V - from harmonic minor, and far more common than v
  '5:minor': 1.8, // iv
  '10:major': 1.8, // VII
  '8:major': 1.6, // VI
  '3:major': 1.5, // III
  '7:minor': 1.3, // v
};

const MAX_WEIGHT = 3.0;

/**
 * Conventional numeral for each semitone offset above the tonic. Spelling
 * follows what a musician would actually write: flats for the borrowed
 * degrees in major (bIII, bVI, bVII), sharps for the raised ones in minor.
 * Case is applied afterwards from the chord's own quality.
 */
const MAJOR_NUMERALS = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const MINOR_NUMERALS = ['I', 'bII', 'II', 'III', '#III', 'IV', '#IV', 'V', 'VI', '#VI', 'VII', '#VII'];

function weightFor(offset: number, quality: ChordQuality, mode: 'major' | 'minor'): number {
  const table = mode === 'major' ? MAJOR_KEY_WEIGHTS : MINOR_KEY_WEIGHTS;
  return table[`${offset}:${quality}`] ?? 0;
}

/**
 * Estimate the key from timed chord spans.
 *
 * Chords are weighted by how long they were actually held, not merely counted:
 * a tonic sustained for four bars says far more about the key than a passing
 * chord that went by in a beat. Returns null when there is nothing to go on.
 */
export function estimateKey(spans: ChordSpan[]): KeyEstimate | null {
  const usable = spans.filter((s) => s.endSec > s.startSec);
  if (usable.length === 0) return null;

  const totalSec = usable.reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
  if (totalSec <= 0) return null;

  const candidates: Array<{ tonic: number; mode: 'major' | 'minor'; score: number; diatonicSec: number }> = [];

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      let score = 0;
      let diatonicSec = 0;
      for (const span of usable) {
        const held = span.endSec - span.startSec;
        const offset = (((span.root - tonic) % 12) + 12) % 12;
        const weight = weightFor(offset, span.quality, mode);
        if (weight > 0) {
          // Scale by the detector's own confidence in the chord, so a shaky
          // reading pulls the key estimate around less than a clear one.
          score += held * weight * span.confidence;
          diatonicSec += held;
        }
      }
      candidates.push({ tonic, mode, score, diatonicSec });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.score <= 0) return null;

  const runnerUp = candidates[1]?.score ?? 0;
  const margin = (best.score - runnerUp) / best.score;
  const coverage = best.diatonicSec / totalSec;

  return {
    tonic: best.tonic,
    mode: best.mode,
    confidence: Math.max(0, Math.min(1, coverage * (0.5 + 0.5 * margin))),
  };
}

/**
 * Absolute chord -> Roman numeral in a given key, e.g. Am in C major -> "vi".
 *
 * The result round-trips through `parseRomanChord`: parsing what this returns
 * recovers the same interval above the tonic and the same quality.
 */
export function toRomanNumeral(chord: ChordRef, key: Pick<KeyEstimate, 'tonic' | 'mode'>): string {
  const offset = (((chord.root - key.tonic) % 12) + 12) % 12;
  const numeral = (key.mode === 'major' ? MAJOR_NUMERALS : MINOR_NUMERALS)[offset];
  return chord.quality === 'minor' ? lowercaseNumeral(numeral) : numeral;
}

/** Lowercase the roman letters while leaving any leading accidental alone. */
function lowercaseNumeral(numeral: string): string {
  const match = /^([b#]*)(.*)$/.exec(numeral);
  if (!match) return numeral.toLowerCase();
  return match[1] + match[2].toLowerCase();
}

/** Convenience for a whole progression. */
export function toRomanProgression(
  chords: ChordRef[],
  key: Pick<KeyEstimate, 'tonic' | 'mode'>
): string[] {
  return chords.map((c) => toRomanNumeral(c, key));
}

/** The scale a mode is built from - exported for tests and callers that need it. */
export function scaleFor(mode: 'major' | 'minor'): number[] {
  return mode === 'major' ? [...MAJOR_SCALE] : [...MINOR_SCALE];
}

export const MAX_KEY_WEIGHT = MAX_WEIGHT;
