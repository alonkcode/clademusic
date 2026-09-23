import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Bookmark, X, Sparkles, Waves, Play, Pause, Music, Youtube, MessageSquare } from 'lucide-react';
import { HarmonyCard } from './HarmonyCard';
import { TrackComments } from './TrackComments';
import { NearbyListenersSheet } from './NearbyListenersSheet';
import { ShareSheet } from './ShareSheet';
import { AudioPreview } from './AudioPreview';
import { QuickStreamButtons } from './QuickStreamButtons';
import { CompactSongSections } from './CompactSongSections';
import { TrackMenu } from './TrackMenu';
import { Button } from '@/components/ui/button';
import { AncestorBadge } from '@/components/icons/CladeIcon';
import { Track, InteractionType, TrackSection, SongSection } from '@/types';
import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useRecordListeningActivity } from '@/hooks/api/useNearbyListeners';
import { useRecordPlay } from '@/hooks/api/useFollowing';
import { useAuth } from '@/hooks/useAuth';
import { useInteractions } from '@/hooks/useInteractions';
import { SectionSelectionProvider } from '@/hooks/useSectionSelection';
import { usePlayer } from '@/player/PlayerContext';
import { useCommentCount, useCommentCountRealtime } from '@/hooks/api/useComments';
import { useTrackCoverArt } from '@/hooks/useTrackCoverArt';

interface TrackCardProps {
  track: Track;
  isActive: boolean;
  onInteraction: (type: InteractionType) => void;
  interactions?: Set<InteractionType>;
  onPipModeActivate?: (videoId: string, title: string) => void;
  isPipActive?: boolean;
}

export function TrackCard({ 
  track, 
  isActive, 
  onInteraction, 
  interactions = new Set(),
  onPipModeActivate,
  isPipActive = false,
}: TrackCardProps) {
  const { user, guestMode } = useAuth();
  const [isPlaying, setIsPlaying] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playStartTimeRef = useRef<number | null>(null);
  const recordActivity = useRecordListeningActivity();
  const recordPlay = useRecordPlay();
  const { interaction, toggleLike, toggleHarmonySave, toggleBookmark, toggleVibe, recordShare } = useInteractions(track.id);
  const { openPlayer, canonicalTrackId: dockedTrackId } = usePlayer();
  // The docked player (EmbeddedPlayerDrawer) is fixed to the bottom of every
  // route and shows its own HarmonicHUD for whatever track is loaded into
  // it, live-synced to real playback - strictly more useful than this
  // card's own static progression teaser for that one specific track. Once
  // both existed, whichever card happened to be the one currently playing
  // showed the exact same chord progression twice on screen at once.
  const isDockedTrack = dockedTrackId === track.id;
  // Just the number - not every comment (and each author's profile) for a card
  // that only shows a count until the thread is expanded.
  const { data: commentCount = 0 } = useCommentCount(track.id);
  useCommentCountRealtime(track.id);
  const coverUrl = useTrackCoverArt(track);

  // Convert SongSection to TrackSection format
  const convertSections = useCallback((sections: SongSection[]): TrackSection[] => {
    return sections.map((section, index) => ({
      id: `${track.id}-${section.type}-${index}`,
      track_id: track.id,
      label: section.type,
      start_ms: section.start_time * 1000,
      end_ms: section.end_time ? section.end_time * 1000 : (sections[index + 1]?.start_time || track.duration_ms || 240000 / 1000) * 1000,
      created_at: new Date().toISOString(),
    }));
  }, [track.id, track.duration_ms]);


  // Only the track's own analyzed sections. The fallback used to invent them
  // at fixed percentages of the duration (intro 0-10%, verse 10-30%, ...),
  // which meant every song claimed the same structure regardless of how it
  // actually goes - the chips looked authoritative and were wrong. A song
  // whose sections have not been analyzed yet shows none.
  const trackSections: TrackSection[] = track.sections && track.sections.length > 0
    ? convertSections(track.sections)
    : [];

  // Pause audio when card becomes inactive
  useEffect(() => {
    if (!isActive && isPlaying) {
      handlePause();
    }
  }, [isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const handlePlay = useCallback(async () => {
    if (audioRef.current && track.preview_url) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
        playStartTimeRef.current = Date.now();
        
        // Record listening activity
        recordActivity.mutate({ 
          trackId: track.id, 
          artist: track.artist 
        });
      } catch (err) {
        console.error('Playback failed:', err);
      }
    }
  }, [track.preview_url, track.id, track.artist, recordActivity]);

  const handlePause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);

      // Record play duration
      if (playStartTimeRef.current && user) {
        const durationMs = Date.now() - playStartTimeRef.current;
        recordPlay.mutate({
          trackId: track.id,
          durationMs,
          source: 'feed',
        });
        playStartTimeRef.current = null;
      }
    }
  }, [user, track.id, recordPlay]);

  const handlePlayPause = () => {
    if (isPlaying) {
      handlePause();
    } else {
      handlePlay();
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    if (playStartTimeRef.current && user) {
      const durationMs = Date.now() - playStartTimeRef.current;
      recordPlay.mutate({
        trackId: track.id,
        durationMs,
        source: 'feed',
      });
      playStartTimeRef.current = null;
    }
  };

  const handleShare = () => {
    if (user) {
      recordShare();
    }
    onInteraction('share');
  };

  // Like/Save/Harmonic/Vibe persist to the DB via useInteractions once signed
  // in; signed out, fall through to onInteraction so FeedPage's existing
  // "sign in to interact" prompt still fires.
  const handleToggle = (type: InteractionType, toggleFn: () => void) => {
    if (!user) {
      onInteraction(type);
      return;
    }
    toggleFn();
  };

  return (
    // One selected stanza for the whole card: the section chips and the
    // harmonic readout below them read and write the same index.
    <SectionSelectionProvider trackId={track.id}>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: isActive ? 1 : 0.5 }}
      className="relative w-full h-full flex flex-col"
      data-track-card={track.id}
    >
      {/* Hidden audio element for preview playback */}
      {track.preview_url && (
        <audio
          ref={audioRef}
          src={track.preview_url}
          preload="none"
          onEnded={handleAudioEnded}
        />
      )}

      {/* Background with cover art. IMPORTANT: All playback surfaces must live in the universal player only. */}
      <div className="absolute inset-0 z-0">
        {coverUrl ? (
          <>
            <img
              src={coverUrl}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
          </>
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-secondary to-background" />
        )}
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col justify-end p-6 pb-8 space-y-4">
        {/* Track info with menu */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <motion.h2
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="text-2xl font-bold text-foreground line-clamp-2 flex-1 flex items-center gap-2"
            >
              <span>{track.title}</span>
              {track.is_common_ancestor && (
                <span 
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30"
                  title="Common Ancestor - Foundational track that influenced a musical movement"
                >
                  <AncestorBadge size={14} className="text-amber-400" />
                  <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">Ancestor</span>
                </span>
              )}
            </motion.h2>
            <TrackMenu track={track} />
          </div>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.05 }}
            className="text-lg text-muted-foreground"
          >
            {track.artist}
          </motion.p>
          
          {/* Metadata */}
          {(track.tempo || track.genre) && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.07 }}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              {track.tempo && (
                <span className="font-medium">{Math.round(track.tempo)} BPM</span>
              )}
              {track.tempo && track.genre && (
                <span>•</span>
              )}
              {track.genre && (
                <span className="capitalize">{track.genre}</span>
              )}
            </motion.div>
          )}
        </div>

        {/* Compact Song Sections - always visible */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.08 }}
        >
          <CompactSongSections
            sections={trackSections}
            youtubeId={track.youtube_id}
            spotifyId={track.spotify_id}
            trackTitle={track.title}
            trackArtist={track.artist || ''}
            canonicalTrackId={track.id}
          />
        </motion.div>

        {/* Play button and streaming links */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex items-center gap-3"
        >
          {/* Preview play button (if available) */}
          {track.preview_url && (
            <Button
              variant="outline"
              size="lg"
              onClick={handlePlayPause}
              className="gap-2 glass border-white/20 hover:bg-white/10"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5" />
              )}
              {isPlaying ? 'Pause' : 'Preview'}
            </Button>
          )}

          {/* YouTube watch intent -> universal player only */}
          {track.youtube_id && (
            <Button
              variant="outline"
              size="lg"
              onClick={() =>
                openPlayer({
                  canonicalTrackId: track.id,
                  provider: 'youtube',
                  providerTrackId: track.youtube_id,
                  autoplay: true,
                  context: 'feed-card-watch',
                  title: track.title,
                  artist: track.artist,
                })
              }
              className="gap-2 glass border-white/20 hover:bg-white/10"
            >
              <Youtube className="w-5 h-5" />
              Watch
            </Button>
          )}

          {/* Quick streaming buttons - Spotify & YouTube icons */}
          <QuickStreamButtons
            track={{
              spotifyId: track.spotify_id || undefined,
              youtubeId: track.youtube_id || undefined,
              urlSpotifyWeb: track.url_spotify_web || undefined,
              urlSpotifyApp: track.url_spotify_app || undefined,
              urlYoutube: track.url_youtube || undefined,
            }}
            canonicalTrackId={track.id}
            trackTitle={track.title}
            trackArtist={track.artist}
            size="md"
          />
        </motion.div>

        {/* Harmony card - suppressed for whichever track is loaded in the
            docked player, since that already shows the same progression
            (see isDockedTrack above). */}
        {track.progression_roman && track.progression_roman.length > 0 && !isDockedTrack && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15 }}
          >
            <HarmonyCard
              progression={track.progression_roman}
              detectedKey={track.detected_key}
              detectedMode={track.detected_mode}
              cadenceType={track.cadence_type}
              confidenceScore={track.confidence_score}
              bpm={track.tempo}
              loopLengthBars={track.loop_length_bars}
              trackId={track.id}
              sections={track.sections}
              matchReason="Same vi–IV–I–V loop with similar energy"
            />
          </motion.div>
        )}

        {/* Main action buttons */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex items-center justify-between pt-4 relative z-20"
        >
          {/* Skip - always clickable */}
          <ActionButton
            icon={X}
            label="Skip"
            isActive={interactions.has('skip')}
            onClick={() => onInteraction('skip')}
            variant="muted"
          />

          {/* More like this (harmonic) */}
          <ActionButton
            icon={Sparkles}
            label="Harmonic"
            isActive={interaction.harmonySaved}
            onClick={() => handleToggle('more_harmonic', toggleHarmonySave)}
            variant="primary"
          />

          {/* Like */}
          <ActionButton
            icon={Heart}
            label="Like"
            isActive={interaction.liked}
            onClick={() => handleToggle('like', toggleLike)}
            variant="accent"
          />

          {/* More like this (vibe) */}
          <ActionButton
            icon={Waves}
            label="Vibe"
            isActive={interaction.vibed}
            onClick={() => handleToggle('more_vibe', toggleVibe)}
            variant="primary"
          />

          {/* Save */}
          <ActionButton
            icon={Bookmark}
            label="Save"
            isActive={interaction.bookmarked}
            onClick={() => handleToggle('save', toggleBookmark)}
            variant="muted"
          />
        </motion.div>

        {/* Secondary actions: Comments, Nearby, Share */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="flex items-center justify-center gap-4"
        >
          {/* Comments - Now inline with count */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 hover:bg-muted transition-all text-muted-foreground hover:text-foreground"
          >
            <MessageSquare className="w-5 h-5" />
            <span className="text-sm font-medium">{commentCount}</span>
          </motion.button>

          {/* Nearby Listeners */}
          <NearbyListenersSheet 
            trackId={track.id} 
            artist={track.artist} 
            trackTitle={track.title}
          />

          {/* Share */}
          <ShareSheet track={track} onShare={handleShare} />
        </motion.div>

        {/* Expandable Comments Section */}
        <AnimatePresence>
          {showComments && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="mt-6 pt-6 border-t border-border/50">
                <TrackComments trackId={track.id} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
    </SectionSelectionProvider>
  );
}

interface ActionButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
  onClick: () => void;
  variant: 'primary' | 'accent' | 'muted';
}

function ActionButton({ icon: Icon, label, isActive, onClick, variant }: ActionButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1 p-3 rounded-xl transition-all',
        isActive && variant === 'accent' && 'text-accent glow-accent',
        isActive && variant === 'primary' && 'text-primary glow-primary',
        isActive && variant === 'muted' && 'text-foreground',
        !isActive && 'text-muted-foreground hover:text-foreground'
      )}
    >
      <div
        className={cn(
          'p-3 rounded-full transition-all',
          isActive && variant === 'accent' && 'bg-accent/20',
          isActive && variant === 'primary' && 'bg-primary/20',
          isActive && variant === 'muted' && 'bg-muted',
          !isActive && 'bg-muted/50 hover:bg-muted'
        )}
      >
        <Icon className={cn('w-6 h-6', isActive && variant === 'accent' && 'fill-current')} />
      </div>
      <span className="text-xs font-medium">{label}</span>
    </motion.button>
  );
}
