import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlayHistory, useTopArtists, usePlayStats } from './usePlayEvents';

/**
 * These used to query user_interactions for `play_%` interaction_type rows
 * that nothing ever wrote (see the file's own header comment). Verifies the
 * real path instead: play_history joined with tracks, and useTopArtists'
 * aggregation.
 */

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

const mocks = vi.hoisted(() => ({
  playHistoryRows: [] as any[],
  tracksRows: [] as any[],
  playHistoryCount: 0,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'play_history') {
        // usePlayHistory: select(...).eq(...).order(...).limit(...) - limit()
        // is the real terminal call. usePlayStats: select('*', {count,head}).eq(...)
        // with no further chaining - .eq() is the terminal call there, so the
        // chain itself has to be thenable to resolve directly off .eq().
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => Promise.resolve({ data: mocks.playHistoryRows, error: null })),
          then: (resolve: (v: unknown) => void) => resolve({ count: mocks.playHistoryCount }),
        };
        return chain;
      }
      if (table === 'tracks') {
        const chain: any = {
          select: vi.fn(() => chain),
          in: vi.fn(() => Promise.resolve({ data: mocks.tracksRows, error: null })),
        };
        return chain;
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  },
}));

function renderQuery<T>(useHook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result: T;
  function Probe() {
    result = useHook();
    return null;
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  return { get: () => result! };
}

beforeEach(() => {
  mocks.playHistoryRows = [];
  mocks.tracksRows = [];
  mocks.playHistoryCount = 0;
});

describe('usePlayHistory', () => {
  it('joins play_history rows with their tracks, most recent first', async () => {
    mocks.playHistoryRows = [
      { id: 'h1', track_id: 't1', played_at: '2026-01-02T00:00:00Z', source: 'player' },
      { id: 'h2', track_id: 't2', played_at: '2026-01-01T00:00:00Z', source: 'feed' },
    ];
    mocks.tracksRows = [
      { id: 't1', title: 'Song A', artist: 'Artist A', album: null, cover_url: 'a.jpg', spotify_id: null, youtube_id: null },
      { id: 't2', title: 'Song B', artist: 'Artist B', album: null, cover_url: null, spotify_id: null, youtube_id: null },
    ];

    const hook = renderQuery(() => usePlayHistory({ limit: 20 }));

    await waitFor(() => expect(hook.get().data).toHaveLength(2));
    expect(hook.get().data![0]).toMatchObject({ id: 'h1', track_id: 't1', track: { title: 'Song A' } });
  });

  it('drops a history row whose track no longer exists, instead of crashing', async () => {
    mocks.playHistoryRows = [{ id: 'h1', track_id: 'deleted', played_at: '2026-01-01T00:00:00Z', source: 'player' }];
    mocks.tracksRows = [];

    const hook = renderQuery(() => usePlayHistory());

    await waitFor(() => expect(hook.get().isSuccess).toBe(true));
    expect(hook.get().data).toEqual([]);
  });
});

describe('useTopArtists', () => {
  it('ranks artists by play count across recent history', async () => {
    mocks.playHistoryRows = [
      { track_id: 't1' }, { track_id: 't1' }, { track_id: 't2' }, { track_id: 't1' }, { track_id: 't3' },
    ];
    mocks.tracksRows = [
      { id: 't1', artist: 'Frequent Artist', cover_url: 'f.jpg' },
      { id: 't2', artist: 'Rare Artist', cover_url: null },
      { id: 't3', artist: 'Frequent Artist', cover_url: 'f.jpg' }, // same artist, different track
    ];

    const hook = renderQuery(() => useTopArtists(10));

    await waitFor(() => expect(hook.get().data).toHaveLength(2));
    const [first, second] = hook.get().data!;
    expect(first).toMatchObject({ name: 'Frequent Artist', playCount: 4 }); // 3x t1 + 1x t3
    expect(second).toMatchObject({ name: 'Rare Artist', playCount: 1 });
  });

  it('skips tracks with no artist rather than showing a blank entry', async () => {
    mocks.playHistoryRows = [{ track_id: 't1' }];
    mocks.tracksRows = [{ id: 't1', artist: null, cover_url: null }];

    const hook = renderQuery(() => useTopArtists(10));

    await waitFor(() => expect(hook.get().isSuccess).toBe(true));
    expect(hook.get().data).toEqual([]);
  });
});

describe('usePlayStats', () => {
  it('reports the total play count', async () => {
    mocks.playHistoryCount = 42;

    const hook = renderQuery(() => usePlayStats());

    await waitFor(() => expect(hook.get().data).toEqual({ totalPlays: 42 }));
  });
});
