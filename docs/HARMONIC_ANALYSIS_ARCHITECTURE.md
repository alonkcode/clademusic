# Harmonic Analysis Architecture

## Overview

Clade uses a **hybrid harmonic analysis pipeline** that prioritizes cost-efficiency and user experience. The system analyzes songs by their relative harmonic structure (Roman numerals), not absolute chords or genre metadata.

> **Two analysis paths exist today, and they are not connected.** The pipeline described under [Analysis Pipeline](#analysis-pipeline) (cache → job → store) is the *fingerprint/job path*; its analysis step is still a stub. Real chord, key, tempo and section detection runs separately as a live capture, described under [Live Detection Pipeline](#live-detection-pipeline-implemented).

## Core Principles

### 1. Relative Theory First

**Never store absolute chord names as primary data.**

All harmonic data is stored in relative form:
- `tonal_center` → Relative interval (0-11 semitones from reference)
- `roman_progression` → Array of Roman numeral chords (e.g., `["I", "V", "vi", "IV"]`)
- `cadence_type` → How the progression resolves
- `loop_length_bars` → Structure of the harmonic loop
- `modal_color` → Modal flavor beyond major/minor

Absolute keys (e.g., "C major") are derived only for display purposes.

### 2. Hybrid Pipeline

When a song is added to the system:

```
1. Check harmony database
   ↓
   ├─→ If found: Use cached analysis (O(1))
   └─→ If not found:
       ├─→ Queue async audio analysis
       ├─→ Return provisional data immediately (non-blocking)
       └─→ Update with final result when ready
```

**Key characteristics:**
- **Asynchronous**: Never blocks the UI
- **Cacheable**: Results stored for 90 days minimum
- **Idempotent**: Re-running analysis on same audio yields same result
- **Replaceable**: Can update analysis with improved models

### 3. Cost & Scale Awareness

Audio analysis is expensive. We optimize by:

- **Aggressive caching**: Store all results in `harmonic_fingerprints` table
- **Deduplication**: ISRC-based lookups prevent re-analyzing identical audio
- **Batch processing**: Queue low-priority jobs during off-peak hours
- **Confidence thresholds**: Mark low-confidence results for manual review

**Design Goal**: Support millions of songs, not thousands.

## Data Model

### HarmonicFingerprint (Primary Storage)

```typescript
interface HarmonicFingerprint {
  // Identity
  track_id: string;
  
  // Relative harmonic data (NEVER absolute chords)
  tonal_center: RelativeTonalCenter;
  roman_progression: RomanChord[];
  loop_length_bars: number;
  cadence_type: CadenceType;
  modal_color?: ModalColor;
  borrowed_chords?: BorrowedChord[];
  
  // Section-specific progressions
  section_progressions?: SectionProgression[];
  
  // Analysis metadata
  confidence_score: number; // 0.0 - 1.0
  analysis_timestamp: string;
  analysis_version: string; // e.g., "1.2.0"
  is_provisional: boolean; // true if confidence < 0.7
  
  // Derived display data (computed from relative data)
  detected_key?: string; // e.g., "C" - UI only
  detected_mode?: 'major' | 'minor' | ModalColor;
}
```

### RomanChord

```typescript
interface RomanChord {
  numeral: string; // "I", "iv", "V7", "bVI", etc.
  quality: ChordQuality; // major, minor, diminished, etc.
  duration_beats?: number; // Rhythmic weight
  timing_ms?: number; // Position in track
  inversions?: number; // 0 = root, 1 = first inversion
}
```

### CadenceType

How a progression resolves:

- `authentic` → V → I (strong resolution)
- `plagal` → IV → I (amen cadence)
- `deceptive` → V → vi (fake-out ending)
- `half` → Ends on V (unresolved)
- `loop` → Circular, no resolution
- `modal` → Non-functional harmony
- `none` → No clear cadence

## Analysis Pipeline

### Phase 1: Cache Check

```typescript
async function getHarmonicAnalysis(trackId: string) {
  // O(1) database lookup
  const cached = await checkHarmonyCache(trackId);
  if (cached) {
    return { fingerprint: cached, method: 'cached' };
  }
  
  // Continue to Phase 2...
}
```

**Optimization**: Index `harmonic_fingerprints` table by:
- `track_id` (primary key)
- `confidence_score` (for quality filtering)
- `cadence_type` (for similarity queries)

### Phase 2: Job Queue

```typescript
// Queue async analysis
const job = await queueAnalysis({
  track_id: trackId,
  priority: 'normal', // or 'high' for user-requested
});

// Return provisional data immediately (non-blocking)
return {
  fingerprint: createProvisionalFingerprint(trackId),
  confidence: { overall: 0.0, ... },
  method: 'ml_audio',
};
```

**Important**: UI shows "Analyzing…" state but allows playback.

### Phase 3: Audio Analysis

**Current**: Stub. `src/services/audioAnalysis.ts` returns mock results, and the ML step of the `harmonic-analysis` Edge Function is a stub. The `useHarmonicAnalysis` hook and `AnalysisStatusBadge` component that sit on this path are not used by app code yet.  
**TODO**: Integrate ML model (e.g., Essentia.js, Chord.js, or custom model), or reuse the live-detection DSP described below

```typescript
async function runAnalysisJob(job: AnalysisJob) {
  // 1. Fetch audio file
  // 2. Extract chroma features (FFT-based)
  // 3. Detect key and mode (template matching)
  // 4. Identify chord progression (HMM or CNN)
  // 5. Detect section boundaries (novelty detection)
  // 6. Extract cadence patterns
  // 7. Calculate confidence scores
  
  const fingerprint = await mlModel.analyze(audioData);
  await storeInCache(fingerprint);
  
  return { fingerprint, processing_time_ms: ... };
}
```

### Phase 4: Result Storage

```typescript
await supabase
  .from('harmonic_fingerprints')
  .upsert(fingerprint, { onConflict: 'track_id' });
```

Results are cached for **90 days minimum**, reanalyzed after **365 days** if model improves.

## Live Detection Pipeline (implemented)

A listener can run a live capture while a track plays. The result is stored as *evidence* for review, not as truth.

1. **Capture and DSP.** `useLiveChordDetection` (`src/hooks`) captures tab audio with `getDisplayMedia` (desktop Chrome/Edge; `supported` reports availability) and runs the DSP: chord templates over chroma, key estimation, tempo and section boundaries. Chords are matched against the accompaniment: `harmonyChroma` finds the most salient pitch in the melody register and removes it and its harmonics from the spectrum before folding to chroma (signal processing on the frame being analysed; no audio is separated, stored, or put through a model). `ChordDecoder` then decodes twice, the second time giving a small bonus to chords that belong to the key estimated from the first. Section detection still uses the whole-mix chroma. The DSP lives in `supabase/functions/_shared/dsp/`; `src/lib/harmony/` re-exports it, and `services/live-analysis` imports it directly. Timestamps follow the player position; when the player never reports a moving position the hook sets `timingAligned` to false, and such a capture must not be stored.
2. **Payload.** `buildDetectionRunPayload` (`src/api/detectionRuns.ts`) turns chords and sections into Roman numerals relative to the estimated key, so the relative-theory rule holds. `submitDetectionRun` sends it to the `ingest-detection` Edge Function. Every run carries `DETECTION_ANALYSIS_VERSION`.
3. **Ingest.** `ingest-detection` is the only write path into the detection tables, which RLS closes to clients. It validates the payload (`_shared/detectionPayload.ts`), enforces a per-user daily cap, finds or creates the catalog row for a provider id, and stores `detection_runs` (status `pending`), `detection_run_sections` and `detection_run_chords`.
4. **Promotion.** It then calls `auto_promote_detection_run`. A run becomes the track's saved analysis automatically only when the track has no analysis yet and the capture clears the thresholds in `_shared/autoPromotion.ts` (`AUTO_PROMOTION`). The browser runs the same code to know when to submit. Otherwise an admin promotes the run after review. The database refuses to overwrite an existing analysis.

The detection tables are defined in `supabase/sql-editor/17-live-detection-runs.sql`; the promotion functions are in `18-*`, `29-*` and `30-*` (later files redefine `_promote_detection_run_core`). All of it is included in `supabase/schema_bundle.sql`, and none of it is in `supabase/migrations/`.

For devices that cannot capture tab audio, `services/live-analysis` is a separate Bun WebSocket service that analyses the listener's microphone. As of September 26, 2026 its server side exists (see its README) and no app code connects to it.

## Similarity Engine

Tracks are considered similar if they share:

1. **Progression shape** (50% weight)
   - Same Roman numeral sequence
   - Allows rotation: `[I, V, vi, IV]` ≈ `[V, vi, IV, I]`

2. **Cadence behavior** (20% weight)
   - Same resolution pattern

3. **Loop length** (15% weight)
   - Same bar structure

4. **Modal color** (10% weight)
   - Same tonal mode

5. **Tempo** (5% weight)
   - Secondary signal only

**Genre, artist, and instrumentation are NOT primary signals.**

### Similarity Query

```typescript
const results = await findSimilarTracks({
  reference_track_id: 'abc123',
  max_results: 20,
  weights: {
    progression_shape: 0.5,
    cadence_type: 0.2,
    loop_length: 0.15,
    modal_color: 0.1,
    tempo: 0.05,
  },
  filters: {
    min_confidence: 0.7, // Only high-quality results
    same_mode_only: false,
  },
});
```

Returns:
```typescript
[
  {
    track_id: 'xyz789',
    similarity_score: 0.92,
    matching_features: ['progression_shape', 'cadence_type'],
    explanation: 'Similar chord progression, Same resolution pattern',
  },
  // ...
]
```

## UX Requirements

### 1. Non-Blocking Analysis

✅ **Good**: Show "Analyzing…" state, allow playback immediately  
❌ **Bad**: Block UI waiting for analysis to complete

### 2. Provisional Results

Always label provisional data:

```tsx
<AnalysisStatusBadge
  fingerprint={fingerprint}
  isAnalyzing={isAnalyzing}
/>
// Shows: "Provisional" or "High Confidence"
```

### 3. Confidence Indicators

Display confidence scores clearly:

```tsx
<AnalysisConfidenceDisplay fingerprint={fingerprint} />
// Shows: Progress bar + percentage + warning if provisional
```

### 4. Graceful Degradation

If analysis fails:
- Still show track metadata
- Disable harmony-based features (similar tracks, progression search)
- Allow manual data correction

## Database Schema

### `harmonic_fingerprints` Table

```sql
CREATE TABLE harmonic_fingerprints (
  track_id TEXT PRIMARY KEY REFERENCES tracks(id),
  
  -- Relative harmonic data (JSONB)
  tonal_center JSONB NOT NULL,
  roman_progression JSONB NOT NULL,
  loop_length_bars INTEGER NOT NULL,
  cadence_type TEXT NOT NULL,
  modal_color TEXT,
  borrowed_chords JSONB,
  section_progressions JSONB,
  
  -- Analysis metadata
  confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  analysis_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analysis_version TEXT NOT NULL,
  is_provisional BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Derived display data
  detected_key TEXT,
  detected_mode TEXT,
  
  -- Indexes for similarity queries
  CONSTRAINT valid_cadence CHECK (cadence_type IN ('authentic', 'plagal', 'deceptive', 'half', 'loop', 'modal', 'none'))
);

CREATE INDEX idx_fingerprints_confidence ON harmonic_fingerprints(confidence_score);
CREATE INDEX idx_fingerprints_cadence ON harmonic_fingerprints(cadence_type);
CREATE INDEX idx_fingerprints_loop_length ON harmonic_fingerprints(loop_length_bars);
```

### `analysis_jobs` Table

```sql
CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  progress REAL NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  result JSONB, -- HarmonicFingerprint if completed
  
  CONSTRAINT one_active_job_per_track UNIQUE (track_id, status)
);

CREATE INDEX idx_jobs_status ON analysis_jobs(status) WHERE status IN ('queued', 'processing');
CREATE INDEX idx_jobs_track ON analysis_jobs(track_id);
```

## Code Organization

```
src/
├── types/
│   ├── harmony.ts           # Core harmonic types
│   └── index.ts             # Track type (existing)
│
├── lib/
│   ├── harmony/             # Detection (re-exports of _shared/dsp), theory, clocks, auto-promotion policy
│   └── liveAnalysis/        # Tests only: rules of services/live-analysis
│
├── api/
│   └── detectionRuns.ts     # Live-capture payload builder and submit
│
├── services/
│   ├── harmonicAnalysis.ts  # Fingerprint/job pipeline
│   ├── audioAnalysis.ts     # v0 stub: mock analysis
│   └── similarityEngine.ts  # Track matching (no app callers yet)
│
├── components/
│   ├── HarmonicHUD.tsx          # Live chord readout
│   └── AnalysisStatusBadge.tsx  # UI for confidence display (not used yet)
│
└── hooks/
    ├── useLiveChordDetection.ts # Live capture
    ├── useAnalyzeTrack.ts       # Capture → auto-submit for unanalysed tracks
    └── useHarmonicAnalysis.ts   # Hook over the fingerprint pipeline (not used yet)

supabase/functions/
├── ingest-detection/        # Only write path into detection_runs
├── harmonic-analysis/       # Fingerprint job runner (ML step is a stub)
└── _shared/                 # dsp/, autoPromotion.ts, detectionPayload.ts

services/live-analysis/      # Bun WebSocket service for microphone analysis
```

## Future Improvements

### Short-term (MVP+)
- [ ] Integrate real ML audio analysis model (or reuse the live-detection DSP) for the job path
- [ ] Replace the stub ML step in the `harmonic-analysis` Edge Function
- [ ] Implement progression rotation matching
- [ ] Add user feedback mechanism for corrections

### Medium-term
- [ ] ML-based progression embeddings (semantic similarity)
- [ ] Crowd-sourced analysis refinement
- [ ] Real-time analysis progress updates (WebSockets)
- [ ] Batch re-analysis when model improves

### Long-term
- [ ] Section-aware progression analysis
- [ ] Harmonic clustering with t-SNE visualization
- [ ] Borrowed chord detection
- [ ] Modulation detection (key changes within song)

## Performance Targets

- **Cache hit**: < 50ms (database query)
- **Cache miss**: < 100ms (queue job + return provisional)
- **Full analysis**: < 30s (background, non-blocking)
- **Similarity query**: < 200ms (indexed database query)

## References

- **Music Theory**: [Harmonic Function](https://en.wikipedia.org/wiki/Diatonic_function)
- **Chord Detection**: [Essentia.js](https://mtg.github.io/essentia.js/)
- **Roman Numeral Analysis**: [Music21](http://web.mit.edu/music21/)

---

**Last Updated**: January 2026  
**Model Version**: 1.0.0 (placeholder)  
**Author**: Clade Engineering Team
