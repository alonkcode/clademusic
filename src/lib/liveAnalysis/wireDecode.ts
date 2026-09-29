/**
 * Wire -> app types for the microphone analysis route.
 *
 * The service speaks milliseconds and 0-100 confidences because that keeps a
 * snapshot a few hundred bytes however long the song is; the app's harmony
 * types are in seconds and 0-1. Every conversion between the two lives here,
 * in one place, so a unit slip cannot hide inside the transport or the hook -
 * a span decoded with the wrong scale would put sections a thousand times too
 * far into the track and still look like a plausible object.
 *
 * Nothing here touches the network or React: it is all pure functions over
 * the types in services/live-analysis/protocol.
 */

import type { ChordSpan } from '@/lib/harmony/chordTimeline';
import type { DetectedSection, DetectedSectionType } from '@/lib/harmony/sectionDetection';
import type { DetectedChord } from '@/lib/harmony/chordDetection';
import type { KeyEstimate } from '@/lib/harmony/keyEstimation';
import type { TempoReading } from '@/lib/harmony/tempoDetection';
import type {
  SnapshotMessage,
  WireChord,
  WireSection,
  WireSpan,
} from '../../../services/live-analysis/protocol';

const SECTION_TYPES: readonly DetectedSectionType[] = ['intro', 'verse', 'chorus', 'bridge', 'outro'];

/** 0-100 on the wire, 0-1 in the app, and never outside that range. */
const confidence = (wire: number): number => Math.max(0, Math.min(1, wire / 100));

/** `[root, minor]` where 1 means minor - the wire has no room for a quality string. */
export function decodeChord(wire: WireChord | null): DetectedChord | null {
  if (!wire) return null;
  const [root, minor] = wire;
  // score has no wire field of its own: a `chord` event is only sent once the
  // server has settled on it, so it is reported at full confidence rather
  // than invented as some lower number.
  return { root, quality: minor === 1 ? 'minor' : 'major', score: 1 };
}

export function decodeSpan(wire: WireSpan): ChordSpan {
  const [root, minor, startMs, endMs, conf] = wire;
  return {
    root,
    quality: minor === 1 ? 'minor' : 'major',
    startSec: startMs / 1000,
    endSec: endMs / 1000,
    confidence: confidence(conf),
  };
}

export function decodeSection(wire: WireSection): DetectedSection {
  // `t` is typed as a plain string on the wire. Anything unrecognised becomes
  // a verse rather than leaking a bad union member into the section types.
  const type = SECTION_TYPES.includes(wire.t as DetectedSectionType)
    ? (wire.t as DetectedSectionType)
    : 'verse';
  return { type, label: wire.l, startSec: wire.s / 1000, endSec: wire.e / 1000 };
}

export function decodeKey(wire: SnapshotMessage['key']): KeyEstimate | null {
  if (!wire) return null;
  return { tonic: wire.tonic, mode: wire.minor === 1 ? 'minor' : 'major', confidence: confidence(wire.confidence) };
}

export function decodeTempo(wire: SnapshotMessage['tempo']): TempoReading | null {
  if (!wire) return null;
  return { bpm: wire.bpm, confidence: confidence(wire.confidence) };
}

/**
 * Apply a snapshot's chord-span delta.
 *
 * `spans` replaces everything from `spanStart` onward rather than being
 * appended, which is what keeps a long song's snapshot the size of its newest
 * few chords: the server re-sends the tail because the last span keeps growing
 * while the chord is still sounding.
 *
 * A `spanStart` past the end of what we hold means frames were missed, so the
 * delta cannot be placed. Keeping what we have and ignoring the delta would
 * silently leave a hole in the timeline; the next snapshot re-sends from a
 * reachable index, so dropping this one is the honest recovery.
 */
export function applySpanDelta(current: ChordSpan[], spanStart: number, spans: WireSpan[]): ChordSpan[] {
  if (spanStart < 0 || spanStart > current.length) return current;
  return [...current.slice(0, spanStart), ...spans.map(decodeSpan)];
}
