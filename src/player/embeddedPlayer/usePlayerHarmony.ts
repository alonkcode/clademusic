import { useMemo } from 'react';
import { useTrackSections } from '@/hooks/api/useTrackSections';
import { useTrack } from '@/hooks/api/useTracks';
import { useHarmonicFingerprint } from '@/hooks/api/useHarmonicFingerprint';
import { isTestEnv } from '@/lib/env';
import { isUuid } from './constants';
import type { SongSection } from '@/types';

export interface PlayerHarmony {
  detectedKey: string | null;
  detectedMode: 'major' | 'minor' | 'unknown' | null;
  cadenceType: string | null;
  confidenceScore: number | null;
  progression: string[];
  bpm: number | undefined;
  /** Bars in one cycle of `progression` - lets the chord-rotation heuristic
   *  derive how many beats each chord actually holds instead of assuming 4. */
  loopLengthBars: number | undefined;
  /** The catalog's own known duration - independent of whatever (if
   *  anything) the live embed itself reports. See its use in
   *  EmbeddedPlayerDrawer for why that distinction matters. */
  catalogDurationMs: number | undefined;
}

/**
 * Section, key/mode/progression/tempo data for whichever track is loaded -
 * feeds both HarmonicHUD (the rotating chord readout) and the section-jump
 * chips/loop button, and the seekbar's section tick marks.
 */
export function usePlayerHarmony(canonicalTrackId: string | null | undefined) {
  const analysisTrackId = !isTestEnv && isUuid(canonicalTrackId) ? canonicalTrackId : undefined;

  const sectionsQuery = useTrackSections(analysisTrackId);
  const sections = useMemo(() => {
    const raw = sectionsQuery.data;
    if (!Array.isArray(raw)) return [];
    return [...raw].sort((a, b) => a.start_ms - b.start_ms);
  }, [sectionsQuery.data]);

  const trackQuery = useTrack(analysisTrackId, !!analysisTrackId);
  const fingerprintQuery = useHarmonicFingerprint(analysisTrackId);
  const harmony: PlayerHarmony = useMemo(() => {
    const track = trackQuery.data ?? null;
    const fingerprint = fingerprintQuery.data ?? null;

    const detectedKey = (fingerprint as any)?.detected_key ?? (track as any)?.detected_key ?? null;
    const detectedMode = (fingerprint as any)?.detected_mode ?? (track as any)?.detected_mode ?? null;
    const cadenceType = (fingerprint as any)?.cadence_type ?? (track as any)?.cadence_type ?? null;
    const confidenceScore =
      typeof (fingerprint as any)?.confidence_score === 'number'
        ? (fingerprint as any).confidence_score
        : typeof (track as any)?.confidence_score === 'number'
          ? (track as any).confidence_score
          : null;

    const fromTrack: string[] = Array.isArray((track as any)?.progression_roman) ? (track as any).progression_roman : [];
    const fromFingerprint: string[] = Array.isArray((fingerprint as any)?.roman_progression)
      ? (fingerprint as any).roman_progression.map((c: any) => c?.numeral).filter(Boolean)
      : [];

    const progression = fromTrack.length ? fromTrack : fromFingerprint;

    return {
      detectedKey,
      detectedMode,
      cadenceType,
      confidenceScore,
      progression,
      bpm: typeof track?.tempo === 'number' ? track.tempo : undefined,
      loopLengthBars: typeof track?.loop_length_bars === 'number' ? track.loop_length_bars : undefined,
      catalogDurationMs: typeof (track as any)?.duration_ms === 'number' ? (track as any).duration_ms : undefined,
    };
  }, [fingerprintQuery.data, trackQuery.data]);

  // HarmonicHUD - the rotating chord readout - already existed and already
  // does exactly this (chords that advance with real playback position), but
  // only ever got mounted inside the feed's TrackCard. The player itself
  // stays mounted across every route, so that was the whole reason chords
  // never showed up anywhere except the feed. sections needs converting: HUD
  // takes seconds (SongSection), this component's own sections are
  // milliseconds (TrackSection, from track_sections). chords/chord_timings
  // (a section's own real, per-chord-analyzed progression, when curated)
  // are carried over too - dropping them here silently forced every section
  // onto the generic bpm/beats-per-chord guess in useSectionSync even for a
  // track that actually had real per-chord timing.
  const hudSections: SongSection[] = useMemo(
    () =>
      sections.map((s) => ({
        type: s.label,
        start_time: s.start_ms / 1000,
        end_time: s.end_ms / 1000,
        chords: s.chords,
        chord_timings: s.chord_timings,
      })),
    [sections]
  );

  return { sections, harmony, hudSections };
}
