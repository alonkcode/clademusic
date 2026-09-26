import type { Track } from '@/types';

/** The two pieces of player state that describe the queue. */
export interface QueueState {
  queue: Track[];
  /** Index of the entry playback is on, or -1 when there is none. */
  queueIndex: number;
}

/**
 * An index that points inside a queue of `queueLength` entries. An empty queue
 * has no valid index, so it gets -1; otherwise the index is pulled into range.
 */
export const clampQueueIndex = (queueLength: number, index: number) => {
  if (queueLength === 0) return -1;
  return Math.max(0, Math.min(index, queueLength - 1));
};

/*
 * The edits below take any state that includes a queue and return the same
 * kind of state. Where an edit changes nothing they return the state they were
 * given, unchanged and not copied, so a React updater built on them does not
 * cause a re-render.
 */

/**
 * Puts `track` at the end of the queue, moving it there if it is already
 * queued. The current entry stays current.
 */
export function appendTrack<S extends QueueState>(state: S, track: Track): S {
  const existingIdx = state.queue.findIndex((t) => t.id === track.id);
  if (existingIdx === state.queueIndex) return state;

  let queue = state.queue;
  let queueIndex = state.queueIndex;

  if (existingIdx !== -1) {
    queue = state.queue.filter((_, i) => i !== existingIdx);
    if (existingIdx < queueIndex) queueIndex -= 1;
  }

  queue = [...queue, track];
  return { ...state, queue, queueIndex: clampQueueIndex(queue.length, queueIndex) };
}

/**
 * Puts `track` directly after the current entry, moving it there if it is
 * already queued. With no valid current entry it goes to the end.
 */
export function insertTrackNext<S extends QueueState>(state: S, track: Track): S {
  let baseIndex = state.queueIndex;
  const isValidBase = baseIndex >= 0 && baseIndex < state.queue.length;
  if (!isValidBase) baseIndex = -1;

  const queue = [...state.queue];
  const existingIdx = queue.findIndex((t) => t.id === track.id);
  if (existingIdx === baseIndex) return state;

  if (existingIdx !== -1) {
    queue.splice(existingIdx, 1);
    if (existingIdx < baseIndex) baseIndex -= 1;
  }

  const insertAt = baseIndex === -1 ? queue.length : baseIndex + 1;
  queue.splice(insertAt, 0, track);

  return { ...state, queue, queueIndex: clampQueueIndex(queue.length, baseIndex) };
}

/**
 * Removes the entry at `index`. The current entry stays current, unless it is
 * the one removed, in which case the entry that follows it is.
 */
export function removeTrackAt<S extends QueueState>(state: S, index: number): S {
  const queue = state.queue.filter((_, i) => i !== index);
  const adjustedIndex = index < state.queueIndex ? state.queueIndex - 1 : state.queueIndex;
  return { ...state, queue, queueIndex: clampQueueIndex(queue.length, adjustedIndex) };
}

/**
 * Reorders the entries after the current one. The current entry and everything
 * before it stay where they are. `random` is injectable so a test can control it.
 */
export function shuffleUpcoming<S extends QueueState>(state: S, random: () => number = Math.random): S {
  const upcoming = state.queue.slice(state.queueIndex + 1);
  const shuffled = [...upcoming].sort(() => random() - 0.5);
  const queue = [...state.queue.slice(0, state.queueIndex + 1), ...shuffled];
  return { ...state, queue, queueIndex: clampQueueIndex(queue.length, state.queueIndex) };
}

/** The index "next" moves to, wrapping from the last entry back to the first. */
export const wrappedNextIndex = (queueLength: number, queueIndex: number) =>
  queueIndex >= queueLength - 1 ? 0 : queueIndex + 1;

/** The index "previous" moves to, wrapping from the first entry to the last. */
export const wrappedPreviousIndex = (queueLength: number, queueIndex: number) =>
  queueIndex <= 0 ? queueLength - 1 : queueIndex - 1;
