import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * The admin side of live chord detection: the queue of captures waiting for
 * review, one run's detail, and the promote/reject decisions.
 *
 * All four RPCs are admin-gated in the database rather than here - these
 * tables are closed to clients by RLS, and the promote/reject functions are
 * SECURITY DEFINER with their own has_role check. This layer is convenience,
 * not the guard.
 */

export type DetectionRunStatus = 'pending' | 'promoted' | 'rejected';

export interface DetectionRunSummary {
  id: string;
  track_id: string;
  track_title: string | null;
  track_artist: string | null;
  contributor: string | null;
  status: DetectionRunStatus;
  detected_key: string | null;
  detected_mode: 'major' | 'minor' | null;
  key_confidence: number | null;
  covered_from_ms: number;
  covered_to_ms: number;
  section_count: number;
  chord_count: number;
  created_at: string;
}

export interface DetectionRunChord {
  numeral: string;
  root_pitch_class: number;
  quality: 'major' | 'minor';
  start_ms: number;
  end_ms: number;
  confidence: number | null;
}

export interface DetectionRunSection {
  section_id: string;
  label: string;
  ordinal: number;
  start_ms: number;
  end_ms: number;
  loop_roman: string[];
  confidence: number | null;
  chords: DetectionRunChord[];
}

export function useDetectionRuns(status: DetectionRunStatus | 'all' = 'pending') {
  return useQuery({
    queryKey: ['detectionRuns', status],
    queryFn: async (): Promise<DetectionRunSummary[]> => {
      const { data, error } = await supabase.rpc('list_detection_runs' as never, {
        p_status: status,
        p_limit: 50,
      } as never);
      if (error) {
        // The script may not have been applied to this project yet; an empty
        // queue reads better than a broken tab.
        console.debug('list_detection_runs unavailable:', error.message);
        return [];
      }
      return (data as unknown as DetectionRunSummary[]) ?? [];
    },
    staleTime: 30_000,
  });
}

/** One run's sections with their chords. Only fetched when a run is opened. */
export function useDetectionRunDetail(runId: string | null) {
  return useQuery({
    queryKey: ['detectionRun', runId],
    enabled: Boolean(runId),
    queryFn: async (): Promise<DetectionRunSection[]> => {
      const { data, error } = await supabase.rpc('get_detection_run' as never, {
        p_run_id: runId,
      } as never);
      if (error) {
        console.debug('get_detection_run failed:', error.message);
        return [];
      }
      return (data as unknown as DetectionRunSection[]) ?? [];
    },
  });
}

/**
 * Promoting rewrites a track's canonical sections, so every view built on
 * them is stale afterwards - the queue, the run, and the track's own
 * sections wherever the player is showing them.
 */
export function usePromoteDetectionRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.rpc('promote_detection_run' as never, {
        p_run_id: runId,
      } as never);
      if (error) throw new Error(error.message);
      const rows = data as unknown as Array<{ track_id: string; sections_written: number }>;
      return rows?.[0] ?? { track_id: '', sections_written: 0 };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['detectionRuns'] });
      queryClient.invalidateQueries({ queryKey: ['detectionRun'] });
      queryClient.invalidateQueries({ queryKey: ['track-sections'] });
    },
  });
}

export function useRejectDetectionRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.rpc('reject_detection_run' as never, {
        p_run_id: runId,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['detectionRuns'] });
    },
  });
}
