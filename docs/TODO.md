The migration is done and verified (build + tests pass). Here's what changed:

Root cause: production runs at https://kaospan.github.io/clademusic/ (a subpath), but browsers' default Referrer-Policy sends only the origin cross-origin, dropping /clademusic/. A path-scoped entry in the YouTube key's HTTP-referrer allowlist can never match that stripped referrer, so every client-side call got 403'd — while also leaving the key effectively unprotected in the public bundle, since its only guard wasn't working.

Fix: added supabase/functions/search-youtube/index.ts, a server-side proxy for the two YouTube endpoints the app needs (search, videos), following the same pattern search-spotify already uses to keep secrets off the client. Rewrote src/services/youtubeSearchService.ts to call it via supabase.functions.invoke instead of hitting googleapis.com directly — this is the one shared module all 6 consumers (SearchPage, TrackDetailPage, QuickStreamButtons, CompactSongSections, useTracks, etc.) import, so nothing downstream needed touching. Removed VITE_YOUTUBE_API_KEY from the three GH Actions workflows, .env.example, README.md, and docs/deployment.md, replacing it with the server-side secret.

Two things only you can do (I have no access to Google Cloud Console or your Supabase secrets):

In Google Cloud Console, create a new YouTube Data API v3 key with no referrer restriction (a server function sends no referrer at all, so a referrer-restricted key would reject it too) — keep it separate from any client key.
supabase secrets set YOUTUBE_API_KEY=<new key> --project-ref jlmddkchldgcjmdpvibm then supabase functions deploy search-youtube --project-ref jlmddkchldgcjmdpvibm. I have the Supabase CLI available and your project ref if you'd like me to run the deploy once the secret's set — just say so.
Note: I left index.html, EmbeddedPlayerDrawer.tsx, the seed data/SQL files, and SpotifyCallbackPage.tsx's state alone — those have unrelated uncommitted changes already in your working tree that I didn't touch.



-----------------------------------

The .env only has the publishable (anon) key — creating real auth users via the admin API needs the service role key, which isn't present locally. Also, RESEND_API_KEY is configured, meaning normal signup would likely trigger real confirmation emails to fake addresses.

Please add your Supabase service role key to .env as SUPABASE_SERVICE_KEY=... (from Supabase dashboard → Project Settings → API → service_role secret) — don't paste it into chat. Let me know once it's there and I'll proceed with auth.admin.createUser (which sets email_confirm: true directly and skips sending any email).

Bash Check if service key has been added to .env
IN
grep -q "^SUPABASE_SERVICE" .env 2>/dev/null && echo "found" || echo "not-yet"

OUT
not-yet
I'll wait for you to add the key — let me know when it's ready and I'll continue.

----------------------------------



Good, this confirms the live-capture pipeline is genuine, non-placeholder DSP. I now have a complete picture. Here is my report.

Summary assessment
This is scenario "both" — a real backend data gap plus a frontend wiring bug that compounds it — not a missing feature. A genuine timed-chord-progression pipeline exists end-to-end in the schema and in one real, working (but opt-in, manual, rarely-populated) live-DSP feature. But the code path that actually feeds the persistent player bar's HarmonicHUD never reaches real per-chord timing for virtually any catalog track, and even where structural section timing does exist statically, it isn't wired into the player-bar hook at all. Root-causing "chords not rotating":

The always-visible player-bar readout is driven by harmony.progression, a flat, untimed string[] of chord symbols (e.g. ['i','IV','VI','V']) — never timestamps.
Rotation is supposed to come from useSectionSync's liveChordIndex, but that function hard-returns 0 whenever activeSection is null (src/hooks/useSectionSync.ts:111-112).
activeSection comes from sections, which usePlayerHarmony sources only from the track_sections DB table (via useTrackSections) — and that table is essentially always empty for real catalog tracks, because it's populated only by an admin manually promoting a rare, opt-in, user-consented live-tab-audio capture. usePlayerHarmony has no fallback to the tracks.sections JSONB column that does exist with seeded structural timing (and that a different component, TrackCard, does use).
Net effect: for the player bar, activeSection is null for basically every real track → liveChordIndex is pinned at 0 forever → the "current chord" and the highlighted chip in the progression strip never advance, no matter how long/how far playback progresses. This is what "the chords are still not rotating" looks like in practice.
Separately, there is no automatic real analysis of whatever's currently playing. The only genuine live DSP analysis in the app is opt-in, manual, and requires OS-level tab-audio-share consent (useLiveChordDetection) — it is not what silently drives the default readout.

1. src/player/embeddedPlayer/usePlayerHarmony.ts
sections ← useTrackSections(analysisTrackId) (src/hooks/api/useTrackSections.ts), which calls Supabase RPC get_track_sections(p_track_id) against the track_sections table. Sorted by start_ms.
harmony.progression (lines 73-78):

const fromTrack: string[] = Array.isArray((track as any)?.progression_roman) ? (track as any).progression_roman : [];
const fromFingerprint: string[] = Array.isArray((fingerprint as any)?.roman_progression)
  ? (fingerprint as any).roman_progression.map((c: any) => c?.numeral).filter(Boolean)
  : [];
const progression = fromTrack.length ? fromTrack : fromFingerprint;
track ← useTrack() → Supabase tracks table's progression_roman column (a bare text[], e.g. ARRAY['i','IV','VI','V']). fingerprint ← useHarmonicFingerprint() → the harmonic_fingerprints table's roman_progression jsonb, reduced to just .numeral strings.
progression is confirmed to be an ordered but completely untimed list of chord symbols — no timestamps, no beat positions, nothing. Timing, when it exists at all, lives in a separate array, sections[i].chord_timings (ms, relative to each section's start), sourced from track_sections, not from progression itself.
hudSections (lines 108-118) converts sections → SongSection[], carrying chords/chord_timings through — but only if track_sections had them, which it almost never does for a real catalog track.
The code's own comment (lines 97-107) is telling: it explains HarmonicHUD "already does exactly this (chords that advance with real playback position)" but was previously only mounted in the feed's TrackCard, not the persistent player — i.e., someone already attempted this exact fix once, and the remaining gap is the data source mismatch described above.
2. src/components/HarmonicHUD.tsx
Yes — there is a real "currently playing chord" / rotation concept, driven by useSectionSync (sync.liveChordIndex) and useHarmonicLoop (loop.activeStep) for the non-live preview case:

const activeIndex = sync.isLiveSynced ? sync.liveChordIndex : loop.activeStep;   // line 263
const current = chords[Math.max(activeIndex, 0)] ?? chords[0];                   // line 267
The progression strip highlights the active chip via i === activeIndex (lines 401-419, scale-110 + full-opacity background vs opacity-40).
isLiveSynced = isPlaying && canonicalTrackId === trackId (real playback-position sync, from useSectionSync.ts:76).
There's also a genuinely separate real-audio live-detection mode wired in (useLiveChordDetection, the "Listen" button, lines 74, 451-475, 344-371): while live.status === 'capturing', the big readout switches to live.chord, labeled "live estimate from audio" — this is true live DSP over captured tab audio, not the catalog progression. But it's manual/opt-in (screen/tab-audio-share permission prompt, desktop Chrome/Edge only, costs 1 credit), not automatic.
So the rotation mechanism is real and present in this file — the reason it visibly doesn't rotate is upstream: progression and sections reaching it are (a) untimed and (b) essentially always empty, per point 1.
3. src/player/embeddedPlayer/useActiveSection.ts
Standard "scan sections sorted by start_ms, keep the last one whose start has passed positionMs" pattern (lines 42-52) — this is the same pattern useSectionSync.liveSectionIndex and useSectionSync.liveChordIndex (in src/hooks/useSectionSync.ts:84-92, 111-136) already use for section- and chord-level position matching. It's directly reusable/already reused for a live-position-to-chord match; no new pattern would need to be invented — useSectionSync.liveChordIndex (lines 111-136) is exactly that, applied at chord granularity, walking activeSection.chord_timings from the end backward to find the last chord whose timestamp has passed.
4 & 7. Where chord data actually gets into the DB — precomputed vs. live vs. fake
Three distinct data sources feed "chords", of very different quality:

A. tracks.progression_roman (static, hand-authored "metadata") — supabase/sql-editor/07-seed.sql (generated by scripts/build-seed-sql.mjs). Example:


'F', 'minor', ARRAY['i','IV','VI','V']::text[], 4, ... 'metadata'
analysis_source: 'metadata' — this is manually curated per track at seed time, not derived from any audio pipeline. No timing whatsoever.

B. harmonic_fingerprints.roman_progression — a literal mock. supabase/functions/harmonic-analysis/index.ts (a Supabase Edge Function):


// TODO: Integrate actual ML model here
// For now, use mock analysis
const fingerprint = await runMockAnalysis(track_id, audio_hash, isrc)
runMockAnalysis (lines 403-454) picks one of 3 hardcoded canned progressions at random (Math.floor(Math.random() * progressions.length)) and returns it after a fake setTimeout(1000ms) "processing" delay. No chroma/essentia/librosa/madmom, no real audio access at all — it doesn't even fetch the audio. This is the "ML audio analysis" backend referenced by usePlayerHarmony's comment ("audioAnalysis returns a mock that feeds fingerprints"). It writes no per-chord timing either (bare {numeral, quality} objects).

C. track_sections.chord_timings — the only genuinely timed chord data, and it's real DSP, but rare. This is a proper, well-designed pipeline:

src/hooks/useLiveChordDetection.ts — real client-side Web Audio API analysis: getDisplayMedia({video:true, audio:true}) (tab-audio capture, user-consented), AudioContext/AnalyserNode at FFT_SIZE = 8192, ticking every 120ms.
src/lib/harmony/chordDetection.ts — genuine chroma extraction (FFT bin → MIDI → pitch class folding) and major/minor triad template matching via cosine similarity (confirmed by reading the file; own docstring: "This is genuine DSP over captured audio - not a placeholder").
src/lib/harmony/sectionDetection.ts, chordTimeline.ts, keyEstimation.ts, playbackClock.ts — self-similarity section segmentation, a real chord timeline with actual start/end ms per chord, and key estimation.
Results are POSTed to the ingest-detection edge function → detection_runs / detection_run_sections / detection_run_chords tables (raw evidence, RLS-locked, service-role-only writes; supabase/sql-editor/17-live-detection-runs.sql).
An admin must then manually review and call promote_detection_run(run_id) (supabase/sql-editor/18-promote-detection-run.sql) to copy that run's chords/timings into the canonical track_sections table (with the chord_timings int array line up 1:1 with progression_roman, enforced by a CHECK constraint).
Alternative: an admin can hand-mark section boundaries only via save_track_sections (19-save-track-sections.sql) — explicitly without chords/timings ("Deliberately no progression_roman or chord_timings... chords come from promoting a detection run").
So: real per-chord timing storage and a real (if basic) DSP pipeline to produce it both exist, but populating track_sections for any given track requires a listener to manually run "Listen" (screen-share consent) through an entire play-through and an admin to later review and promote that capture. For the overwhelming majority of catalog tracks this has simply never happened, so track_sections is empty and usePlayerHarmony's sections is [].

There is no server-side/offline batch analysis job (no scripts in scripts/ do chord detection — that directory is imports, seeding, favicon/logo generation, performance tests, comments automation; nothing audio-analysis-related) and no separate Python/server backend at all (no server/, python/, or non-Deno backend directories in the repo).

5. Dependencies check
Root package.json: no meyda, essentia.js, pitchy, aubiojs, tonal, chord-symbol, crepe, or any pitch/chroma/DSP library — grep returned nothing. The live-detection chroma/template-matching math in src/lib/harmony/chordDetection.ts is entirely hand-rolled against the raw Web Audio API AnalyserNode, not backed by any installed audio-DSP package.
No package.json/deno.json exists per-function under supabase/functions/*; the edge functions import everything directly from esm.sh/deno.land URLs (@supabase/supabase-js), and none import an audio-analysis library either.
6. DB schema for chord/section/progression data
public.tracks — progression_roman text[], detected_key, detected_mode, loop_length_bars, cadence_type, sections jsonb (legacy inline format used by TrackCard, separate from track_sections), analysis_source ('metadata' | 'crowd' | 'analysis'). (supabase/sql-editor/01-core-schema.sql, supabase/migrations/20260114211348_...sql)
public.harmonic_fingerprints — roman_progression jsonb (bare numerals, no timing), tonal_center, loop_length_bars, cadence_type, confidence_score, cache TTL columns (reuse_until/reanalyze_after). (supabase/migrations/20260125_harmonic_analysis_core.sql)
public.analysis_jobs — job queue rows for the mock harmonic-analysis function.
public.track_sections — canonical, the only table with per-chord ms timing: label, ordinal, start_ms, end_ms, progression_roman text[], chord_timings integer[] (CHECK'd to line up 1:1 with progression_roman), confidence, source_run_id. (supabase/sql-editor/17-live-detection-runs.sql)
public.detection_runs / detection_run_sections / detection_run_chords — raw, per-capture evidence from useLiveChordDetection, with real start_ms/end_ms per chord (detection_run_chords), pending admin promotion into track_sections. (same file)
Bottom line for the fix
This is not primarily "wire up already-timed chord data" (scenario 1 alone) and not primarily "build a whole new analysis pipeline from scratch" (scenario with zero real analysis) — it's a hybrid:

The rotation mechanism in HarmonicHUD/useSectionSync is already correctly built and does the right thing when given chord_timings (or even just section boundaries for the BPM-heuristic fallback).
The blocking bug closest to "why chords don't rotate today" is in usePlayerHarmony.ts: it sources sections exclusively from the near-always-empty track_sections table, with no fallback to the tracks.sections JSONB column that TrackCard already successfully uses for the feed teaser (imperfect timing, but at minimum a non-null activeSection so the BPM-based rotation heuristic could kick in instead of hard-freezing at index 0).
Getting truly accurate, per-track, always-available rotation would still require either (a) populating track_sections/chord_timings at scale — today that only happens via a manual, opt-in, per-listener capture + manual admin promotion, not an automatic pipeline — or (b) replacing the mock harmonic-analysis edge function with a real offline analysis pipeline run at ingestion.
True "analyze the actual audio currently playing, live" already exists as working code (useLiveChordDetection + src/lib/harmony/chordDetection.ts), but only behind the manual "Listen" button requiring tab-audio-share consent — it is not automatically engaged just because a track is playing, and its results don't become the default/canonical display without manual admin review.