import { describe, expect, it } from 'vitest';
import {
  bassNote,
  chordDisplayName,
  midiToFrequency,
  parsePitchClass,
  parseRomanChord,
  pitchClassName,
  voiceChord,
} from './theory';

describe('parsePitchClass', () => {
  it('reads naturals, sharps and flats', () => {
    expect(parsePitchClass('C')).toBe(0);
    expect(parsePitchClass('F#')).toBe(6);
    expect(parsePitchClass('Gb')).toBe(6);
    expect(parsePitchClass('B#')).toBe(0); // wraps
    expect(parsePitchClass('Cb')).toBe(11); // wraps below zero
  });

  it('returns null for unusable input', () => {
    expect(parsePitchClass(undefined)).toBeNull();
    expect(parsePitchClass('H')).toBeNull();
    expect(parsePitchClass('')).toBeNull();
  });
});

describe('parseRomanChord', () => {
  it('derives the right root offsets in major', () => {
    expect(parseRomanChord('I')?.rootOffset).toBe(0);
    expect(parseRomanChord('IV')?.rootOffset).toBe(5);
    expect(parseRomanChord('V')?.rootOffset).toBe(7);
    expect(parseRomanChord('vi')?.rootOffset).toBe(9);
  });

  it('honours the minor scale when the mode is minor', () => {
    expect(parseRomanChord('III', 'minor')?.rootOffset).toBe(3);
    expect(parseRomanChord('VI', 'minor')?.rootOffset).toBe(8);
  });

  it('applies leading accidentals', () => {
    expect(parseRomanChord('bVII')?.rootOffset).toBe(10);
    expect(parseRomanChord('bVI')?.rootOffset).toBe(8);
    expect(parseRomanChord('#iv')?.rootOffset).toBe(6);
  });

  it('infers quality from case and modifiers', () => {
    expect(parseRomanChord('I')?.quality).toBe('major');
    expect(parseRomanChord('vi')?.quality).toBe('minor');
    expect(parseRomanChord('V7')?.quality).toBe('dominant7');
    expect(parseRomanChord('ii7')?.quality).toBe('minor7');
    expect(parseRomanChord('Imaj7')?.quality).toBe('major7');
    expect(parseRomanChord('vii°')?.quality).toBe('diminished');
    expect(parseRomanChord('Vsus4')?.quality).toBe('sus4');
    expect(parseRomanChord('III+')?.quality).toBe('augmented');
  });

  it('rejects things that are not roman numerals', () => {
    expect(parseRomanChord('')).toBeNull();
    expect(parseRomanChord('Cmaj')).toBeNull();
  });
});

describe('chordDisplayName', () => {
  it('names chords in the chosen key', () => {
    const one = parseRomanChord('I')!;
    const six = parseRomanChord('vi')!;
    const five = parseRomanChord('V7')!;

    // In C major: I = C, vi = Am, V7 = G7
    expect(chordDisplayName(one, 0)).toBe('C');
    expect(chordDisplayName(six, 0)).toBe('Am');
    expect(chordDisplayName(five, 0)).toBe('G7');

    // Transposed to G major (tonic = 7): I = G, vi = Em, V7 = D7
    expect(chordDisplayName(one, 7)).toBe('G');
    expect(chordDisplayName(six, 7)).toBe('Em');
    expect(chordDisplayName(five, 7)).toBe('D7');
  });
});

describe('voiceChord', () => {
  it('produces one note per chord tone with correct intervals', () => {
    const chord = parseRomanChord('I')!;
    const notes = voiceChord(chord, 0);
    expect(notes).toHaveLength(3);
    // Major triad: root, +4, +7 semitones.
    expect(notes[1] - notes[0]).toBe(4);
    expect(notes[2] - notes[0]).toBe(7);
  });

  it('keeps successive chords in a nearby register (voice leading)', () => {
    const first = voiceChord(parseRomanChord('I')!, 0);
    const second = voiceChord(parseRomanChord('V')!, 0, first);
    const centre = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
    // No leap of more than an octave between chord centres.
    expect(Math.abs(centre(second) - centre(first))).toBeLessThan(12);
  });

  it('shifts by whole octaves only, preserving chord identity', () => {
    const chord = parseRomanChord('IV')!;
    const plain = voiceChord(chord, 0);
    const led = voiceChord(chord, 0, [24, 28, 31]);
    led.forEach((note, i) => {
      expect(Math.abs((note - plain[i]) % 12)).toBe(0);
    });
  });
});

describe('pitch helpers', () => {
  it('round-trips pitch class names', () => {
    expect(pitchClassName(0)).toBe('C');
    expect(pitchClassName(12)).toBe('C');
    expect(pitchClassName(-1)).toBe('B');
  });

  it('converts MIDI to frequency at concert pitch', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 5);
    expect(midiToFrequency(57)).toBeCloseTo(220, 5);
  });

  it('puts the bass below the voicing', () => {
    const chord = parseRomanChord('I')!;
    expect(bassNote(chord, 0)).toBeLessThan(Math.min(...voiceChord(chord, 0)));
  });
});
