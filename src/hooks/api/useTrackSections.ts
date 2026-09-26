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
function saveErrorMessage(error: { message?: string; code?: string }, withChords: boolean): string {
  if (error.code === 'PGRST202' || error.code === '42883') {
    // A save carrying chords calls a function signature only script 32 creates,
    // so a database that has 19 and 31 but not 32 lands here too - and the
    // structure-only advice would send the admin to scripts already run.
    if (withChords) {
      return 'Saving chords is not set up in the database yet. Run supabase/sql-editor/32-save-track-sections-chords.sql in the SQL editor (after 19 and 31 if you have not run those).';
    }
    return 'Saving sections is not set up in the database yet. Run supabase/sql-editor/19-save-track-sections.sql (then 31-save-track-sections-mirror.sql) in the SQL editor.';
  }
  if (error.code === '42501') return 'Only an admin can edit a track\'s sections.';
  return error.message || 'Could not save these sections.';
}

/** A section to store. Chords, when present, are relative to `start_ms` and the same length. */
export interface SectionToSave {
  label: string;
  ordinal: number;
  start_ms: number;
  end_ms: number;
  progression_roman?: string[];
  chord_timings?: number[];
}

/**
 * Save a hand-edited set of sections, and their chords, for a track.
 *
 * Chords are stored only when the call says it carries them (`p_with_chords`).
 * The flag is sent only when some section has chords, so a structure-only save
 * still works against a database that has not had script 32 applied, while a
 * save with chords against one that has not fails loudly instead of returning
 * "saved" for data it never wrote.
 */
export function useSaveTrackSections() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { trackId: string; sections: SectionToSave[] }) => {
      const withChords = args.sections.some((s) => (s.progression_roman?.length ?? 0) > 0);
      const { data, error } = await supabase.rpc('save_track_sections' as never, {
        p_track_id: args.trackId,
        p_sections: args.sections,
        ...(withChords ? { p_with_chords: true } : {}),
      } as never);
      if (error) throw new Error(saveErrorMessage(error, withChords));
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
