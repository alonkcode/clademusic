import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * connectLastFm/getLastFmUsername/disconnectLastFm all called `supabase.*`
 * without ever importing it - a plain ReferenceError on the very first real
 * connect attempt (the Last.fm lookup itself is a public, unauthenticated
 * fetch, so it never got far enough to hit that in manual testing). These
 * exercise the fixed import by actually calling through to the mocked
 * client, so a regression here fails loudly instead of only in production.
 */

const mocks = vi.hoisted(() => ({
  upsertResponse: { data: null as any, error: null as any },
  selectResponse: { data: null as any, error: null as any },
  deleteResponse: { data: null as any, error: null as any },
  authUpdateUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })),
  authGetUser: vi.fn(async () => ({ data: { user: null }, error: null })),
}));

vi.mock('@/integrations/supabase/client', () => {
  const chain: any = {
    upsert: vi.fn(() => Promise.resolve(mocks.upsertResponse)),
    select: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(mocks.selectResponse)),
    // supabase-js query builders are themselves thenable - delete().eq().eq()
    // is awaited directly with no terminal call, unlike select()/upsert().
    then: (resolve: (v: unknown) => void) => resolve(mocks.deleteResponse),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      auth: {
        updateUser: mocks.authUpdateUser,
        getUser: mocks.authGetUser,
      },
    },
  };
});

const { supabase } = await import('@/integrations/supabase/client');
const { connectLastFm, getLastFmUsername, disconnectLastFm } = await import('./lastfmService');

function mockLastFmUserFound(username: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ user: { name: username, playcount: '100' } }), { status: 200 })
    )
  );
}

function mockLastFmUserNotFound() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ error: 6, message: 'User not found' }), { status: 200 }))
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_LASTFM_API_KEY', 'test-key');
  mocks.upsertResponse.data = null;
  mocks.upsertResponse.error = null;
  mocks.selectResponse.data = null;
  mocks.selectResponse.error = null;
  mocks.deleteResponse.data = null;
  mocks.deleteResponse.error = null;
  mocks.authUpdateUser.mockClear();
  mocks.authGetUser.mockClear();
  vi.mocked(supabase.from).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('connectLastFm', () => {
  it('stores the username in user_providers when the lookup succeeds', async () => {
    mockLastFmUserFound('realuser');

    await connectLastFm('user-1', '@realuser');

    expect(supabase.from).toHaveBeenCalledWith('user_providers');
    const chain = vi.mocked(supabase.from).mock.results[0].value;
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', provider: 'lastfm', provider_user_id: 'realuser' }),
      expect.objectContaining({ onConflict: 'user_id,provider' })
    );
    expect(mocks.authUpdateUser).not.toHaveBeenCalled();
  });

  it('falls back to auth metadata when the user_providers write is rejected', async () => {
    mockLastFmUserFound('realuser');
    mocks.upsertResponse.error = { message: 'RLS violation' };

    await connectLastFm('user-1', 'realuser');

    expect(mocks.authUpdateUser).toHaveBeenCalledWith({ data: { lastfm_username: 'realuser' } });
  });

  it('rejects an unknown username without ever touching supabase', async () => {
    mockLastFmUserNotFound();

    await expect(connectLastFm('user-1', 'nobody')).rejects.toThrow(/username not found/i);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe('getLastFmUsername', () => {
  it('returns the stored username from user_providers', async () => {
    mocks.selectResponse.data = { provider_user_id: 'realuser' };

    await expect(getLastFmUsername('user-1')).resolves.toBe('realuser');
    expect(mocks.authGetUser).not.toHaveBeenCalled();
  });

  it('falls back to auth metadata when not in user_providers', async () => {
    mocks.selectResponse.data = null;
    mocks.authGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', user_metadata: { lastfm_username: 'metauser' } } },
      error: null,
    });

    await expect(getLastFmUsername('user-1')).resolves.toBe('metauser');
  });

  it('returns null when Last.fm was never connected', async () => {
    mocks.selectResponse.data = null;
    mocks.authGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    await expect(getLastFmUsername('user-1')).resolves.toBeNull();
  });
});

describe('disconnectLastFm', () => {
  it('deletes the user_providers row and clears the auth metadata', async () => {
    await disconnectLastFm('user-1');

    expect(supabase.from).toHaveBeenCalledWith('user_providers');
    expect(mocks.authUpdateUser).toHaveBeenCalledWith({ data: { lastfm_username: null } });
  });

  it('throws when clearing the auth metadata fails', async () => {
    mocks.authUpdateUser.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    await expect(disconnectLastFm('user-1')).rejects.toThrow(/failed to disconnect/i);
  });
});
