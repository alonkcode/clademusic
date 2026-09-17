import { describe, it, expect } from 'vitest';
import { buildDetectionRunPayload } from './detectionRuns';
import { validate, BadRequest } from '../../supabase/functions/_shared/detectionPayload';
import { ChordTimeline, sectionProgressions, type ChordSpan, type SectionProgression } from '@/lib/harmony/chordTimeline';
import { estimateKey, type KeyEstimate } from '@/lib/harmony/keyEstimation';
import type { DetectedSection } from '@/lib/harmony/sectionDetection';

/**
 * The browser builds the ingest payload; the edge function validates it. Each
 * side had its own tests, but nothing checked them against EACH OTHER - so a
 * builder that emitted something the validator rejects would pass every test
 * here and fail every Save in production. This feeds the real builder's output
 * through the real validator the function runs.
 */

const TRACK = '11111111-2222-3333-4444-555555555555';
const C_MAJOR: KeyEstimate = { tonic: 0, mode: 'major', confidence: 0.8 };

function span(root: number, quality: 'major' | 'minor', startSec: number, endSec: number): ChordSpan {
  return { root, quality, startSec, endSec, confidence: 0.9 };
}

function progression(type: DetectedSection['type'], startSec: number, endSec: number, chords: ChordSpan[]): SectionProgression {
  return {
    section: { type, label: type, startSec, endSec },
    chords,
    loop: chords.map((c) => ({ root: c.root, quality: c.quality })),
  };
}

/** Build, then validate - throwing the validator's own message on rejection. */
function roundTrip(sections: SectionProgression[], key: KeyEstimate | null = C_MAJOR) {
  const payload = buildDetectionRunPayload({ trackId: TRACK, sectionProgressions: sections, detectedKey: key });
  expect(payload).not.toBeNull();
  // JSON round-trip too, since that is what actually crosses the wire.
  return validate(JSON.parse(JSON.stringify(payload)));
}

describe('ingest payload contract (client builder -> server validator)', () => {
  it('accepts an ordinary capture', () => {
    const result = roundTrip([
      progression('verse', 0, 8, [span(0, 'major', 0, 2), span(7, 'major', 2, 4), span(9, 'minor', 4, 6), span(5, 'major', 6, 8)]),
      progression('chorus', 8, 16, [span(5, 'major', 8, 11), span(0, 'major', 11, 14), span(7, 'major', 14, 16)]),
    ]);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].chords.map((c) => c.numeral)).toEqual(['I', 'V', 'vi', 'IV']);
  });

  it('accepts a section in which no chord was detected', () => {
    const result = roundTrip([
      progression('verse', 0, 8, [span(0, 'major', 0, 4)]),
      progression('outro', 8, 12, []),
    ]);
    expect(result.sections[1].chords).toEqual([]);
    expect(result.sections[1].confidence).toBeNull();
  });

  it('accepts adjacent sections that share a boundary exactly', () => {
    // labelSegments produces contiguous sections: one ends where the next
    // begins. The validator's overlap check must treat touching as fine.
    expect(() =>
      roundTrip([
        progression('verse', 0, 8.3333, [span(0, 'major', 0, 4)]),
        progression('chorus', 8.3333, 16.6667, [span(5, 'major', 8.3333, 12)]),
      ])
    ).not.toThrow();
  });

  // A chord clipped at a section edge can be a sliver. Rounding it to whole
  // milliseconds collapses it, and naively bumping its end forward by 1ms
  // makes it overlap the chord that starts at that same millisecond - which
  // the server rejects, failing the entire run over a sub-millisecond artifact.
  it('survives a sub-millisecond chord that rounds to zero length', () => {
    expect(() =>
      roundTrip([
        progression('chorus', 8, 16, [
          span(7, 'major', 8.0, 8.0004),
          span(5, 'major', 8.0004, 12),
          span(0, 'major', 12, 16),
        ]),
      ])
    ).not.toThrow();
  });

  it('survives two chords that round onto the same millisecond', () => {
    expect(() =>
      roundTrip([
        progression('verse', 0, 8, [
          span(0, 'major', 0, 2.0001),
          span(7, 'major', 2.0001, 2.0003),
          span(9, 'minor', 2.0003, 8),
        ]),
      ])
    ).not.toThrow();
  });

  it('accepts the output of the whole live pipeline end to end', () => {
    const tl = new ChordTimeline();
    const play = (root: number, quality: 'major' | 'minor', t: number, secs: number) => {
      for (let x = 0; x < secs - 1e-9; x += 0.12) tl.push({ root, quality, score: 0.9 }, Number((t + x).toFixed(4)));
    };
    for (let cycle = 0; cycle < 2; cycle++) {
      const b = cycle * 8;
      play(0, 'major', b, 2);
      play(7, 'major', b + 2, 2);
      play(9, 'minor', b + 4, 2);
      play(5, 'major', b + 6, 2);
    }
    for (let cycle = 0; cycle < 2; cycle++) {
      const b = 16 + cycle * 8;
      play(5, 'major', b, 3);
      play(0, 'major', b + 3, 3);
      play(7, 'major', b + 6, 2);
    }
    tl.push(null, 32);

    const spans = tl.toSpans();
    const detected: DetectedSection[] = [
      { type: 'verse', label: 'Verse 1', startSec: 0, endSec: 16 },
      { type: 'chorus', label: 'Chorus 1', startSec: 16, endSec: 32 },
    ];
    const key = estimateKey(spans);
    const result = roundTrip(sectionProgressions(detected, spans), key);

    expect(result.key?.tonic).toBe(0);
    expect(result.sections.map((s) => s.progressionRoman)).toEqual([
      ['I', 'V', 'vi', 'IV'],
      ['IV', 'I', 'V'],
    ]);
  });

  it('is rejected, not silently accepted, when the payload really is invalid', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      sectionProgressions: [progression('verse', 0, 8, [span(0, 'major', 0, 4)])],
      detectedKey: C_MAJOR,
    });
    const broken = { ...payload!, trackId: 'not-a-uuid' };
    expect(() => validate(broken)).toThrow(BadRequest);
  });
});
