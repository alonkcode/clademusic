import { useEffect, type RefObject } from 'react';

const HEIGHT_VAR = '--clade-player-height';

/**
 * Publish the docked player's real rendered height so the page reserves
 * exactly that much bottom space (see body.clade-player-open in index.css).
 * The chord readout above the bar makes the player 200-350px tall, but the
 * reservation was hard-coded at 52px - so the panel sat on top of the
 * page's own content (the login form's submit button, most visibly).
 */
export function usePublishPlayerHeight(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (typeof window === 'undefined' || !el) return;
    const publish = () => {
      document.body.style.setProperty(HEIGHT_VAR, `${Math.round(el.getBoundingClientRect().height)}px`);
    };
    const clear = () => document.body.style.removeProperty(HEIGHT_VAR);
    publish();
    if (typeof ResizeObserver === 'undefined') return clear;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [ref]);
}
