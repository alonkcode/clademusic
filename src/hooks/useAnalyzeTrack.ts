/**
 * Analyse the track that is playing, save it once it is good enough, and stop
 * asking.
 *
 * This is the "unknown track" flow: a track nobody has analysed gets one
 * listen (one click - the browser insists on it, see useLiveChordDetection),
 * and when the capture is good enough on its own terms it is sent to the
 * server, which stores it as that track's analysis for everyone. The listener
 * never presses Save: the same rule the server applies
 * (@/lib/harmony/autoPromotion) tells this hook when to send.
 *
 * What it deliberately does not do:
 *   - Charge a credit. The first analysis of a track that has none adds to the
 *     shared catalog, and the option only exists while the track has no
 *     analysis, so it cannot be farmed.
 *   - Keep sending. A few attempts per capture, spaced by new coverage; every
 *     attempt is a run row and counts against the daily cap.
 *   - Combine captures. A capture that ends early is thrown away when the next
 *     starts, the same as everywhere else in the live pipeline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useLiveChordDetection, type UseLiveChordDetectionResult } from '@/hooks/useLiveChordDetection';
import { parseSyntheticTrackId, resolvedTrackIdKey } from '@/hooks/api/useResolvedTrackId';
import {
  buildDetectionRunPayload,
  submitDetectionRun,
  type DetectionTrackRef,
} from '@/api/detectionRuns';
import {
  evaluateAutoPromotion,
  requiredCoverageMs,
  type AutoPromotionProgress,
} from '@/lib/harmony/autoPromotion';
import { QUERY_KEYS } from '@/lib/constants';
import { toast } from '@/hooks/use-toast';

/** Sends per capture. Each one is a stored run, and the server caps runs per day. */
const MAX_AUTO_ATTEMPTS = 3;
/** After a send the server declined, wait for this much more of the song before trying again. */
const RETRY_EXTRA_COVERAGE_MS = 15_000;
/** How long a capture may run before "your player reports no position" is worth saying. */
const ALIGNMENT_GRACE_MS = 10_000;

export interface AnalyzeTarget {
  provider: string | null | undefined;
  /** The provider's own id for the track, as the player holds it. */
  providerTrackId: string | null | undefined;
  canonicalTrackId: string | null | undefined;
  title: string;
  artist: string;
  album?: string | null;
  /** From the player; 0 or absent until the embed reports it. */
  durationMs?: number | null;
  /** The catalog row, when there is one already. */
  resolvedTrackId?: string;
}

export type AnalyzeState =
  | 'unsupported'
  | 'signed-out'
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'saving'
  | 'saved'
  | 'already'
  | 'stopped'
  | 'error';

export interface UseAnalyzeTrackResult {
  state: AnalyzeState;
  live: UseLiveChordDetectionResult;
  /** How close the capture is to being saveable. Zeroed until there is anything to judge. */
  progress: AutoPromotionProgress;
  /** Capturing, but the player never reports a moving position - the run could not be tied to the song. */
  unaligned: boolean;
  message: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

/** Providers the server can create a catalog row for. */
const isSupportedProvider = (provider: string | null | undefined): provider is 'spotify' | 'youtube' =>
  provider === 'spotify' || provider === 'youtube';

/**
 * Is this the moment to offer analysis? Only for a loaded track whose
 * analysis has finished loading and turned out to be empty - offering it while
 * the lookup is still running would flash the prompt at every track that
 * already has an answer. And without a title and artist the server cannot
 * create the catalog row a saved analysis needs, so there is nothing to offer.
 */
export function shouldOfferAnalysis(args: {
  isIdle: boolean;
  isLoading: boolean;
  provider: string | null | undefined;
  title: string | null | undefined;
  artist: string | null | undefined;
  hasProgression: boolean;
  hasSections: boolean;
}): boolean {
  return (
    !args.isIdle &&
    !args.isLoading &&
    isSupportedProvider(args.provider) &&
    Boolean(args.title?.trim()) &&
    Boolean(args.artist?.trim()) &&
    !args.hasProgression &&
    !args.hasSections
  );
}

export function useAnalyzeTrack(target: AnalyzeTarget): UseAnalyzeTrackResult {
  const live = useLiveChordDetection();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [saved, setSaved] = useState<'none' | 'saved' | 'already'>('none');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [alignmentGraceOver, setAlignmentGraceOver] = useState(false);

  const attemptsRef = useRef(0);
  const lastAttemptCoverageRef = useRef(0);
  const endAttemptedRef = useRef(false);
  const inFlightRef = useRef(false);

  const atTrackEnd = live.atTrackEnd ?? false;

  // The server validates ids strictly, so hand it the normalised one from the
  // canonical id when there is one rather than whatever form the player kept.
  const trackRef = useMemo<DetectionTrackRef | null>(() => {
    if (!isSupportedProvider(target.provider)) return null;
    const fromCanonical = parseSyntheticTrackId(target.canonicalTrackId);
    const providerTrackId =
      fromCanonical?.provider === target.provider ? fromCanonical.providerId : target.providerTrackId;
    if (!providerTrackId || !target.title || !target.artist) return null;
    const duration = target.durationMs && target.durationMs >= 1000 ? Math.round(target.durationMs) : null;
    return {
      provider: target.provider,
      providerTrackId,
      title: target.title,
      artist: target.artist,
      album: target.album ?? null,
      durationMs: duration,
    };
  }, [
    target.provider,
    target.canonicalTrackId,
    target.providerTrackId,
    target.title,
    target.artist,
    target.album,
    target.durationMs,
  ]);

  const payload = useMemo(
    () =>
      trackRef
        ? buildDetectionRunPayload({
            trackId: target.resolvedTrackId,
            trackRef,
            sectionProgressions: live.sectionProgressions,
            detectedKey: live.detectedKey,
            tempo: live.tempo,
          })
        : null,
    [trackRef, target.resolvedTrackId, live.sectionProgressions, live.detectedKey, live.tempo]
  );

  const verdict = useMemo(
    () => (payload ? evaluateAutoPromotion(payload, target.durationMs) : null),
    [payload, target.durationMs]
  );

  const capturing = live.status === 'capturing';

  // A capture has to be tied to the song's own clock to be worth saving. Give
  // the player a moment to start reporting before deciding it never will.
  useEffect(() => {
    if (!capturing) {
      setAlignmentGraceOver(false);
      return;
    }
    const timer = setTimeout(() => setAlignmentGraceOver(true), ALIGNMENT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [capturing]);

  // A new capture is a fresh set of attempts.
  useEffect(() => {
    if (live.status === 'requesting') {
      attemptsRef.current = 0;
      lastAttemptCoverageRef.current = 0;
      endAttemptedRef.current = false;
      setSaveError(null);
      setGaveUp(false);
    }
  }, [live.status]);

  const settle = useCallback(
    (trackId: string | undefined) => {
      // Point the resolver at the row the server just made, so the analysis is
      // found on this very render rather than after the resolver's own cache
      // expires - then have everything that reads it look again.
      if (trackId) queryClient.setQueryData(resolvedTrackIdKey(target.canonicalTrackId), trackId);
      void queryClient.invalidateQueries({ queryKey: ['resolved-track-id'] });
      void queryClient.invalidateQueries({ queryKey: ['track-sections'] });
      void queryClient.invalidateQueries({ queryKey: ['harmonic-fingerprint'] });
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRACKS] });
    },
    [queryClient, target.canonicalTrackId]
  );

  const stopLive = live.stop;

  useEffect(() => {
    if (!capturing || !payload || !verdict?.ok || !user) return;
    // Times only mean something against the song when the player reports its
    // position; without that the server would be handed a timeline that is
    // relative to when the listener happened to click.
    if (!live.timingAligned) return;
    if (inFlightRef.current || saved !== 'none') return;
    if (endAttemptedRef.current) return;
    if (attemptsRef.current >= MAX_AUTO_ATTEMPTS && !atTrackEnd) return;
    if (
      attemptsRef.current > 0 &&
      verdict.progress.coverageMs - lastAttemptCoverageRef.current < RETRY_EXTRA_COVERAGE_MS
    ) {
      return;
    }

    inFlightRef.current = true;
    if (atTrackEnd) endAttemptedRef.current = true;
    attemptsRef.current += 1;
    lastAttemptCoverageRef.current = verdict.progress.coverageMs;
    setSaving(true);
    setSaveError(null);

    submitDetectionRun(payload)
      .then((result) => {
        if (result.promoted) {
          settle(result.trackId);
          setSaved('saved');
          stopLive();
          toast({
            title: 'Analysis saved',
            description: `${target.title} now has its chords, key${payload.tempo ? ' and BPM' : ''} for everyone.`,
          });
        } else if (result.reason === 'already_analysed') {
          // Someone else got there first. Not a failure: the analysis exists.
          settle(result.trackId);
          setSaved('already');
          stopLive();
        }
        // Any other reason is the server wanting more than it has heard; keep
        // listening and the next attempt goes out once there is more of the
        // song - until the attempts run out.
        else if (attemptsRef.current >= MAX_AUTO_ATTEMPTS) setGaveUp(true);
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : 'Could not save this analysis.');
        if (attemptsRef.current >= MAX_AUTO_ATTEMPTS) setGaveUp(true);
      })
      .finally(() => {
        inFlightRef.current = false;
        setSaving(false);
      });
  }, [atTrackEnd, capturing, payload, verdict, user, live.timingAligned, saved, settle, stopLive, target.title]);

  const start = useCallback(async () => {
    setSaved('none');
    setSaveError(null);
    setGaveUp(false);
    await live.start();
  }, [live]);

  const unaligned = capturing && alignmentGraceOver && !live.timingAligned;

  let state: AnalyzeState;
  let message: string | null = null;
  if (saved === 'saved') state = 'saved';
  else if (saved === 'already') state = 'already';
  else if (!live.supported && live.status !== 'capturing') state = 'unsupported';
  else if (!user) state = 'signed-out';
  else if (live.status === 'requesting') state = 'requesting';
  else if (capturing) {
    state = saving ? 'saving' : 'listening';
    if (gaveUp) message = 'Could not save this yet. You can stop and try again.';
    else if (saveError) message = saveError;
  } else if (live.status === 'error') {
    state = 'error';
    message = live.errorMessage;
  } else if (live.chordSpans.length > 0) state = 'stopped';
  else state = 'idle';

  return {
    state,
    live,
    progress: verdict?.progress ?? {
      keyConfidence: 0,
      chords: 0,
      sections: 0,
      coverageMs: 0,
      requiredCoverageMs: requiredCoverageMs(target.durationMs),
      ratio: 0,
    },
    unaligned,
    message,
    start,
    stop: live.stop,
  };
}
