/**
 * Similarity Engine
 * 
 * Find tracks with similar harmonic structures.
 * Uses relative theory matching, not genre/metadata.
 * 
 * ALGORITHM:
 * 1. Extract harmonic fingerprint from reference track
 * 2. Query database for tracks with similar:
 *    - Roman numeral progression shape
 *    - Cadence type
 *    - Loop length
 *    - Modal color
 * 3. Score matches using configurable weights
 * 4. Return ranked results
 * 
 * TODO: Add ML-based embedding similarity for nuanced matching
 * TODO: Implement progression transposition matching (rotate progressions)
 */

import type {
  SimilarityQuery,
  SimilarityResult,
  SimilarityFilters,
  SimilarityWeights,
  HarmonicFingerprint,
  RomanChord,
} from '@/types/harmony';
import { compareProgressions } from '@/types/harmony';
import { supabase } from '@/integrations/supabase/client';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_WEIGHTS: Required<SimilarityWeights> = {
  progression_shape: 0.50, // Most important
  cadence_type: 0.20,
  loop_length: 0.15,
  modal_color: 0.10,
  tempo: 0.05, // Least important
};

const DEFAULT_MAX_RESULTS = 20;

// ============================================================================
// MAIN SIMILARITY API
// ============================================================================

/**
 * Find tracks similar to a reference track
 */
export async function findSimilarTracks(
  query: SimilarityQuery
): Promise<SimilarityResult[]> {
  try {
    // Step 1: Get reference track's harmonic fingerprint
    const reference = await getFingerprint(query.reference_track_id);
    if (!reference) {
      throw new Error('Reference track not found');
    }

    // Step 2: Query candidate tracks
    const candidates = await queryCandidates(reference, query.filters);

    // Step 3: Score each candidate
    const weights = { ...DEFAULT_WEIGHTS, ...query.weights };
    const scored = candidates.map(candidate => ({
      track_id: candidate.track_id,
      similarity_score: calculateSimilarity(reference, candidate, weights),
      matching_features: getMatchingFeatures(reference, candidate),
      explanation: generateExplanation(reference, candidate),
    }));

    // Step 4: Sort and limit results
    const maxResults = query.max_results || DEFAULT_MAX_RESULTS;
    return scored
      .filter(r => r.similarity_score > 0.3) // Minimum threshold
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, maxResults);
  } catch (error) {
    console.error('[SimilarityEngine] Error:', error);
    return [];
  }
}

/**
 * Find tracks matching a specific progression pattern
 * Supports progression rotation matching
 */
export async function findByProgression(
  progression: RomanChord[],
  options?: { max_results?: number; allow_rotation?: boolean }
): Promise<SimilarityResult[]> {
  const maxResults = options?.max_results || DEFAULT_MAX_RESULTS;
  const allowRotation = options?.allow_rotation ?? true;
  
  try {
    // Query database for candidate tracks
    const { data: candidates, error } = await supabase
      .from('harmonic_fingerprints')
      .select('*')
      .gte('confidence_score', 0.5) // Minimum confidence threshold
      .order('confidence_score', { ascending: false })
      .limit(maxResults * 3); // Over-fetch for filtering

    if (error) {
      console.error('[SimilarityEngine] Query error:', error);
      return [];
    }

    if (!candidates || candidates.length === 0) {
      return [];
    }

    // Score and filter matches
    const results: SimilarityResult[] = [];

    for (const candidate of candidates as HarmonicFingerprint[]) {
      const candidateProg = candidate.roman_progression;

      // Direct match
      const directScore = compareProgressions(progression, candidateProg);
      let bestScore = directScore;
      let rotationOffset: number | undefined;
      let matchedWithRotation = false;

      // Check rotations if enabled
      if (allowRotation && candidateProg.length === progression.length) {
        for (let offset = 1; offset < candidateProg.length; offset++) {
          const rotated = rotateProgression(candidateProg, offset);
          const rotatedScore = compareProgressions(progression, rotated);
          
          if (rotatedScore > bestScore) {
            bestScore = rotatedScore;
            rotationOffset = offset;
            matchedWithRotation = true;
          }
        }
      }

      // If score is high enough, add to results
      if (bestScore >= 0.6) {
        results.push({
          track_id: candidate.track_id,
          similarity_score: bestScore,
          matching_features: {
            shared_progression_shape: true,
            cadence_match: candidate.cadence_type,
            rotation_offset: matchedWithRotation ? rotationOffset : undefined,
          },
          explanation: matchedWithRotation
            ? `Matches progression with ${rotationOffset}-chord rotation (${(bestScore * 100).toFixed(0)}% similarity)`
            : `Direct progression match (${(bestScore * 100).toFixed(0)}% similarity)`,
        });
      }
    }

    // Sort by score and limit
    return results
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, maxResults);
  } catch (error) {
    console.error('[SimilarityEngine] Error in findByProgression:', error);
    return [];
  }
}

/**
 * Get harmonic clusters (groups of similar tracks)
 */
export async function getHarmonicClusters(
  minClusterSize: number = 5
): Promise<Array<{ prototype: RomanChord[]; track_ids: string[] }>> {
  // TODO: Implement clustering algorithm
  // 1. Group tracks by progression similarity
  // 2. Find cluster centroids
  // 3. Return clusters above size threshold
  
  return [];
}

// ============================================================================
// SIMILARITY SCORING
// ============================================================================

/**
 * Calculate overall similarity score
 */
function calculateSimilarity(
  reference: HarmonicFingerprint,
  candidate: HarmonicFingerprint,
  weights: Required<SimilarityWeights>
): number {
  let totalScore = 0;

  // 1. Progression shape similarity
  const progScore = compareProgressions(
    reference.roman_progression,
    candidate.roman_progression
  );
  totalScore += progScore * weights.progression_shape;

  // 2. Cadence type match
  const cadenceScore = reference.cadence_type === candidate.cadence_type ? 1.0 : 0.0;
  totalScore += cadenceScore * weights.cadence_type;

  // 3. Loop length similarity
  const loopScore = calculateLoopSimilarity(
    reference.loop_length_bars,
    candidate.loop_length_bars
  );
  totalScore += loopScore * weights.loop_length;

  // 4. Modal color match
  const modalScore = calculateModalSimilarity(
    reference.tonal_center.mode,
    candidate.tonal_center.mode
  );
  totalScore += modalScore * weights.modal_color;

  // 5. Tempo similarity (if available)
  // const tempoScore = calculateTempoSimilarity(reference.tempo, candidate.tempo);
  // totalScore += tempoScore * weights.tempo;

  return Math.min(totalScore, 1.0);
}

/**
 * Calculate loop length similarity
 */
function calculateLoopSimilarity(a: number, b: number): number {
  if (a === b) return 1.0;
  const diff = Math.abs(a - b);
  return Math.max(0, 1 - diff / Math.max(a, b));
}

/**
 * Calculate modal similarity
 */
function calculateModalSimilarity(
  a: string,
  b: string
): number {
  if (a === b) return 1.0;
  
  // Related modes get partial credit
  const relatedModes: Record<string, string[]> = {
    major: ['lydian', 'mixolydian'],
    minor: ['dorian', 'phrygian', 'aeolian'],
    dorian: ['minor', 'aeolian'],
    phrygian: ['minor'],
    lydian: ['major'],
    mixolydian: ['major'],
    aeolian: ['minor', 'dorian'],
    locrian: [],
  };

  if (relatedModes[a]?.includes(b)) return 0.6;
  return 0.0;
}

/**
 * Get list of matching features
 */
function getMatchingFeatures(
  reference: HarmonicFingerprint,
  candidate: HarmonicFingerprint
): string[] {
  const matches: string[] = [];

  if (
    compareProgressions(reference.roman_progression, candidate.roman_progression) > 0.8
  ) {
    matches.push('progression_shape');
  }

  if (reference.cadence_type === candidate.cadence_type) {
    matches.push('cadence_type');
  }

  if (reference.loop_length_bars === candidate.loop_length_bars) {
    matches.push('loop_length');
  }

  if (reference.tonal_center.mode === candidate.tonal_center.mode) {
    matches.push('modal_color');
  }

  return matches;
}

/**
 * Generate human-readable explanation
 */
function generateExplanation(
  reference: HarmonicFingerprint,
  candidate: HarmonicFingerprint
): string {
  const features = getMatchingFeatures(reference, candidate);
  
  if (features.length === 0) {
    return 'Shares some harmonic characteristics';
  }

  const explanations: Record<string, string> = {
    progression_shape: 'Similar chord progression',
    cadence_type: 'Same resolution pattern',
    loop_length: 'Same loop structure',
    modal_color: 'Same tonal mode',
  };

  return features.map(f => explanations[f]).join(', ');
}

// ============================================================================
// QUERY OPTIMIZATION
// ============================================================================

/**
 * Query candidate tracks efficiently
 * Uses database indexes for fast filtering
 */
async function queryCandidates(
  reference: HarmonicFingerprint,
  filters?: SimilarityFilters
): Promise<HarmonicFingerprint[]> {
  try {
    let query = supabase
      .from('harmonic_fingerprints')
      .select('*')
      .neq('track_id', reference.track_id) // Exclude reference track
      .gte('confidence_score', 0.5); // Minimum confidence

    // Apply filters
    if (filters?.min_confidence) {
      query = query.gte('confidence_score', filters.min_confidence);
    }

    if (filters?.cadence_types && filters.cadence_types.length > 0) {
      query = query.in('cadence_type', filters.cadence_types);
    }

    if (filters?.modes && filters.modes.length > 0) {
      // Filter by mode (stored in tonal_center.mode)
      // Note: This requires a JSONB query
      const modeConditions = filters.modes.map(mode => `tonal_center->mode.eq.${mode}`);
      // Simplified: just fetch all and filter client-side for now
    }

    if (filters?.loop_lengths && filters.loop_lengths.length > 0) {
      query = query.in('loop_length_bars', filters.loop_lengths);
    }

    // Order by confidence and limit
    query = query
      .order('confidence_score', { ascending: false })
      .limit(100); // Get top candidates

    const { data, error } = await query;

    if (error) {
      console.error('[SimilarityEngine] Query error:', error);
      return [];
    }

    // Additional client-side filtering for mode (since JSONB queries are complex)
    let candidates = data as HarmonicFingerprint[] || [];

    if (filters?.modes && filters.modes.length > 0) {
      candidates = candidates.filter(c => 
        filters.modes!.includes(c.tonal_center.mode)
      );
    }

    return candidates;
  } catch (error) {
    console.error('[SimilarityEngine] Error querying candidates:', error);
    return [];
  }
}

/**
 * Get harmonic fingerprint from database
 */
async function getFingerprint(trackId: string): Promise<HarmonicFingerprint | null> {
  try {
    const { data, error } = await supabase
      .from('harmonic_fingerprints')
      .select('*')
      .eq('track_id', trackId)
      .order('analysis_timestamp', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[SimilarityEngine] Fingerprint lookup error:', error);
      return null;
    }

    return (data?.[0] as HarmonicFingerprint | undefined) ?? null;
  } catch (error) {
    console.error('[SimilarityEngine] Error getting fingerprint:', error);
    return null;
  }
}

// ============================================================================
// ADVANCED MATCHING
// ============================================================================

/**
 * Check if progressions match with rotation
 * Example: [I, V, vi, IV] matches [vi, IV, I, V]
 */
function matchesWithRotation(
  a: RomanChord[],
  b: RomanChord[]
): boolean {
  if (a.length !== b.length) return false;

  for (let offset = 0; offset < a.length; offset++) {
    const rotated = rotateProgression(b, offset);
    if (compareProgressions(a, rotated) >= 0.9) {
      return true;
    }
  }

  return false;
}

/**
 * Rotate progression by n positions
 */
function rotateProgression(progression: RomanChord[], n: number): RomanChord[] {
  const len = progression.length;
  const offset = ((n % len) + len) % len;
  return [...progression.slice(offset), ...progression.slice(0, offset)];
}

/**
 * Find progression variations (inversions, substitutions)
 * Includes rotations and common chord substitutions
 */
export function findProgressionVariations(
  progression: RomanChord[]
): RomanChord[][] {
  const variations: RomanChord[][] = [];

  // Add original
  variations.push(progression);

  // Add rotations
  for (let i = 1; i < progression.length; i++) {
    variations.push(rotateProgression(progression, i));
  }

  // Add common substitutions
  const commonSubstitutions: Record<string, string[]> = {
    'IV': ['ii'], // Subdominant substitution
    'ii': ['IV'],
    'vi': ['IV'], // Relative minor substitution
    'iii': ['I'], // Mediant substitution
    'I': ['iii', 'vi'], // Tonic substitutions
    'V': ['vii°'], // Dominant substitution
    'vii°': ['V'],
  };

  // Generate substitution variations (limit to prevent explosion)
  for (let i = 0; i < Math.min(progression.length, 3); i++) {
    const chord = progression[i];
    const subs = commonSubstitutions[chord.numeral];
    
    if (subs) {
      for (const subNumeral of subs) {
        const variation = [...progression];
        variation[i] = {
          ...chord,
          numeral: subNumeral,
        };
        variations.push(variation);
      }
    }
  }

  return variations;
}

/**
 * Normalize progression for comparison
 * Converts to canonical form (removes extensions, simplifies qualities)
 */
export function normalizeProgression(progression: RomanChord[]): RomanChord[] {
  return progression.map(chord => ({
    numeral: chord.numeral,
    quality: simplifyQuality(chord.quality),
  }));
}

/**
 * Simplify chord quality to basic types
 */
function simplifyQuality(quality: string): RomanChord['quality'] {
  // Map complex qualities to basic types
  if (quality.includes('maj') || quality === 'major') return 'major';
  if (quality.includes('min') || quality === 'minor') return 'minor';
  if (quality.includes('dim') || quality === 'diminished') return 'diminished';
  if (quality.includes('aug') || quality === 'augmented') return 'augmented';
  if (quality.includes('dom') || quality.includes('7')) return 'dominant';
  
  return quality as RomanChord['quality'];
}

// ============================================================================
// EXPORT UTILITIES
// ============================================================================

export {
  DEFAULT_WEIGHTS as defaultSimilarityWeights,
  calculateSimilarity,
  matchesWithRotation,
  rotateProgression,
  normalizeProgression,
};
