import { describe, it, expect } from 'vitest';
import { buildDetectionRunPayload, DETECTION_ANALYSIS_VERSION } from './detectionRuns';
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
  it('never emits a zero-length section or chord', () => {
    const payload = buildDetectionRunPayload({
      trackId: TRACK,
      detectedKey: C_MAJOR,
      sectionProgressions: [progression('intro', 4.0001, 4.0002, [span(0, 'major', 4.0001, 4.0002)])],
    });
    const section = payload!.sections[0];
    expect(section.endMs).toBeGreaterThan(section.startMs);
    expect(section.chords[0].endMs).toBeGreaterThan(section.chords[0].startMs);
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
