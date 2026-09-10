import { useMemo, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { usePlayer } from './PlayerContext';
import { Volume2, VolumeX, Maximize2, X, ChevronDown, ChevronUp, Play, Pause, SkipBack, SkipForward, ListMusic, Repeat } from 'lucide-react';
import { QueueSheet } from './QueueSheet';
import { useConnectSpotify } from '@/hooks/api/useSpotifyConnect';
import { useSpotifyConnected } from '@/hooks/api/useSpotifyUser';
import { getSectionDisplayLabel } from '@/lib/sections';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { UniversalPlayerHost } from '@/player/universal/UniversalPlayerHost';
import { SpotifyWebPlayer } from '@/player/providers/SpotifyWebPlayer';
import { HarmonicHUD } from '@/components/HarmonicHUD';
import { buildProviderDeepLink } from '@/player/universal/buildEmbedSrc';
import { isTestEnv } from '@/lib/env';
import { toast } from '@/hooks/use-toast';
import { providerMeta, formatTime } from './embeddedPlayer/constants';
import { useAnimatedSeekbar } from './embeddedPlayer/useAnimatedSeekbar';
import { usePlayerHarmony } from './embeddedPlayer/usePlayerHarmony';
import { useActiveSection } from './embeddedPlayer/useActiveSection';
import { usePlayerLayout } from './embeddedPlayer/usePlayerLayout';
import { useTransportControls } from './embeddedPlayer/useTransportControls';
import { BeatIndicator } from './embeddedPlayer/BeatIndicator';
import { useDevPlayerInvariants } from './embeddedPlayer/useDevInvariants';

type EmbeddedPlayerDrawerProps = {
  onNext?: () => void;
  onPrev?: () => void;
  canNext?: boolean;
  canPrev?: boolean;
};

export function EmbeddedPlayerDrawer({ onNext, onPrev, canNext, canPrev }: EmbeddedPlayerDrawerProps) {
  const {
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
  } = usePlayer();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: isSpotifyConnected } = useSpotifyConnected();
  const connectSpotify = useConnectSpotify();

  const { sections, harmony, hudSections } = usePlayerHarmony(canonicalTrackId);

  const safeQueue = Array.isArray(queue) ? queue : [];
  const safeQueueIndex = typeof queueIndex === 'number' ? queueIndex : -1;
  const autoplay = isPlaying;
  const canSeekInEmbed = true; // Enable seekbar - commit seek immediately to sync positionMs and provider
  const [queueOpen, setQueueOpen] = useState(false);
  const [scrubSec, setScrubSec] = useState<number | null>(null);

  // Docked to the bottom edge, full width, like Spotify's own desktop
  // player - always there while a track is loaded, never dragged or
  // resized around the screen. "Show video" reveals a compact panel above
  // the bar (the "miniplayer") rather than taking over the screen.
  const { cinemaRef, showVideo, setShowVideo, toggleFullscreen } = usePlayerLayout({ isCinema, enterCinema, exitCinema });

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

  const commitSeek = useCallback(
    (sec: number) => {
      if (!Number.isFinite(sec)) return;
      seekToMs(sec * 1000);
      setScrubSec(null);
    },
    [seekToMs]
  );

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
  const animatedPositionMs = useAnimatedSeekbar(safeMs(positionMs), durationMsSafe, isPlaying);
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
  }, [provider, trackId]);

  useDevPlayerInvariants(isOpen, resolvedTitle);

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
        className={`fixed inset-x-0 bottom-0 z-[110] border-t border-border/60 bg-gradient-to-t ${meta.color} shadow-[0_-18px_60px_-30px_rgba(0,0,0,0.75)] backdrop-blur-xl`}
      >
        {/* Chord readout and section jump chips: always visible whenever a
            track is loaded, not just when the video panel below is expanded.
            These used to live inside the collapsible DetailsPanel (gated on
            showVideo, which defaults closed) - since that panel is collapsed
            most of the time, the "rotating chords" feature was effectively
            hidden by default, and "jump to chorus/verse" wasn't reachable
            without first opening a panel most listeners never open. Only the
            video box itself (which genuinely benefits from being opt-in) stays
            behind the expand toggle, below. */}
        {!isIdle && (
          <div className="max-h-[45vh] overflow-y-auto border-b border-border/60 bg-background/95 px-3 py-3 md:px-4">
            <HarmonicHUD
              trackId={canonicalTrackId ?? ''}
              progression={harmony.progression}
              detectedKey={harmony.detectedKey ?? undefined}
              detectedMode={harmony.detectedMode ?? undefined}
              bpm={harmony.bpm}
              loopLengthBars={harmony.loopLengthBars}
              sections={hudSections}
            />

            {sections.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                  {sections.map((section) => {
                    const isActive = currentSectionId === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => {
                          if (typeof setCurrentSection === 'function') {
                            setCurrentSection(section.id);
                          }
                          if (canSeekInEmbed) {
                            seekToMs(section.start_ms);
                            return;
                          }
                          if (provider && trackId) {
                            const url = buildProviderDeepLink(provider, trackId, { startSec: Math.floor(section.start_ms / 1000) });
                            window.open(url, '_blank', 'noopener,noreferrer');
                          }
                        }}
                        className={[
                          'flex-shrink-0 rounded-full px-3 py-1 text-[11px] md:text-xs font-semibold transition border',
                          isActive
                            ? 'bg-primary text-primary-foreground border-primary/50'
                            : 'bg-muted/60 text-muted-foreground border-border/60 hover:bg-muted',
                        ].join(' ')}
                        aria-label={`Jump to ${getSectionDisplayLabel(section.label)}`}
                        title={`Jump to ${getSectionDisplayLabel(section.label)}${sectionWhy && isActive ? ` — ${sectionWhy}` : ''}`}
                      >
                        {getSectionDisplayLabel(section.label)}
                      </button>
                    );
                  })}
                </div>

                {activeSection && (
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof setLoopSection !== 'function') return;
                      const next = loopSectionId === activeSection.id ? null : activeSection.id;
                      setLoopSection(next);
                    }}
                    className={[
                      'inline-flex h-8 w-8 items-center justify-center rounded-full border transition',
                      loopSectionId === activeSection.id
                        ? 'border-primary/50 bg-primary/20 text-primary'
                        : 'border-border/60 bg-muted/60 text-muted-foreground hover:bg-muted',
                    ].join(' ')}
                    aria-label={loopSectionId === activeSection.id ? 'Disable section loop' : 'Loop section'}
                    title={loopSectionId === activeSection.id ? 'Disable section loop' : 'Loop section'}
                  >
                    <Repeat className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>
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
          <div className="max-h-[70vh] overflow-y-auto border-b border-border/60 bg-background/95 px-3 py-3 md:px-4">
            {useSpotifySdk ? (
              // Audio-only - Premium SDK playback has no picture to show,
              // just real transport control via the docked bar.
              <div className="mt-3">
                <SpotifyWebPlayer
                  providerTrackId={trackId}
                  autoplay={autoplay}
                  onFallback={(reason) => {
                    setSpotifySdkFailed(true);
                    const lower = reason.toLowerCase();
                    toast({
                      title: lower.includes('403') || lower.includes('developer dashboard')
                        ? 'Spotify app in Development Mode'
                        : lower.includes('premium')
                          ? 'Spotify Premium required'
                          : 'Falling back to Spotify preview',
                      // This toast stays until dismissed (see use-toast.ts's
                      // TOAST_REMOVE_DELAY) specifically so actionable detail
                      // like the 403/dev-mode guidance below doesn't flash
                      // past before it can be read.
                      description: reason,
                    });
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
                    request={
                      provider && trackId
                        ? {
                            provider,
                            id: trackId,
                            title: resolvedTitle,
                            artist: resolvedArtist,
                            autoplay,
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
            visually hidden) while idle, so there's no empty-looking strip
            reserved at the bottom of every page before anything has played;
            the iframe host above keeps mounting regardless (see isIdle
            comment above the DetailsPanel setup). */}
        {!isIdle && (
        <div className="flex items-center gap-2 px-3 py-2 md:gap-3 md:px-4 md:py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/80 text-lg shadow-inner md:h-10 md:w-10">
            {meta.Icon ? <meta.Icon className="h-4 w-4 md:h-5 md:w-5" /> : meta.badge}
          </span>
          <div className="flex min-w-0 flex-col leading-tight" style={{ flexBasis: '9rem' }}>
            {resolvedTitle && (
              <span className="truncate text-xs font-bold text-foreground md:text-sm" aria-label="Track title">{resolvedTitle}</span>
            )}
            {resolvedArtist && (
              <span className="truncate text-[11px] text-muted-foreground md:text-xs" aria-label="Artist name">{resolvedArtist}</span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Previous/next hide below sm - on a narrow phone width there is
                not enough room for badge + title + prev + play + next + seek
                + expand + close all in one non-wrapping row without things
                overlapping; Spotify's own mobile bar drops to just
                play/pause too, leaving prev/next to the expanded view. */}
            <button
              type="button"
              onClick={() => (effectiveCanPrev ? handlePrev() : null)}
              disabled={!effectiveCanPrev}
              className="hidden h-9 w-9 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed sm:inline-flex"
              aria-label="Previous track"
              title="Previous track"
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={togglePlayPause}
              className="inline-flex h-10 w-10 touch-manipulation items-center justify-center rounded-full border-2 border-primary/70 bg-primary/20 text-primary transition hover:border-primary hover:bg-primary hover:text-white"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-4 w-4 md:h-5 md:w-5" /> : <Play className="h-4 w-4 md:h-5 md:w-5" />}
            </button>
            <button
              type="button"
              onClick={() => (effectiveCanNext ? handleNext() : null)}
              disabled={!effectiveCanNext}
              className="hidden h-9 w-9 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed sm:inline-flex"
              aria-label="Next track"
              title="Next track"
            >
              <SkipForward className="h-4 w-4" />
            </button>
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
            className="hidden sm:flex"
          />

          {/* Seekbar - takes the remaining space, like Spotify's own bar.
              min-w-[130px] is a real floor (time label + seek track + time
              label at their own minimums), not just min-w-0: a flex-1 item
              with flex-basis 0 gets shrunk before items with an explicit
              basis (the title block) do, so without this floor the seekbar
              - not the title - was the one collapsing, and its own children
              (which never got the memo) kept their size and visually spilled
              into the icon buttons after it. */}
          <div className="flex min-w-[130px] flex-1 items-center gap-2 text-white">
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums md:w-10 md:text-xs" aria-label="Elapsed time">{formatTime(positionSec)}</span>
            <div className="relative min-w-[40px] flex-1">
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
                  if (!canSeekInEmbed) return;
                  const nextSec = Number(e.target.value);
                  if (!Number.isFinite(nextSec)) return;
                  setScrubSec(nextSec); // visual feedback only while dragging
                }}
                onPointerUp={(e) => {
                  if (!canSeekInEmbed) return;
                  const target = e.currentTarget as HTMLInputElement;
                  const nextSec = Number(target.value);
                  if (!Number.isFinite(nextSec)) return;
                  commitSeek(nextSec);
                }}
                onKeyUp={(e) => {
                  // Arrow-key/Home/End seeking generates no pointer events, so
                  // this is the commit path for keyboard users.
                  if (!canSeekInEmbed) return;
                  const target = e.currentTarget as HTMLInputElement;
                  const nextSec = Number(target.value);
                  if (!Number.isFinite(nextSec)) return;
                  commitSeek(nextSec);
                }}
                disabled={isIdle || !canSeekInEmbed || !hasDuration}
                className="relative z-10 w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5
                         [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full
                         [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
                aria-label="Seek"
              />
            </div>
            {/* "--:--" rather than "0:00" whenever duration is genuinely
                unknown - a guest/non-Premium Spotify preview has no public
                API to report one at all (a hard platform limit, not a bug),
                and a real 0:00 next to a track that's visibly playing reads
                as broken rather than as "still loading". */}
            <span className="w-9 shrink-0 text-left text-[10px] tabular-nums md:w-10 md:text-xs" aria-label="Total duration">
              {hasDuration ? formatTime(durationSec) : '--:--'}
            </span>
          </div>

          {/* Secondary controls - collapse on narrow viewports rather than
              wrapping the bar to a second row. */}
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            <button
              onClick={toggleMute}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
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

            {provider === 'spotify' && isSpotifyConnected !== true && (
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
              <button
                type="button"
                onClick={toggleFullscreen}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
                aria-label={isCinema ? 'Exit full screen' : 'Enter full screen'}
                title={isCinema ? 'Exit full screen' : 'Enter full screen'}
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            className="hidden h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground sm:inline-flex"
            aria-label="Show queue"
            title="Show queue"
          >
            <ListMusic className="h-4 w-4" />
          </button>

          {showVideo ? (
            <button
              type="button"
              onClick={() => setShowVideo(false)}
              className="inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
              aria-label="Compact player and hide video"
              title="Hide details"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowVideo(true)}
              className="inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
              aria-label="Show video and expand player"
              title="Show details"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={closePlayer}
            className="inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
            aria-label="Close player"
            title="Close player"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        )}
      </div>

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
