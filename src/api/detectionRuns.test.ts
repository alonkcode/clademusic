import { describe, it, expect } from 'vitest';
import { buildDetectionRunPayload, estimateLoopBars, DETECTION_ANALYSIS_VERSION } from './detectionRuns';
import type { SectionProgression, ChordSpan } from '@/lib/harmony/chordTimeline';
import type { KeyEstimate } from '@/lib/harmony/keyEstimation';
import type { DetectedSectionType } from '@/lib/harmony/sectionDetection';

const C_MAJOR: KeyEstimate = { tonic: 0, mode: 'major', confidence: 0.82 };
const TRACK = '11111111-2222-3333-4444-555555555555';

function span(root: number, quality: 'major' | 'minor', startSec: number, endSec: number, confidence = 0.9): ChordSpan {
  return { root, quality, startSec, endSec, confidence };
}

function progression(
  type: DetectedSectionType,
  startSec: number,
  endSec: number,
  chords: ChordSpan[]
): SectionProgression {
  return {
    section: { type, label: `${type} ${startSec}`, startSec, endSec },
    chords,
    loop: chords.map((c) => ({ root: c.root, quality: c.quality })),
  };
}

describe('buildDetectionRunPayload', () => {
  it('returns null when there is no key to make the numerals relative to', () => {
    const sections = [progression('verse', 0, 8, [span(0, 'major', 0, 4)])];
    expect(buildDetectionRunPayload({ trackId: TRACK, sectionProgressions: sections, detectedKey: null })).toBeNull();
  });

  it('returns null with nothing detected', () => {
    expect(
      buildDetectionRunPayload({ trackId: TRACK, sectionProgressions: [], detectedKey: C_MAJOR })
    ).toBeNull();
  });

  it('returns null without a track to attach the run to', () => {
    const sections = [progression('verse', 0, 8, [span(0, 'major', 0, 4)])];
    expect(buildDetectionRunPayload({ trackId: '', sectionProgressions: sections, detectedKey: C_MAJOR })).toBeNull();
  });

  it('numbers repeated sections in playing order', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [
        progression('verse', 0, 8, [span(0, 'major', 0, 4)]),
        progression('chorus', 8, 16, [span(5, 'major', 8, 12)]),
        progression('verse', 16, 24, [span(0, 'major', 16, 20)]),
        progression('chorus', 24, 32, [span(5, 'major', 24, 28)]),
      ],
    });

    expect(payload!.sections.map((s) => [s.label, s.ordinal])).toEqual([
      ['verse', 1],
      ['chorus', 1],
      ['verse', 2],
      ['chorus', 2],
    ]);
  });

  it('sorts sections by start time before numbering them', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [
        progression('verse', 16, 24, [span(0, 'major', 16, 20)]),
        progression('verse', 0, 8, [span(0, 'major', 0, 4)]),
      ],
    });
    expect(payload!.sections.map((s) => s.startMs)).toEqual([0, 16000]);
    expect(payload!.sections.map((s) => s.ordinal)).toEqual([1, 2]);
  });

  it('writes chords as numerals relative to the detected key', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [
        progression('verse', 0, 8, [
          span(0, 'major', 0, 2),
          span(7, 'major', 2, 4),
          span(9, 'minor', 4, 6),
          span(5, 'major', 6, 8),
        ]),
      ],
    });

    expect(payload!.sections[0].progressionRoman).toEqual(['I', 'V', 'vi', 'IV']);
    expect(payload!.sections[0].chords.map((c) => c.numeral)).toEqual(['I', 'V', 'vi', 'IV']);
  });

  it('keeps the absolute chord alongside the numeral', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [progression('verse', 0, 8, [span(9, 'minor', 0, 4)])],
    });
    const chord = payload!.sections[0].chords[0];
    expect(chord.numeral).toBe('vi');
    expect(chord.rootPitchClass).toBe(9);
    expect(chord.quality).toBe('minor');
  });

  it('converts seconds to whole milliseconds', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [progression('verse', 1.2345, 8.6789, [span(0, 'major', 1.2345, 4.5)])],
    });
    const section = payload!.sections[0];
    expect(section.startMs).toBe(1235);
    expect(section.endMs).toBe(8679);
    expect(Number.isInteger(section.chords[0].startMs)).toBe(true);
    expect(section.chords[0].endMs).toBe(4500);
  });

  // The server rejects any span that does not end after it starts, and
  // rounding two nearby times can collapse them onto the same millisecond.
  // Such slivers are dropped rather than stretched: stretching one by 1ms
  // made it overlap its neighbour, and the server rejects a whole run for that.
  it('drops a chord that rounds to zero length, keeping the section', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [
        progression('verse', 0, 8, [span(7, 'major', 0, 0.0004), span(0, 'major', 0.0004, 8)]),
      ],
    });
    const chords = payload!.sections[0].chords;
    expect(chords).toHaveLength(1);
    expect(chords[0].numeral).toBe('I');
  });

  it('drops a section that rounds to zero length and numbers the rest without gaps', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [
        progression('verse', 0, 8, [span(0, 'major', 0, 4)]),
        progression('verse', 8.0001, 8.0002, [span(0, 'major', 8.0001, 8.0002)]),
        progression('verse', 16, 24, [span(0, 'major', 16, 20)]),
      ],
    });
    expect(payload!.sections.map((s) => [s.startMs, s.ordinal])).toEqual([
      [0, 1],
      [16000, 2],
    ]);
  });

  it('returns null when every section is a sliver', () => {
    expect(
      buildDetectionRunPayload({
        trackId: TRACK,
        detectedKey: C_MAJOR,
        sectionProgressions: [progression('intro', 4.0001, 4.0002, [span(0, 'major', 4.0001, 4.0002)])],
      })
    ).toBeNull();
  });

  it('covers the span from the first section to the last', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [
        progression('verse', 10, 20, [span(0, 'major', 10, 14)]),
        progression('chorus', 20, 35, [span(5, 'major', 20, 24)]),
      ],
    });
    expect(payload!.coveredFromMs).toBe(10000);
    expect(payload!.coveredToMs).toBe(35000);
  });

  // Section detection always starts its first segment at 0:00, so a capture
  // begun mid-song comes in as a section from 0 whose chords only start where
  // the listening did. Counting from the section edge credited the unheard
  // minutes before it.
  it('starts coverage at the first chord actually heard, not at the first section\'s 0:00 edge', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [
        progression('verse', 0, 130, [span(0, 'major', 120, 124), span(7, 'major', 124, 128)]),
      ],
    });
    expect(payload!.coveredFromMs).toBe(120000);
    expect(payload!.coveredToMs).toBe(130000);
  });

  it('falls back to the first section\'s start when no section has a chord in it', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [progression('verse', 5, 30, [])],
    });
    expect(payload!.coveredFromMs).toBe(5000);
  });

  it('averages the detector confidence across a section', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [
        progression('verse', 0, 8, [span(0, 'major', 0, 4, 1), span(7, 'major', 4, 8, 0.5)]),
      ],
    });
    expect(payload!.sections[0].confidence).toBeCloseTo(0.75, 3);
  });

  it('leaves confidence unset for a section with no chords', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [
        progression('verse', 0, 8, [span(0, 'major', 0, 4)]),
        progression('outro', 8, 12, []),
      ],
    });
    expect(payload!.sections[1].confidence).toBeNull();
  });

  it('carries the key and the analysis version', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [progression('verse', 0, 8, [span(0, 'major', 0, 4)])],
    });
    expect(payload!.key).toEqual({ tonic: 0, mode: 'major', confidence: 0.82 });
    expect(payload!.analysisVersion).toBe(DETECTION_ANALYSIS_VERSION);
  });

  it('reuses a caller-supplied idempotency key so a retry is safe', () => {
    const args = {
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [progression('verse', 0, 8, [span(0, 'major', 0, 4)])],
      idempotencyKey: 'fixed-key',
    };
    expect(buildDetectionRunPayload(args)!.idempotencyKey).toBe('fixed-key');
    expect(buildDetectionRunPayload(args)!.idempotencyKey).toBe('fixed-key');
  });

  it('generates a distinct key per capture when none is supplied', () => {
    const args = {
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [progression('verse', 0, 8, [span(0, 'major', 0, 4)])],
    };
    expect(buildDetectionRunPayload(args)!.idempotencyKey).not.toBe(
      buildDetectionRunPayload(args)!.idempotencyKey
    );
  });
});

describe('buildDetectionRunPayload: tracks without a catalog row', () => {
  const ref = { provider: 'youtube' as const, providerTrackId: 'dQw4w9WgXcQ', title: 'A song', artist: 'Someone' };
  const verse = [progression('verse', 0, 8, [span(0, 'major', 0, 4)])];

  it('accepts a track reference in place of a track id', () => {
    const payload = buildDetectionRunPayload({ trackRef: ref, sectionProgressions: verse, detectedKey: C_MAJOR });
    expect(payload!.trackRef).toEqual(ref);
    expect('trackId' in payload!).toBe(false);
  });

  it('still returns null when it has neither an id nor a reference', () => {
    expect(buildDetectionRunPayload({ sectionProgressions: verse, detectedKey: C_MAJOR })).toBeNull();
  });

  it('never sends an empty trackId next to a reference', () => {
    const payload = buildDetectionRunPayload({ trackId: '', trackRef: ref, sectionProgressions: verse, detectedKey: C_MAJOR });
    expect('trackId' in payload!).toBe(false);
  });

  it('sends a tempo in range, rounded, and drops one that is not', () => {
    const args = { trackId: TRACK, sectionProgressions: verse, detectedKey: C_MAJOR };
    expect(buildDetectionRunPayload({ ...args, tempo: { bpm: 127.96, confidence: 0.7 } })!.tempo).toEqual({
      bpm: 128,
      confidence: 0.7,
    });
    expect(buildDetectionRunPayload({ ...args, tempo: { bpm: 12, confidence: 0.9 } })!.tempo).toBeUndefined();
    expect(buildDetectionRunPayload({ ...args, tempo: { bpm: NaN, confidence: 0.9 } })!.tempo).toBeUndefined();
    expect(buildDetectionRunPayload({ ...args, tempo: null })!.tempo).toBeUndefined();
  });

  it('fills loop length in bars from a confident tempo', () => {
    // A 4-chord loop, 2 s per chord: 8 s per cycle = 4 bars at 120 BPM.
    const chords = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      span([0, 7, 9, 5][i % 4], i % 4 === 2 ? 'minor' : 'major', i * 2, i * 2 + 2)
    );
    const args = {
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [progression('verse', 0, 16, chords)].map((sp) => ({ ...sp, loop: sp.loop.slice(0, 4) })),
    };
    expect(buildDetectionRunPayload({ ...args, tempo: { bpm: 120, confidence: 0.8 } })!.sections[0].loopLengthBars).toBe(4);
  });

  it('leaves loop length empty when the tempo is not trusted', () => {
    const chords = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => span(0, 'major', i * 2, i * 2 + 2));
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [{ ...progression('verse', 0, 16, chords), loop: chords.slice(0, 4).map((c) => ({ root: c.root, quality: c.quality })) }],
      tempo: { bpm: 120, confidence: 0.3 },
    });
    expect(payload!.tempo).toBeDefined();
    expect(payload!.sections[0].loopLengthBars).toBeNull();
  });
});

describe('estimateLoopBars', () => {
  /** n chords, each `sec` long, back to back. */
  const run = (n: number, sec: number) => Array.from({ length: n }, (_, i) => span(0, 'major', i * sec, (i + 1) * sec));

  it('measures whole bars: 4 chords x 2 s at 120 BPM is 4 bars', () => {
    expect(estimateLoopBars(run(12, 2), 4, 120)).toBe(4);
  });

  it('measures a two-bar loop', () => {
    // 2 chords x 2 s = 4 s per cycle = 2 bars at 120 BPM
    expect(estimateLoopBars(run(8, 2), 2, 120)).toBe(2);
  });

  it('needs two full cycles before it will say anything', () => {
    expect(estimateLoopBars(run(4, 2), 4, 120)).toBeNull();
    expect(estimateLoopBars(run(7, 2), 4, 120)).toBeNull();
  });

  it('returns null when the cycle is not a whole number of bars', () => {
    // 4 x 1.8 s = 7.2 s = 3.6 bars at 120 BPM: the tempo or the loop is off.
    expect(estimateLoopBars(run(12, 1.8), 4, 120)).toBeNull();
  });

  it('is not moved by one stretched repeat', () => {
    const chords = run(12, 2).map((c, i) => (i === 5 ? { ...c, endSec: c.endSec + 0.4 } : c));
    // Only the shifted spans' own start times move the later cycles; the median cycle stays 8 s.
    expect(estimateLoopBars(chords, 4, 120)).toBe(4);
  });

  it.each([0, -5, NaN])('rejects a nonsense tempo (%s)', (bpm) => {
    expect(estimateLoopBars(run(8, 2), 4, bpm)).toBeNull();
  });
});
