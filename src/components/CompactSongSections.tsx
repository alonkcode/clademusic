import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { TrackSection } from '@/types';
import { usePlayer } from '@/player/PlayerContext';
import type { MusicProvider } from '@/types';
import { useSectionSelection } from '@/hooks/useSectionSelection';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/timeFormat';

interface CompactSongSectionsProps {
  sections: TrackSection[];
  youtubeId?: string;
  spotifyId?: string;
  trackTitle: string;
  trackArtist: string;
  canonicalTrackId?: string | null;
  className?: string;
}

/**
 * Providers hand back the same track as a bare id, a `spotify:track:` URI or a
 * share URL. Reduce all three to the id so "is this the playing track?" is not
 * decided by formatting.
 */
function sameProviderTrack(a?: string | null, b?: string | null): boolean {
  const normalize = (value?: string | null) => {
    if (!value) return null;
    const withoutQuery = value.split('?')[0];
    const last = withoutQuery.split(/[:/]/).filter(Boolean).pop();
    return last ?? null;
  };
  const left = normalize(a);
  const right = normalize(b);
  return !!left && !!right && left === right;
}

const SECTION_COLORS: Record<string, string> = {
  intro: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  verse: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'pre-chorus': 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  chorus: 'bg-green-500/20 text-green-300 border-green-500/30',
  bridge: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  outro: 'bg-red-500/20 text-red-300 border-red-500/30',
  breakdown: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  drop: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
};

export function CompactSongSections({ 
  sections, 
  youtubeId, 
  spotifyId,
  trackTitle, 
  trackArtist,
  canonicalTrackId = null,
  className 
}: CompactSongSectionsProps) {
  const {
    openPlayer,
    seekTo,
    youtubeOpen,
    youtubeTrackId,
    spotifyOpen,
    spotifyTrackId,
    currentSectionId,
    positionMs,
    isPlaying,
    provider: activeProvider,
    trackId: activeTrackId,
    canonicalTrackId: activePlayingTrackId,
  } = usePlayer();

  const selection = useSectionSelection();

  const handleSectionClick = (section: TrackSection, index: number) => {
    // Move the harmonic readout below the card to this stanza too, so both
    // controls always describe the same part of the song.
    selection?.select(index);

    const startSeconds = Math.floor(section.start_ms / 1000);

    // Is this track the one already playing, and where? Compare on normalised
    // ids: the player may hold a URI or a URL where the track row holds a bare
    // id, and a mismatch here is what silently sent a section tap off to
    // YouTube while Spotify was playing.
    const playingSpotify =
      (activeProvider === 'spotify' || spotifyOpen) &&
      sameProviderTrack(spotifyTrackId ?? activeTrackId, spotifyId);
    const playingYoutube =
      (activeProvider === 'youtube' || youtubeOpen) &&
      sameProviderTrack(youtubeTrackId ?? activeTrackId, youtubeId);

    // Already playing this track: seek in place, whichever provider it is.
    if (playingSpotify || playingYoutube) {
      seekTo(startSeconds);
      return;
    }

    // Not playing yet. Stay on whichever player is already open for this
    // track; otherwise go straight to Spotify when it's available - instant
    // seeking, no ads - rather than following a stale "last used provider"
    // preference (e.g. left over from an earlier YouTube quick-link tap) that
    // is exactly what kept sending section taps to YouTube by default.
    const openProvider: MusicProvider | null =
      spotifyOpen && spotifyId ? 'spotify' : youtubeOpen && youtubeId ? 'youtube' : null;
    const provider = openProvider ?? (spotifyId ? 'spotify' : youtubeId ? 'youtube' : null);
    const providerTrackId = provider === 'spotify' ? spotifyId : youtubeId;
    if (!provider || !providerTrackId) return;

    openPlayer({
      // The real track id, not null: the harmonic readout below only follows
      // playback when it can recognise the playing track as this one.
      canonicalTrackId,
      provider,
      providerTrackId,
      autoplay: true,
      startSec: startSeconds,
    });
  };

  if (!sections || sections.length === 0) return null;

  return (
    <div className={cn('flex gap-1.5 flex-wrap', className)}>
      {sections.map((section, index) => {
        const colorClass = SECTION_COLORS[section.label] || 'bg-muted/20 text-muted-foreground border-muted/30';
        
        // Highlight active section: explicit currentSectionId match OR
        // fallback to position-based highlighting when currentSectionId is null
        const isLastSection = index === sections.length - 1;
        // positionMs/currentSectionId belong to whatever the global player has
        // loaded, not necessarily this card's track - comparing them against
        // this card's own section timestamps without checking that first is
        // what let a card highlight a "current" chip based on some other
        // track's playback position. Gate on canonicalTrackId, exactly like
        // useSectionSync's isLiveSynced below the card, so the two agree.
        const isThisTrackLive = isPlaying && !!canonicalTrackId && canonicalTrackId === activePlayingTrackId;
        const isPlayingThisSection = isThisTrackLive && (
          currentSectionId === section.id ||
          (currentSectionId === null && positionMs >= section.start_ms &&
           (isLastSection ? positionMs <= section.end_ms : positionMs < section.end_ms))
        );
        const isActive = isThisTrackLive
          ? isPlayingThisSection
          : selection
            ? selection.index === index
            : false;
        
        return (
          <motion.button
            key={section.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.03 }}
            onClick={() => handleSectionClick(section, index)}
            className={cn(
              'group relative px-2.5 py-1.5 rounded-md text-xs font-medium',
              'border transition-all hover:brightness-125',
              isActive && 'ring-2 ring-primary ring-offset-1',
              colorClass
            )}
            title={`Play ${section.label} from ${formatTime(section.start_ms)} and show its chords`}
          >
            <div className="flex items-center gap-1">
              <Play className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 transition-opacity" />
              <span className="capitalize">{section.label}</span>
              <span className="text-[10px] opacity-60">{formatTime(section.start_ms)}</span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
