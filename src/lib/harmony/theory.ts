/**
 * Harmonic theory primitives.
 *
 * Turns the relative (Roman numeral) representation Clade stores into concrete
 * pitches, so a progression can be *heard* in any key rather than only read.
 * Nothing here touches absolute chord data — we always derive from the numeral.
 */

export const PITCH_CLASSES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

/** Semitone offset of each scale degree in major / natural minor. */
const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11];
const MINOR_DEGREES = [0, 2, 3, 5, 7, 8, 10];

const NUMERAL_TO_DEGREE: Record<string, number> = {
  I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6,
};

const NOTE_TO_PITCH_CLASS: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

export type ChordQualityName =
  | 'major' | 'minor' | 'diminished' | 'augmented'
  | 'dominant7' | 'major7' | 'minor7' | 'halfDiminished7' | 'diminished7'
  | 'sus2' | 'sus4' | 'add9';

/** Intervals in semitones above the chord root. */
const QUALITY_INTERVALS: Record<ChordQualityName, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  halfDiminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
};

export interface ParsedChord {
  /** The numeral exactly as it was given, e.g. "bVII7". */
  source: string;
  /** Semitones above the tonic. */
  rootOffset: number;
  quality: ChordQualityName;
  /** Semitone intervals above the chord root. */
  intervals: number[];
  /** Roman numeral stripped of accidentals/extensions, uppercased — "IV". */
  base: string;
  /** True when the numeral was written lowercase (minor-ish). */
  isLowercase: boolean;
}

/** Parse a pitch-class name ("F#", "Bb", "eb") into 0-11. Returns null if unknown. */
export function parsePitchClass(name?: string | null): number | null {
  if (!name) return null;
  const trimmed = name.trim();
  const letter = trimmed.charAt(0).toUpperCase();
  const natural = NOTE_TO_PITCH_CLASS[letter];
  if (natural === undefined) return null;

  let value = natural;
  for (const ch of trimmed.slice(1)) {
    if (ch === '#' || ch === '♯') value += 1;
    else if (ch === 'b' || ch === '♭') value -= 1;
    else break;
  }
  return ((value % 12) + 12) % 12;
}

export function pitchClassName(pitchClass: number): string {
  return PITCH_CLASSES[((pitchClass % 12) + 12) % 12];
}

/**
 * Parse a Roman numeral chord symbol relative to a mode.
 * Handles accidentals (bIII, #iv), qualities (°, +, m, maj7, 7, sus, add9)
 * and returns everything needed to sound the chord.
 */
export function parseRomanChord(
  symbol: string,
  mode: 'major' | 'minor' = 'major'
): ParsedChord | null {
  if (!symbol) return null;
  const raw = symbol.trim();
  let i = 0;
  let accidental = 0;

  // Leading accidentals: b / # / ♭ / ♯
  while (i < raw.length && 'b#♭♯'.includes(raw[i])) {
    accidental += raw[i] === 'b' || raw[i] === '♭' ? -1 : 1;
    i += 1;
  }

  // Roman numeral body
  let numeral = '';
  while (i < raw.length && /[IViv]/.test(raw[i])) {
    numeral += raw[i];
    i += 1;
  }
  if (!numeral) return null;

  const modifiers = raw.slice(i);
  const base = numeral.toUpperCase();
  const degree = NUMERAL_TO_DEGREE[base];
  if (degree === undefined) return null;

  const isLowercase = numeral === numeral.toLowerCase();
  const scale = mode === 'minor' ? MINOR_DEGREES : MAJOR_DEGREES;
  const rootOffset = (((scale[degree] + accidental) % 12) + 12) % 12;

  const quality = resolveQuality(modifiers, isLowercase);
  return {
    source: raw,
    rootOffset,
    quality,
    intervals: QUALITY_INTERVALS[quality],
    base,
    isLowercase,
  };
}

function resolveQuality(modifiers: string, isLowercase: boolean): ChordQualityName {
  const m = modifiers.toLowerCase();
  const diminished = m.includes('°') || m.includes('dim') || m.includes('o');
  const halfDim = m.includes('ø') || (diminished && m.includes('7') && !m.includes('dim7'));

  if (m.includes('sus2')) return 'sus2';
  if (m.includes('sus')) return 'sus4';
  if (halfDim) return 'halfDiminished7';
  if (diminished) return m.includes('7') ? 'diminished7' : 'diminished';
  if (m.includes('+') || m.includes('aug')) return 'augmented';
  if (m.includes('maj7') || m.includes('M7') || m.includes('Δ')) return 'major7';
  if (m.includes('add9')) return 'add9';
  if (m.includes('9') || m.includes('7')) return isLowercase ? 'minor7' : 'dominant7';
  return isLowercase ? 'minor' : 'major';
}

/** Display name for a chord in a concrete key, e.g. "Am7". */
export function chordDisplayName(chord: ParsedChord, tonicPitchClass: number): string {
  const root = pitchClassName(tonicPitchClass + chord.rootOffset);
  const suffix: Record<ChordQualityName, string> = {
    major: '', minor: 'm', diminished: 'dim', augmented: 'aug',
    dominant7: '7', major7: 'maj7', minor7: 'm7',
    halfDiminished7: 'm7♭5', diminished7: 'dim7',
    sus2: 'sus2', sus4: 'sus4', add9: 'add9',
  };
  return root + suffix[chord.quality];
}

/** MIDI note number → frequency in Hz (A4 = 69 = 440Hz). */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Voice a chord into MIDI notes around a target register, keeping successive
 * chords close together (voice leading) so the loop sounds musical rather than
 * like a sequence of root-position block chords.
 */
export function voiceChord(
  chord: ParsedChord,
  tonicPitchClass: number,
  previousVoicing?: number[],
  centerMidi = 60
): number[] {
  const rootPc = (tonicPitchClass + chord.rootOffset) % 12;
  const baseOctave = Math.round((centerMidi - rootPc) / 12);
  let notes = chord.intervals.map((iv) => rootPc + baseOctave * 12 + iv);

  if (previousVoicing?.length) {
    const prevCenter = previousVoicing.reduce((a, b) => a + b, 0) / previousVoicing.length;
    const center = notes.reduce((a, b) => a + b, 0) / notes.length;
    const shift = Math.round((prevCenter - center) / 12) * 12;
    // Only nudge by whole octaves so the chord identity is preserved.
    if (shift) notes = notes.map((n) => n + shift);
  }

  return notes;
}

/** The bass note for a chord, an octave-and-a-bit below the voicing. */
export function bassNote(chord: ParsedChord, tonicPitchClass: number): number {
  const rootPc = (tonicPitchClass + chord.rootOffset) % 12;
  return rootPc + 36; // C2-ish register
}
