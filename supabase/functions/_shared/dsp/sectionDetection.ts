/**
 * Best-effort section-boundary detection from accumulated audio features -
 * no pre-analyzed track data, and no lookahead past whatever has already
 * played. Feeds the same live tab-audio capture already used for chord
 * detection (useLiveChordDetection), so "detect the sections" and "detect
 * the chords" are one capture, not two, and the result can only ever
 * describe the song so far, not the whole thing in advance.
 *
 * Method: a self-similarity matrix (SSM) over chroma aggregated into ~1s
 * buckets, scored for novelty with a checkerboard kernel run along the
 * SSM's diagonal (Foote, "Automatic Audio Segmentation Using a Measure Of
 * Audio Novelty", 2000), then peak-picked for boundary times. Segments are
 * labeled with genre-agnostic songwriting conventions - first is the intro,
 * last is the outro, the most-repeated distinct segment is the chorus, a
 * late one-off is a bridge, everything else is a verse - a heuristic, not a
 * music-theory-grade classifier.
 */

export interface ChromaFrame {
  chroma: number[];
  timeSec: number;
}

export type DetectedSectionType = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';

export interface DetectedSection {
  type: DetectedSectionType;
  label: string;
  startSec: number;
  endSec: number;
}

export interface SectionDetectionOptions {
  /** Width of each aggregated frame, in seconds. */
  bucketSec?: number;
  /** How far (in buckets) the novelty kernel looks either side of a point. */
  kernelRadius?: number;
  /** Shortest section the peak-picker will accept, in seconds. */
  minSegmentSec?: number;
}

const DEFAULT_BUCKET_SEC = 1;
const DEFAULT_KERNEL_RADIUS = 8;
const DEFAULT_MIN_SEGMENT_SEC = 8;
/** Fewer aggregated frames than this and there isn't enough structure to
 *  say anything - a handful of seconds of audio can't have "sections". */
const MIN_FRAMES = 12;
/** How closely two segments' average chroma must match to call them "the
 *  same part repeated" rather than two different, similar-sounding parts. */
const REPEAT_SIMILARITY_THRESHOLD = 0.93;

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na < 1e-9 || nb < 1e-9) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function averageChroma(vectors: number[][]): number[] {
  if (vectors.length === 0) return new Array(12).fill(0);
  const sum = new Array(vectors[0].length).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < v.length; i++) sum[i] += v[i];
  }
  return sum.map((v) => v / vectors.length);
}

/**
 * Collapse raw per-tick chroma into fixed-width time buckets. Keeps the
 * self-similarity matrix small (a few hundred cells even for a long track)
 * and averages out per-frame noise that would otherwise read as false
 * novelty peaks.
 */
export function aggregateFrames(frames: ChromaFrame[], bucketSec = DEFAULT_BUCKET_SEC): ChromaFrame[] {
  if (frames.length === 0) return [];
  const buckets = new Map<number, { sum: number[]; count: number }>();
  for (const f of frames) {
    const key = Math.floor(f.timeSec / bucketSec);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { sum: new Array(f.chroma.length).fill(0), count: 0 };
      buckets.set(key, bucket);
    }
    for (let i = 0; i < f.chroma.length; i++) bucket.sum[i] += f.chroma[i];
    bucket.count += 1;
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, { sum, count }]) => ({
      chroma: sum.map((v) => v / count),
      timeSec: key * bucketSec,
    }));
}

/**
 * Foote's checkerboard novelty: at each point, frames on the same side
 * (both before, or both after) contribute positively, frames on opposite
 * sides contribute negatively. A stable section scores low (before and
 * after resemble each other just as much as they resemble themselves); a
 * boundary scores high (they stop resembling each other at all).
 */
function checkerboardNovelty(ssm: number[][], radius: number): number[] {
  const n = ssm.length;
  const novelty = new Array(n).fill(0);
  for (let center = 0; center < n; center++) {
    let score = 0;
    let weight = 0;
    for (let i = -radius; i <= radius; i++) {
      const a = center + i;
      if (a < 0 || a >= n) continue;
      for (let j = -radius; j <= radius; j++) {
        const b = center + j;
        if (b < 0 || b >= n) continue;
        const sign = Math.sign(i) * Math.sign(j); // +1 same side, -1 opposite, 0 on an axis
        if (sign === 0) continue;
        score += sign * ssm[a][b];
        weight += 1;
      }
    }
    novelty[center] = weight > 0 ? score / weight : 0;
  }
  return novelty;
}

/**
 * Local maxima of the novelty curve, at least a meaningful amount above the
 * curve's own mean (a section that never changes should not produce
 * "boundaries" out of pure noise), spaced at least minDistance buckets
 * apart - keeping only the taller of two peaks that land too close together.
 */
function pickPeaks(curve: number[], minDistance: number): number[] {
  if (curve.length < 3) return [];
  const mean = curve.reduce((a, b) => a + b, 0) / curve.length;
  const variance = curve.reduce((a, b) => a + (b - mean) ** 2, 0) / curve.length;
  const std = Math.sqrt(variance);
  const threshold = mean + 0.75 * std;

  const peaks: number[] = [];
  for (let i = 1; i < curve.length - 1; i++) {
    if (curve[i] <= threshold) continue;
    if (curve[i] < curve[i - 1] || curve[i] < curve[i + 1]) continue;
    const lastPeak = peaks[peaks.length - 1];
    if (lastPeak !== undefined && i - lastPeak < minDistance) {
      if (curve[i] > curve[lastPeak]) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  return peaks;
}

/**
 * Boundary times (seconds), not including the implicit start (0) and end of
 * the accumulated audio - those are added by labelSegments.
 */
export function detectSectionBoundaries(frames: ChromaFrame[], opts: SectionDetectionOptions = {}): number[] {
  const bucketSec = opts.bucketSec ?? DEFAULT_BUCKET_SEC;
  const minSegmentSec = opts.minSegmentSec ?? DEFAULT_MIN_SEGMENT_SEC;

  const agg = aggregateFrames(frames, bucketSec);
  if (agg.length < MIN_FRAMES) return [];

  const kernelRadius = Math.max(2, Math.min(opts.kernelRadius ?? DEFAULT_KERNEL_RADIUS, Math.floor(agg.length / 2)));
  const ssm = agg.map((a) => agg.map((b) => cosineSim(a.chroma, b.chroma)));
  const novelty = checkerboardNovelty(ssm, kernelRadius);
  const minDistanceBuckets = Math.max(1, Math.round(minSegmentSec / bucketSec));

  return pickPeaks(novelty, minDistanceBuckets).map((i) => agg[i].timeSec);
}

/** Segments whose average chroma matches at least one other segment's
 *  closely enough to call them "the same part repeated". The largest such
 *  group is the chorus - grouped with union-find so a chain of near-matches
 *  (A~B, B~C) counts even when A and C were never compared as close. */
function findMostRepeatedGroup(fingerprints: number[][]): Set<number> {
  const n = fingerprints.length;
  if (n < 2) return new Set();

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosineSim(fingerprints[i], fingerprints[j]) >= REPEAT_SIMILARITY_THRESHOLD) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  }

  let best: number[] = [];
  for (const list of groups.values()) {
    if (list.length >= 2 && list.length > best.length) best = list;
  }
  return new Set(best);
}

/** A segment late in the song that does not resemble any other segment at
 *  all (chorus included) reads as a bridge; needs enough total structure
 *  (4+ segments) to distinguish "a bridge" from just "the next section". */
function isBridge(index: number, fingerprints: number[][], chorusIndices: Set<number>): boolean {
  const n = fingerprints.length;
  if (n < 4 || chorusIndices.has(index)) return false;
  if (index === 0 || index === n - 1) return false;
  if (index < n / 2) return false;
  for (let j = 0; j < n; j++) {
    if (j === index) continue;
    if (cosineSim(fingerprints[index], fingerprints[j]) >= REPEAT_SIMILARITY_THRESHOLD) return false;
  }
  return true;
}

/**
 * Turns boundary times back into labeled segments spanning the whole
 * accumulated capture (0 to the last frame), using the audio itself - never
 * a fixed guess - to decide which segment repeats (chorus), stands alone
 * late in the song (bridge), or is simply the first/last part (intro/outro).
 */
export function labelSegments(
  boundaries: number[],
  frames: ChromaFrame[],
  bucketSec = DEFAULT_BUCKET_SEC
): DetectedSection[] {
  const agg = aggregateFrames(frames, bucketSec);
  if (agg.length === 0) return [];

  const lastTime = agg[agg.length - 1].timeSec + bucketSec;
  const edges = [0, ...boundaries.filter((b) => b > 0 && b < lastTime), lastTime];
  const sortedEdges = [...new Set(edges)].sort((a, b) => a - b);
  if (sortedEdges.length < 2) return [];

  const spans = sortedEdges.slice(0, -1).map((start, i) => {
    const end = sortedEdges[i + 1];
    const inSpan = agg.filter((f) => f.timeSec >= start && f.timeSec < end);
    const fingerprint = averageChroma(inSpan.length ? inSpan.map((f) => f.chroma) : [agg[0].chroma]);
    return { start, end, fingerprint };
  });

  const fingerprints = spans.map((s) => s.fingerprint);
  const chorusIndices = findMostRepeatedGroup(fingerprints);

  const counts: Partial<Record<DetectedSectionType, number>> = {};
  return spans.map((seg, i) => {
    let type: DetectedSectionType;
    if (chorusIndices.has(i)) {
      type = 'chorus';
    } else if (i === 0 && spans.length > 1) {
      type = 'intro';
    } else if (i === spans.length - 1 && spans.length > 2) {
      type = 'outro';
    } else if (isBridge(i, fingerprints, chorusIndices)) {
      type = 'bridge';
    } else {
      type = 'verse';
    }

    const n = (counts[type] = (counts[type] ?? 0) + 1);
    const label = type === 'intro' || type === 'outro' || type === 'bridge' ? capitalize(type) : `${capitalize(type)} ${n}`;

    return { type, label, startSec: seg.start, endSec: seg.end };
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Detect and label in one call - the shape most callers actually want. */
export function detectSections(frames: ChromaFrame[], opts: SectionDetectionOptions = {}): DetectedSection[] {
  const boundaries = detectSectionBoundaries(frames, opts);
  return labelSegments(boundaries, frames, opts.bucketSec ?? DEFAULT_BUCKET_SEC);
}
