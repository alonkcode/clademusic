import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  rows: [] as any[],
  error: null as any,
  or: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ isTestEnv: false }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn(() => chain),
        or: mocks.or.mockImplementation(() => chain),
        limit: mocks.limit.mockImplementation(() => Promise.resolve({ data: mocks.rows, error: mocks.error })),
      };
      return chain;
    }),
  },
}));

const { useResolvedTrackId, parseSyntheticTrackId, findTrackIdByProviderId } = await import('./useResolvedTrackId');

const UUID = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';

function renderResolved(canonicalTrackId: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let latest: ReturnType<typeof useResolvedTrackId>;
  function Probe() {
    latest = useResolvedTrackId(canonicalTrackId);
    return null;
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  return { get: () => latest! };
}

beforeEach(() => {
  mocks.rows = [];
  mocks.error = null;
  mocks.or.mockClear();
  mocks.limit.mockClear();
});

describe('parseSyntheticTrackId', () => {
  it('reads both provider forms', () => {
    expect(parseSyntheticTrackId('spotify:0VjIjW4GlUZAMYd2vXMi3b')).toEqual({
      provider: 'spotify',
      providerId: '0VjIjW4GlUZAMYd2vXMi3b',
    });
    expect(parseSyntheticTrackId('youtube:dQw4w9WgXcQ')).toEqual({ provider: 'youtube', providerId: 'dQw4w9WgXcQ' });
  });

  it.each([
    null,
    undefined,
    '',
    UUID,
    'apple:abcdefgh',
    'youtube:',
    'youtube:ab',
    'youtube:abc,def)or(x',
    'spotify:has space',
  ])('rejects %s', (value) => {
    expect(parseSyntheticTrackId(value as any)).toBeNull();
  });
});

describe('findTrackIdByProviderId', () => {
  it('matches the provider row or the other provider id column', async () => {
    mocks.rows = [{ id: UUID, provider: 'spotify', external_id: '0VjIjW4GlUZAMYd2vXMi3b' }];
    await findTrackIdByProviderId('youtube', 'dQw4w9WgXcQ');
    expect(mocks.or).toHaveBeenCalledWith('and(provider.eq.youtube,external_id.eq.dQw4w9WgXcQ),youtube_id.eq.dQw4w9WgXcQ');
  });

  it('prefers the row that is exactly this provider and id', async () => {
    mocks.rows = [
      { id: OTHER, provider: 'spotify', external_id: 'spotifyRow000000000000' },
      { id: UUID, provider: 'youtube', external_id: 'dQw4w9WgXcQ' },
    ];
    expect(await findTrackIdByProviderId('youtube', 'dQw4w9WgXcQ')).toBe(UUID);
  });

  it('returns null when the catalog has never seen it, and when the lookup fails', async () => {
    expect(await findTrackIdByProviderId('youtube', 'dQw4w9WgXcQ')).toBeNull();
    mocks.error = { message: 'boom' };
    expect(await findTrackIdByProviderId('youtube', 'dQw4w9WgXcQ')).toBeNull();
  });
});

describe('useResolvedTrackId', () => {
  it('passes a real catalog UUID straight through without a lookup', () => {
    const probe = renderResolved(UUID);
    expect(probe.get()).toEqual({ trackId: UUID, isResolving: false });
    expect(mocks.or).not.toHaveBeenCalled();
  });

  it('resolves a provider id to the catalog row', async () => {
    mocks.rows = [{ id: UUID, provider: 'youtube', external_id: 'dQw4w9WgXcQ' }];
    const probe = renderResolved('youtube:dQw4w9WgXcQ');
    expect(probe.get().isResolving).toBe(true);
    await waitFor(() => expect(probe.get().trackId).toBe(UUID));
    expect(probe.get().isResolving).toBe(false);
  });

  it('reports an unknown track as resolved-to-nothing, not as still loading', async () => {
    const probe = renderResolved('youtube:dQw4w9WgXcQ');
    await waitFor(() => expect(probe.get().isResolving).toBe(false));
    expect(probe.get().trackId).toBeUndefined();
  });

  it('does nothing for an id it cannot interpret', () => {
    const probe = renderResolved('anon-youtube-x');
    expect(probe.get()).toEqual({ trackId: undefined, isResolving: false });
    expect(mocks.or).not.toHaveBeenCalled();
  });
});
