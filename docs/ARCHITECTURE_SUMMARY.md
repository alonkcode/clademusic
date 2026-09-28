# Clade Architecture Summary

**Last Updated**: January 21, 2026 (analysis layer, file structure, schema and status sections reconciled with the code on September 26, 2026)

## Product Vision


TikTok-style music discovery platform that analyzes songs by **harmonic structure**, not genre. Songs are clustered by relative chord progressions, tonal center, cadence type, and loop structure.

## Core Architecture (Non-Negotiable)

### 1. Harmonic Data Model ✅

**Primary storage uses relative theory, never absolute chords:**

```typescript
// ✅ CORRECT (stored in database)
{
  tonal_center: { root_interval: 0, mode: 'major' },
  roman_progression: ['I', 'V', 'vi', 'IV'],
  cadence_type: 'authentic',
  confidence_score: 0.85,
  is_provisional: false
}

// ❌ WRONG (never store as primary data)
{
  chords: ['C', 'G', 'Am', 'F']
}
```

**Absolute keys derived for display only:**
```typescript
const displayKey = getDisplayKey(tonalCenter, 'C'); // "C major"
```

### 2. Hybrid Analysis Pipeline ✅

```
User adds song
     ↓
Check harmony DB → Found? Use cached analysis (O(1))
     ↓ Not found
Queue async job → Return provisional data (non-blocking UI)
     ↓
Run ML analysis (background)
     ↓
Store result → Update confidence score
```

**Key characteristics:**
- ✅ **Asynchronous**: Never blocks UI
- ✅ **Cacheable**: 90-day cache, 365-day reanalysis
- ✅ **Idempotent**: Same audio = same result
- ✅ **Replaceable**: Model versioning support

### 3. Audio Analysis Layer ✅ live detection · 🚧 background jobs

Two analysis paths exist. They are **not connected to each other**.

#### Live detection (implemented)

A listener runs one capture while a track plays; the browser does the analysis.

```
Browser DSP: chords, key, tempo, sections
  (implemented in supabase/functions/_shared/dsp, re-exported by src/lib/harmony)
     ↓ detection payload (src/api/detectionRuns.ts)
`ingest-detection` Edge Function: validates, stores a `detection_runs` row as pending
     ↓
`auto_promote_detection_run` (SQL): saves it as the track's analysis only if the
track has none and the capture clears supabase/functions/_shared/autoPromotion.ts;
otherwise an admin promotes it after review
```

- `ingest-detection` is the only write path into the detection tables (closed to clients by RLS).
- The DSP has one copy, in `supabase/functions/_shared/dsp/`. The browser imports it through the re-exports in `src/lib/harmony/`, and `services/live-analysis` imports it directly.
- `services/live-analysis` is a separate Bun WebSocket service for devices that cannot capture tab audio. The server side exists (see its README). As of September 26, 2026 no app code connects to it.
- The detection tables (`detection_runs`, `detection_run_sections`, `detection_run_chords`) are defined in `supabase/sql-editor/17-live-detection-runs.sql`. The promotion functions are in `18-*`, `29-*` and `30-*` (later files redefine `_promote_detection_run_core`). All of it is included in `supabase/schema_bundle.sql`, and none of it is in `supabase/migrations/`.

#### Fingerprint and job pipeline (stub)

`src/services/harmonicAnalysis.ts` implements cache check → job → store, but the analysis step is a placeholder: `src/services/audioAnalysis.ts` returns mock results, and the ML step of the `harmonic-analysis` Edge Function is a stub. The `useHarmonicAnalysis` hook and `AnalysisStatusBadge` component sit on top of it; nothing in app code imports either yet.

**Requirements (both paths):**
- Extract chroma/harmonic features from audio
- Detect: key center, chord sequence, section boundaries
- Output relative structures with confidence scores
- Never block UI during analysis

**TODO:**
- [ ] Replace the mock in `audioAnalysis.ts` and the stub in `harmonic-analysis` with a real analysis step (Essentia.js or a custom model), or route the job path through the live-detection DSP
- [ ] Decide how the two paths relate; today live detection writes `detection_runs`, while the job path writes `harmonic_fingerprints`
- [ ] Add real-time progress updates for background jobs

### 4. UX Requirements ✅

- ✅ Show "Analyzing…" state immediately
- ✅ Allow playback before analysis completes
- ✅ Clearly label provisional harmony results
- ✅ Support future refinement without breaking references

**UI Components:**
```tsx
<AnalysisStatusBadge
  fingerprint={fingerprint}
  isAnalyzing={isAnalyzing}
/>
// Shows: "Analyzing…" | "Provisional" | "High Confidence"

<AnalysisConfidenceDisplay fingerprint={fingerprint} />
// Shows: Progress bar + percentage + version info
```

### 5. Cost & Scale Awareness ✅

**Optimizations:**
- ✅ Aggressive caching (90-day TTL)
- ✅ ISRC-based deduplication
- 🚧 Batch background processing (TODO: queue system)
- ✅ Confidence thresholds (< 0.7 = provisional)

**Design Goal**: Millions of songs, not thousands

### 6. Similarity Engine ✅

**Tracks are similar if they share:**

| Feature | Weight | Implementation |
|---------|--------|----------------|
| Progression shape | 50% | Roman numeral sequence matching |
| Cadence behavior | 20% | Resolution pattern comparison |
| Loop length | 15% | Bar structure similarity |
| Modal color | 10% | Tonal mode matching |
| Tempo | 5% | BPM proximity |

**Genre/artist/instrumentation are secondary signals only.**

**Status**: implemented in `src/services/similarityEngine.ts`; nothing in app code calls `findSimilarTracks` yet (only tests do).

```typescript
const results = await findSimilarTracks({
  reference_track_id: 'abc123',
  max_results: 20,
  weights: { progression_shape: 0.5, ... },
});
// Returns: [{ track_id, similarity_score, matching_features, explanation }]
```

**TODO:**
- [ ] Progression rotation matching (I-V-vi-IV ≈ V-vi-IV-I)
- [ ] ML-based embeddings for semantic similarity
- [ ] Harmonic clustering with t-SNE visualization

### 7. Code Quality Standards ✅

- ✅ **Modular**: Separated concerns (types, services, UI)
- ✅ **DRY**: Reusable components (ProviderBadge, GlassCard, formatters)
- ✅ **Testable**: Pure functions, clear interfaces
- ✅ **Config-driven**: `ANALYSIS_CONFIG` for thresholds
- ✅ **Clear separation**: ingestion → analysis → storage → UI

## File Structure

```
src/
├── types/
│   ├── harmony.ts                 # Core harmonic types
│   └── index.ts                   # Track type
│
├── lib/
│   ├── harmony/                   # Chord/key/tempo/section detection (re-exports of
│   │                              #   supabase/functions/_shared/dsp), theory, playback
│   │                              #   clocks, auto-promotion policy
│   └── liveAnalysis/              # Tests only: rules of services/live-analysis
│
├── api/
│   └── detectionRuns.ts           # Builds and submits a live-capture payload
│
├── services/
│   ├── harmonicAnalysis.ts        # Fingerprint/job pipeline (cache → job → store)
│   ├── audioAnalysis.ts           # v0 stub: mock analysis
│   └── similarityEngine.ts        # Track matching (no app callers yet)
│
├── hooks/
│   ├── useLiveChordDetection.ts   # Live capture → chords, sections, key, tempo
│   ├── useAnalyzeTrack.ts         # Capture → auto-submit for unanalysed tracks
│   └── useHarmonicAnalysis.ts     # Hook over the fingerprint pipeline (not used yet)
│
├── components/
│   ├── HarmonicHUD.tsx            # Live chord readout
│   ├── AnalysisStatusBadge.tsx    # Confidence UI (not used yet)
│   └── layout/
│       └── ResponsiveLayout.tsx   # Desktop layouts
│
└── player/                        # See docs/PLAYER_ARCHITECTURE.md

supabase/functions/
├── ingest-detection/              # Only write path into detection_runs
├── harmonic-analysis/             # Fingerprint job runner (ML step is a stub)
├── autoPromotion + detectionPayload + dsp/   # In _shared/: code the browser also runs

services/live-analysis/            # Bun WebSocket service for microphone analysis
```

## Database Schema

`harmonic_fingerprints` and `analysis_jobs` exist (`supabase/migrations/20260125_harmonic_analysis_core.sql`). The SQL below is a simplified excerpt; the migration is authoritative. Live detection uses separate tables, described in the Audio Analysis Layer section above.

### `harmonic_fingerprints` Table

```sql
CREATE TABLE harmonic_fingerprints (
  track_id TEXT PRIMARY KEY,
  tonal_center JSONB NOT NULL,
  roman_progression JSONB NOT NULL,
  loop_length_bars INTEGER NOT NULL,
  cadence_type TEXT NOT NULL,
  confidence_score REAL CHECK (confidence_score BETWEEN 0 AND 1),
  analysis_version TEXT NOT NULL,
  is_provisional BOOLEAN DEFAULT TRUE,
  detected_key TEXT, -- UI display only
  ...
);
```

### `analysis_jobs` Table

```sql
CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  status TEXT CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  progress REAL CHECK (progress BETWEEN 0 AND 1),
  result JSONB, -- HarmonicFingerprint
  ...
);
```

## Implementation Status

### ✅ Completed

- [x] Harmonic types system (`src/types/harmony.ts`)
- [x] Analysis pipeline architecture (`src/services/harmonicAnalysis.ts`)
- [x] Similarity engine (`src/services/similarityEngine.ts`)
- [x] UI confidence indicators (`src/components/AnalysisStatusBadge.tsx`)
- [x] Comprehensive documentation (`docs/HARMONIC_ANALYSIS_ARCHITECTURE.md`)
- [x] Responsive desktop UI (FeedPage, SearchPage)
- [x] DRY refactoring (ProviderBadge, GlassCard, formatters)
- [x] Queue management system
- [x] Song credits (songwriter, producer, label)
- [x] BPM and genre metadata
- [x] Live detection pipeline: browser DSP (chords, key, tempo, sections) → `detection_runs` via `ingest-detection`, with auto-promotion
- [x] `harmonic_fingerprints` and `analysis_jobs` tables (migration exists)
- [x] `harmonic-analysis` Edge Function (ML step is a stub)
- [x] `services/live-analysis` Bun WebSocket service (server side only; no app client yet)

### 🚧 In Progress

- [ ] Real analysis step for the fingerprint/job path (today it is mock data)
- [ ] Wiring `useHarmonicAnalysis`, `AnalysisStatusBadge` and `findSimilarTracks` into the app
- [ ] App client for `services/live-analysis`
- [ ] Real-time job progress updates

### 📋 TODO (Priority Order)

1. **Database Integration**
   - Add indexes for similarity queries
   - Implement cache lookup/storage against `harmonic_fingerprints`

2. **ML Model Integration**
   - Research: Essentia.js vs Chord.js vs custom model, or reuse the live-detection DSP for jobs
   - Calculate confidence scores

3. **Background Processing**
   - Replace the stub in the `harmonic-analysis` Edge Function
   - Implement job queue system
   - Add progress tracking (WebSockets)

4. **Advanced Similarity**
   - Progression rotation matching
   - ML-based embeddings
   - Clustering visualization

5. **User Refinement**
   - Crowd-sourced corrections
   - Manual override interface
   - Feedback mechanism

## Performance Targets

| Operation | Target | Status |
|-----------|--------|--------|
| Cache hit | < 50ms | 🚧 TODO |
| Cache miss (queue) | < 100ms | 🚧 TODO |
| Full analysis | < 30s (background) | 🚧 TODO |
| Similarity query | < 200ms | 🚧 TODO |

## Recent Changes (Jan 21, 2026)

1. ✅ Created harmonic analysis type system
2. ✅ Implemented hybrid pipeline architecture
3. ✅ Built similarity engine with configurable weights
4. ✅ Added UI components for confidence display
5. ✅ Documented architecture comprehensively
6. ✅ Updated responsive desktop UI (FeedPage, SearchPage)
7. ✅ Build successful (16.43s, 2555 modules)

## Next Steps

1. **Immediate**: Decide how the live-detection and fingerprint/job paths relate
2. **Short-term**: Replace the mock analysis step, or reuse the live-detection DSP
3. **Medium-term**: Add real-time progress tracking
4. **Long-term**: Build harmonic clustering visualization

## References

- **Architecture Doc**: [`docs/HARMONIC_ANALYSIS_ARCHITECTURE.md`](../docs/HARMONIC_ANALYSIS_ARCHITECTURE.md)
- **Types**: [`src/types/harmony.ts`](../src/types/harmony.ts)
- **Services**: [`src/services/harmonicAnalysis.ts`](../src/services/harmonicAnalysis.ts), [`src/services/similarityEngine.ts`](../src/services/similarityEngine.ts)
- **UI**: [`src/components/AnalysisStatusBadge.tsx`](../src/components/AnalysisStatusBadge.tsx)
- **Live detection**: [`src/api/detectionRuns.ts`](../src/api/detectionRuns.ts), [`supabase/functions/ingest-detection`](../supabase/functions/ingest-detection/index.ts), [`supabase/functions/_shared/dsp`](../supabase/functions/_shared/dsp)
- **Microphone analysis service**: [`services/live-analysis/README.md`](../services/live-analysis/README.md)
- **Player**: [`docs/PLAYER_ARCHITECTURE.md`](./PLAYER_ARCHITECTURE.md)

---

**This architecture is designed to feel correct five years from now.**

- Never fake harmony results
- Never guess without marking confidence
- Always store relative theory as primary data
- Always cache aggressively for scale
- Always label provisional results clearly
