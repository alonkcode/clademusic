/**
 * Track Detail Page
 * 
 * Comprehensive track view with:
 * - Song sections (intro, verse, chorus, bridge)
 * - Hooktheory chord data
 * - WhoSampled connections
 * - Multiple YouTube videos in PiP
 * - Auto-start from intro timestamp
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTrack } from '@/hooks/api/useTracks';
import { useCommentCount } from '@/hooks/api/useComments';
import { useAuth } from '@/hooks/useAuth';
import { useInteractions } from '@/hooks/useInteractions';
import { toast } from '@/hooks/use-toast';
import { usePlayer } from '@/player/PlayerContext';
import { BottomNav } from '@/components/BottomNav';
import { ChordBadge } from '@/components/ChordBadge';
import { TrackLineageView } from '@/components/TrackLineageView';
import { TrackComments } from '@/components/TrackComments';
import { LiveChat } from '@/components/LiveChat';
import { TrackMobileActions } from '@/components/TrackMobileActions';
import { QuickStreamButtons } from '@/components/QuickStreamButtons';
import { ScrollingComments } from '@/components/ScrollingComments';
import { getTrackSections } from '@/api/trackSections';
import { searchYouTubeVideos } from '@/services/youtubeSearchService';
import { TrackSection, Track } from '@/types';
import { ArrowLeft, Play, Music2, Link as LinkIcon, ExternalLink, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { formatTime, formatDuration } from '@/lib/timeFormat';
import { sectionDisplayNames } from '@/lib/sections';
import { ProfileCircle } from '@/components/shared';
import { TrackThumbnail } from '@/components/TrackThumbnail';

interface VideoSource {
  id: string;
  videoId: string;
  title: string;
  type: 'official' | 'cover' | 'live' | 'instrumental' | 'lyric' | 'audio';
}

export default function TrackDetailPage() {
  const { trackId } = useParams();
  const navigate = useNavigate();
  const { data: track, isLoading, isError } = useTrack(decodeURIComponent(trackId || ''));
  const { openPlayer, provider, trackId: activeTrackId, isPlaying } = usePlayer();
  const { user } = useAuth();
  const { interaction, toggleLike } = useInteractions(track?.id ?? null);
  // Same id the comment thread below is given, so the count matches it.
  const { data: commentCount = 0 } = useCommentCount(trackId || '');
  const [activeTab, setActiveTab] = useState('sections');
  const tabsRef = useRef<HTMLDivElement>(null);
  // IMPORTANT: There must NEVER be more than one playback surface.
  // YouTube must be played only through the universal player.
  const currentTime = 0;
  const seekTo = (_seconds: number) => {};
  
  const [sections, setSections] = useState<TrackSection[]>([]);
  const sectionNames = sectionDisplayNames(sections);
  const [hooktheoryData, setHooktheoryData] = useState<any>(null);
  const [whoSampledData, setWhoSampledData] = useState<any>(null);
  const [youtubeVideos, setYoutubeVideos] = useState<VideoSource[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  
  // Get current section and chord based on playback time
  const currentTimeMs = currentTime * 1000;
  const currentSection = sections.find(
    s => currentTimeMs >= s.start_ms && currentTimeMs < s.end_ms
  );
  
  // Calculate current chord index within the section
  const getCurrentChordIndex = () => {
    if (!currentSection?.chords || !currentSection?.chord_timings) return -1;
    
    const sectionTime = currentTimeMs - currentSection.start_ms;
    for (let i = currentSection.chord_timings.length - 1; i >= 0; i--) {
      if (sectionTime >= currentSection.chord_timings[i]) {
        return i;
      }
    }
    return 0;
  };
  
  const currentChordIndex = getCurrentChordIndex();
  
  // Load sections and related data when track is available
  useEffect(() => {
    if (!track?.id) return;

    (async () => {
      await loadSections();
      await loadHooktheoryData();
      await loadWhoSampledData();
      await loadYouTubeVideos();
    })();
  }, [track?.id]);

  async function loadYouTubeVideos() {
    if (!track?.artist || !track?.title) return;
    
    setLoadingVideos(true);
    try {
      const results = await searchYouTubeVideos(track.artist, track.title);
      const videos: VideoSource[] = results.map(r => ({
        id: r.videoId,
        videoId: r.videoId,
        title: r.title,
        type: r.type,
      }));
      setYoutubeVideos(videos);

    } catch (err) {
      console.error('Failed to load YouTube videos:', err);
    } finally {
      setLoadingVideos(false);
    }
  }

  async function loadSections() {
    if (!track?.id) return;
    
    try {
      // getTrackSections already falls back to the track's own analyzed
      // sections when the track_sections table has none. What it will not do
      // is invent them: the old fallback here spaced intro/verse/chorus at
      // fixed percentages of the duration, so every song displayed the same
      // structure and the timestamps were wrong for all but a coincidence.
      // No analysis yet means no sections shown.
      setSections(await getTrackSections(track.id));
    } catch (err) {
      console.error('Failed to load sections:', err);
      setSections([]);
    }
  }

  async function loadHooktheoryData() {
    if (!track?.title || !track?.artist) return;
    
    try {
      // TODO: Integrate with actual Hooktheory API
      // API endpoint: https://api.hooktheory.com/v1/trends/nodes
      // Requires API key from hooktheory.com/api/trends/docs
      // See TASKS.md for integration steps
      
      // For now, use track's existing chord data
      if (track.progression_roman) {
        setHooktheoryData({
          chords: track.progression_roman,
          key: track.detected_key,
          mode: track.detected_mode,
          source: 'local',
        });
      }
    } catch (err) {
      console.error('Failed to load Hooktheory data:', err);
    }
  }

  async function loadWhoSampledData() {
    if (!track?.title || !track?.artist) return;
    
    try {
      // TODO: Integrate with actual WhoSampled API
      // API endpoint: https://www.whosampled.com/api/
      // Requires API key from whosampled.com
      // See TASKS.md for integration steps
      
      // For now, return mock data
      setWhoSampledData({
        samples: [],
        sampledBy: [],
        covers: [],
        source: 'local',
      });
    } catch (err) {
      console.error('Failed to load WhoSampled data:', err);
    }
  }


  function handleSectionClick(section: TrackSection) {
    // Not floored - see sectionStartSeconds in lib/sections.ts for why that
    // truncation is exactly what caused section chips to highlight the one
    // before whatever was actually clicked.
    const startSeconds = section.start_ms / 1000;
    
    // Always play sections on YouTube
    if (track?.youtube_id) {
      openPlayer({
        provider: 'youtube',
        providerTrackId: track.youtube_id,
        canonicalTrackId: track.id,
        autoplay: true,
        startSec: startSeconds,
        context: 'section_navigation',
      });
    }
  }

  function handlePlayVideo(video: VideoSource) {
    if (!track?.artist || !track?.title) return;

    openPlayer({
      canonicalTrackId: track.id,
      provider: 'youtube',
      providerTrackId: video.videoId,
      autoplay: true,
      context: 'track-detail-video',
      title: track.title,
      artist: track.artist,
    });
  }

  function handleLike() {
    if (!user) {
      navigate('/auth');
      return;
    }
    toggleLike();
  }

  function openCommentsTab() {
    setActiveTab('comments');
    // Once the tab has switched, bring the tab strip to the top of the screen
    // (scroll-mt on it clears the sticky header).
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function handleShare() {
    if (!track) return;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${track.title} - ${track.artist}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied' });
    } catch (err) {
      // Dismissing the native share sheet rejects with AbortError - not a failure.
      if ((err as { name?: string })?.name === 'AbortError') return;
      toast({ title: "Couldn't share this track", description: 'Please try again.', variant: 'destructive' });
    }
  }

  // Use YouTube search results, or fallback to track's youtube_id if available
  const videoSources: VideoSource[] = youtubeVideos.length > 0 
    ? youtubeVideos
    : track?.youtube_id 
    ? [{
        id: 'official',
        videoId: track.youtube_id,
        title: `${track.title} - Official`,
        type: 'official',
      }]
    : [];

  // Three distinct states, not one. This used to be `if (isLoading || !track)`,
  // which rendered "Loading track..." with a pulsing icon for a track that had
  // finished loading and simply did not exist - so an unknown or mistyped id
  // looked like it was loading forever, with no way to tell it never would.
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Music2 className="w-12 h-12 text-muted-foreground animate-pulse mx-auto mb-4" />
          <p className="text-muted-foreground">Loading track...</p>
        </div>
      </div>
    );
  }

  if (isError || !track) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center max-w-sm space-y-4">
          <Music2 className="w-12 h-12 text-muted-foreground mx-auto" />
          <p className="text-lg font-semibold">
            {isError ? "Couldn't load this track" : 'Track not found'}
          </p>
          <p className="text-sm text-muted-foreground">
            {isError
              ? 'Something went wrong fetching it. Try again in a moment.'
              : "It may have been removed, or the link isn't quite right."}
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => navigate(-1)}>
              Go back
            </Button>
            <Button onClick={() => navigate('/search')}>Search tracks</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 glass-strong safe-top">
        <div className="flex items-center gap-3 px-4 py-3 max-w-4xl mx-auto">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold truncate">{track.title}</h1>
            <p className="text-sm text-muted-foreground truncate">{track.artist}</p>
          </div>
          <ProfileCircle />
        </div>
      </header>

      {/* Content */}
      <main className="px-4 py-6 max-w-4xl mx-auto space-y-6">
        {/* Track Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-4"
        >
          <TrackThumbnail
            track={track}
            alt={track.title}
            className="w-32 h-32 rounded-lg object-cover flex-shrink-0 shadow-lg"
          />
          <div className="flex-1 space-y-3">
            <div>
              <h2 className="text-2xl font-bold">{track.title}</h2>
              <p className="text-lg text-muted-foreground">{track.artist}</p>
              {track.album && (
                <p className="text-sm text-muted-foreground">{track.album}</p>
              )}
            </div>
            
            {/* Music Metadata */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {track.detected_key && (
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Key:</span>
                  <span className="font-medium">
                    {track.detected_key} {track.detected_mode}
                  </span>
                </div>
              )}
              
              {track.tempo && (
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">•</span>
                  <span className="text-muted-foreground">BPM:</span>
                  <span className="font-medium">{Math.round(track.tempo)}</span>
                </div>
              )}
              
              {track.genre && (
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">•</span>
                  <span className="text-muted-foreground">Genre:</span>
                  <span className="font-medium capitalize">{track.genre}</span>
                </div>
              )}
            </div>
            
            {/* Genre Tags */}
            {track.genres && track.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {track.genres.map((genre, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}
            
            {/* Genre Description */}
            {track.genre_description && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {track.genre_description}
              </p>
            )}
            
            {/* Credits */}
            {(track.songwriter || track.producer || track.label || track.release_date) && (
              <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/50">
                {track.songwriter && (
                  <div>
                    <span className="font-medium">Written by:</span> {track.songwriter}
                  </div>
                )}
                {track.producer && (
                  <div>
                    <span className="font-medium">Produced by:</span> {track.producer}
                  </div>
                )}
                {track.label && (
                  <div>
                    <span className="font-medium">Label:</span> {track.label}
                  </div>
                )}
                {track.release_date && (
                  <div>
                    <span className="font-medium">Released:</span> {new Date(track.release_date).toLocaleDateString()}
                  </div>
                )}
              </div>
            )}

            {/* Track Lineage - Musical DNA */}
            {track.id && (
              <div className="pt-4 border-t border-border/50">
                <TrackLineageView trackId={track.id} />
              </div>
            )}

            {/* Play Controls - Provider Icons */}
            <div className="flex gap-3 pt-2">
              <QuickStreamButtons
                track={{
                  spotifyId: track.spotify_id,
                  youtubeId: track.youtube_id,
                }}
                canonicalTrackId={track.id}
                trackTitle={track.title}
                trackArtist={track.artist}
                size="lg"
              />
            </div>

            <TrackMobileActions
              className="pt-1"
              liked={interaction.liked}
              commentCount={commentCount}
              onLike={handleLike}
              onComments={openCommentsTab}
              onShare={handleShare}
            />
          </div>
        </motion.div>

        {/* IMPORTANT: Playback surfaces must live in the universal player. Use provider buttons above. */}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} ref={tabsRef} className="w-full scroll-mt-24">
          {/* 52px strip = 44px tabs on a phone (they were 32px); a little tighter
              type and padding so "Comments" isn't edge to edge in its pill. */}
          <TabsList className="grid h-[3.25rem] w-full grid-cols-5 items-stretch sm:h-10 sm:items-center">
            <TabsTrigger className="px-1 text-[13px] sm:px-3 sm:text-sm" value="sections">Sections</TabsTrigger>
            <TabsTrigger className="px-1 text-[13px] sm:px-3 sm:text-sm" value="chords">Chords</TabsTrigger>
            <TabsTrigger className="px-1 text-[13px] sm:px-3 sm:text-sm" value="samples">Samples</TabsTrigger>
            <TabsTrigger className="px-1 text-[13px] sm:px-3 sm:text-sm" value="videos">Videos</TabsTrigger>
            <TabsTrigger className="px-1 text-[13px] sm:px-3 sm:text-sm" value="comments">Comments</TabsTrigger>
          </TabsList>

          {/* Sections Tab */}
          <TabsContent value="sections" className="space-y-3">
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                Song Structure
              </h3>
              <div className="space-y-2">
                {sections.map((section, index) => {
                  const isActive = currentSection?.id === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => handleSectionClick(section)}
                      className={cn(
                        "w-full p-3 glass rounded-lg text-left transition-all group",
                        isActive 
                          ? "bg-primary/20 border-primary/50 shadow-lg" 
                          : "hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex-1">
                          <div className={cn(
                            "font-medium capitalize flex items-center gap-2",
                            isActive && "text-primary"
                          )}>
                            {sectionNames[index]}
                            {isActive && <span className="text-xs animate-pulse">●</span>}
                            {!isActive && <Play className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatTime(section.start_ms, true)} - {formatTime(section.end_ms, true)}
                          </div>
                        </div>

                        <div className="flex-shrink-0 ml-4 flex flex-col items-end">
                          <div className="text-xs text-muted-foreground">
                            {formatDuration(section.end_ms - section.start_ms)}
                          </div>

                          {/* IMPORTANT: Playback surfaces must stay in the universal player */}
                          {((videoSources && videoSources[0]) || track.youtube_id) && (
                            <div className="mt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  openPlayer({
                                    canonicalTrackId: track.id,
                                    provider: 'youtube',
                                    providerTrackId: (videoSources && videoSources[0]?.videoId) || track.youtube_id!,
                                    autoplay: true,
                                    startSec: section.start_ms / 1000,
                                    context: 'section-snippet',
                                    title: track.title,
                                    artist: track.artist,
                                  })
                                }
                                className="text-xs h-8 px-3"
                              >
                                Play section
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Show chords for this section */}
                      {section.chords && section.chords.length > 0 && (
                        <div className="flex gap-2 flex-wrap mt-2">
                          {section.chords.map((chord, i) => {
                            const isCurrentChord = isActive && currentChordIndex === i;
                            return (
                              <ChordBadge
                                key={i}
                                chord={chord}
                                keySignature={track.detected_key}
                                size="lg"
                                className={cn(
                                  "transition-all duration-200",
                                  isCurrentChord && "ring-2 ring-primary scale-110 shadow-lg"
                                )}
                              />
                            );
                          })}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </Card>
          </TabsContent>

          {/* Chords Tab */}
          <TabsContent value="chords" className="space-y-3">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Chord Progression
                </h3>
                {hooktheoryData?.source === 'local' && (
                  <span className="text-xs text-muted-foreground">Local data</span>
                )}
              </div>
              {track.progression_roman && track.progression_roman.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex gap-2.5 flex-wrap">
                    {track.progression_roman.map((chord, i) => (
                      <ChordBadge 
                        key={i} 
                        chord={chord} 
                        keySignature={track.detected_key}
                        size="lg"
                      />
                    ))}
                  </div>
                  {track.detected_key && (
                    <p className="text-sm text-muted-foreground">
                      Key: {track.detected_key} {track.detected_mode}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No chord data available
                </p>
              )}
            </Card>
          </TabsContent>

          {/* Samples Tab */}
          <TabsContent value="samples" className="space-y-3">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Sample Connections
                </h3>
                <Button variant="ghost" size="sm" className="h-7 text-xs">
                  <ExternalLink className="w-3 h-3 mr-1" />
                  WhoSampled
                </Button>
              </div>
              <div className="text-center py-8">
                <Info className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No sample data available yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  WhoSampled integration coming soon
                </p>
              </div>
            </Card>
          </TabsContent>

          {/* Videos Tab */}
          <TabsContent value="videos" className="space-y-3">
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                Video Sources
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Click the Play button above to start playback. Video player continues across navigation.
              </p>
              <div className="space-y-2">
                {loadingVideos ? (
                  <div className="text-center py-8">
                    <Music2 className="w-8 h-8 text-muted-foreground mx-auto mb-2 animate-pulse" />
                    <p className="text-sm text-muted-foreground">
                      Searching YouTube...
                    </p>
                  </div>
                ) : (
                  <>
                    {videoSources.map((video) => (
                      <button
                        key={video.id}
                        onClick={() => handlePlayVideo(video)}
                        className="w-full p-3 glass rounded-lg text-left hover:bg-muted/50 transition-colors flex items-center gap-3"
                      >
                        <Play className="w-4 h-4 text-primary flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{video.title}</div>
                          <div className="text-xs text-muted-foreground capitalize">
                            {video.type}
                          </div>
                        </div>
                        {provider === 'youtube' && activeTrackId === video.videoId && (
                          <span className="text-xs text-primary">Playing</span>
                        )}
                      </button>
                    ))}
                    {videoSources.length === 0 && (
                      <div className="text-center py-8">
                        <Music2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No videos available
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Comments Tab */}
          <TabsContent value="comments" className="space-y-3">
            <Tabs defaultValue="discussion" className="w-full">
              <TabsList className="grid h-[3.25rem] w-full grid-cols-2 items-stretch sm:h-10 sm:items-center">
                <TabsTrigger value="discussion">Discussion</TabsTrigger>
                <TabsTrigger value="chat">Live chat</TabsTrigger>
              </TabsList>
              <TabsContent value="discussion" className="mt-3">
                <Card className="p-4 sm:p-6">
                  <TrackComments trackId={trackId || ''} />
                </Card>
              </TabsContent>
              <TabsContent value="chat" className="mt-3">
                {trackId && <LiveChat roomType="track" trackId={trackId} />}
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </main>

      {/* Scrolling comments overlay */}
      {/* Hidden on the Comments tab: it floats snippets of the very thread that is
          already on screen, on top of its Like/Reply controls. */}
      {activeTab !== 'comments' && <ScrollingComments trackId={trackId} maxVisible={3} scrollSpeed={4000} />}

      <BottomNav />
    </div>
  );
}
