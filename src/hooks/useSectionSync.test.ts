import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSectionSync } from './useSectionSync';
import type { SongSection } from '@/types';

/**
 * The chord-rotation heuristic has two real fixes covered here:
 *  1. A section with real per-chord chord_timings drives the index exactly,
 *     instead of the generic bpm/beats-per-chord guess.
 *  2. Without per-chord timing, the guess is now sized from the track's own
 *     loop_length_bars when known, instead of a flat "4 beats per chord"
 *     that's only ever right by coincidence.
 */

const mocks = vi.hoisted(() => ({
  player: {
    canonicalTrackId: 'track-1',
    isPlaying: true,
    positionMs: 0,
    seekTo: vi.fn(),
  },
}));

vi.mock('@/player/PlayerContext', () => ({
  usePlayer: () => mocks.player,
}));

vi.mock('@/hooks/useSectionSelection', () => ({
  useSectionSelection: () => null,
}));

const section = (overrides: Partial<SongSection>): SongSection => ({
  type: 'verse',
  start_time: 0,
  end_time: 100,
  ...overrides,
});

describe('useSectionSync liveChordIndex', () => {
  it('uses real chord_timings exactly when the active section has them, ignoring bpm entirely', () => {
    mocks.player.positionMs = 5400; // 5.4s into the track = 5.4s into this section
    const sections: SongSection[] = [
      section({
        start_time: 0,
        end_time: 100,
        chords: ['I', 'V', 'vi', 'IV'],
        chord_timings: [0, 2000, 5000, 8000], // real per-chord offsets, ms
      }),
    ];

    const { result } = renderHook(() =>
      useSectionSync({
        trackId: 'track-1',
        progression: ['I', 'V', 'vi', 'IV'],
        sections,
        bpm: 999, // deliberately absurd - must be ignored when chord_timings exists
      })
    );

    // 5400ms has passed the vi (5000ms) timing but not yet IV (8000ms).
    expect(result.current.liveChordIndex).toBe(2);
    expect(result.current.progression).toEqual(['I', 'V', 'vi', 'IV']);
  });

  it('derives beats-per-chord from loopLengthBars when chord_timings is absent', () => {
    // 4 chords over an 8-bar loop = 2 bars (8 beats) per chord. At 120bpm,
    // one beat is 0.5s, so one chord = 8 * 0.5 = 4s.
    mocks.player.positionMs = 4500; // 4.5s in - just past the first chord's 4s
    const sections: SongSection[] = [section({ start_time: 0, end_time: 100 })];

    const { result } = renderHook(() =>
      useSectionSync({
        trackId: 'track-1',
        progression: ['I', 'V', 'vi', 'IV'],
        sections,
        bpm: 120,
        loopLengthBars: 8,
      })
    );

    expect(result.current.liveChordIndex).toBe(1);
  });

  it('falls back to the flat beatsPerChord default when loopLengthBars is unknown', () => {
    // Old behavior preserved: 4 beats/chord at 120bpm = 2s/chord.
    mocks.player.positionMs = 2500; // just past the first chord's 2s
    const sections: SongSection[] = [section({ start_time: 0, end_time: 100 })];

    const { result } = renderHook(() =>
      useSectionSync({
        trackId: 'track-1',
        progression: ['I', 'V', 'vi', 'IV'],
        sections,
        bpm: 120,
      })
    );

    expect(result.current.liveChordIndex).toBe(1);
  });
});
