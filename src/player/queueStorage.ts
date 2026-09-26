import type { Track } from '@/types';
import { clampQueueIndex, type QueueState } from './queueState';

const QUEUE_STORAGE_KEY = 'clade_queue_v1';

/**
 * The queue saved by an earlier visit, or null when there is nothing to
 * restore: nothing was saved, or storage cannot be read. A saved value that is
 * damaged is reported and treated the same way, so a bad entry never stops the
 * player from starting.
 */
export function loadSavedQueue(): QueueState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { queue?: Track[]; queueIndex?: number };
    const queue = Array.isArray(parsed?.queue) ? parsed.queue : [];
    const queueIndex = clampQueueIndex(queue.length, typeof parsed?.queueIndex === 'number' ? parsed.queueIndex : -1);
    return { queue, queueIndex };
  } catch (err) {
    console.error('Failed to hydrate queue from storage', err);
    return null;
  }
}

/** Saves the queue for the next visit. A storage failure is reported, not thrown. */
export function saveQueue({ queue, queueIndex }: QueueState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify({ queue, queueIndex: clampQueueIndex(queue.length, queueIndex) })
    );
  } catch (err) {
    console.error('Failed to persist queue to storage', err);
  }
}
