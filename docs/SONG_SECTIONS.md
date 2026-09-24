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
