# Player Architecture

## Embedded Player-First Architecture

CladeAI now relies on a **single global player** that lives inside the bottom drawer UI. All playback requests flow through `PlayerContext`, ensuring every page (feed, album, track, etc.) uses the exact same strip.

### EmbeddedPlayerDrawer (Global Player)

**Location:** `src/player/EmbeddedPlayerDrawer.tsx`  
**Context:** `src/player/PlayerContext.tsx` (via `usePlayer()`)  
**Position:** Fixed, full-width bar docked to the bottom. Its height is not fixed: the chord readout above the bar makes the player roughly 200–350px tall when open. `usePublishPlayerHeight` measures the real height with a `ResizeObserver` and publishes it as `--clade-player-height`, and `body.clade-player-open` reserves that space.  
**Use Case:** Unified playback for Spotify + YouTube (auto-switching)

**Key Behaviors:**
- `isOpen` is derived: true when both `provider` and `trackId` are set
- Provider switch keeps the drawer mounted (no unmount/remount flash)
- The drawer is not rendered for signed-out visitors on `/` (`PlayerVisibilityGate` in `src/App.tsx`), and a crash inside it shows a toast instead of taking the page down
- Metadata (title + optional artist) flows from `openPlayer` payloads
- Queue + seek operations remain centralized in `PlayerContext`
- Section navigation sets `startSec` and uses `seekTo` when already active

**API Snapshot (excerpt; `PlayerContextValue` in `PlayerContext.tsx` is the full contract):**
```typescript
const {
  isOpen,
  provider,          // MusicProvider | null - the active provider
  trackId,           // provider-specific id of the loaded track
  canonicalTrackId,
  spotifyTrackId,
  youtubeTrackId,
  trackTitle,
  trackArtist,
  isPlaying,
  isStarting,        // a start was requested and the provider has not confirmed audio yet
  openPlayer,
  play,
  pause,
  stop,
  closePlayer,
  switchProvider,
  seekTo,
} = usePlayer();
```

**State Structure (excerpt; see `PlayerState` for every field):**
```typescript
{
  provider: MusicProvider | null;
  trackId: string | null;
  canonicalTrackId: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
  trackAlbum: string | null;
  positionMs: number;
  durationMs: number;
  volume: number;            // 0..1
  isMuted: boolean;
  spotifyOpen: boolean;
  youtubeOpen: boolean;
  spotifyTrackId: string | null;
  youtubeTrackId: string | null;
  autoplaySpotify: boolean;
  autoplayYoutube: boolean;
  isPlaying: boolean;
  isStarting: boolean;
  playRequestId: number;     // bumped on every explicit play/open request
  seekToSec: number | null;
  currentSectionId: string | null;
  loopSectionId: string | null;
  queue: Track[];
  queueIndex: number;
}
```

**Queue:** `enqueueNext`, `enqueueLater` (alias `addToQueue`), `playFromQueue`, `removeFromQueue`, `reorderQueue`, `clearQueue`, `shuffleQueue`, `nextTrack` and `previousTrack` (both wrap around). `openPlayer` adds the track to the queue when it is not already there. The queue and its index persist to `localStorage` under `clade_queue_v1`.

**Ordering:** `openPlayer`, `play`, `stop`, `closePlayer` and `switchProvider` run through one serial operation chain, so overlapping requests apply in the order they were made.

**Display modes:** `isHidden` / `toggleHidden` hide the docked chrome without unmounting the player, so playback continues. `isCinema` is browser fullscreen (`enterCinema` / `exitCinema`). The mini-mode state (`isMini`, `collapseToMini`, `restoreFromMini`, `miniPosition`) is still in `PlayerContext`, but no app code outside the context uses it; only tests do.

### Provider Surfaces

Providers are React components that register a `ProviderControls` object with `registerProviderControls` and report progress through `updatePlaybackState` (see `src/player/providers/adapter.ts`). The drawer mounts two of them:

- **`SpotifyWebPlayer`**: Spotify Web Playback SDK, audio only. Used when SDK playback is available.
- **`UniversalPlayerHost`** (`src/player/universal/`): the single iframe host for YouTube, and the embed fallback for Spotify when SDK playback is not available (guest, non-Premium, or an SDK error).

Exactly one provider is active at a time. When the active provider changes, `PlayerContext` stops the previous one first.

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

The legacy `FloatingPlayersContext` + `FloatingPlayer` component have been removed from the application shell. Historical references are preserved only for audit trails; do not reintroduce multi-window playback unless a new architectural review approves it. The file `src/components/FloatingPlayer.tsx` still exists, but nothing imports it.

### Testing Checklist

Automated coverage: Vitest tests beside the code in `src/player/` (context controls, queue, starting state, providers, universal host) and Playwright specs in `tests/player-*.spec.ts` (singleton, provider atomicity, survives navigation, z-index, Spotify embed fallback).

When making player changes:

- [ ] Trigger playback via QuickStream buttons (Spotify + YouTube)
- [ ] Trigger WATCH/LISTEN buttons via `PlaybackControls`
- [ ] Use section chips to verify `seekTo` vs new playback
- [ ] Switch providers from the same drawer instance (no flicker)
- [ ] Close and reopen drawer to ensure metadata resets correctly
- [ ] Confirm drawer appears identically on Feed, Album, and Track pages
