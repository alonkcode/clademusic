/**
 * Track Sections API Hook
 * 
 * Fetches canonical song structure sections (intro, verse, chorus, etc.)
 * for seek-based playback across providers.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getTrackSections } from '@/api/trackSections';
import { QUERY_KEYS } from '@/lib/constants';
import type { TrackSection } from '@/types';

/**
 * React Query hook for fetching track sections.
 *
 * Delegates to the API-layer getTrackSections, which tries the canonical
 * track_sections table (populated by promoted live-detection runs) and
 * falls back to the tracks.sections JSONB column (hand-curated structural
 * boundaries seeded into the catalog) when that table has no rows. Without
 * the fallback, the persistent player bar's HarmonicHUD gets an empty
 * sections array for every catalog track, so useSectionSync's
 * liveChordIndex hard-returns 0 and the chord readout never rotates.
 */
export function useTrackSections(trackId: string | undefined) {
  return useQuery({
    queryKey: ['track-sections', trackId],
    queryFn: () => getTrackSections(trackId!),
    enabled: !!trackId,
    staleTime: 1000 * 60 * 60, // Sections rarely change - cache for 1 hour
    gcTime: 1000 * 60 * 60 * 24, // Keep in cache for 24 hours
  });
}

/**
 * Get a specific section by label
 */
export function findSectionByLabel(
  sections: TrackSection[],
  label: TrackSection['label']
): TrackSection | undefined {
  return sections.find(s => s.label === label);
}

/**
 * Get the section that contains a given timestamp
 */
export function findSectionAtTime(
  sections: TrackSection[],
  timeMs: number
): TrackSection | undefined {
  return sections.find(s => timeMs >= s.start_ms && timeMs < s.end_ms);
}

/**
 * What to tell the person clicking Save. The raw PostgREST text for a function
 * that has not been installed ("Could not find the function ... in the schema
 * cache") reads like an app bug; it is a missing SQL script.
 */
function saveErrorMessage(error: { message?: string; code?: string }): string {
  if (error.code === 'PGRST202' || error.code === '42883') {
    return 'Saving sections is not set up in the database yet. Run supabase/sql-editor/19-save-track-sections.sql (then 31-save-track-sections-mirror.sql) in the SQL editor.';
  }
  if (error.code === '42501') return 'Only an admin can edit a track\'s sections.';
  return error.message || 'Could not save these sections.';
}

/**
 * Save a hand-marked set of sections for a track.
 *
 * Structure only: the RPC deliberately drops any chord data, because moving a
 * boundary changes which chords fall inside a section and carrying them over
 * would attach them to the wrong part while still looking exact. Chords come
 * back by promoting a detection run.
 */
export function useSaveTrackSections() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      trackId: string;
      sections: Array<{ label: string; ordinal: number; start_ms: number; end_ms: number }>;
    }) => {
      const { data, error } = await supabase.rpc('save_track_sections' as never, {
        p_track_id: args.trackId,
        p_sections: args.sections,
      } as never);
      if (error) throw new Error(saveErrorMessage(error));
      return (data as unknown as number) ?? 0;
    },
    onSuccess: (_count, args) => {
      queryClient.invalidateQueries({ queryKey: ['track-sections', args.trackId] });
      // The database also mirrors the saved structure onto the track's own
      // `sections` column, which is what the feed cards read. Without this
      // they kept showing the old sections until their cache expired.
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRACKS] });
    },
  });
}
