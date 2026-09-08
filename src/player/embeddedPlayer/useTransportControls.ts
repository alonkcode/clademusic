import { useCallback } from 'react';

export interface UseTransportControlsOptions {
  isIdle: boolean;
  /** Real playback position in ms - used only to decide "restart" vs "previous track". */
  positionMs: number;
  queueIndex: number;
  queueLength: number;
  playFromQueue: (index: number) => void;
  seekToMs: (ms: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  canNext?: boolean;
  canPrev?: boolean;
}

/**
 * Prev/next: step through the queue when there's one to step through,
 * otherwise defer to the host page's own onPrev/onNext, otherwise restart the
 * current track. Also derives whether each button should actually be enabled.
 */
export function useTransportControls({
  isIdle,
  positionMs,
  queueIndex,
  queueLength,
  playFromQueue,
  seekToMs,
  onPrev,
  onNext,
  canNext,
  canPrev,
}: UseTransportControlsOptions) {
  const handlePrev = useCallback(() => {
    if (isIdle) return;
    if (positionMs > 3000) {
      seekToMs(0);
      return;
    }
    if (queueIndex > 0 && queueLength) {
      playFromQueue(queueIndex - 1);
      return;
    }
    if (queueIndex === -1 && queueLength > 0) {
      playFromQueue(0);
      return;
    }
    if (onPrev) {
      onPrev();
      return;
    }
    seekToMs(0);
  }, [isIdle, positionMs, queueIndex, queueLength, playFromQueue, seekToMs, onPrev]);

  const handleNext = useCallback(() => {
    if (isIdle) return;
    if (queueIndex >= 0 && queueIndex < queueLength - 1) {
      playFromQueue(queueIndex + 1);
      return;
    }
    if (queueIndex === -1 && queueLength > 0) {
      playFromQueue(0);
      return;
    }
    if (onNext) {
      onNext();
    }
  }, [isIdle, queueIndex, queueLength, playFromQueue, onNext]);

  // A queue of >1 does not mean a next track exists - at the last index there
  // is nothing to advance to, which left the button enabled but inert.
  const hasQueueNext = (queueIndex >= 0 && queueIndex < queueLength - 1) || (queueIndex === -1 && queueLength > 0);
  const effectiveCanNext = canNext ?? (!isIdle && (hasQueueNext || Boolean(onNext)));
  // Previous is available whenever it can do something: step back, restart the
  // current track, or defer to the host page.
  const effectiveCanPrev = canPrev ?? !isIdle;

  return { handlePrev, handleNext, effectiveCanNext, effectiveCanPrev };
}
