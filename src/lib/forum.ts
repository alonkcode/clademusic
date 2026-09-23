export type VoteDirection = 'up' | 'down';
export type UserVote = VoteDirection | null;

/** Pressing the arrow that is already active clears the vote. */
export function nextVote(current: UserVote, clicked: VoteDirection): UserVote {
  return current === clicked ? null : clicked;
}

const voteValue = (v: UserVote) => (v === 'up' ? 1 : v === 'down' ? -1 : 0);

export function applyVoteToCount(count: number, current: UserVote, next: UserVote): number {
  return count - voteValue(current) + voteValue(next);
}

/** Votes weighted by age, so a fresh post can outrank an older one with more votes. */
export function hotScore(voteCount: number, createdAt: string, now: number = Date.now()): number {
  const ageHours = Math.max(0, (now - new Date(createdAt).getTime()) / 3_600_000);
  return voteCount / Math.pow(ageHours + 2, 1.5);
}

export interface CommentLike {
  id: string;
  parent_comment_id: string | null;
}

export interface CommentNode<T extends CommentLike> {
  comment: T;
  children: CommentNode<T>[];
  depth: number;
}

/** Nests a flat, chronologically ordered list by parent_comment_id. Orphans become roots. */
export function buildCommentTree<T extends CommentLike>(comments: T[]): CommentNode<T>[] {
  const nodes = new Map<string, CommentNode<T>>();
  for (const comment of comments) nodes.set(comment.id, { comment, children: [], depth: 0 });

  const roots: CommentNode<T>[] = [];
  for (const comment of comments) {
    const node = nodes.get(comment.id)!;
    const parent = comment.parent_comment_id ? nodes.get(comment.parent_comment_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const assignDepth = (list: CommentNode<T>[], depth: number) => {
    for (const node of list) {
      node.depth = depth;
      assignDepth(node.children, depth + 1);
    }
  };
  assignDepth(roots, 0);
  return roots;
}

export const FORUM_NAME_PATTERN = /^[a-z0-9_]{3,21}$/;

export function normalizeForumName(input: string): string {
  return input.trim().toLowerCase();
}

export function timeAgo(dateString: string, now: number = Date.now()): string {
  const date = new Date(dateString);
  const seconds = Math.floor((now - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString();
}
