import { describe, it, expect } from 'vitest';
import {
  applyVoteToCount,
  buildCommentTree,
  FORUM_NAME_PATTERN,
  hotScore,
  nextVote,
  normalizeForumName,
} from './forum';

describe('nextVote', () => {
  it('sets a vote when none is active', () => {
    expect(nextVote(null, 'up')).toBe('up');
    expect(nextVote(null, 'down')).toBe('down');
  });

  it('clears the vote when the active arrow is pressed again', () => {
    expect(nextVote('up', 'up')).toBeNull();
    expect(nextVote('down', 'down')).toBeNull();
  });

  it('switches direction when the opposite arrow is pressed', () => {
    expect(nextVote('up', 'down')).toBe('down');
    expect(nextVote('down', 'up')).toBe('up');
  });
});

describe('applyVoteToCount', () => {
  it('moves the count by one when adding or removing a vote', () => {
    expect(applyVoteToCount(5, null, 'up')).toBe(6);
    expect(applyVoteToCount(5, null, 'down')).toBe(4);
    expect(applyVoteToCount(5, 'up', null)).toBe(4);
    expect(applyVoteToCount(5, 'down', null)).toBe(6);
  });

  it('moves the count by two when flipping direction', () => {
    expect(applyVoteToCount(5, 'up', 'down')).toBe(3);
    expect(applyVoteToCount(5, 'down', 'up')).toBe(7);
  });
});

describe('hotScore', () => {
  const now = Date.parse('2026-09-23T12:00:00Z');

  it('ranks a fresh post above an older one with the same votes', () => {
    const fresh = hotScore(10, '2026-09-23T11:00:00Z', now);
    const stale = hotScore(10, '2026-09-20T11:00:00Z', now);
    expect(fresh).toBeGreaterThan(stale);
  });

  it('lets a much higher vote count outweigh a small age gap', () => {
    const popular = hotScore(200, '2026-09-23T06:00:00Z', now);
    const quiet = hotScore(2, '2026-09-23T11:00:00Z', now);
    expect(popular).toBeGreaterThan(quiet);
  });

  it('does not blow up on a future timestamp', () => {
    expect(Number.isFinite(hotScore(3, '2026-09-24T00:00:00Z', now))).toBe(true);
  });
});

describe('buildCommentTree', () => {
  const c = (id: string, parent: string | null = null) => ({ id, parent_comment_id: parent });

  it('nests replies under their parent and records depth', () => {
    const tree = buildCommentTree([c('a'), c('b', 'a'), c('c', 'b'), c('d')]);

    expect(tree.map((n) => n.comment.id)).toEqual(['a', 'd']);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].comment.id).toBe('b');
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children[0].comment.id).toBe('c');
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it('preserves input order among siblings', () => {
    const tree = buildCommentTree([c('a'), c('x', 'a'), c('y', 'a'), c('z', 'a')]);
    expect(tree[0].children.map((n) => n.comment.id)).toEqual(['x', 'y', 'z']);
  });

  it('promotes a comment whose parent is missing to a root', () => {
    const tree = buildCommentTree([c('a'), c('b', 'ghost')]);
    expect(tree.map((n) => n.comment.id)).toEqual(['a', 'b']);
  });

  it('treats a self-parented comment as a root instead of looping', () => {
    const tree = buildCommentTree([c('a', 'a')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(0);
  });

  it('returns an empty tree for no comments', () => {
    expect(buildCommentTree([])).toEqual([]);
  });
});

describe('forum names', () => {
  it('normalises case and surrounding whitespace', () => {
    expect(normalizeForumName('  Jazz_Fans ')).toBe('jazz_fans');
  });

  it('accepts 3-21 lowercase letters, digits and underscores', () => {
    expect(FORUM_NAME_PATTERN.test('jazz')).toBe(true);
    expect(FORUM_NAME_PATTERN.test('a_1')).toBe(true);
    expect(FORUM_NAME_PATTERN.test('x'.repeat(21))).toBe(true);
  });

  it('rejects names that are too short, too long, or contain other characters', () => {
    expect(FORUM_NAME_PATTERN.test('ab')).toBe(false);
    expect(FORUM_NAME_PATTERN.test('x'.repeat(22))).toBe(false);
    expect(FORUM_NAME_PATTERN.test('has space')).toBe(false);
    expect(FORUM_NAME_PATTERN.test('dash-ed')).toBe(false);
    expect(FORUM_NAME_PATTERN.test('Upper')).toBe(false);
  });
});
