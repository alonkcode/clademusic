import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * recordPlayHistory() is what makes ProfilePage's Recently Played/Top
 * Artists sections show anything at all - before this, usePlayHistory
 * queried a table (play_history) nothing ever wrote to, so those sections
 * silently never rendered for anyone.
 */

const mocks = vi.hoisted(() => ({
  insertResponse: { data: null as any, error: null as any },
  insert: vi.fn((row: unknown) => Promise.resolve(mocks.insertResponse)),
  authGetUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })),
}));

// recordPlayHistory bails out early under isTestEnv (so other component
// tests that indirectly trigger playback don't make real Supabase calls) -
// exactly the behavior this file needs to get past to test the function's
// actual logic.
vi.mock('@/lib/env', () => ({ isTestEnv: false }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      insert: (row: unknown) => mocks.insert(row),
    })),
    auth: { getUser: mocks.authGetUser },
  },
}));

const { supabase } = await import('@/integrations/supabase/client');
const { recordPlayHistory } = await import('./playEvents');

const VALID_TRACK_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  mocks.insertResponse.data = null;
  mocks.insertResponse.error = null;
  mocks.insert.mockClear();
  mocks.authGetUser.mockClear();
  vi.mocked(supabase.from).mockClear();
});

describe('recordPlayHistory', () => {
  it('inserts a play_history row for a real (UUID) catalog track', async () => {
    await recordPlayHistory(VALID_TRACK_ID, 'player');

    expect(supabase.from).toHaveBeenCalledWith('play_history');
    expect(mocks.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      track_id: VALID_TRACK_ID,
      source: 'player',
    });
  });

  it('does not insert for a non-UUID id (synthetic/off-catalog track)', async () => {
    // track_id is a hard FK to tracks.id - a synthetic id like
    // "spotify:track:xyz" would just fail that constraint.
    await recordPlayHistory('spotify:track:xyz', 'player');

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('does not insert for a signed-out user', async () => {
    mocks.authGetUser.mockResolvedValueOnce({ data: { user: null } });

    await recordPlayHistory(VALID_TRACK_ID, 'player');

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('does not throw when the insert itself fails', async () => {
    mocks.insertResponse.error = { message: 'RLS violation' };

    await expect(recordPlayHistory(VALID_TRACK_ID, 'player')).resolves.toBeUndefined();
  });
});
