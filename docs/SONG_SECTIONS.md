# Song Sections Feature Documentation

## Overview
Song sections describe a track's cut points (intro, verse, chorus, bridge, breakdown, etc.) and are used for both navigation and harmonic context. The canonical data is stored as millisecond boundaries on the section itself, and playback always starts through the universal player rather than launching a standalone inline embed.

## Current behavior

### 1. Universal-player seek navigation
When a user taps a section chip:
- the app resolves the correct provider and track
- it seeks the existing player in place when the same track is already playing
- otherwise it opens the universal player at the exact section boundary
- the section start is preserved as a real millisecond value, not rounded to whole seconds

This is the behavior implemented in: 
- `src/components/CompactSongSections.tsx`
- `src/components/SongSections.tsx`
- `src/player/PlayerContext.tsx`

### 2. Timestamp precision for tuning
Section boundaries are stored and displayed in milliseconds so the UI can show values such as `0:50.000`. This is important for fine adjustment of section starts, especially when a section boundary is not perfectly aligned to a whole second.

### 3. Section-aware playback context
A section card not only jumps to the right time but also keeps the harmonic readout and active-section highlighting aligned with the current track and playback position.

### 4. Manual editing (admin)
The section editor (the Edit button on `HarmonicHUD`, `src/components/SectionEditor.tsx`) marks structure and chords by ear against the playing track. Nothing is written until Save.

- **Sections** are edited as boundaries (`src/lib/harmony/sectionDraft.ts`): mark at the playhead, nudge, type an exact start, relabel, remove. The first section starts where the track does, so its start is not a boundary anyone can move.
- **Chords** (`src/lib/harmony/chordDraft.ts`) can be replaced, added at the playhead, moved to a typed onset, split into two half-length chords (a bar into two half bars), or removed. Each chord is kept at its place in the *track*, not inside a section, so moving a boundary never moves a chord in the audio - the chord simply belongs to whichever section it now falls in. A chord holds until the next one in its section (or the section's end), and the first chord of a section always plays from the section's start, as `chordIndexAt` already treats it - so that chord has no onset of its own to retime, and moving the boundary is what that edit means.
- **Times** are shown, and typed back, to the millisecond (`m:ss.mmm`; `parseTimecode` in `src/lib/timeFormat.ts` reads the shorter forms too, through `src/components/TimecodeInput.tsx`). A typed time that will not fit between its neighbours is held at the nearest moment that does rather than refused, so boundaries stay `MIN_SECTION_MS` apart and chords `MIN_CHORD_MS`.
- **Storage:** each section saves `progression_roman` (Roman numerals, so harmony stays relative) and `chord_timings` (ms from the section's own start, one per numeral) - the shape a promoted detection run writes. Saving replaces every stored section *and its chords* with what the editor shows, and mirrors both onto `tracks.sections` for the feed.
- **Database:** chord saving needs `supabase/sql-editor/32-save-track-sections-chords.sql` (after 19 and 31). A save that carries chords against a database without it fails with an instruction to run it, rather than reporting success for chords that were not stored. A save with no chords still works without it.

## Data shapes

### Legacy song-sections payload
```ts
export interface SongSection {
  type: SongSectionType;
  label?: string; // e.g. "Verse 1", "Chorus", "Bridge"
  start_time: number; // seconds for legacy payloads
  end_time?: number; // seconds (optional)
  chords?: string[];
  chord_timings?: number[];
}
```

### Canonical section rows
```ts
export interface TrackSection {
  id: string;
  track_id: string;
  label: SongSectionType;
  start_ms: number;
  end_ms: number;
  created_at: string;
  ordinal?: number;
  chords?: string[];
  chord_timings?: number[];
  confidence?: number;
}
```

The important distinction is that the app treats `start_ms` / `end_ms` as the source of truth for playhead positioning and UI labels, while the older `start_time` / `end_time` fields are legacy compatibility shapes.

## Implementation references
- `src/components/CompactSongSections.tsx` — compact section chips and click-through seeking
- `src/components/SongSections.tsx` — full song-structure view
- `src/pages/TrackDetailPage.tsx` — section list on track detail pages
- `src/lib/timeFormat.ts` — shared time formatting
- `src/lib/sections.ts` — section utilities and precise millisecond formatting
- `src/types/index.ts` — section data contracts
