export interface TrackComment {
  id: string;
  track_id: string;
  user_id: string;
  comment: string;
  reply_to: string | null;
  likes_count: number;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  user_display_name: string;
  user_avatar_url?: string;
  user_liked: boolean;
}

/**
 * track_comments carries two shapes for the same data (comment/reply_to and the
 * older content/parent_id, kept in step by a trigger), so read either.
 */
export function normalizeComment(row: any, likedIds: ReadonlySet<string>): TrackComment {
  return {
    id: row.id,
    track_id: String(row.track_id),
    user_id: row.user_id,
    comment: row.comment ?? row.content ?? '',
    reply_to: row.reply_to ?? row.parent_id ?? null,
    likes_count: row.likes_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    edited_at: row.edited_at ?? null,
    user_display_name: row.profiles_public?.display_name || 'Anonymous',
    user_avatar_url: row.profiles_public?.avatar_url || undefined,
    user_liked: likedIds.has(row.id),
  };
}

function topAncestorId(comment: TrackComment, byId: Map<string, TrackComment>): string {
  let current = comment;
  const seen = new Set([comment.id]);
  while (current.reply_to) {
    const parent = byId.get(current.reply_to);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current.id;
}

/**
 * Splits a flat, chronological list into top-level comments and their replies.
 * The UI is one level deep, so a reply to a reply is filed under the top-level
 * comment above it; a comment whose parent isn't loaded is shown as top-level
 * rather than vanishing.
 */
export function groupComments(comments: TrackComment[]): {
  roots: TrackComment[];
  repliesByRoot: Map<string, TrackComment[]>;
} {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const roots: TrackComment[] = [];
  const repliesByRoot = new Map<string, TrackComment[]>();

  for (const comment of comments) {
    const rootId = topAncestorId(comment, byId);
    if (rootId === comment.id) {
      roots.push(comment);
    } else {
      const replies = repliesByRoot.get(rootId) ?? [];
      replies.push(comment);
      repliesByRoot.set(rootId, replies);
    }
  }

  return { roots, repliesByRoot };
}

/** The optimistic result of pressing the heart: flips the state and moves the count by one. */
export function applyLikeToggle(
  comments: TrackComment[],
  commentId: string,
  currentlyLiked: boolean
): TrackComment[] {
  return comments.map((c) =>
    c.id === commentId
      ? {
          ...c,
          user_liked: !currentlyLiked,
          likes_count: Math.max(0, c.likes_count + (currentlyLiked ? -1 : 1)),
        }
      : c
  );
}
