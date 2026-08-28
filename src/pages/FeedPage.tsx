import { useRef, useEffect, useCallback, useMemo, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrackCard } from '@/components/TrackCard';
import { FeedSkeleton } from '@/components/FeedSkeleton';
const ScrollingComments = lazy(() =>
  import('@/components/ScrollingComments').then((module) => ({ default: module.ScrollingComments }))
);
import { BottomNav } from '@/components/BottomNav';
import { GuestBanner } from '@/components/GuestBanner';
import { ResponsiveContainer, DesktopColumns } from '@/components/layout/ResponsiveLayout';
import { useFeedTracks } from '@/hooks/api/useTracks';
import { useAuth } from '@/hooks/useAuth';
import { useLastFmRecentTracks } from '@/hooks/api/useLastFm';
import { useSpotifyRecommendations } from '@/hooks/api/useSpotifyUser';
import { InteractionType, Track } from '@/types';
import { ChevronUp, ChevronDown, LogIn, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { usePlayer } from '@/player/PlayerContext';
import { ProfileCircle } from '@/components/shared';

export default function FeedPage() {
  const { user, loading: authLoading, guestMode, enterGuestMode } = useAuth();
  const { data: lastfmRecentRaw = [] } = useLastFmRecentTracks(200);
  const navigate = useNavigate();
  
  // Fetch from multiple sources
  const { data: trackResult, isLoading: tracksLoading, error: tracksError } = useFeedTracks(50);
  const { data: recommendations = [], isLoading: recommendationsLoading } = useSpotifyRecommendations([], [], 50);

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

  // Merge in priority order: scrobbles (newest), base feed, personalized recs; dedupe by provider id or title+artist
  const tracks: Track[] = useMemo(() => {
    const seen = new Set<string>();
    const all = [...lastfmRecent, ...baseFeed, ...personalizedRecs];
    return all.filter((t) => {
      const title = (t.title || (t as any).name || '').toLowerCase().trim();
      const artist = (t.artist || t.artists?.[0] || '').toLowerCase().trim();
      const key = (t.spotify_id || t.youtube_id || `${title}|${artist}`) || t.id;
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [lastfmRecent, baseFeed, personalizedRecs]);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [interactions, setInteractions] = useState<Map<string, Set<InteractionType>>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(!user);
  const { openPlayer } = usePlayer();

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

    // Auto-advance on skip
    if (type === 'skip' && currentIndex < tracks.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const goToNext = useCallback(() => {
    if (currentIndex < tracks.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, tracks.length]);

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
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

  if (authLoading || tracksLoading || recommendationsLoading) {
    return (
      <div className="min-h-screen bg-background">
        <FeedSkeleton />
        <BottomNav />
      </div>
    );
  }

  if (tracksError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
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
    <div className="min-h-screen bg-background flex flex-col touch-pan-y" ref={containerRef} data-feed>
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 glass-strong safe-top border-b border-border/50">
        <ResponsiveContainer maxWidth="full">
          <div className="flex items-center justify-between gap-3 py-2.5 sm:py-3 min-w-0">
            <h1 className="text-base sm:text-lg lg:text-xl font-bold gradient-text tracking-tight shrink-0">
              CladeMusic
            </h1>

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
          disabled={currentIndex === 0}
          aria-label="Previous track"
        >
          <ChevronUp className="w-5 h-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="glass rounded-full"
          onClick={goToNext}
          disabled={currentIndex === tracks.length - 1}
          aria-label="Next track"
        >
          <ChevronDown className="w-5 h-5" />
        </Button>
      </div>

      {/* Feed content */}
      <main className="flex-1 pt-16 pb-24">
        <ResponsiveContainer maxWidth="full" className="py-6">
          {/* One guest prompt, not three - dismissible, and it never pushes the feed */}
          {showAuthPrompt && !user && (
            <div className="mx-auto mb-4 w-full max-w-lg lg:max-w-2xl rounded-xl border border-border/60 bg-background/70 px-4 py-3 shadow-md backdrop-blur">
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
          {/*
            Center-focused stage. Uses dvh so the card is not cut off by mobile
            browser chrome, with a min-height floor so short landscape viewports
            scroll instead of squashing the card.
          */}
          <div className="mx-auto w-full max-w-lg lg:max-w-2xl min-h-[32rem] h-[calc(100dvh-13rem)]">
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
        </ResponsiveContainer>
      </main>

      {/* Scrolling comments overlay for current track */}
      {tracks[currentIndex] && (
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
