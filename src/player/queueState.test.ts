import { describe, expect, it } from 'vitest';
import type { Track } from '@/types';
import {
  appendTrack,
  clampQueueIndex,
  insertTrackNext,
  removeTrackAt,
  shuffleUpcoming,
  wrappedNextIndex,
  wrappedPreviousIndex,
  type QueueState,
} from './queueState';

const track = (id: string): Track => ({ id, title: `Track ${id}` });
const stateOf = (ids: string[], queueIndex: number): QueueState => ({ queue: ids.map(track), queueIndex });
const idsOf = (state: QueueState) => state.queue.map((t) => t.id);

describe('clampQueueIndex', () => {
  it('has no valid index for an empty queue', () => {
    expect(clampQueueIndex(0, 0)).toBe(-1);
    expect(clampQueueIndex(0, 5)).toBe(-1);
    expect(clampQueueIndex(0, -1)).toBe(-1);
  });

  it('pulls an index back into range and leaves a valid one alone', () => {
    expect(clampQueueIndex(3, -1)).toBe(0);
    expect(clampQueueIndex(3, 1)).toBe(1);
    expect(clampQueueIndex(3, 9)).toBe(2);
  });
});

describe('appendTrack', () => {
  it('adds a new track at the end and keeps the current entry', () => {
    const next = appendTrack(stateOf(['a', 'b'], 1), track('c'));
    expect(idsOf(next)).toEqual(['a', 'b', 'c']);
    expect(next.queueIndex).toBe(1);
  });

  it('moves a queued track to the end, and the index follows the current entry', () => {
    const next = appendTrack(stateOf(['a', 'b', 'c'], 1), track('a'));
    expect(idsOf(next)).toEqual(['b', 'c', 'a']);
    expect(next.queueIndex).toBe(0);
  });

  it('returns the very same state when the track is already current', () => {
    const state = stateOf(['a', 'b'], 1);
    expect(appendTrack(state, track('b'))).toBe(state);
  });

  it('returns the very same state for a new track when nothing is current (current behavior)', () => {
    const state = stateOf([], -1);
    expect(appendTrack(state, track('a'))).toBe(state);
  });

  it('does not change the state it was given, and keeps any other fields on it', () => {
    const state = { ...stateOf(['a', 'b'], 0), volume: 0.5 };
    const next = appendTrack(state, track('c'));
    expect(idsOf(state)).toEqual(['a', 'b']);
    expect(next.volume).toBe(0.5);
  });
});

describe('insertTrackNext', () => {
  it('puts a new track directly after the current entry', () => {
    const next = insertTrackNext(stateOf(['a', 'b', 'c'], 0), track('d'));
    expect(idsOf(next)).toEqual(['a', 'd', 'b', 'c']);
    expect(next.queueIndex).toBe(0);
  });

  it('moves a queued track to just after the current entry', () => {
    expect(idsOf(insertTrackNext(stateOf(['a', 'b', 'c'], 0), track('c')))).toEqual(['a', 'c', 'b']);
  });

  it('follows the current entry when the moved track came before it', () => {
    const next = insertTrackNext(stateOf(['a', 'b', 'c'], 2), track('a'));
    expect(idsOf(next)).toEqual(['b', 'c', 'a']);
    expect(next.queueIndex).toBe(1);
  });

  it('returns the very same state when the track is already current', () => {
    const state = stateOf(['a', 'b'], 1);
    expect(insertTrackNext(state, track('b'))).toBe(state);
  });

  describe('with no valid current entry (current behavior)', () => {
    it.each([-1, 7])('changes nothing for a new track, with the index at %i', (queueIndex) => {
      const state = stateOf(['a', 'b'], queueIndex);
      expect(insertTrackNext(state, track('z'))).toBe(state);
    });

    it('moves an already-queued track to the end and makes the first entry current', () => {
      const next = insertTrackNext(stateOf(['a', 'b', 'c'], -1), track('b'));
      expect(idsOf(next)).toEqual(['a', 'c', 'b']);
      expect(next.queueIndex).toBe(0);
    });
  });

  it('does not change the state it was given', () => {
    const state = stateOf(['a', 'b'], 0);
    insertTrackNext(state, track('c'));
    expect(idsOf(state)).toEqual(['a', 'b']);
  });
});

describe('removeTrackAt', () => {
  it('leaves the index alone when the removed entry is after the current one', () => {
    const next = removeTrackAt(stateOf(['a', 'b', 'c'], 0), 2);
    expect(idsOf(next)).toEqual(['a', 'b']);
    expect(next.queueIndex).toBe(0);
  });

  it('follows the current entry when an earlier one is removed', () => {
    const next = removeTrackAt(stateOf(['a', 'b', 'c'], 2), 0);
    expect(idsOf(next)).toEqual(['b', 'c']);
    expect(next.queueIndex).toBe(1);
  });

  it('keeps the same entry current when an earlier one is removed from a longer queue', () => {
    // Four entries, so the shifted index is not just the clamped one.
    const next = removeTrackAt(stateOf(['a', 'b', 'c', 'd'], 2), 0);
    expect(idsOf(next)).toEqual(['b', 'c', 'd']);
    expect(next.queueIndex).toBe(1);
    expect(next.queue[next.queueIndex].id).toBe('c');
  });

  it('keeps the index in range when the current last entry is removed', () => {
    expect(removeTrackAt(stateOf(['a', 'b', 'c'], 2), 2).queueIndex).toBe(1);
  });

  it('leaves no current entry when the only one is removed', () => {
    expect(removeTrackAt(stateOf(['a'], 0), 0)).toMatchObject({ queue: [], queueIndex: -1 });
  });

  it('removes nothing for an index that is not in the queue', () => {
    const next = removeTrackAt(stateOf(['a', 'b'], 1), 9);
    expect(idsOf(next)).toEqual(['a', 'b']);
    expect(next.queueIndex).toBe(1);
  });

  it('does not change the state it was given', () => {
    const state = stateOf(['a', 'b'], 0);
    removeTrackAt(state, 1);
    expect(idsOf(state)).toEqual(['a', 'b']);
  });
});

describe('shuffleUpcoming', () => {
  /** A repeatable stand-in for Math.random. */
  const sequence = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it('keeps the current entry and everything before it, and only reorders what follows', () => {
    const next = shuffleUpcoming(stateOf(['a', 'b', 'c', 'd', 'e'], 1), sequence([0.9, 0.1, 0.6, 0.2]));
    expect(idsOf(next).slice(0, 2)).toEqual(['a', 'b']);
    expect([...idsOf(next).slice(2)].sort()).toEqual(['c', 'd', 'e']);
    expect(next.queueIndex).toBe(1);
  });

  it('uses the random source it is given, and only when there is something to reorder', () => {
    let calls = 0;
    const counting = () => {
      calls += 1;
      return 0.5;
    };
    shuffleUpcoming(stateOf(['a', 'b', 'c'], 0), counting);
    expect(calls).toBeGreaterThan(0);

    calls = 0;
    shuffleUpcoming(stateOf(['a', 'b'], 1), counting);
    expect(calls).toBe(0);
  });

  it('does not change the state it was given', () => {
    const state = stateOf(['a', 'b', 'c'], 0);
    shuffleUpcoming(state, sequence([0.9, 0.1]));
    expect(idsOf(state)).toEqual(['a', 'b', 'c']);
  });
});

describe('wrapped stepping', () => {
  it('moves forward and wraps from the last entry to the first', () => {
    expect(wrappedNextIndex(3, 0)).toBe(1);
    expect(wrappedNextIndex(3, 2)).toBe(0);
  });

  it('moves back and wraps from the first entry to the last', () => {
    expect(wrappedPreviousIndex(3, 2)).toBe(1);
    expect(wrappedPreviousIndex(3, 0)).toBe(2);
  });

  it('treats "no current entry" as the start when going back and as before the first when going forward', () => {
    expect(wrappedPreviousIndex(3, -1)).toBe(2);
    expect(wrappedNextIndex(3, -1)).toBe(0);
  });
});
