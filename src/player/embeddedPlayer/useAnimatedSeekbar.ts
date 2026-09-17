import { useEffect, useRef, useState } from 'react';
import { isTestEnv } from '@/lib/env';

/** Drift below this is left alone - correcting it would be visible as a stutter. */
const REANCHOR_TOLERANCE_MS = 250;
/** How close two consecutive backward readings must be to count as agreeing. */
const REWIND_AGREEMENT_MS = 1500;

/**
 * Animates the seekbar smoothly between provider updates.
 * Syncs to authoritative positionMs on each update while animating locally via RAF.
 */
export function useAnimatedSeekbar(
  positionMs: number,
  durationMs: number,
  isPlaying: boolean
): number {
  const [displayMs, setDisplayMs] = useState(positionMs);
  const rafIdRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const lastAuthorityMsRef = useRef<number>(positionMs);
  const durationRef = useRef<number>(durationMs);
  const playingRef = useRef<boolean>(isPlaying);
  playingRef.current = isPlaying;
  // A backward reading that has been seen once but not yet corroborated.
  const unconfirmedRewindRef = useRef<number | null>(null);

  // Re-anchor on the provider's position whenever the bar has drifted away
  // from it. Comparing the new reading against the PREVIOUS READING instead of
  // against what is drawn meant a stalled provider - a YouTube ad, a buffering
  // stall - reported the same position every tick, the comparison saw no
  // change, and the local animation ran away from the real playhead with
  // nothing to pull it back.
  //
  // Backward readings get one extra round of scrutiny. During playback the
  // real playhead only ever moves forward, so a reading behind what is drawn
  // is either a genuine seek/stall (which persists - the next reading agrees
  // with it) or a stale one-off from a provider that was busy when it was
  // sampled (which does not - the next reading is back out ahead). Snapping on
  // the first sighting is what made the bar flick to 0:00 and back while the
  // volume slider was being dragged: the flood of commands that drag used to
  // send made YouTube relay stale currentTime values, each of which looked
  // like a seek to the start. Requiring two consecutive readings that agree
  // with each other costs one poll interval on a real rewind and rejects the
  // glitch outright.
  useEffect(() => {
    if (!Number.isFinite(positionMs)) return;
    setDisplayMs((prev) => {
      const delta = positionMs - prev;
      if (Math.abs(delta) <= REANCHOR_TOLERANCE_MS) {
        unconfirmedRewindRef.current = null;
        return prev;
      }
      if (delta > 0 || !playingRef.current) {
        // Ahead of the bar, or not playing at all: nothing to second-guess.
        unconfirmedRewindRef.current = null;
        return positionMs;
      }
      const pending = unconfirmedRewindRef.current;
      // Corroborated when the previous backward reading landed in the same
      // region - identical for a stall, a little further on for a real seek
      // that kept playing.
      if (pending !== null && Math.abs(positionMs - pending) <= REWIND_AGREEMENT_MS) {
        unconfirmedRewindRef.current = null;
        return positionMs;
      }
      unconfirmedRewindRef.current = positionMs;
      return prev;
    });
    lastAuthorityMsRef.current = positionMs;
    lastFrameTimeRef.current = performance.now();
  }, [positionMs]);

  // Clamp display to duration changes to avoid drift beyond track end.
  useEffect(() => {
    durationRef.current = durationMs;
    if (durationMs > 0) {
      setDisplayMs((prev) => Math.min(prev, durationMs));
    }
  }, [durationMs]);

  // When playback stops, snap to authoritative position to stay in sync.
  useEffect(() => {
    if (!isPlaying && Number.isFinite(positionMs)) {
      unconfirmedRewindRef.current = null;
      setDisplayMs(positionMs);
    }
  }, [isPlaying, positionMs]);

  // Animate forward during playback using RAF
  useEffect(() => {
    if (isTestEnv) return;
    if (!isPlaying) {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return;
    }

    const animate = (now: number) => {
      const elapsed = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      setDisplayMs((prev) => {
        const next = prev + elapsed;
        const limit = durationRef.current;
        return limit > 0 ? Math.min(next, limit) : next;
      });

      rafIdRef.current = requestAnimationFrame(animate);
    };

    lastFrameTimeRef.current = performance.now();
    rafIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isPlaying, durationMs]);

  return displayMs;
}
