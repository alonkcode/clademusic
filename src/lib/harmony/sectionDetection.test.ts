import { describe, expect, it } from 'vitest';
import {
  aggregateFrames,
  detectSectionBoundaries,
  detectSections,
  labelSegments,
  type ChromaFrame,
} from './sectionDetection';

/** A block of identical one-hot chroma frames at 2 frames/sec - orthogonal
 *  pitch classes stand in for genuinely different-sounding parts of a song. */
function block(pitchClass: number, startSec: number, durationSec: number): ChromaFrame[] {
  const frames: ChromaFrame[] = [];
  const chroma = new Array(12).fill(0);
  chroma[pitchClass] = 1;
  for (let t = 0; t < durationSec * 2; t++) {
    frames.push({ chroma, timeSec: startSec + t / 2 });
  }
  return frames;
}

/** intro(12) verse(16) chorus(16) verse(16) chorus(16) bridge(12) chorus(16) outro(12) = 116s. */
function buildSong(): { frames: ChromaFrame[]; edges: number[] } {
  const parts: [number, number, number][] = [
    [0, 0, 12], // intro, pitch class 0
    [2, 12, 16], // verse 1, pitch class 2
    [4, 28, 16], // chorus 1, pitch class 4
    [2, 44, 16], // verse 2, pitch class 2
    [4, 60, 16], // chorus 2, pitch class 4
    [9, 76, 12], // bridge, pitch class 9
    [4, 88, 16], // chorus 3, pitch class 4
    [7, 104, 12], // outro, pitch class 7
  ];
  const frames = parts.flatMap(([pc, start, dur]) => block(pc, start, dur));
  const edges = [12, 28, 44, 60, 76, 88, 104];
  return { frames, edges };
}

describe('aggregateFrames', () => {
  it('averages same-second frames into one bucket per second', () => {
    const frames: ChromaFrame[] = [
      { chroma: [1, 0], timeSec: 0.1 },
      { chroma: [0, 1], timeSec: 0.6 },
      { chroma: [1, 1], timeSec: 1.2 },
    ];
    const agg = aggregateFrames(frames, 1);
    expect(agg).toHaveLength(2);
    expect(agg[0].timeSec).toBe(0);
    expect(agg[0].chroma).toEqual([0.5, 0.5]);
    expect(agg[1].timeSec).toBe(1);
    expect(agg[1].chroma).toEqual([1, 1]);
  });

  it('returns nothing for no frames', () => {
    expect(aggregateFrames([])).toEqual([]);
  });
});

describe('detectSectionBoundaries', () => {
  it('finds no boundaries with too little accumulated audio', () => {
    const { frames } = buildSong();
    expect(detectSectionBoundaries(frames.slice(0, 10))).toEqual([]);
  });

  it('finds a boundary near every true section edge, and nothing far from one', () => {
    const { frames, edges } = buildSong();
    const boundaries = detectSectionBoundaries(frames);

    expect(boundaries.length).toBeGreaterThan(0);
    for (const b of boundaries) {
      const nearestGap = Math.min(...edges.map((e) => Math.abs(e - b)));
      expect(nearestGap).toBeLessThanOrEqual(3);
    }
    // Every real edge should have been found by some boundary within 3s.
    for (const e of edges) {
      const found = boundaries.some((b) => Math.abs(b - e) <= 3);
      expect(found).toBe(true);
    }
  });
});

describe('labelSegments / detectSections', () => {
  it('labels the repeated hook as chorus, the ends as intro/outro, and the one-off as bridge', () => {
    const { frames } = buildSong();
    const sections = detectSections(frames);

    expect(sections[0].type).toBe('intro');
    expect(sections[sections.length - 1].type).toBe('outro');

    const choruses = sections.filter((s) => s.type === 'chorus');
    expect(choruses.length).toBeGreaterThanOrEqual(2); // the repeated hook, found at least twice

    expect(sections.some((s) => s.type === 'bridge')).toBe(true);

    // Segments must tile the whole capture with no gap or overlap.
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i].startSec).toBe(sections[i - 1].endSec);
    }
    expect(sections[0].startSec).toBe(0);
  });

  it('numbers repeated verse/chorus labels instead of repeating the same label', () => {
    const { frames } = buildSong();
    const sections = detectSections(frames);
    const chorusLabels = sections.filter((s) => s.type === 'chorus').map((s) => s.label);
    expect(new Set(chorusLabels).size).toBe(chorusLabels.length); // "Chorus 1", "Chorus 2", ... - no duplicates
  });

  it('produces nothing from an empty capture', () => {
    expect(labelSegments([], [])).toEqual([]);
    expect(detectSections([])).toEqual([]);
  });
});
