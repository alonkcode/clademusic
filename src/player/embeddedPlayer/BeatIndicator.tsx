import { useEffect, useRef, useState } from 'react';
import { isTestEnv } from '@/lib/env';
import { beatFlashIntensity, isUsableBpm } from './beatClock';

/** How visible the dot is between beats. Never fully invisible - a dot that
 *  vanishes reads as "no data" rather than as the off-half of a rhythm. */
const REST_OPACITY = 0.2;
const REST_SCALE = 1;
const PEAK_SCALE = 1.45;

type BeatIndicatorProps = {
  bpm: number | null | undefined;
  /** The provider's own reported position - NOT a smoothed/animated one. */
  positionMs: number;
  isPlaying: boolean;
  className?: string;
};

/**
 * A dot that flashes on each beat, next to the tempo it is counting.
 *
 * Driven straight to the DOM from inside a rAF loop rather than through React
 * state: at 120bpm this repaints ~60 times a second, and putting that through
 * setState would re-render every consumer of the player context at that rate
 * for what is one element's opacity.
 *
 * The loop reads playback position, not elapsed wall-clock time. It re-anchors
 * on `positionMs` every time the provider reports one, so the flashes track
 * the audio through seeks, pauses and buffering stalls instead of free-running
 * from mount and sliding out of phase with the music.
 */
export function BeatIndicator({ bpm, positionMs, isPlaying, className }: BeatIndicatorProps) {
  const dotRef = useRef<HTMLSpanElement | null>(null);
  // Last authoritative position, and the clock reading when it landed - the
  // two together let the loop extrapolate between provider updates, which
  // arrive only a few times a second and would otherwise make the dot stutter.
  const anchorPosRef = useRef(positionMs);
  const anchorAtRef = useRef(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    anchorPosRef.current = positionMs;
    anchorAtRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
  }, [positionMs]);

  // Flashing is exactly the kind of motion this setting exists to turn off, and
  // at fast tempos it is the most insistent thing on the screen.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduceMotion(query.matches);
    apply();
    query.addEventListener?.('change', apply);
    return () => query.removeEventListener?.('change', apply);
  }, []);

  useEffect(() => {
    const dot = dotRef.current;
    if (!dot) return;

    const rest = () => {
      dot.style.opacity = String(REST_OPACITY);
      dot.style.transform = `scale(${REST_SCALE})`;
    };

    if (isTestEnv || reduceMotion || !isPlaying || !isUsableBpm(bpm)) {
      rest();
      return;
    }

    let frame = requestAnimationFrame(function tick() {
      const elapsed = performance.now() - anchorAtRef.current;
      const intensity = beatFlashIntensity(anchorPosRef.current + elapsed, bpm);
      dot.style.opacity = String(REST_OPACITY + (1 - REST_OPACITY) * intensity);
      dot.style.transform = `scale(${REST_SCALE + (PEAK_SCALE - REST_SCALE) * intensity})`;
      frame = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(frame);
      rest();
    };
  }, [bpm, isPlaying, reduceMotion]);

  // Nothing honest to show without a tempo: an idle dot next to a blank number
  // would just look like a broken readout.
  if (!isUsableBpm(bpm)) return null;

  const rounded = Math.round(bpm);

  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 ${className ?? ''}`}
      title={`Tempo: ${rounded} beats per minute`}
    >
      <span
        ref={dotRef}
        aria-hidden="true"
        className="block h-2.5 w-2.5 rounded-full bg-primary will-change-transform"
        style={{ opacity: REST_OPACITY, transform: `scale(${REST_SCALE})` }}
      />
      <span className="text-[10px] font-semibold leading-none tabular-nums text-muted-foreground md:text-xs">
        {rounded}
        <span className="ml-0.5 font-normal opacity-70">BPM</span>
      </span>
    </div>
  );
}
