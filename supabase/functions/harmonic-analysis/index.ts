/**
 * Supabase Edge Function: Harmonic Analysis
 * 
 * Processes harmonic analysis jobs in the background.
 * Triggered by analysis_jobs queue or manual invocation.
 * 
 * FLOW:
 * 1. Receive job request
 * 2. Update job status to 'processing'
 * 3. Run ML analysis pipeline (stub for now)
 * 4. Store result in harmonic_fingerprints table
 * 5. Update job status to 'completed' or 'failed'
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const ANALYSIS_CONFIG = {
  CACHE_TTL_DAYS: 90,
  REANALYSIS_THRESHOLD_DAYS: 365,
  CURRENT_MODEL_VERSION: '1.0.0',
} as const

interface AnalysisRequest {
  track_id: string
  audio_hash?: string
  isrc?: string
  priority?: 'low' | 'normal' | 'high'
  force_reanalysis?: boolean
  job_id?: string
}

interface AnalysisJob {
  id: string
  track_id: string
  audio_hash?: string | null
  isrc?: string | null
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cached'
  progress: number
  started_at: string
  completed_at?: string | null
  error_message?: string | null
  analysis_version: string
  result?: HarmonicFingerprint | null
}

interface HarmonicFingerprint {
  track_id: string
  audio_hash?: string | null
  isrc?: string | null
  tonal_center: {
    root_interval: number
    mode: 'major' | 'minor' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'aeolian' | 'locrian'
    stability_score: number
  }
  roman_progression: Array<{
    numeral: string
    quality: 'major' | 'minor' | 'diminished' | 'augmented' | 'dominant'
    extensions?: string[]
  }>
  loop_length_bars: number
  cadence_type: 'authentic' | 'plagal' | 'deceptive' | 'half' | 'none'
  confidence_score: number
  analysis_timestamp: string
  analysis_version: string
  is_provisional: boolean
  detected_key?: string
  detected_mode: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const nowIso = new Date().toISOString()
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Parse request
    const request: AnalysisRequest = await req.json()
    const { track_id, audio_hash, isrc, force_reanalysis, job_id } = request

    console.log('[HarmonicAnalysis] Processing request:', {
      track_id,
      has_audio_hash: !!audio_hash,
      has_isrc: !!isrc,
      force_reanalysis,
      job_id,
    })

    // Step 1: Check for existing analysis (unless force_reanalysis)
    const reusableFingerprint = force_reanalysis
      ? null
      : await findReusableFingerprint(supabaseClient, {
          track_id,
          audio_hash,
          isrc,
          nowIso,
        })

    if (reusableFingerprint) {
      console.log('[HarmonicAnalysis] Using cached result')

      await markJobCached(supabaseClient, {
        jobId: job_id,
        fallbackLookup: { track_id, audio_hash, isrc },
        result: reusableFingerprint,
      })

      return jsonResponse({
        success: true,
        fingerprint: reusableFingerprint,
        method: 'cached',
        job_id: job_id,
      })
    }

    // Step 2: Find or create analysis job (idempotent)
    let job = await findActiveJob(supabaseClient, {
      jobId: job_id,
      track_id,
      audio_hash,
      isrc,
    })

    if (!job) {
      const newJobId = job_id ?? crypto.randomUUID()
      const { data: inserted, error: insertError } = await supabaseClient
        .from('analysis_jobs')
        .insert({
          id: newJobId,
          track_id,
          audio_hash: audio_hash ?? null,
          isrc: isrc ?? null,
          status: 'processing',
          progress: 0.05,
          started_at: nowIso,
          analysis_version: ANALYSIS_CONFIG.CURRENT_MODEL_VERSION,
        })
        .select('*')
        .limit(1)

      if (insertError) {
        throw new Error(`Failed to create job: ${insertError.message}`)
      }

      job = (inserted?.[0] as AnalysisJob) ?? null
    } else if (job.status !== 'processing') {
      const { data: updated, error: updateError } = await supabaseClient
        .from('analysis_jobs')
        .update({
          status: 'processing',
          progress: 0.05,
          updated_at: nowIso,
          analysis_version: ANALYSIS_CONFIG.CURRENT_MODEL_VERSION,
        })
        .eq('id', job.id)
        .select('*')
        .limit(1)

      if (updateError) {
        throw new Error(`Failed to adopt job: ${updateError.message}`)
      }

      job = (updated?.[0] as AnalysisJob) ?? job
    }

    if (!job) {
      throw new Error('Unable to initialize analysis job')
    }

    console.log('[HarmonicAnalysis] Starting analysis:', job.id)

    // Update progress: Fetching audio
    await updateJobProgress(supabaseClient, job.id, 0.2)

    // TODO: Integrate actual ML model here
    // For now, use mock analysis
    const fingerprint = await runMockAnalysis(track_id, audio_hash, isrc)

    // Update progress: Extracting features
    await updateJobProgress(supabaseClient, job.id, 0.5)

    // Update progress: Detecting harmony
    await updateJobProgress(supabaseClient, job.id, 0.8)

    const fingerprintToStore: HarmonicFingerprint = {
      ...fingerprint,
      audio_hash: audio_hash ?? fingerprint.audio_hash ?? null,
      isrc: isrc ?? fingerprint.isrc ?? null,
      analysis_version: ANALYSIS_CONFIG.CURRENT_MODEL_VERSION,
      analysis_timestamp: nowIso,
      is_provisional: false,
    }

    // Step 4: Store result with idempotent conflict key
    const conflictKey = fingerprintToStore.audio_hash
      ? 'audio_hash'
      : fingerprintToStore.isrc
        ? 'isrc'
        : 'track_id'

    const { error: storeError } = await supabaseClient
      .from('harmonic_fingerprints')
      .upsert(fingerprintToStore, {
        onConflict: conflictKey,
      })

    if (storeError) {
      throw new Error(`Failed to store result: ${storeError.message}`)
    }

    // Step 5: Mark job complete
    const { error: completeError } = await supabaseClient
      .from('analysis_jobs')
      .update({
        status: 'completed',
        progress: 1.0,
        completed_at: new Date().toISOString(),
        result: fingerprintToStore,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    if (completeError) {
      console.error('[HarmonicAnalysis] Failed to update job:', completeError)
    }

    console.log('[HarmonicAnalysis] Analysis complete:', job.id)

    return jsonResponse({
      success: true,
      job_id: job.id,
      fingerprint: fingerprintToStore,
      method: 'ml_audio',
    })
  } catch (error) {
    console.error('[HarmonicAnalysis] Error:', error)

    const errMessage = (error as Error)?.message ?? 'Unknown error'
    return jsonResponse({
      success: false,
      error: errMessage,
    }, 500)
  }
})

// Helper: Update job progress
async function updateJobProgress(
  supabaseClient: any,
  jobId: string,
  progress: number
): Promise<void> {
  await supabaseClient
    .from('analysis_jobs')
    .update({
      progress,
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId)
}

// Helper: Prioritized cache lookup with TTL + reanalysis windows
async function findReusableFingerprint(
  supabaseClient: SupabaseClient,
  params: { track_id: string; audio_hash?: string; isrc?: string; nowIso: string }
): Promise<HarmonicFingerprint | null> {
  const { track_id, audio_hash, isrc, nowIso } = params

  const lookup = async (column: 'audio_hash' | 'isrc' | 'track_id', value: string) => {
    const { data, error } = await supabaseClient
      .from('harmonic_fingerprints')
      .select('*')
      .eq(column, value)
      .gte('reuse_until', nowIso)
      .gte('reanalyze_after', nowIso)
      .order('analysis_timestamp', { ascending: false })
      .limit(1)

    if (error) {
      console.error('[HarmonicAnalysis] Cache lookup error:', error.message)
      return null
    }

    return (data?.[0] as HarmonicFingerprint | undefined) ?? null
  }

  if (audio_hash) {
    const hit = await lookup('audio_hash', audio_hash)
    if (hit) return hit
  }

  if (isrc) {
    const hit = await lookup('isrc', isrc)
    if (hit) return hit
  }

  return await lookup('track_id', track_id)
}

// Helper: Find active job by priority or explicit id
async function findActiveJob(
  supabaseClient: SupabaseClient,
  params: { jobId?: string; track_id: string; audio_hash?: string; isrc?: string }
): Promise<AnalysisJob | null> {
  const { jobId, track_id, audio_hash, isrc } = params

  if (jobId) {
    const { data, error } = await supabaseClient
      .from('analysis_jobs')
      .select('*')
      .eq('id', jobId)
      .limit(1)

    if (error) {
      console.error('[HarmonicAnalysis] Job lookup by id failed:', error.message)
    }

    if (data?.[0]) return data[0] as AnalysisJob
  }

  const statuses = ['queued', 'processing']
  const search = async (column: 'audio_hash' | 'isrc' | 'track_id', value: string) => {
    const { data, error } = await supabaseClient
      .from('analysis_jobs')
      .select('*')
      .eq(column, value)
      .in('status', statuses)
      .order('started_at', { ascending: false })
      .limit(1)

    if (error) {
      console.error('[HarmonicAnalysis] Job lookup error:', error.message)
      return null
    }

    return (data?.[0] as AnalysisJob | undefined) ?? null
  }

  if (audio_hash) {
    const hit = await search('audio_hash', audio_hash)
    if (hit) return hit
  }

  if (isrc) {
    const hit = await search('isrc', isrc)
    if (hit) return hit
  }

  return await search('track_id', track_id)
}

// Helper: Mark job as cached reuse (if job exists)
async function markJobCached(
  supabaseClient: SupabaseClient,
  params: {
    jobId?: string
    fallbackLookup: { track_id: string; audio_hash?: string; isrc?: string }
    result: HarmonicFingerprint
  }
): Promise<void> {
  const { jobId, fallbackLookup, result } = params
  const nowIso = new Date().toISOString()

  const job = jobId
    ? await findActiveJob(supabaseClient, { jobId, ...fallbackLookup })
    : await findActiveJob(supabaseClient, fallbackLookup)

  if (!job) return

  await supabaseClient
    .from('analysis_jobs')
    .update({
      status: 'cached',
      progress: 1.0,
      completed_at: nowIso,
      result,
      updated_at: nowIso,
    })
    .eq('id', job.id)
}

// Helper: JSON response with CORS
function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

// Mock analysis (placeholder until ML model integrated)
async function runMockAnalysis(
  trackId: string,
  audioHash?: string,
  isrc?: string
): Promise<HarmonicFingerprint> {
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Common progressions for testing
  const progressions = [
    [
      { numeral: 'I', quality: 'major' as const },
      { numeral: 'V', quality: 'major' as const },
      { numeral: 'vi', quality: 'minor' as const },
      { numeral: 'IV', quality: 'major' as const }
    ],
    [
      { numeral: 'i', quality: 'minor' as const },
      { numeral: 'VI', quality: 'major' as const },
      { numeral: 'III', quality: 'major' as const },
      { numeral: 'VII', quality: 'major' as const }
    ],
    [
      { numeral: 'I', quality: 'major' as const },
      { numeral: 'IV', quality: 'major' as const },
      { numeral: 'V', quality: 'major' as const }
    ]
  ]

  const progression = progressions[Math.floor(Math.random() * progressions.length)]

  return {
    track_id: trackId,
    audio_hash: audioHash ?? null,
    isrc: isrc ?? null,
    tonal_center: {
      root_interval: 0,
      mode: 'major',
      stability_score: 0.85
    },
    roman_progression: progression,
    loop_length_bars: 4,
    cadence_type: 'authentic',
    confidence_score: 0.72,
    analysis_timestamp: new Date().toISOString(),
    analysis_version: '1.0.0',
    is_provisional: false, // Edge function produces final results
    detected_key: 'C',
    detected_mode: 'major'
  }
}
