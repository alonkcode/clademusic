/**
 * Personalized feed ranking.
 *
 * The candidate pool is the same daily-seeded catalog pick the guest feed uses
 * (trackService.fetchTracks with randomize), so a refresh can't reshuffle it.
 * Personalization only re-ranks inside that pool. Array.prototype.sort is
 * stable and ties fall back to pool order, so the ranking is a pure function of
 * the pool and the signals.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Track } from '@/types';
import type { TasteDNAProfile } from '@/api/tasteDNA';
import { fetchTracks, type TrackResult } from '@/services/trackService';
import { scoreTrackByTaste } from '@/services/recommendationService';
import { fetchFollowingIds } from '@/services/followService';

const POOL_SIZE = 200;
const TASTE_WEIGHT = 0.6;
const SOCIAL_WEIGHT = 0.4;
const SOCIAL_WINDOW_DAYS = 14;
/** This many followed users playing a track counts as full social score. */
const SOCIAL_SATURATION = 3;
const SKIP_THRESHOLD = 2;
/** Every Nth slot is an exploration pick instead of the next best match. */
const EXPLORE_EVERY = 4;

export interface FeedSignals {
  tasteDNA: TasteDNAProfile | null;
  /** track id -> distinct followed users who played it recently */
  followingListeners: Map<string, number>;
  /** track ids this user keeps skipping */
  skipped: Set<string>;
}

export interface PersonalizedFeedResult extends TrackResult {
  /** False when there was nothing to personalize with (a new user). */
  personalized: boolean;
}

// scoreTrackByTaste gives any track it can't compare a flat zero. A track with
// no analysis data isn't a bad match, it's an unknown - treated as unscored so
// it can surface through the exploration slots rather than sink.
function hasTasteFeatures(track: Track): boolean {
  return (
    !!track.progression_roman?.length ||
    (!!track.detected_mode && track.detected_mode !== 'unknown') ||
    typeof track.energy === 'number' ||
    typeof track.tempo === 'number'
  );
}

function combinedScore(
  track: Track,
  signals: FeedSignals,
  socialAvailable: boolean
): number | null {
  let total = 0;
  let weight = 0;

  if (signals.tasteDNA && hasTasteFeatures(track)) {
    total += TASTE_WEIGHT * scoreTrackByTaste(track, signals.tasteDNA).score;
    weight += TASTE_WEIGHT;
  }
  if (socialAvailable) {
    const listeners = signals.followingListeners.get(track.id) ?? 0;
    total += SOCIAL_WEIGHT * Math.min(1, listeners / SOCIAL_SATURATION);
    weight += SOCIAL_WEIGHT;
  }

  // Renormalised over the signals that exist, so a missing one doesn't drag
  // every score toward zero.
  return weight > 0 ? total / weight : null;
}

/**
 * Re-ranks `pool` by taste match and what followed users have been playing.
 * With no signals at all the pool is returned untouched.
 */
export function rankFeed(pool: Track[], signals: FeedSignals): Track[] {
  const socialAvailable = signals.followingListeners.size > 0;
  if (!signals.tasteDNA && !socialAvailable && signals.skipped.size === 0) return pool;

  const scored: { track: Track; score: number; index: number }[] = [];
  const unscored: Track[] = [];
  const demoted: Track[] = [];

  pool.forEach((track, index) => {
    if (signals.skipped.has(track.id)) {
      demoted.push(track);
      return;
    }
    const score = combinedScore(track, signals, socialAvailable);
    if (score === null) unscored.push(track);
    else scored.push({ track, score, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const ranked: Track[] = [];
  let s = 0;
  let u = 0;
  while (s < scored.length || u < unscored.length) {
    const exploreSlot = ranked.length % EXPLORE_EVERY === EXPLORE_EVERY - 1;
    if ((exploreSlot && u < unscored.length) || s >= scored.length) ranked.push(unscored[u++]);
    else ranked.push(scored[s++].track);
  }

  return [...ranked, ...demoted];
}

async function orNull<T>(label: string, promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    console.warn(`[feedService] ${label} unavailable, ranking without it:`, error);
    return null;
  }
}

/** Track id -> how many distinct followed users played it in the recent window. */
export async function fetchFollowingListeners(userId: string): Promise<Map<string, number>> {
  const followingIds = await fetchFollowingIds(userId);
  if (followingIds.length === 0) return new Map();

  const since = new Date(Date.now() - SOCIAL_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('play_history')
    .select('user_id, track_id')
    .in('user_id', followingIds)
    .gte('played_at', since)
    .limit(1000);
  if (error) throw error;

  const listenersByTrack = new Map<string, Set<string>>();
  for (const row of (data ?? []) as { user_id: string; track_id: string }[]) {
    if (!row.track_id) continue;
    const listeners = listenersByTrack.get(row.track_id) ?? new Set<string>();
    listeners.add(row.user_id);
    listenersByTrack.set(row.track_id, listeners);
  }
  return new Map([...listenersByTrack].map(([trackId, listeners]) => [trackId, listeners.size]));
}

export async function fetchSkippedTrackIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('user_interactions')
    .select('track_id')
    .eq('user_id', userId)
    .gte('skip_count', SKIP_THRESHOLD)
    .limit(500);
  if (error) throw error;
  return new Set(((data ?? []) as { track_id: string }[]).map((row) => row.track_id));
}

export async function getPersonalizedFeed(input: {
  userId: string;
  limit: number;
  tasteDNA: TasteDNAProfile | null;
}): Promise<PersonalizedFeedResult> {
  const { userId, limit, tasteDNA } = input;

  const [pool, followingListeners, skipped] = await Promise.all([
    fetchTracks({ limit: POOL_SIZE, randomize: true }),
    orNull('following activity', fetchFollowingListeners(userId)),
    orNull('skip history', fetchSkippedTrackIds(userId)),
  ]);

  const signals: FeedSignals = {
    tasteDNA,
    followingListeners: followingListeners ?? new Map(),
    skipped: skipped ?? new Set(),
  };
  const personalized = !!tasteDNA || signals.followingListeners.size > 0 || signals.skipped.size > 0;

  return {
    ...pool,
    tracks: rankFeed(pool.tracks, signals).slice(0, limit),
    personalized,
  };
}
