import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const secondEq = vi.fn();
  const firstEq = vi.fn();
  const del = vi.fn();
  const upsert = vi.fn();
  const from = vi.fn();
  return { secondEq, firstEq, del, upsert, from };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...args: unknown[]) => mocks.from(...args) },
}));

import { castVote } from './forumService';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.secondEq.mockResolvedValue({ error: null });
  mocks.firstEq.mockReturnValue({ eq: mocks.secondEq });
  mocks.del.mockReturnValue({ eq: mocks.firstEq });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.from.mockReturnValue({ delete: mocks.del, upsert: mocks.upsert });
});

describe('castVote', () => {
  it('deletes the vote when the active arrow is pressed again', async () => {
    await castVote({ target: 'post', id: 'p1', userId: 'u1', current: 'up', direction: 'up' });

    expect(mocks.from).toHaveBeenCalledWith('forum_votes');
    expect(mocks.firstEq).toHaveBeenCalledWith('user_id', 'u1');
    expect(mocks.secondEq).toHaveBeenCalledWith('post_id', 'p1');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('upserts on the (user, post) key when setting a first vote', async () => {
    await castVote({ target: 'post', id: 'p1', userId: 'u1', current: null, direction: 'down' });

    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: 'u1', post_id: 'p1', vote_type: 'down' },
      { onConflict: 'user_id,post_id' }
    );
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('upserts (not inserts) when switching direction, so an existing vote is updated', async () => {
    await castVote({ target: 'post', id: 'p1', userId: 'u1', current: 'up', direction: 'down' });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ vote_type: 'down' }),
      { onConflict: 'user_id,post_id' }
    );
  });

  it('keys comment votes on comment_id', async () => {
    await castVote({ target: 'comment', id: 'c1', userId: 'u1', current: null, direction: 'up' });

    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: 'u1', comment_id: 'c1', vote_type: 'up' },
      { onConflict: 'user_id,comment_id' }
    );
  });

  it('throws when the database rejects the vote', async () => {
    mocks.upsert.mockResolvedValue({ error: { message: 'boom' } });

    await expect(
      castVote({ target: 'post', id: 'p1', userId: 'u1', current: null, direction: 'up' })
    ).rejects.toEqual({ message: 'boom' });
  });
});
