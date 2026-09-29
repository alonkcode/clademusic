import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrackCard } from '@/components/TrackCard';
import { FeedSkeleton } from '@/components/FeedSkeleton';
const ScrollingComments = lazy(() =>
  import('@/components/ScrollingComments').then((module) => ({ default: module.ScrollingComments }))
);
import { BottomNav } from '@/components/BottomNav';
import { GuestBanner } from '@/components/GuestBanner';
import { ResponsiveContainer, DesktopColumns } from '@/components/layout/ResponsiveLayout';
import { usePersonalizedFeed } from '@/hooks/api/useFeed';
import { useTrack } from '@/hooks/api/useTracks';
import { useAuth } from '@/hooks/useAuth';
import { useLastFmRecentTracks } from '@/hooks/api/useLastFm';
import { useSpotifyRecommendations } from '@/hooks/api/useSpotifyUser';
import { usePlayHistory } from '@/hooks/api/usePlayEvents';
import { useSetting } from '@/hooks/useSystemSettings';
import { InteractionType, Track } from '@/types';
import { ChevronUp, ChevronDown, LogIn, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePlayer } from '@/player/PlayerContext';
import { CladeBrand, ProfileCircle } from '@/components/shared';
import { NotificationBell } from '@/components/notifications/NotificationBell';

export default function FeedPage() {
  const { user, loading: authLoading, guestMode, enterGuestMode } = useAuth();
  const chatEnabled = useSetting('flag.chat_enabled');
  const { data: lastfmRecentRaw = [] } = useLastFmRecentTracks(200);
  const navigate = useNavigate();
  // Set by the docked player's title tap: the one song the feed should show.
  const location = useLocation();
  const focusTrackId = (location.state as { focusTrackId?: string } | null)?.focusTrackId;
  const locationKey = location.key;

  // Fetch from multiple sources
  const { data: trackResult, isLoading: tracksLoading, error: tracksError } = usePersonalizedFeed(50);
  const { data: recommendations = [], isLoading: recommendationsLoading } = useSpotifyRecommendations([], [], 50);
  // What this listener has already played, so the feed can push those toward
  // the back instead of opening on the exact same tracks every visit.
  const { data: playHistory = [] } = usePlayHistory({ limit: 200 });
  const recentlyPlayedIds = useMemo(
    () => new Set(playHistory.map((p) => p.track_id).filter(Boolean)),
    [playHistory]
  );

  // Always show both recent feed tracks and personalized recommendations (if available and signed-in).
  const baseFeed = trackResult?.tracks ?? [];
  const personalizedRecs = user ? recommendations : [];
  // Map the last 200 scrobbles to Track shape and dedupe by title+artist (newest wins).
  const lastfmRecent: Track[] = useMemo(() => {
    const getImageUrl = (images?: Array<{ '#text': string; size: string }>): string | undefined => {
      if (!images || images.length === 0) return undefined;
      const sizePriority = ['extralarge', 'large', 'medium', 'small'];
      for (const size of sizePriority) {
        const img = images.find((i) => i.size === size);
        if (img?.['#text']) return img['#text'];
      }
      return images[0]?.['#text'] || undefined;
    };

    const seen = new Set<string>();
    const out: Track[] = [];

    for (let i = 0; i < lastfmRecentRaw.length; i++) {
      const t = lastfmRecentRaw[i] as any;
      const title = String(t?.name || '').trim();
      const artist = String(t?.artist?.name || t?.artist?.['#text'] || '').trim();
      if (!title || !artist) continue;

      const key = `${title.toLowerCase()}|${artist.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const playedAtMs = t?.date?.uts ? Number(t.date.uts) * 1000 : undefined;
      out.push({
        id: `lastfm:${artist}-${title}-${playedAtMs ?? i}`,
        title,
        artist,
        album: t?.album?.['#text'] || undefined,
        cover_url: getImageUrl(t?.image),
      });
    }

    return out;
  }, [lastfmRecentRaw]);

  // Merge: top of the ranked feed, scrobbles (newest), rest of the feed, Spotify recs; dedupe by provider id or title+artist
  const rankedTracks: Track[] = useMemo(() => {
    const nameArtistKey = (t: Track) => {
      const title = (t.title || (t as any).name || '').toLowerCase().trim();
      const artist = (t.artist || t.artists?.[0] || '').toLowerCase().trim();
      return `${title}|${artist}`;
    };

    // A Last.fm scrobble is only a title + artist - no provider ids, no
    // sections, no harmony. So its feed card had nothing for the quick-link
    // buttons to play and nothing for the section chips to seek to. When the
    // same song is in the catalog (or the Spotify recs), fold that row's
    // playable data onto the scrobble so the card behaves like any other.
    const catalogByNameArtist = new Map<string, Track>();
    for (const t of [...baseFeed, ...personalizedRecs]) {
      const k = nameArtistKey(t);
      if (k !== '|' && !catalogByNameArtist.has(k)) catalogByNameArtist.set(k, t);
    }
    const hydratedLastfm = lastfmRecent.map((t) => {
      const match = catalogByNameArtist.get(nameArtistKey(t));
      if (!match) return t;
      // Catalog row wins for the canonical id and everything playback needs
      // (provider ids, sections, harmony, duration) so section-seek and the
      // already-played ordering below both recognise it; the scrobble keeps
      // its own cover art / album only where the catalog has none.
      return { ...t, ...match, cover_url: match.cover_url || t.cover_url, album: match.album || t.album };
    });

    // The ranked catalog leads (its first picks are the ones chosen for this
    // listener), then their scrobbles, then the rest of the ranked feed. With
    // the scrobbles first - up to 200 of them - a Last.fm user would never
    // reach the personalization below.
    const LEADING_PICKS = 10;
    const seen = new Set<string>();
    const all = [
      ...baseFeed.slice(0, LEADING_PICKS),
      ...hydratedLastfm,
      ...baseFeed.slice(LEADING_PICKS),
      ...personalizedRecs,
    ];
    const deduped = all.filter((t) => {
      const key = (t.spotify_id || t.youtube_id || nameArtistKey(t)) || t.id;
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (recentlyPlayedIds.size === 0) return deduped;

    // Push what's already been played toward the back rather than dropping
    // it - the catalog is small enough that hiding it outright could leave
    // an active listener with barely anything - so a returning visitor's
    // feed opens on what they haven't heard, without ever going empty.
    const unseen = deduped.filter((t) => !recentlyPlayedIds.has(t.id));
    const seenBefore = deduped.filter((t) => recentlyPlayedIds.has(t.id));
    return [...unseen, ...seenBefore];
  }, [lastfmRecent, baseFeed, personalizedRecs, recentlyPlayedIds]);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [interactions, setInteractions] = useState<Map<string, Set<InteractionType>>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(!user);
  const { openPlayer, canonicalTrackId } = usePlayer();

  // A song can be playing that this feed's own list doesn't contain - started
  // from search, a playlist, a profile or the queue. Tapping the player's
  // title asks the feed to show what's playing, so with no card for it the
  // tap would land on whatever card was already up. Fetch that one song and
  // put it at the front. useTrack resolves catalog ids as well as the
  // `spotify:`/`youtube:` canonical ids the player synthesizes for a provider
  // track with no catalog row, and all three of its sources return a row
  // whose own id is that same canonical id - which is what lets the jump
  // below, and the player-follows-feed effect, find it by id. A lookup that
  // fails yields nothing and leaves the feed exactly as it was.
  const playingIsInFeed = useMemo(
    () => !!canonicalTrackId && rankedTracks.some((t) => t.id === canonicalTrackId),
    [rankedTracks, canonicalTrackId]
  );
  const { data: playingTrack } = useTrack(
    canonicalTrackId ?? undefined,
    !!canonicalTrackId && !playingIsInFeed
  );
  const tracks: Track[] = useMemo(
    () =>
      playingTrack && !playingIsInFeed && playingTrack.id === canonicalTrackId
        ? [playingTrack, ...rankedTracks]
        : rankedTracks,
    [playingTrack, playingIsInFeed, canonicalTrackId, rankedTracks]
  );

  // The guest-mode prompt sits in normal flow above the card, so its real
  // height (which varies with text wrapping/viewport width) has to come out
  // of the card's own dvh budget below - otherwise the card claims its usual
  // full height on top of the banner's, overflowing the viewport and adding
  // a scroll that reaches nothing but blank space. A plain ref wouldn't do
  // here: the banner's dependencies (showAuthPrompt, user) are already true/
  // null during the earlier loading-skeleton render, where nothing is
  // mounted yet, so an effect keyed on them never re-fires once the real
  // banner node shows up later with the same values. A callback ref fires
  // exactly when the node itself is attached/detached, sidestepping that.
  const [authPromptEl, setAuthPromptEl] = useState<HTMLDivElement | null>(null);
  const [authPromptOffset, setAuthPromptOffset] = useState(0);

  // The docked player's own transport (its prev/next buttons, the queue
  // sheet, a track opened from search/profile/etc.) can change what's
  // playing independently of this page's own swipe position. Without this,
  // the feed kept showing whatever card the listener last swiped to even
  // after playback moved on elsewhere, so the card on screen and the chords
  // in the docked bar below it stopped matching the audio actually playing.
  useEffect(() => {
    if (!canonicalTrackId) return;
    const playingIndex = tracks.findIndex((t) => t.id === canonicalTrackId);
    if (playingIndex !== -1 && playingIndex !== currentIndex) {
      setCurrentIndex(playingIndex);
    }
    // Only react to the playing track (or the feed list) changing - not to
    // currentIndex itself, or every manual swipe would immediately be
    // fought back to wherever the player last was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalTrackId, tracks]);

  // Tapping the docked player's title navigates here asking for one song:
  // show me that one. The effect above can't serve that on its own - it only
  // fires when the PLAYING track changes, and this tap changes nothing about
  // playback, so arriving from a card the listener had swiped away to (or
  // tapping the title while already on the feed) would otherwise do nothing
  // at all.
  //
  // One jump per navigation, tracked by location.key, which is fresh on every
  // navigate: a second tap mints a new key and jumps again, but nothing else
  // does. `tracks` stays in the deps because the list is still loading (or
  // the off-feed song above is still being fetched) on the render this
  // arrives at, so the requested song often isn't findable until a later
  // pass - but the list also gets a new identity on every background
  // refetch, and without the ref each of those would drag the listener back
  // to this card however long ago they swiped away from it.
  const servedFocusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusTrackId || servedFocusKeyRef.current === locationKey) return;
    const focusIndex = tracks.findIndex((t) => t.id === focusTrackId);
    if (focusIndex === -1) return;
    servedFocusKeyRef.current = locationKey;
    setCurrentIndex(focusIndex);
  }, [focusTrackId, locationKey, tracks]);

  useLayoutEffect(() => {
    if (!authPromptEl) {
      setAuthPromptOffset(0);
      return;
    }
    const update = () => setAuthPromptOffset(authPromptEl.offsetHeight + 16 /* mt-4 */);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(authPromptEl);
    return () => observer.disconnect();
  }, [authPromptEl]);

  useEffect(() => {
    if (user || guestMode) {
      setShowAuthPrompt(false);
    }
  }, [user, guestMode]);
  
  const handleInteraction = (type: InteractionType) => {
    if (!user) {
      setShowAuthPrompt(true);
      return;
    }

    const trackId = tracks[currentIndex]?.id;
    if (!trackId) return;

    setInteractions((prev) => {
      const next = new Map(prev);
      const trackInteractions = new Set(prev.get(trackId) || []);

      if (trackInteractions.has(type)) {
        trackInteractions.delete(type);
      } else {
        trackInteractions.add(type);
      }

      next.set(trackId, trackInteractions);
      return next;
    });

    // Auto-advance on skip - wraps like the rest of the feed's navigation.
    if (type === 'skip' && tracks.length > 0) {
      setCurrentIndex((prev) => (prev + 1) % tracks.length);
    }
  };

  // Endless feed: wraps at both ends instead of stopping, so the up/down
  // chevrons (and keyboard/swipe) are only ever disabled when there's
  // nothing to loop through (0 or 1 tracks) rather than "greyed out" every
  // time you land on the first or last card.
  const goToNext = useCallback(() => {
    if (tracks.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % tracks.length);
  }, [tracks.length]);

  const goToPrevious = useCallback(() => {
    if (tracks.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + tracks.length) % tracks.length);
  }, [tracks.length]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      // An open sheet or dialog (comments, share, nearby) owns the keyboard:
      // scrolling its content with the arrow keys must not skip the track
      // sitting behind it.
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        goToNext();
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        goToPrevious();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNext, goToPrevious]);

  // Handle touch/scroll with improved swipe detection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let startY = 0;
    let startX = 0;
    let startTime = 0;

    const handleTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      startTime = Date.now();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const endY = e.changedTouches[0].clientY;
      const endX = e.changedTouches[0].clientX;
      const diffY = startY - endY;
      const diffX = Math.abs(startX - endX);
      const timeDiff = Date.now() - startTime;

      // Swipe threshold: at least 50px vertical, mostly vertical (not horizontal), completed within 500ms
      if (Math.abs(diffY) > 50 && Math.abs(diffY) > diffX && timeDiff < 500) {
        if (diffY > 0) {
          goToNext();
        } else {
          goToPrevious();
        }
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [goToNext, goToPrevious]);

  // Desktop mouse-wheel / trackpad scroll: the feed is one full-viewport
  // card at a time, so a scroll gesture here advances/retreats through
  // tracks the same way a touch swipe does on mobile, rather than scrolling
  // the page. preventDefault blocks the page itself from ever moving; the
  // lockout collapses a single trackpad gesture's burst of small deltaY
  // events (and any inertial tail) into one track change instead of several.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let locked = false;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (locked || Math.abs(e.deltaY) < 10) return;

      locked = true;
      if (e.deltaY > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
      window.setTimeout(() => {
        locked = false;
      }, 500);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [goToNext, goToPrevious]);

  if (authLoading || tracksLoading || recommendationsLoading) {
    return (
      // pt-[4.5rem] = the loaded feed's own offset (main pt-16 + card pt-2), so
      // the title placeholder sits where the real title lands instead of at
      // the top edge and then jumping down.
      <div className="min-h-[100dvh] overflow-hidden bg-background pt-[4.5rem]">
        <FeedSkeleton />
        <BottomNav />
      </div>
    );
  }

  if (tracksError) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background">
        <div className="text-center p-6">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Failed to load tracks</h2>
          <p className="text-muted-foreground">Please try again later</p>
        </div>
        <BottomNav />
      </div>
    );
  }

  const currentTrack = tracks[currentIndex];

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background touch-pan-y" ref={containerRef} data-feed>
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 glass-strong safe-top border-b border-border/50">
        <ResponsiveContainer maxWidth="full">
          {/*
            pl-14/16 clears BottomNav's floating hamburger button, which is
            fixed at top-left (p-3/p-4 + a 40px button) independently of this
            header. Without this offset the brand name renders directly under
            that button and is effectively invisible.
          */}
          <div className="flex items-center justify-between gap-3 py-2.5 sm:py-3 pl-14 sm:pl-16 min-w-0">
            <CladeBrand size="sm" className="shrink-0" />

            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              {tracks.length > 0 && (
                <span
                  className="text-[11px] sm:text-xs text-muted-foreground font-mono tabular-nums shrink-0"
                  aria-live="polite"
                >
                  {currentIndex + 1}
                  <span className="opacity-50">/{tracks.length}</span>
                </span>
              )}
              {!user && (
                <Button
                  size="sm"
                  onClick={() => navigate('/auth')}
                  className="gap-1.5 shrink-0"
                >
                  <LogIn className="w-4 h-4" />
                  <span className="hidden sm:inline">Sign in</span>
                </Button>
              )}
              <NotificationBell />
              <ProfileCircle />
            </div>
          </div>
        </ResponsiveContainer>

        {/* Position through the feed - a thin, unobtrusive progress rail */}
        {tracks.length > 1 && (
          <div className="h-0.5 w-full bg-muted/40">
            <motion.div
              className="h-full bg-gradient-to-r from-primary to-accent"
              animate={{ width: `${((currentIndex + 1) / tracks.length) * 100}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        )}
      </header>

      {/* Navigation arrows - desktop only; on touch the feed is swiped */}
      <div className="hidden lg:flex fixed left-4 xl:left-6 top-1/2 -translate-y-1/2 z-30 flex-col gap-2">
        <Button
          variant="outline"
          size="icon"
          className="glass rounded-full"
          onClick={goToPrevious}
          disabled={tracks.length <= 1}
          aria-label="Previous track"
        >
          <ChevronUp className="w-5 h-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="glass rounded-full"
          onClick={goToNext}
          disabled={tracks.length <= 1}
          aria-label="Next track"
        >
          <ChevronDown className="w-5 h-5" />
        </Button>
      </div>

      {/* Feed content */}
      <main className="min-h-0 flex-1 overflow-hidden pt-16">
        {/* pt-16 above already clears the fixed header - stacking py-6's own
            top padding on top of that (as this used to) added a second,
            redundant gap before any real content, on top of the header's
            own real height. pb-6 for breathing room above pb-24's player-bar
            clearance is kept; just the top half was the dead space. */}
        <ResponsiveContainer maxWidth="full" className="flex h-full min-h-0 flex-col pt-2 pb-14">
          {/*
            Center-focused stage. Uses dvh so the card is not cut off by mobile
            browser chrome, minus authPromptOffset so the guest banner below
            (when shown) doesn't push this past the viewport, with a
            min-height floor so short landscape viewports scroll instead of
            squashing the card.
          */}
          <div
            // Clipped only while the guest prompt below is showing: on a short
            // phone the card's content is taller than the space left for it,
            // and unclipped it spilled over the prompt.
            className={`mx-auto min-h-0 w-full max-w-lg flex-1 lg:max-w-2xl${authPromptEl ? ' overflow-hidden' : ''}`}
            style={{
              height: `calc(100dvh - 10rem - var(--clade-player-height, 0px) - ${authPromptOffset}px)`,
            }}
          >
            <AnimatePresence mode="wait">
              {currentTrack && (
                <motion.div
                  key={currentTrack.id}
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -50 }}
                  transition={{ duration: 0.3 }}
                  className="h-full"
                >
                  <TrackCard
                    track={currentTrack}
                    isActive={true}
                    onInteraction={handleInteraction}
                    interactions={interactions.get(currentTrack.id) || new Set()}
                     onPipModeActivate={(videoId, title) => {
                       if (!videoId) return;
                       openPlayer({
                         canonicalTrackId: currentTrack.id,
                         provider: 'youtube',
                         providerTrackId: videoId,
                         autoplay: true,
                         context: 'feed',
                         title,
                         artist: currentTrack.artist,
                       });
                     }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* The guest prompt sits BELOW the card, in normal flow: above it, it
              pushed the title down by its own height (~150px) and put a gap
              between the header and the song. Its real height still comes
              out of the card's dvh budget via authPromptOffset (measured,
              not guessed) - without that the card kept its usual full height
              on top of the banner's, overflowing the viewport and leaving a
              scroll that reached nothing but blank space. */}
          {showAuthPrompt && !user && (
            <div
              ref={setAuthPromptEl}
              className="mx-auto mt-4 w-full max-w-lg lg:max-w-2xl rounded-xl border border-border/60 bg-background/70 px-4 py-3 shadow-md backdrop-blur"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Exploring as a guest</p>
                  <p className="text-xs text-muted-foreground">
                    Browsing and playback stay open. Sign in to like, comment, follow and save.
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" onClick={() => navigate('/auth')}>
                    Sign in
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      enterGuestMode();
                      setShowAuthPrompt(false);
                    }}
                  >
                    Not now
                  </Button>
                </div>
              </div>
            </div>
          )}
        </ResponsiveContainer>
      </main>

      {/* Ambient overlay of the global chat room; gone when an admin turns chat off */}
      {chatEnabled && tracks[currentIndex] && (
        <Suspense fallback={null}>
          <ScrollingComments roomId="global" maxVisible={3} scrollSpeed={4000} />
        </Suspense>
      )}

      {/* Guest banner */}
      <GuestBanner />

      {/* Bottom navigation */}
      <BottomNav />
    </div>
  );
}
