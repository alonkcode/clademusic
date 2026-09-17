/**
 * Track Sections API
 * 
 * Clean API layer for fetching track sections.
 * No Supabase calls in JSX - all data fetching here.
 */

import { supabase } from '@/integrations/supabase/client';
import type { TrackSection } from '@/types';

/**
 * Fetch all sections for a track, ordered by start time
 */
/** Seconds in tracks.sections; milliseconds everywhere the app uses them. */
function sectionsColumnToTrackSections(trackId: string, raw: unknown): TrackSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any, index: number) => {
      const start = Number(entry?.start_time);
      const end = Number(entry?.end_time);
      if (!Number.isFinite(start)) return null;
      return {
        id: `${trackId}-${entry?.type ?? 'section'}-${index}`,
        track_id: trackId,
        label: entry?.label || entry?.type || 'section',
        start_ms: Math.max(0, Math.round(start * 1000)),
        end_ms: Number.isFinite(end) ? Math.max(0, Math.round(end * 1000)) : 0,
        created_at: new Date().toISOString(),
      } as TrackSection;
    })
    .filter((s): s is TrackSection => s !== null)
    .sort((a, b) => a.start_ms - b.start_ms);
}

export async function getTrackSections(trackId: string): Promise<TrackSection[]> {
  // Using rpc approach to avoid type issues with new table
  // Once migration is applied and types regenerated, can switch to .from('track_sections')
  const { data, error } = await supabase.rpc('get_track_sections' as never, {
    p_track_id: trackId,
  } as never);

  if (!error) {
    const rows = (data as unknown as TrackSection[]) ?? [];
    if (rows.length > 0) return rows;
  } else {
    // Table/function might not exist yet - fall through gracefully
    console.debug('track_sections not available:', error.message);
  }

  // The track_sections table is the eventual home for analyzed sections, but
  // it is empty, so this used to return nothing at all - and every caller then
  // fabricated sections at fixed percentages of the duration (10%/30%/50%...),
  // which is why every song showed the same intro/verse/chorus boundaries no
  // matter how it actually goes.
  //
  // Real, per-song boundaries already exist for some tracks in the catalog's
  // own tracks.sections column; they were simply never read on this path. Use
  // them when they are there.
  const { data: track, error: trackError } = await supabase
    .from('tracks')
    .select('sections')
    .eq('id', trackId)
    .maybeSingle();

  if (trackError) {
    console.debug('tracks.sections not readable:', trackError.message);
    return [];
  }

  return sectionsColumnToTrackSections(trackId, (track as { sections?: unknown } | null)?.sections);
}

/**
 * Get a specific section by ID
 */
export async function getTrackSection(sectionId: string): Promise<TrackSection | null> {
  const { data, error } = await supabase.rpc('get_track_section_by_id' as never, {
    p_section_id: sectionId,
  } as never);

  if (error) {
    console.debug('get_track_section_by_id not available:', error.message);
    return null;
  }

  const sections = data as unknown as TrackSection[];
  return sections?.[0] ?? null;
}
