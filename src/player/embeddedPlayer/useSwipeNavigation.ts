import { useEffect, useRef, type RefObject } from 'react';

/** Enough horizontal travel, in px, to count as a deliberate swipe. */
const SWIPE_MIN_DISTANCE_PX = 50;
/** A swipe that takes longer than this is a drag, not a flick. */
const SWIPE_MAX_DURATION_MS = 500;

export interface SwipeTransport {
  handlePrev: () => void;
  handleNext: () => void;
  effectiveCanPrev: boolean;
  effectiveCanNext: boolean;
}

/**
 * Horizontal swipe on an element for prev/next track: left goes forward, right
 * goes back. Mirrors FeedPage.tsx's vertical swipe-to-advance pattern, but
 * deliberately on the X axis instead of Y - a vertical swipe here would fight
 * the browser's native pull-to-refresh gesture, which the player bar sits on
 * top of on every page.
 *
 * `transport` is read through a ref updated on every render rather than
 * depended on: handlePrev/handleNext are recreated on every position tick
 * (they need the live position to decide restart-vs-previous), and depending
 * on them would tear the listeners down and re-attach them several times a
 * second while a track plays. The effect only needs to re-run when the element
 * mounts or unmounts, which is what `mounted` tracks.
 *
 * Returns a ref that is true from the moment a swipe is acted on until a
 * reader clears it. A flick past the browser's tap slop usually suppresses the
 * click engines synthesize after a touch, but that threshold isn't guaranteed
 * across engines - anything clickable inside the swiped element should check
 * this first, or changing track by swipe would also fire that element's click.
 */
export function useSwipeNavigation(ref: RefObject<HTMLElement | null>, transport: SwipeTransport, mounted: boolean) {
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const didSwipeRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;

    const handleTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      didSwipeRef.current = false;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const diffX = startX - e.changedTouches[0].clientX;
      const diffY = Math.abs(startY - e.changedTouches[0].clientY);
      const isSwipe =
        Math.abs(diffX) > SWIPE_MIN_DISTANCE_PX && Math.abs(diffX) > diffY && Date.now() - startTime < SWIPE_MAX_DURATION_MS;
      if (!isSwipe) return;
      didSwipeRef.current = true;

      const { effectiveCanNext, effectiveCanPrev, handleNext, handlePrev } = transportRef.current;
      if (diffX > 0) {
        if (effectiveCanNext) handleNext();
      } else if (effectiveCanPrev) {
        handlePrev();
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [ref, mounted]);

  return didSwipeRef;
}
