import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerContext';
import type { Track } from '@/types';

/**
 * Characterizes how the queue is edited and persisted through usePlayer().
 * These pin today's behavior, including edge cases that may not be intended
 * (see the empty-queue tests), so that moving the queue logic out of
 * PlayerContext can be shown not to change any of it.
 */

vi.mock('@/api/playEvents', () => ({
  recordPlayEvent: vi.fn(async () => {}),
  recordPlayHistory: vi.fn(async () => {}),
}));

const STORAGE_KEY = 'clade_queue_v1';

type Ctx = ReturnType<typeof usePlayer>;

let latest: Ctx;

function Probe() {
  const ctx = usePlayer();
  useEffect(() => {
    latest = ctx;
  });
  return null;
}

const track = (id: string): Track => ({ id, title: `Track ${id}` });
const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(track);

/** Mounts the player with a queue restored from storage, as on a real page load. */
function mount(queue: Track[], queueIndex: number) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ queue, queueIndex }));
  render(
    <PlayerProvider>
      <Probe />
    </PlayerProvider>
  );
}

const ids = () => latest.queue.map((t) => t.id);
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enqueueLater', () => {
  it('appends a new track and keeps the current entry', () => {
    mount([a, b], 1);
    act(() => latest.enqueueLater(c));
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(latest.queueIndex).toBe(1);
  });

  it('moves an already-queued track to the end, following the current entry when it shifts', () => {
    mount([a, b, c], 1);
    act(() => latest.enqueueLater(a));
    expect(ids()).toEqual(['b', 'c', 'a']);
    expect(latest.queueIndex).toBe(0);
  });

  it('moves a track that comes after the current entry without moving the index', () => {
    mount([a, b, c], 0);
    act(() => latest.enqueueLater(b));
    expect(ids()).toEqual(['a', 'c', 'b']);
    expect(latest.queueIndex).toBe(0);
  });

  it('leaves the queue alone for the track that is already current', () => {
    mount([a, b, c], 1);
    const before = latest.queue;
    act(() => latest.enqueueLater(b));
    expect(latest.queue).toBe(before);
    expect(latest.queueIndex).toBe(1);
  });

  it('addToQueue behaves as enqueueLater', () => {
    mount([a, b], 0);
    act(() => latest.addToQueue(c));
    expect(ids()).toEqual(['a', 'b', 'c']);
  });
});

describe('enqueueNext', () => {
  it('inserts a new track directly after the current entry', () => {
    mount([a, b, c], 0);
    act(() => latest.enqueueNext(d));
    expect(ids()).toEqual(['a', 'd', 'b', 'c']);
    expect(latest.queueIndex).toBe(0);
  });

  it('moves an already-queued track to just after the current entry', () => {
    mount([a, b, c], 0);
    act(() => latest.enqueueNext(c));
    expect(ids()).toEqual(['a', 'c', 'b']);
    expect(latest.queueIndex).toBe(0);
  });

  it('follows the current entry when the moved track came before it', () => {
    mount([a, b, c], 2);
    act(() => latest.enqueueNext(a));
    expect(ids()).toEqual(['b', 'c', 'a']);
    expect(latest.queueIndex).toBe(1);
  });

  it('leaves the queue alone for the track that is already current', () => {
    mount([a, b], 1);
    const before = latest.queue;
    act(() => latest.enqueueNext(b));
    expect(latest.queue).toBe(before);
    expect(latest.queueIndex).toBe(1);
  });
});

describe('editing an empty queue with nothing current (current behavior)', () => {
  // Both calls return the state untouched, because "the track's index" and
  // "the current index" are both -1. Whether that is intended is deferred;
  // this pins it so a refactor cannot change it by accident.
  it('enqueueLater adds nothing', () => {
    mount([], -1);
    act(() => latest.enqueueLater(a));
    expect(ids()).toEqual([]);
    expect(latest.queueIndex).toBe(-1);
  });

  it('enqueueNext adds nothing', () => {
    mount([], -1);
    act(() => latest.enqueueNext(a));
    expect(ids()).toEqual([]);
    expect(latest.queueIndex).toBe(-1);
  });
});

describe('removeFromQueue', () => {
  it('removes an entry after the current one without moving the index', () => {
    mount([a, b, c], 0);
    act(() => latest.removeFromQueue(2));
    expect(ids()).toEqual(['a', 'b']);
    expect(latest.queueIndex).toBe(0);
  });

  it('follows the current entry when an earlier one is removed', () => {
    mount([a, b, c], 2);
    act(() => latest.removeFromQueue(0));
    expect(ids()).toEqual(['b', 'c']);
    expect(latest.queueIndex).toBe(1);
  });

  it('keeps the same entry current when an earlier one is removed from a longer queue', () => {
    mount([a, b, c, d], 2);
    act(() => latest.removeFromQueue(0));
    expect(ids()).toEqual(['b', 'c', 'd']);
    expect(latest.queueIndex).toBe(1);
  });

  it('keeps the index in range when the current last entry is removed', () => {
    mount([a, b, c], 2);
    act(() => latest.removeFromQueue(2));
    expect(ids()).toEqual(['a', 'b']);
    expect(latest.queueIndex).toBe(1);
  });

  it('leaves no current entry when the only one is removed', () => {
    mount([a], 0);
    act(() => latest.removeFromQueue(0));
    expect(ids()).toEqual([]);
    expect(latest.queueIndex).toBe(-1);
  });

  it('removes nothing for an index that is not in the queue', () => {
    mount([a, b], 1);
    act(() => latest.removeFromQueue(9));
    expect(ids()).toEqual(['a', 'b']);
    expect(latest.queueIndex).toBe(1);
  });
});

describe('reorderQueue and clearQueue', () => {
  it('replaces the queue and keeps the index', () => {
    mount([a, b, c], 1);
    act(() => latest.reorderQueue([c, b, a]));
    expect(ids()).toEqual(['c', 'b', 'a']);
    expect(latest.queueIndex).toBe(1);
  });

  it('pulls the index back into range when the new queue is shorter', () => {
    mount([a, b, c], 2);
    act(() => latest.reorderQueue([a]));
    expect(ids()).toEqual(['a']);
    expect(latest.queueIndex).toBe(0);
  });

  it('empties the queue and clears the current entry', () => {
    mount([a, b, c], 1);
    act(() => latest.clearQueue());
    expect(ids()).toEqual([]);
    expect(latest.queueIndex).toBe(-1);
  });
});

describe('shuffleQueue', () => {
  it('keeps the current and earlier entries in place and reorders only what is after them', () => {
    mount([a, b, c, d], 1);
    act(() => latest.shuffleQueue());
    expect(ids().slice(0, 2)).toEqual(['a', 'b']);
    expect([...ids().slice(2)].sort()).toEqual(['c', 'd']);
    expect(latest.queueIndex).toBe(1);
  });

  it('is a no-op in effect on a queue with nothing after the current entry', () => {
    mount([a, b], 1);
    act(() => latest.shuffleQueue());
    expect(ids()).toEqual(['a', 'b']);
    expect(latest.queueIndex).toBe(1);
  });
});

describe('persisting the queue', () => {
  it('writes the queue and index to storage whenever they change', () => {
    mount([a], 0);
    act(() => latest.enqueueLater(b));
    expect(stored()).toEqual({ queue: [a, b], queueIndex: 0 });

    act(() => latest.clearQueue());
    expect(stored()).toEqual({ queue: [], queueIndex: -1 });
  });
});

describe('restoring the queue', () => {
  it('restores a saved queue and index', () => {
    mount([a, b, c], 2);
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(latest.queueIndex).toBe(2);
  });

  it('pulls a saved index that is past the end back into range', () => {
    mount([a, b], 9);
    expect(latest.queueIndex).toBe(1);
  });

  it('treats a saved queue without a usable index as starting at the first entry', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ queue: [a, b], queueIndex: 'nope' }));
    render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );
    expect(ids()).toEqual(['a', 'b']);
    expect(latest.queueIndex).toBe(0);
  });

  it('ignores a saved value whose queue is not a list', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ queue: 'oops', queueIndex: 3 }));
    render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );
    expect(ids()).toEqual([]);
    expect(latest.queueIndex).toBe(-1);
  });

  it('starts empty and reports it, without throwing, when the saved value is not valid JSON', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, '{not json');
    render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );
    expect(ids()).toEqual([]);
    expect(latest.queueIndex).toBe(-1);
    expect(error).toHaveBeenCalledWith('Failed to hydrate queue from storage', expect.anything());
  });

  it('starts empty when nothing was saved', () => {
    render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );
    expect(ids()).toEqual([]);
    expect(latest.queueIndex).toBe(-1);
  });
});
