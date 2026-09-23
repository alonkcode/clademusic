import { describe, it, expect } from 'vitest';
import { applyLikeToggle, groupComments, normalizeComment, type TrackComment } from './trackComments';

const c = (id: string, reply_to: string | null = null, over: Partial<TrackComment> = {}): TrackComment => ({
  id,
  track_id: 't1',
  user_id: 'u1',
  comment: `comment ${id}`,
  reply_to,
  likes_count: 0,
  created_at: '2026-09-23T12:00:00Z',
  updated_at: '2026-09-23T12:00:00Z',
  edited_at: null,
  user_display_name: 'Alex',
  user_liked: false,
  ...over,
});

const ids = (list: TrackComment[] | undefined) => (list ?? []).map((x) => x.id);

describe('normalizeComment', () => {
  const none = new Set<string>();

  it('reads the comment / reply_to shape', () => {
    const n = normalizeComment({ id: 'a', track_id: 't', user_id: 'u', comment: 'hi', reply_to: 'p', created_at: 'x' }, none);
    expect(n.comment).toBe('hi');
    expect(n.reply_to).toBe('p');
  });

  it('falls back to the older content / parent_id shape', () => {
    const n = normalizeComment({ id: 'a', track_id: 't', user_id: 'u', content: 'old', parent_id: 'p', created_at: 'x' }, none);
    expect(n.comment).toBe('old');
    expect(n.reply_to).toBe('p');
  });

  it('prefers comment over content when both exist', () => {
    const n = normalizeComment({ id: 'a', track_id: 't', user_id: 'u', comment: 'new', content: 'stale', created_at: 'x' }, none);
    expect(n.comment).toBe('new');
  });

  it('names the author from the public profile, or Anonymous without one', () => {
    const named = normalizeComment({ id: 'a', track_id: 't', user_id: 'u', comment: '', created_at: 'x', profiles_public: { display_name: 'Sam', avatar_url: 'a.png' } }, none);
    expect(named.user_display_name).toBe('Sam');
    expect(named.user_avatar_url).toBe('a.png');
    expect(normalizeComment({ id: 'a', track_id: 't', user_id: 'u', comment: '', created_at: 'x' }, none).user_display_name).toBe('Anonymous');
  });

  it('marks the comments the signed-in user has liked', () => {
    const liked = new Set(['a']);
    expect(normalizeComment({ id: 'a', track_id: 't', user_id: 'u', comment: '', created_at: 'x' }, liked).user_liked).toBe(true);
    expect(normalizeComment({ id: 'b', track_id: 't', user_id: 'u', comment: '', created_at: 'x' }, liked).user_liked).toBe(false);
  });

  it('defaults missing counts and dates', () => {
    const n = normalizeComment({ id: 'a', track_id: 5, user_id: 'u', comment: '', created_at: 'made' }, none);
    expect(n.track_id).toBe('5');
    expect(n.likes_count).toBe(0);
    expect(n.updated_at).toBe('made');
    expect(n.edited_at).toBeNull();
  });
});

describe('groupComments', () => {
  it('keeps replies out of the top-level list and groups them under their parent', () => {
    const { roots, repliesByRoot } = groupComments([c('a'), c('r1', 'a'), c('b'), c('r2', 'a')]);

    expect(ids(roots)).toEqual(['a', 'b']);
    expect(ids(repliesByRoot.get('a'))).toEqual(['r1', 'r2']);
    expect(repliesByRoot.has('b')).toBe(false);
  });

  it('files a reply to a reply under the top-level comment', () => {
    const { roots, repliesByRoot } = groupComments([c('a'), c('r1', 'a'), c('r2', 'r1')]);

    expect(ids(roots)).toEqual(['a']);
    expect(ids(repliesByRoot.get('a'))).toEqual(['r1', 'r2']);
  });

  it('shows a comment whose parent is not loaded as top-level instead of dropping it', () => {
    const { roots } = groupComments([c('a'), c('orphan', 'missing')]);
    expect(ids(roots)).toEqual(['a', 'orphan']);
  });

  it('does not loop on a self-parented or cyclic comment', () => {
    expect(ids(groupComments([c('a', 'a')]).roots)).toEqual(['a']);

    const cyc = groupComments([c('a', 'b'), c('b', 'a')]);
    expect(cyc.roots.length + [...cyc.repliesByRoot.values()].flat().length).toBe(2);
  });

  it('returns nothing for no comments', () => {
    const { roots, repliesByRoot } = groupComments([]);
    expect(roots).toEqual([]);
    expect(repliesByRoot.size).toBe(0);
  });
});

describe('applyLikeToggle', () => {
  it('likes: sets the flag and adds one', () => {
    const [a] = applyLikeToggle([c('a', null, { likes_count: 2 })], 'a', false);
    expect(a.user_liked).toBe(true);
    expect(a.likes_count).toBe(3);
  });

  it('unlikes: clears the flag and removes one, never below zero', () => {
    const [a] = applyLikeToggle([c('a', null, { likes_count: 1, user_liked: true })], 'a', true);
    expect(a.user_liked).toBe(false);
    expect(a.likes_count).toBe(0);

    const [b] = applyLikeToggle([c('b', null, { likes_count: 0, user_liked: true })], 'b', true);
    expect(b.likes_count).toBe(0);
  });

  it('leaves every other comment untouched', () => {
    const list = [c('a'), c('b')];
    const out = applyLikeToggle(list, 'a', false);
    expect(out[1]).toBe(list[1]);
  });
});
