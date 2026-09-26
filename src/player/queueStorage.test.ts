import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';
import { loadSavedQueue, saveQueue } from './queueStorage';

// The key is part of what users already have saved in their browsers, so a
// change to it would silently drop everyone's queue.
const STORAGE_KEY = 'clade_queue_v1';

const track = (id: string): Track => ({ id, title: `Track ${id}` });
const [a, b] = [track('a'), track('b')];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveQueue', () => {
  it('stores the queue and index under the existing key', () => {
    saveQueue({ queue: [a, b], queueIndex: 1 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ queue: [a, b], queueIndex: 1 });
  });

  it('stores an index that is inside the queue', () => {
    saveQueue({ queue: [a], queueIndex: 5 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).queueIndex).toBe(0);

    saveQueue({ queue: [], queueIndex: 3 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).queueIndex).toBe(-1);
  });

  it('reports a storage failure instead of throwing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveQueue({ queue: [a], queueIndex: 0 })).not.toThrow();
    expect(error).toHaveBeenCalledWith('Failed to persist queue to storage', expect.any(Error));
  });
});

describe('loadSavedQueue', () => {
  it('returns what saveQueue stored', () => {
    saveQueue({ queue: [a, b], queueIndex: 1 });
    expect(loadSavedQueue()).toEqual({ queue: [a, b], queueIndex: 1 });
  });

  it('returns null when nothing was saved', () => {
    expect(loadSavedQueue()).toBeNull();
  });

  it('pulls a saved index that is out of range back inside the queue', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ queue: [a, b], queueIndex: 9 }));
    expect(loadSavedQueue()?.queueIndex).toBe(1);
  });

  it('starts at the first entry when the saved index is missing or not a number', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ queue: [a, b] }));
    expect(loadSavedQueue()?.queueIndex).toBe(0);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ queue: [a, b], queueIndex: 'x' }));
    expect(loadSavedQueue()?.queueIndex).toBe(0);
  });

  it('treats a queue that is not a list as empty', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ queue: 'oops', queueIndex: 2 }));
    expect(loadSavedQueue()).toEqual({ queue: [], queueIndex: -1 });
  });

  it('reports a damaged value and returns null', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadSavedQueue()).toBeNull();
    expect(error).toHaveBeenCalledWith('Failed to hydrate queue from storage', expect.anything());
  });

  it('reports unreadable storage and returns null', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadSavedQueue()).toBeNull();
    expect(error).toHaveBeenCalledWith('Failed to hydrate queue from storage', expect.any(Error));
  });
});
