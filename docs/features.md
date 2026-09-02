# Features

## 🎵 Harmonic Analysis & Discovery

### Core Analysis Engine
- **Relative Theory-Based Analysis** — All harmony stored as Roman numerals (I-V-vi-IV), not absolute chords
- **Hybrid Pipeline** — Cache-first approach with async ML processing for new tracks
- **Confidence Scoring** — Every analysis includes confidence level (0.0-1.0) and provisional flag
- **Model Versioning** — Track which analysis model version generated each result
- **90-Day Caching** — Aggressive result caching for cost efficiency at scale

### Music Theory Features
- **Roman Numeral Progressions** — Visual chord badges showing relative harmony
- **Cadence Detection** — Identify resolution patterns (authentic, plagal, deceptive, loop, etc.)
- **Loop Structure** — Detect harmonic loop length in bars
- **Modal Color** — Recognize modes beyond major/minor (dorian, mixolydian, etc.)
- **Key & Tempo Detection** — BPM and detected key with confidence scores
- **Section-Aware Analysis** — Different progressions for verse, chorus, bridge

### Smart Similarity
- **Progression Shape Matching** (50% weight) — Find tracks with similar Roman numeral sequences
- **Cadence Behavior** (20% weight) — Match by resolution patterns
- **Loop Length** (15% weight) — Same bar structure
- **Modal Color** (10% weight) — Same tonal mode
- **Tempo Proximity** (5% weight) — BPM similarity
- **Progression Rotation** — Detect rotated progressions (I-V-vi-IV ≈ V-vi-IV-I)
- **Genre-Agnostic** — Similarity based on harmony, not metadata

### Search Capabilities
- **Chord Progression Search** — Find songs by pattern (e.g., "I-V-vi-IV" or "vi-IV-I-V")
- **Progression Archetypes** — Browse popular patterns (Axis, Canon, Andalusian, Blues)
- **Song/Artist Search** — Unified search with Spotify integration
- **Search History** — Recent searches with one-tap repeat

## 🎧 Playback & Streaming

### Multi-Platform Support
- **YouTube Embed** — In-app video playback with section navigation
- **Spotify SDK** — Direct playback for premium users
- **Quick Stream Buttons** — One-tap links to Apple Music, Deezer, SoundCloud, Amazon Music
- **Provider Badges** — Visual indicators showing availability across platforms

### Player Features
- **Docked Player** — Fixed, full-width bar at the bottom of the screen (like Spotify's desktop player), not a floating/draggable panel
- **Video Miniplayer** — Expanding the bar shows a small fixed-aspect video box, not a full-width/full-screen one
- **Active Player Management** — Smart z-index handling (100 for active, 50 for inactive)
- **Section Jump** — Tap song sections to seek to that timestamp
- **Automatic Section Detection** — Verse/chorus/bridge boundaries detected from live-captured audio when no curated sections exist yet
- **Queue Management** — Play next, play later, reorder queue, remove tracks
- **3-Dot Track Menu** — Quick access to queue actions and similar tracks

## 👥 Social & Discovery

### Following System
- **Follow Users** — Track friends and discover their music taste
- **Activity Feed** — See what people you follow are playing in real-time
- **Play Events** — Complete listening history with timestamps

### Community Features
- **Live Comments** — Real-time discussion on tracks
- **Nearby Listeners** — Geolocation-based discovery (permission required)
- **Reactions** — Like and interact with tracks

## 🔗 Track Relationships

### Connection Types
- **Sample Detection** — Find original samples and tracks that sampled this song
- **Cover Versions** — Discover different interpretations
- **Remix Tree** — Track remix relationships
- **Connection Graph** — Visual network of related tracks

## 📊 Rich Metadata

### Track Information
- **Song Credits** — Songwriter, producer, label, release date
- **Audio Features** — Energy, danceability, valence scores
- **Genre Tags** — Multiple genre classifications
- **ISRC Codes** — International standard recording codes for deduplication
- **Provider IDs** — Track across Spotify, YouTube, Apple Music, etc.

### Analysis Metadata
- **Confidence Levels** — High/Medium/Low/Provisional labels
- **Analysis Timestamp** — When analysis was performed
- **Analysis Source** — Cached/Metadata/ML/Crowd-sourced
- **Provisional Warnings** — Clear labels for uncertain results

## 🎨 User Interface

### Desktop Experience
- **Responsive Layouts** — Adaptive 1-3 column layouts (sm/md/lg/xl/2xl breakpoints)
- **Desktop Sidebars** — Track metadata, progress tracking, keyboard shortcuts
- **Multi-Column Grids** — Efficient use of widescreen space
- **Responsive Typography** — Font sizes scale with viewport

### Mobile Experience
- **Mobile-First Design** — Optimized for touch interactions
- **Bottom Navigation** — Thumb-friendly tab bar
- **Swipeable Feed** — TikTok-style track discovery
- **Compact Mode** — Information density optimized for small screens

### Visual Design
- **Glass Morphism** — Frosted glass UI elements with backdrop blur
- **Provider Colors** — Spotify green, Apple Music red, YouTube red, etc.
- **Smooth Animations** — Framer Motion transitions and micro-interactions
- **Dark Mode** — Full dark theme support

### Keyboard Navigation
- **Arrow Keys** — ↓/J for next track, ↑/K for previous
- **Spacebar** — Play/pause
- **Search Focus** — Auto-focus on search pages
- **Quick Actions** — Keyboard shortcuts reference in desktop sidebar

## 🔐 Authentication & Profiles

### Account System
- **Email/Password** — Traditional authentication
- **OAuth Integration** — Spotify, Apple Music connections
- **Profile Customization** — Avatar, bio, taste DNA
- **Privacy Controls** — Manage what's visible to others

### Connected Services
- **Spotify Integration** — OAuth connection with listening history sync
- **Service Status** — Visual indicators for connected platforms
- **Token Management** — Secure credential storage

## 📈 Analytics & Insights

### Personal Stats
- **Listening History** — Complete play log with timestamps
- **Favorite Progressions** — Most-played chord patterns
- **Taste Evolution** — Track how your preferences change over time
- **Top Artists** — Most-listened artists and tracks

## 🛠️ Developer Features

### Architecture
- **DRY Components** — ProviderBadge, GlassCard, formatters utilities
- **Type Safety** — Strict TypeScript with comprehensive type definitions
- **Modular Services** — Separated concerns (analysis, similarity, API)
- **Config-Driven** — Thresholds and settings in config objects

### Performance
- **Code Splitting** — Lazy loading for optimal bundle size
- **React Query** — Efficient data fetching with automatic caching
- **Memoization** — useMemo/useCallback for expensive computations
- **Virtual Scrolling** — Efficient rendering for large lists (TODO)

### Testing
- **Vitest Unit Tests** — Component and utility testing
- **Cypress E2E** — End-to-end smoke tests
- **Type Checking** — Strict mode TypeScript validation

## 🚧 Coming Soon

### Planned Features
- [ ] ML Audio Analysis Integration (Essentia.js)
- [ ] Supabase Edge Functions for background processing
- [ ] Real-time analysis progress (WebSockets)
- [ ] Crowd-sourced analysis corrections
- [ ] Harmonic cluster visualization (t-SNE)
- [ ] Progression transposition matching
- [ ] Section boundary detection
- [ ] Modulation detection (key changes)
- [ ] Borrowed chord identification
- [ ] Virtual scrolling for large lists
- [ ] Offline mode with service workers
- [ ] PWA installation
- [ ] Push notifications for follows

---

**Last Updated**: January 21, 2026  
**Version**: 1.0.0
