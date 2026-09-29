import { useMemo, useEffect, useState, useCallback, useRef, type SyntheticEvent } from 'react';
import { motion } from 'framer-motion';
import { usePlayer } from './PlayerContext';
import { Volume2, VolumeX, Maximize2, X, ChevronDown, ChevronUp, Play, Pause, SkipBack, SkipForward, ListMusic, Loader2, EyeOff } from 'lucide-react';
import { QueueSheet } from './QueueSheet';
import { useConnectSpotify } from '@/hooks/api/useSpotifyConnect';
import { useSpotifyBlocked, useSpotifyConnected } from '@/hooks/api/useSpotifyUser';
import { useIsAdmin } from '@/hooks/api/useAdmin';
import { sectionDisplayNames } from '@/lib/sections';
import { useAuth } from '@/hooks/useAuth';
import { useLocation, useNavigate } from 'react-router-dom';
import { UniversalPlayerHost } from '@/player/universal/UniversalPlayerHost';
import { SpotifyWebPlayer } from '@/player/providers/SpotifyWebPlayer';
import { HarmonicHUD } from '@/components/HarmonicHUD';
import { AnalyzeTrackPanel } from '@/components/AnalyzeTrackPanel';
import { shouldOfferAnalysis } from '@/hooks/useAnalyzeTrack';
import { buildProviderDeepLink } from '@/player/universal/buildEmbedSrc';
import { isTestEnv } from '@/lib/env';
import { toast } from '@/hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import { providerMeta, formatTime } from './embeddedPlayer/constants';
import { useAnimatedSeekbar, type SeekIntent } from './embeddedPlayer/useAnimatedSeekbar';
import { usePlayerHarmony } from './embeddedPlayer/usePlayerHarmony';
import { useActiveSection } from './embeddedPlayer/useActiveSection';
import { usePlayerLayout } from './embeddedPlayer/usePlayerLayout';
import { useTransportControls } from './embeddedPlayer/useTransportControls';
import { BeatIndicator } from './embeddedPlayer/BeatIndicator';
import { useDevPlayerInvariants } from './embeddedPlayer/useDevInvariants';
import { BarIconButton } from './embeddedPlayer/BarIconButton';
import { SectionChips } from './embeddedPlayer/SectionChips';
import { describeSpotifyFallback } from './embeddedPlayer/spotifyFallbackNotice';
import { usePublishPlayerHeight } from './embeddedPlayer/usePublishPlayerHeight';
import { useSwipeNavigation } from './embeddedPlayer/useSwipeNavigation';

type EmbeddedPlayerDrawerProps = {
  onNext?: () => void;
  onPrev?: () => void;
  canNext?: boolean;
  canPrev?: boolean;
};

export function EmbeddedPlayerDrawer({ onNext, onPrev, canNext, canPrev }: EmbeddedPlayerDrawerProps) {
  const {
    playRequestId,
    provider,
    trackId,
    canonicalTrackId,
    trackTitle,
    trackArtist,
    lastKnownTitle,
    lastKnownArtist,
    positionMs,
    durationMs,
    volume,
    isMuted,
    isOpen,
    isCinema,
    enterCinema,
    exitCinema,
    isPlaying,
    isStarting,
    updatePlaybackState,
    togglePlayPause,
    setVolumeLevel,
    toggleMute,
    seekToMs,
    currentSectionId,
    loopSectionId,
    setCurrentSection,
    setLoopSection,
    closePlayer,
    queue,
    queueIndex,
    playFromQueue,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    shuffleQueue,
    nextTrack,
    previousTrack,
    isHidden,
    toggleHidden,
  } = usePlayer();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: isSpotifyConnected, isLoading: isConnectionLoading } = useSpotifyConnected();
  const { data: isSpotifyBlocked } = useSpotifyBlocked();
  const connectSpotify = useConnectSpotify();
  const { data: isAdmin } = useIsAdmin();

  const { sections, harmony, hudSections, isLoading: isHarmonyLoading, resolvedTrackId } = usePlayerHarmony(canonicalTrackId);
  const sectionNames = useMemo(() => sectionDisplayNames(sections), [sections]);

  const safeQueue = Array.isArray(queue) ? queue : [];
  const safeQueueIndex = typeof queueIndex === 'number' ? queueIndex : -1;
  const autoplay = isPlaying;
  const [queueOpen, setQueueOpen] = useState(false);
  const [scrubSec, setScrubSec] = useState<number | null>(null);
  const [seekIntent, setSeekIntent] = useState<SeekIntent | null>(null);
  // Why the embed refused to play, when it does. Lives here rather than in
  // UniversalPlayerHost because the host renders inside the video panel, which
  // is collapsed (and aria-hidden) most of the time - the bar is the only part
  // always on screen while a track is loaded.
  const [embedError, setEmbedError] = useState<{ code: number | null; message: string } | null>(null);

  // Docked to the bottom edge, full width, like Spotify's own desktop
  // player - always there while a track is loaded, never dragged or
  // resized around the screen. "Show video" reveals a compact panel above
  // the bar (the "miniplayer") rather than taking over the screen.
  const { cinemaRef, showVideo, setShowVideo, toggleFullscreen, hudCollapsed, setHudCollapsed } = usePlayerLayout({ isCinema, enterCinema, exitCinema });

  // Real Spotify playback (Web Playback SDK - actual full tracks, actual
  // play/pause/seek/volume control, driven by the user's own connected
  // account) is attempted for any signed-in, Spotify-connected user.
  // UniversalPlayerHost's plain embed iframe has no such control wired up
  // at all (it only ever sets the iframe's initial src) - it's the correct
  // fallback for guests and non-Premium accounts, not the primary path for
  // someone who actually connected Premium.
  const [spotifySdkFailed, setSpotifySdkFailed] = useState(false);
  useEffect(() => {
    setSpotifySdkFailed(false);
  }, [provider, trackId]);
  const useSpotifySdk = provider === 'spotify' && !!user && isSpotifyConnected === true && !spotifySdkFailed;

  // Only the Web Playback SDK confirms that a start took, so it is the only path
  // that ever clears isStarting. On any other path (guest, not connected,
  // blocked, or dropped to the embed) nothing would, and the play button and the
  // quicklink would spin until the context's backstop. Waits for the connection
  // check to settle first: until it does the SDK simply has not mounted yet.
  useEffect(() => {
    if (provider === 'spotify' && isStarting && !useSpotifySdk && !isConnectionLoading) {
      updatePlaybackState({ isStarting: false });
    }
  }, [provider, isStarting, useSpotifySdk, isConnectionLoading, updatePlaybackState]);

  const commitSeek = useCallback(
    (sec: number) => {
      if (!Number.isFinite(sec)) return;
      seekToMs(sec * 1000);
      // Tells the bar the position is now the listener's, not the provider's:
      // until the provider has acted on the seek it keeps reporting where it
      // WAS, and the thumb used to follow it back to the old spot.
      setSeekIntent({ ms: sec * 1000 });
      setScrubSec(null);
    },
    [seekToMs]
  );
  // Releasing the pointer and releasing a key both commit wherever the slider was left.
  const commitSeekFromInput = (e: SyntheticEvent<HTMLInputElement>) => commitSeek(Number(e.currentTarget.value));

  const resolvedTitle = trackTitle ?? lastKnownTitle ?? '';
  const resolvedArtist = trackArtist ?? lastKnownArtist ?? '';
  const safeMs = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
  // The live embed itself never reports a duration at all for YouTube or a
  // guest/non-Premium Spotify preview (no public API surface for it - see
  // universal-player.html) - previously that meant hasDuration below stayed
  // permanently false for those, which not only showed "--:--" but disabled
  // the seekbar outright and pinned its value at 0 regardless of real
  // position, for the entire duration of every such track. The catalog's
  // own known length doesn't depend on which embed is playing it, so it's
  // used as a fallback whenever the live value is unavailable - real data,
  // just sourced differently, and a functioning seekbar beats a disabled one.
  const durationMsSafe = safeMs(durationMs) || safeMs(harmony.catalogDurationMs ?? 0);

  // Use animated seekbar for smooth visual updates
  const animatedPositionMs = useAnimatedSeekbar(safeMs(positionMs), durationMsSafe, isPlaying, seekIntent);
  const positionSec = Math.max(0, animatedPositionMs / 1000);
  const effectivePositionSec = scrubSec ?? positionSec;
  const durationSec = Math.max(0, durationMsSafe / 1000);
  // Until the provider reports a duration there is no scale to draw on. The
  // old fallback (max = the current position) made value equal max, which
  // parked the thumb at the far right of an empty bar the moment playback
  // started anywhere but 0:00.
  const hasDuration = Number.isFinite(durationSec) && durationSec > 0;
  const seekMaxSec = hasDuration ? durationSec : 1;
  const seekStepSec = Math.max(0.01, seekMaxSec / 1200); // finer granularity: ~1200 steps across track
  const seekValueSecRaw = hasDuration ? Math.min(effectivePositionSec, seekMaxSec) : 0;
  const seekValueSec = Number.isFinite(seekValueSecRaw) ? seekValueSecRaw : 0;

  const safeVolume = Number.isFinite(volume) ? volume : 0;
  // Show 0 while muted so the slider matches what is audible, but keep the
  // stored level so unmuting restores it.
  const volumePercent = Math.round((isMuted ? 0 : safeVolume) * 100);
  const isIdle = !isOpen || !provider || !trackId;
  const authoritativePositionMs = safeMs(positionMs);
  // Is there anything in the chord readout worth showing / collapsing?
  // isHarmonyLoading keeps this true across the gap between a track switch
  // and its data arriving - without it, switching tracks flipped this false
  // (both progression and sections briefly empty for the new track) and back
  // true a moment later, which is what made the whole panel look like it
  // kept disappearing on every switch instead of just refreshing in place.
  const hasHarmonyPanel = harmony.progression.length > 0 || sections.length > 0 || isHarmonyLoading;
  // A loaded track with no analysis at all (never seen by the catalog, or seen
  // but never listened through) is offered a one-click analysis instead of an
  // empty gap. Never under test: the panel needs real audio capture.
  const offerAnalysis =
    !isTestEnv &&
    shouldOfferAnalysis({
      isIdle,
      isLoading: isHarmonyLoading,
      provider,
      title: resolvedTitle,
      artist: resolvedArtist,
      hasProgression: harmony.progression.length > 0,
      hasSections: sections.length > 0,
    });

  // Where the embed should start when it loads, so handing a track from one
  // provider to another (the Spotify/YouTube quicklinks) resumes where the
  // listener actually was instead of restarting at 0:00. openPlayer writes
  // the handoff position into positionMs before this renders, so reading it
  // at that moment is the right value.
  //
  // Snapshotted per track/provider/play request, deliberately NOT tracked
  // live: this ends up inside the iframe's src, and UniversalPlayerHost
  // reloads the frame whenever that src changes. A value that moved with
  // playback would rewrite the src several times a second and restart the
  // embed continuously - so it is read through a ref, and only re-read when
  // the thing being played actually changes.
  const positionAtLoadRef = useRef(0);
  positionAtLoadRef.current = authoritativePositionMs;
  const embedStartSec = useMemo(() => {
    const sec = Math.floor(positionAtLoadRef.current / 1000);
    return sec > 0 ? sec : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, trackId, playRequestId]);

  const { activeSection, sectionWhy } = useActiveSection({
    sections,
    positionMs: authoritativePositionMs,
    currentSectionId,
    setCurrentSection,
    loopSectionId,
    seekToMs,
    cadenceType: harmony.cadenceType,
  });

  const meta = useMemo(() => {
    const fallback = { label: 'Now Playing', badge: '♪', color: 'bg-neutral-900/90', Icon: null as React.ComponentType<{ className?: string }> | null };
    return provider ? providerMeta[provider as keyof typeof providerMeta] ?? fallback : fallback;
  }, [provider]);

  const handleReconnectSpotify = useCallback(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    void connectSpotify.mutateAsync();
  }, [connectSpotify, navigate, user]);

  useEffect(() => {
    setScrubSec(null);
    setEmbedError(null);
  }, [provider, trackId]);

  useDevPlayerInvariants(isOpen, resolvedTitle);

  // Starting a new track brings a hidden player back: playing something from
  // the page and hearing it with no controls anywhere is never what was meant.
  useEffect(() => {
    if (isHidden) toggleHidden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playRequestId]);

  usePublishPlayerHeight(cinemaRef);

  const { handlePrev, handleNext, effectiveCanNext, effectiveCanPrev } = useTransportControls({
    isIdle,
    positionMs,
    queueIndex: safeQueueIndex,
    queueLength: safeQueue.length,
    playFromQueue,
    seekToMs,
    onPrev,
    onNext,
    canNext,
    canPrev,
  });

  // Swipe the title/artist block for prev/next track. The block only exists
  // while a track is loaded, hence `!isIdle`.
  const titleSwipeRef = useRef<HTMLDivElement>(null);
  const didSwipeRef = useSwipeNavigation(
    titleSwipeRef,
    { handlePrev, handleNext, effectiveCanPrev, effectiveCanNext },
    !isIdle
  );

  // The player bar is global, so its title is the one place on every page that
  // names what is actually playing. Tapping it takes the main content back to
  // that song: the feed card, which carries the cover, the metadata and the
  // split section chips. The track goes as route state rather than a query
  // param so a repeat tap still lands - each navigate mints a fresh
  // location.key, which is what FeedPage keys its jump on.
  const handleTitleClick = useCallback(() => {
    // A horizontal flick on this block changes track (useSwipeNavigation
    // above); don't also navigate on the click an engine may synthesize
    // after that touch.
    if (didSwipeRef.current) {
      didSwipeRef.current = false;
      return;
    }
    navigate('/feed', {
      state: canonicalTrackId ? { focusTrackId: canonicalTrackId } : undefined,
      // Already on the feed: replace, or every tap stacks another identical
      // /feed entry for the back button to walk back through.
      replace: location.pathname === '/feed',
    });
  }, [didSwipeRef, navigate, canonicalTrackId, location.pathname]);

  // NOT an early return on isIdle: UniversalPlayerHost mounts a single,
  // persistent <iframe id="universal-player"> that every provider switch
  // reuses via postMessage rather than remounting - CI's own E2E test
  // (tests/universal-player.spec.ts) asserts that iframe exists the moment
  // the page loads, before anything has ever played. Returning null here
  // while idle unmounted it entirely until the first track started, which
  // broke that invariant (every CI run since this file's rewrite failed on
  // exactly that assertion). The visible bar chrome below is still hidden
  // while idle - see `{!isIdle && (...)}` - so there is nothing to look at,
  // same as before; only the always-on iframe host stays mounted.
  const DetailsPanel: any = isTestEnv ? 'div' : motion.div;

  return (
    <>
      {/* Single Interchangeable Player - fixed full-width to the bottom edge,
          like Spotify's own desktop bar: always in the same place, never
          dragged or resized, so it can never end up off-screen or on top of
          whatever the listener was looking at. */}
      <div
        ref={cinemaRef}
        data-player="universal"
        // isHidden hides the chrome via CSS rather than unmounting this
        // subtree - UniversalPlayerHost/SpotifyWebPlayer live inside it and
        // must keep running (so playback continues in the background) while
        // the listener has the player hidden, not restart when it reappears.
        className={`fixed inset-x-0 bottom-0 z-[110] max-h-[100dvh] overflow-y-auto overflow-x-hidden border-t border-border/60 bg-gradient-to-t ${meta.color} shadow-[0_-18px_60px_-30px_rgba(0,0,0,0.75)] backdrop-blur-xl pb-[env(safe-area-inset-bottom)]${isHidden ? ' hidden' : ''}`}
      >
        {/* Chord readout and section jump chips: visible by default whenever a
            track is loaded, not just when the video panel below is expanded.
            These used to live inside the collapsible DetailsPanel (gated on
            showVideo, which defaults closed) - since that panel is collapsed
            most of the time, the "rotating chords" feature was effectively
            hidden by default, and "jump to chorus/verse" wasn't reachable
            without first opening a panel most listeners never open. Only the
            video box itself (which genuinely benefits from being opt-in) stays
            behind the expand toggle, below.

            The one dedicated collapse handle here lets the reader reclaim the
            200-350px it occupies (it is part of a position:fixed bar, so it
            overlays the page) without hiding the transport too; the choice is
            remembered across sessions. */}
        {!isIdle && (hasHarmonyPanel || hudCollapsed) && (
          <button
            type="button"
            onClick={() => setHudCollapsed(!hudCollapsed)}
            aria-expanded={!hudCollapsed}
            aria-label={hudCollapsed ? 'Show chord readout' : 'Hide chord readout'}
            className="flex w-full items-center justify-center gap-1.5 border-b border-border/60 bg-background/95 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            {hudCollapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {hudCollapsed ? 'Chords' : 'Hide chords'}
          </button>
        )}

        {!isIdle && !hudCollapsed && hasHarmonyPanel && (
          <div className="max-h-[45dvh] overflow-y-auto [overscroll-behavior-y:contain] border-b border-border/60 bg-background/95 px-3 py-3 md:px-4">
            {/* isHarmonyLoading alone keeps hasHarmonyPanel (and this container)
                mounted across a track switch so the panel doesn't flicker
                closed-then-open - but progression/sections are both still
                empty at that point, and HarmonicHUD renders nothing for an
                empty progression. Without this branch that gap showed as a
                blank padded box instead of any indication data was on the
                way. */}
            {harmony.progression.length === 0 && sections.length === 0 && isHarmonyLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading chords...
              </div>
            ) : (
              <>
                <HarmonicHUD
                  trackId={canonicalTrackId ?? ''}
                  progression={harmony.progression}
                  detectedKey={harmony.detectedKey ?? undefined}
                  detectedMode={harmony.detectedMode ?? undefined}
                  bpm={harmony.bpm}
                  loopLengthBars={harmony.loopLengthBars}
                  sections={hudSections}
                />

                <SectionChips
                  sections={sections}
                  sectionNames={sectionNames}
                  currentSectionId={currentSectionId}
                  sectionWhy={sectionWhy}
                  activeSection={activeSection}
                  loopSectionId={loopSectionId}
                  onSelect={(section) => {
                    setCurrentSection(section.id);
                    seekToMs(section.start_ms);
                  }}
                  onSetLoop={setLoopSection}
                />
              </>
            )}
          </div>
        )}

        {/* No analysis yet: listen once, and it is saved for everyone. Keyed by
            track so switching songs stops any capture in progress. */}
        {offerAnalysis && (
          <AnalyzeTrackPanel
            key={canonicalTrackId ?? trackId}
            provider={provider}
            providerTrackId={trackId}
            canonicalTrackId={canonicalTrackId}
            title={resolvedTitle}
            artist={resolvedArtist}
            durationMs={durationMsSafe > 0 ? durationMsSafe : null}
            resolvedTrackId={resolvedTrackId}
            onSignIn={() => navigate('/auth')}
          />
        )}

        {/* Video panel: for a video-capable provider, a small fixed-size
            "miniplayer", never full width or full screen. Slides up above the
            bar on request; the bar itself never moves. */}
        <DetailsPanel
          initial={isTestEnv ? undefined : false}
          {...(isTestEnv
            ? {}
            : {
                animate: { height: showVideo ? 'auto' : 0, opacity: showVideo ? 1 : 0 },
                transition: { duration: 0.2, ease: 'easeOut' },
              })}
          className="overflow-hidden"
          aria-hidden={!showVideo}
        >
          <div className="max-h-[70dvh] overflow-y-auto [overscroll-behavior-y:contain] border-b border-border/60 bg-background/95 px-3 py-3 md:px-4">
            {useSpotifySdk ? (
              // Audio-only - Premium SDK playback has no picture to show,
              // just real transport control via the docked bar.
              <div className="mt-3">
                <SpotifyWebPlayer
                  providerTrackId={trackId}
                  // Deliberately no `autoplay` prop. It used to be passed
                  // `isPlaying`, which is what this player reports back a few
                  // times a second - so "should be playing" and "is playing"
                  // were the same value, and the first real `paused` reading
                  // from the device turned the recovery path off. SpotifyWebPlayer
                  // already reads `autoplaySpotify` from the context, which is
                  // the listener's intent and is kept correct by openPlayer and
                  // togglePlayPause.
                  // A start that did not take is not a reason to leave full
                  // playback, so it gets a message rather than a fallback. Shown
                  // here because the player itself lives in the collapsed panel.
                  onNotice={(message) => sonnerToast(message, { id: 'spotify-playback-notice' })}
                  onFallback={(reason) => {
                    setSpotifySdkFailed(true);
                    // This toast stays until dismissed (see use-toast.ts's
                    // TOAST_REMOVE_DELAY) specifically so actionable detail
                    // like the 403/dev-mode guidance doesn't flash past
                    // before it can be read.
                    toast(describeSpotifyFallback(reason, isAdmin));
                  }}
                />
              </div>
            ) : (
              /* The miniplayer itself: a small, fixed-aspect video box, not a
                 resizable/draggable panel - Spotify's bar has no equivalent,
                 since it never plays video, but a YouTube track needs
                 somewhere to actually show the picture. Also the fallback
                 surface for Spotify when SDK playback isn't available
                 (guest, non-Premium, or an SDK error). */
              <div className="mt-3 flex justify-center">
                {/* No fixed aspect-video / black fill here any more: this box
                    wrapped every provider, so a Spotify track (an audio widget
                    ~152px tall) and an idle player with nothing loaded both got
                    a full 16:9 black rectangle. UniversalPlayerHost now sizes
                    itself to whatever it is actually showing, and collapses to
                    nothing when idle. */}
                <div className="relative w-full max-w-sm overflow-hidden rounded-xl">
                  <UniversalPlayerHost
                    onEmbedError={setEmbedError}
                    request={
                      provider && trackId
                        ? {
                            provider,
                            id: trackId,
                            title: resolvedTitle,
                            artist: resolvedArtist,
                            autoplay,
                            startSec: embedStartSec,
                          }
                        : null
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </DetailsPanel>

        {/* Bar row - visible whenever a track is loaded. Absent (not just
            visually hidden) while idle, so there is no empty-looking strip
            reserved at the bottom of every page before anything has played;
            the iframe host above keeps mounting regardless (see isIdle
            comment above the DetailsPanel setup). Below lg the row wraps: the
            seekbar block (order-last, w-full) takes its own line under every
            other control, so on a phone the track gets the full bar width
            instead of the sliver left over beside the buttons. In one row it
            measured ~40px wide anywhere from 640px to ~850px (phones in
            landscape, tablets), so the wrap can't stop at the phone
            breakpoint. lg+ is one non-wrapping row. */}
        {!isIdle && (
        <div className="flex min-w-0 flex-wrap items-center gap-1 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 md:gap-3 md:px-4 md:py-2.5 lg:flex-nowrap">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background/80 text-base shadow-inner sm:h-9 sm:w-9 md:h-10 md:w-10 md:text-lg">
            {meta.Icon ? <meta.Icon className="h-4 w-4 md:h-5 md:w-5" /> : meta.badge}
          </span>
          {/* Below lg the title has a zero basis and grows to fill the first
              line, so it can never push a control onto the wrapped line (a
              fixed 9rem basis counts toward wrapping); lg+ keeps 9rem. */}
          <div ref={titleSwipeRef} className="flex min-w-[2rem] flex-1 flex-col leading-tight [touch-action:pan-y] lg:flex-[0_1_9rem]">
            {resolvedTitle && (
              <button
                type="button"
                onClick={handleTitleClick}
                className="truncate text-left text-xs font-bold text-foreground underline-offset-2 hover:underline md:text-sm"
                aria-label="Track title"
                title="Show this song in the feed"
              >
                {resolvedTitle}
              </button>
            )}
            {resolvedArtist && !embedError && (
              <span className="truncate text-[11px] text-muted-foreground md:text-xs" aria-label="Artist name">{resolvedArtist}</span>
            )}
            {embedError && (
              <span className="flex min-w-0 items-center gap-1 text-[11px] text-destructive md:text-xs" role="alert">
                <span className="truncate" title={embedError.message}>Unavailable</span>
                <a
                  href={buildProviderDeepLink(provider as any, trackId ?? '')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 underline underline-offset-2 hover:text-foreground"
                >
                  open
                </a>
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Previous/next hide below sm - on a narrow phone width there is
                not enough room for badge + title + prev + play + next
                + expand + hide + close on one line without the title
                collapsing to nothing; Spotify's own mobile bar drops to just
                play/pause too, leaving prev/next to the expanded view. */}
            <BarIconButton
              label="Previous track"
              onClick={handlePrev}
              disabled={!effectiveCanPrev}
              className="hidden h-8 w-8 sm:inline-flex md:h-9 md:w-9"
            >
              <SkipBack className="h-4 w-4" />
            </BarIconButton>
            <button
              type="button"
              onClick={togglePlayPause}
              className="inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full border-2 border-primary/70 bg-primary/20 text-primary transition hover:border-primary hover:bg-primary hover:text-white sm:h-10 sm:w-10"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              aria-busy={isStarting || undefined}
              title={isStarting ? 'Starting… (press to cancel)' : isPlaying ? 'Pause' : 'Play'}
            >
              {/* While a start is unconfirmed the button says so instead of
                  claiming "playing" - that claim, followed a moment later by
                  "paused", is what read as play flipping back to pause. */}
              {isStarting ? (
                <Loader2 className="h-4 w-4 animate-spin md:h-5 md:w-5" />
              ) : isPlaying ? (
                <Pause className="h-4 w-4 md:h-5 md:w-5" />
              ) : (
                <Play className="h-4 w-4 md:h-5 md:w-5" />
              )}
            </button>
            <BarIconButton
              label="Next track"
              onClick={handleNext}
              disabled={!effectiveCanNext}
              className="hidden h-8 w-8 sm:inline-flex md:h-9 md:w-9"
            >
              <SkipForward className="h-4 w-4" />
            </BarIconButton>
          </div>

          {/* Tempo, as a dot flashing on each beat next to the number. Sits
              with the transport rather than in the details panel so the beat
              is visible while the panel is collapsed, which is most of the
              time. Renders nothing at all for a track with no analyzed
              tempo. Hidden below sm: the bar is already tight there, and the
              seekbar has a hard minimum width it must not lose. */}
          <BeatIndicator
            bpm={harmony.bpm}
            positionMs={authoritativePositionMs}
            isPlaying={isPlaying}
            isEstimated={harmony.bpmIsEstimated}
            className="hidden sm:flex"
          />

          {/* Seekbar - takes the remaining space, like Spotify's own bar.
              min-w-[130px] is a real floor (time label + seek track + time
              label at their own minimums), not just min-w-0: a flex-1 item
              with flex-basis 0 gets shrunk before items with an explicit
              basis (the title block) do, so without this floor the seekbar
              - not the title - was the one collapsing, and its own children
              (which never got the memo) kept their size and visually spilled
              into the icon buttons after it. Below lg it instead owns the
              wrapped second line (w-full, order-last). */}
          <div className="order-last flex w-full min-w-[4.5rem] items-center gap-1 text-white sm:min-w-[8rem] sm:gap-2 lg:order-none lg:w-auto lg:flex-1">
            <span className="w-7 shrink-0 text-right text-[9px] tabular-nums sm:w-9 sm:text-[10px] md:w-10 md:text-xs" aria-label="Elapsed time">{formatTime(positionSec)}</span>
            <div className="relative min-w-[2rem] flex-1">
              {sections.length > 1 && durationMsSafe > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center">
                  {sections.slice(1).map((section) => {
                    const left = Math.min(100, Math.max(0, (section.start_ms / durationMsSafe) * 100));
                    return (
                      <span
                        key={`marker-${section.id}`}
                        className="absolute top-1/2 -translate-y-1/2 h-2 w-px bg-white/40"
                        style={{ left: `${left}%` }}
                        aria-hidden="true"
                      />
                    );
                  })}
                </div>
              )}
              <input
                key={`${provider ?? 'none'}-${trackId ?? 'none'}-seek`}
                type="range"
                min="0"
                max={seekMaxSec}
                step={seekStepSec}
                value={seekValueSec}
                // One commit point, on release - not one per drag tick. Every
                // intermediate `input` event during a drag used to call
                // commitSeek too, and onPointerUp/onMouseUp/onTouchEnd/onClick
                // all fired a second (or third, or fourth) commit for the same
                // physical release, so a single drag issued a burst of
                // overlapping seeks to the embedded player - each one
                // interrupting the last, which is what made this feel
                // laggy/uncontrollable rather than a clean single seek.
                onChange={(e) => {
                  const nextSec = Number(e.target.value);
                  if (!Number.isFinite(nextSec)) return;
                  setScrubSec(nextSec); // visual feedback only while dragging
                }}
                onPointerUp={commitSeekFromInput}
                // Arrow-key/Home/End seeking generates no pointer events, so
                // this is the commit path for keyboard users.
                onKeyUp={commitSeekFromInput}
                disabled={isIdle || !hasDuration}
                className="relative z-10 w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5
                         [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full
                         [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
                aria-label="Seek"
              />
            </div>
            {/* "--:--" rather than "0:00" whenever duration is genuinely
                unknown - a guest/non-Premium Spotify preview has no public
                API to report one at all (a hard platform limit, not a bug),
                and a real 0:00 next to a track that's visibly playing reads
                as broken rather than as "still loading". */}
            <span className="w-7 shrink-0 text-left text-[9px] tabular-nums sm:w-9 sm:text-[10px] md:w-10 md:text-xs" aria-label="Total duration">
              {hasDuration ? formatTime(durationSec) : '--:--'}
            </span>
          </div>

          {/* Secondary controls - collapse on narrow viewports rather than
              wrapping the bar to a second row. */}
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            <BarIconButton label={isMuted ? 'Unmute' : 'Mute'} onClick={toggleMute} className="inline-flex h-9 w-9">
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </BarIconButton>
            <input
              type="range"
              min="0"
              max="100"
              value={volumePercent}
              onChange={(e) => setVolumeLevel(Number(e.target.value) / 100)}
              aria-valuetext={`${volumePercent}%`}
              className="hidden w-20 h-1 bg-white/20 rounded-full appearance-none cursor-pointer md:block
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5
                       [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full
                       [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
              aria-label="Volume"
            />

            {provider === 'spotify' && isSpotifyBlocked && (
              // Spotify answers 403 for this account, so a Reconnect button
              // would loop: OAuth succeeds, /me is refused again, the button
              // comes back. Say what is actually wrong instead.
              <span
                role="status"
                className="max-w-[8.5rem] text-right text-[10px] font-semibold leading-tight text-amber-400"
                title="Spotify is refusing this account (403). The account must be added as an allowed user in the Spotify Developer Dashboard - reconnecting won't help until then. Playing a preview instead."
              >
                Spotify blocked this account
              </span>
            )}

            {provider === 'spotify' && isSpotifyConnected !== true && !isSpotifyBlocked && (
              <button
                type="button"
                onClick={handleReconnectSpotify}
                className="rounded-full border border-border/60 bg-muted/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:bg-muted"
                aria-label="Reconnect Spotify"
                title="Reconnect Spotify"
              >
                Reconnect
              </button>
            )}

            {showVideo && (
              <BarIconButton
                label={isCinema ? 'Exit full screen' : 'Enter full screen'}
                onClick={toggleFullscreen}
                className="inline-flex h-9 w-9"
              >
                <Maximize2 className="h-4 w-4" />
              </BarIconButton>
            )}
          </div>

          <BarIconButton label="Show queue" onClick={() => setQueueOpen(true)} className="hidden h-9 w-9 md:inline-flex">
            <ListMusic className="h-4 w-4" />
          </BarIconButton>

          <BarIconButton
            label={showVideo ? 'Compact player and hide video' : 'Show video and expand player'}
            title={showVideo ? 'Hide details' : 'Show details'}
            onClick={() => setShowVideo(!showVideo)}
            className="inline-flex h-8 w-8 sm:h-9 sm:w-9"
          >
            {showVideo ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </BarIconButton>

          <BarIconButton
            label="Hide player (keeps playing)"
            onClick={toggleHidden}
            className="inline-flex h-8 w-8 sm:h-9 sm:w-9"
          >
            <EyeOff className="h-4 w-4" />
          </BarIconButton>

          <BarIconButton label="Close player" onClick={closePlayer} className="inline-flex h-9 w-9">
            <X className="h-4 w-4" />
          </BarIconButton>
        </div>
        )}
      </div>

      {/* The bar above is display:none while hidden, taking every transport
          control with it - this tab is the only way back, so it must render
          whenever a track is loaded and the bar is hidden. */}
      {isHidden && !isIdle && (
        <button
          type="button"
          onClick={toggleHidden}
          className="fixed bottom-3 right-3 z-[110] inline-flex h-10 touch-manipulation items-center gap-2 rounded-full border border-border/60 bg-background/95 px-4 text-xs font-semibold text-foreground shadow-lg backdrop-blur-xl transition hover:bg-muted mb-[env(safe-area-inset-bottom)]"
          aria-label="Show player"
          title="Show player"
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          <span className="max-w-[10rem] truncate">{resolvedTitle || 'Show player'}</span>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Queue sheet */}
      <QueueSheet
        open={queueOpen}
        onOpenChange={setQueueOpen}
        queue={safeQueue}
        currentIndex={safeQueueIndex}
        onPlayTrack={(idx) => playFromQueue(idx)}
        onRemoveTrack={(idx) => removeFromQueue(idx)}
        onReorderQueue={reorderQueue}
        onClearQueue={clearQueue}
        onShuffleQueue={shuffleQueue}
      />
    </>
  );
}
