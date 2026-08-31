import { describe, it, expect, beforeEach } from 'vitest';
import { addToSearchHistory, getSearchHistory, clearSearchHistory } from './searchHistory';
import type { Track } from '@/types';

describe('searchHistory', () => {
  beforeEach(() => {
    clearSearchHistory();
  });

  it('records a plain search with no track', () => {
    addToSearchHistory({ query: 'shape of you', type: 'song' });

    const history = getSearchHistory();
    expect(history).toHaveLength(1);
    expect(history[0].query).toBe('shape of you');
    expect(history[0].track).toBeUndefined();
  });

  it('a repeat search updates the existing entry in place rather than being dropped', () => {
    addToSearchHistory({ query: 'shape of you', type: 'song' });
    addToSearchHistory({ query: 'blinding lights', type: 'song' });
    addToSearchHistory({ query: 'shape of you', type: 'song' });

    const history = getSearchHistory();
    // Still two entries, not three - and the repeat moved to the front.
    expect(history).toHaveLength(2);
    expect(history[0].query).toBe('shape of you');
    expect(history[1].query).toBe('blinding lights');
  });

  it('attaches a track to the query it came from without duplicating the entry', () => {
    const track = { id: 't1', title: 'Shape of You', artist: 'Ed Sheeran' } as Track;

    addToSearchHistory({ query: 'shape of you', type: 'song' });
    addToSearchHistory({ query: 'shape of you', type: 'song', track });

    const history = getSearchHistory();
    expect(history).toHaveLength(1);
    expect(history[0].track).toEqual(track);
  });

  it('keeps the query and type distinct - a chord search does not merge with a song search', () => {
    addToSearchHistory({ query: 'vi IV I V', type: 'chord' });
    addToSearchHistory({ query: 'vi IV I V', type: 'song' });

    expect(getSearchHistory()).toHaveLength(2);
  });
});
