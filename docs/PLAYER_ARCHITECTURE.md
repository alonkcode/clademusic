# Player Architecture

## Embedded Player-First Architecture

CladeAI now relies on a **single global player** that lives inside the bottom drawer UI. All playback requests flow through `PlayerContext`, ensuring every page (feed, album, track, etc.) uses the exact same strip.

### EmbeddedPlayerDrawer (Global Player)

**Location:** `src/player/EmbeddedPlayerDrawer.tsx`  
**Context:** `src/player/PlayerContext.tsx` (via `usePlayer()`)  
**Position:** Fixed bottom bar (slim, 48px height)  
**Use Case:** Unified playback for Spotify + YouTube (auto-switching)

**Key Behaviors:**
- `isOpen` flag mirrors drawer visibility everywhere
- Provider switch keeps the drawer mounted (no unmount/remount flash)
- Metadata (title + optional artist) flows from `openPlayer` payloads
- Queue + seek operations remain centralized in `PlayerContext`
- Section navigation sets `startSec` and uses `seekTo` when already active

**API Snapshot:**
```typescript
const {
  isOpen,
  currentProvider,
  spotifyTrackId,
  youtubeTrackId,
  trackTitle,
  trackArtist,
  openPlayer,
  switchProvider,
  seekTo,
  closePlayer,
} = usePlayer();
```

**State Structure (excerpt):**
```typescript
{
  spotifyOpen: boolean;
  youtubeOpen: boolean;
  currentProvider: MusicProvider | null;
  canonicalTrackId: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
  spotifyTrackId: string | null;
  youtubeTrackId: string | null;
  autoplaySpotify: boolean;
  autoplayYoutube: boolean;
  seekToSec: number | null;
  queue: Track[];
}
```

### Entry Points

- **QuickStreamButtons** → calls `openPlayer` with canonical track ID + provider IDs
- **CompactSongSections** → calls `openPlayer` with `startSec` or `seekTo` if already playing
- **PlaybackControls** → `openPlayer` + `switchProvider` for WATCH/LISTEN buttons

### Consistency Requirements

- All client components must call `openPlayer` (never instantiate their own player UIs)
- Always provide `canonicalTrackId`, `title`, and `artist` when available so drawer text stays accurate
- Use `switchProvider` for inline provider toggles (e.g., Spotify ↔ YouTube) without closing the drawer
- Use `seekTo` only when you know the same canonical track + provider are already active
- Embedded drawer is the only UI for playback; picture-in-picture modes are deprecated

### Deprecated System

The legacy `FloatingPlayersContext` + `FloatingPlayer` component have been removed from the application shell. Historical references are preserved only for audit trails; do not reintroduce multi-window playback unless a new architectural review approves it.

### Testing Checklist

When making player changes:

- [ ] Trigger playback via QuickStream buttons (Spotify + YouTube)
- [ ] Trigger WATCH/LISTEN buttons via `PlaybackControls`
- [ ] Use section chips to verify `seekTo` vs new playback
- [ ] Switch providers from the same drawer instance (no flicker)
- [ ] Close and reopen drawer to ensure metadata resets correctly
- [ ] Confirm drawer appears identically on Feed, Album, and Track pages
