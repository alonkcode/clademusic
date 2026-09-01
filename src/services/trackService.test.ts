import { describe, it, expect, vi, afterEach } from 'vitest';

// fetchFromDatabase awaits the query builder chain directly (no final
// `.then()` call site to hook), so the mock's chain methods return a
// thenable `this` that resolves to an error - exercising the seed-data
// fallback deterministically instead of making a real network call in tests.
vi.mock('@/integrations/supabase/client', () => {
  const response = { data: null, error: { message: 'blocked in tests' } };
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    limit: () => chain,
    range: () => chain,
    then: (resolve: (v: typeof response) => void) => resolve(response),
  };
  return { supabase: { from: () => chain } };
});

const { shuffle, fetchTracks } = await import('./trackService');

describe('shuffle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps every element, just reorders them', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);
    expect(result).toHaveLength(input.length);
    expect([...result].sort()).toEqual([...input].sort());
  });

  it('does not mutate the array it was given', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    shuffle(input);
    expect(input).toEqual(copy);
  });

  it('actually reorders, given a deterministic non-identity random sequence', () => {
    // random() always returning 0 makes Fisher-Yates swap each position with
    // index 0, in decreasing order - a fixed, non-identity permutation.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(shuffle([1, 2, 3, 4, 5])).toEqual([2, 3, 4, 5, 1]);
  });
});

describe('fetchTracks randomize', () => {
  it('returns a random slice of the requested size from the seed fallback', async () => {
    const result = await fetchTracks({ limit: 5, randomize: true });
    expect(result.source).toBe('seed');
    expect(result.tracks).toHaveLength(5);
    // No repeats within the slice itself.
    expect(new Set(result.tracks.map((t) => t.id)).size).toBe(5);
  });

  it('produces a different order across calls (statistical - seed set is well over 5 tracks)', async () => {
    const orders = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const { tracks } = await fetchTracks({ limit: 8, randomize: true });
      orders.add(tracks.map((t) => t.id).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});
