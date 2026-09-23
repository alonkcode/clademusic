import { supabase } from '@/integrations/supabase/client';
import { hotScore, type UserVote, type VoteDirection } from '@/lib/forum';

export type ForumSort = 'hot' | 'new' | 'top';

export interface Forum {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  icon_url?: string | null;
  member_count: number;
  post_count: number;
  category: string;
}

export interface ForumAuthor {
  display_name: string | null;
  avatar_url: string | null;
}

export interface ForumPost {
  id: string;
  forum_id: string;
  user_id: string | null;
  title: string;
  content: string | null;
  vote_count: number;
  comment_count: number;
  is_locked?: boolean | null;
  created_at: string;
  user: ForumAuthor | null;
  forum: { name: string; display_name: string };
  user_vote: UserVote;
}

export interface ForumComment {
  id: string;
  post_id: string;
  parent_comment_id: string | null;
  user_id: string | null;
  content: string;
  vote_count: number;
  is_deleted: boolean;
  created_at: string;
  edited_at: string | null;
  user: ForumAuthor | null;
  user_vote: UserVote;
}

// Authors are read through profiles_public: profiles' own RLS only lets a user
// read their own row, so embedding it made every other author "Anonymous".
const POST_SELECT = '*, user:profiles_public(display_name, avatar_url), forum:forums!forum_id(name, display_name)';
const COMMENT_SELECT = '*, user:profiles_public(display_name, avatar_url)';

const HOT_POOL = 100;
const PAGE_SIZE = 50;

type VoteTarget = 'post' | 'comment';

const voteColumn = (target: VoteTarget) => (target === 'post' ? 'post_id' : 'comment_id');

async function fetchMyVotes(
  userId: string | undefined,
  target: VoteTarget,
  ids: string[]
): Promise<Map<string, VoteDirection>> {
  const votes = new Map<string, VoteDirection>();
  if (!userId || ids.length === 0) return votes;

  const column = voteColumn(target);
  const { data, error } = await supabase
    .from('forum_votes')
    .select(`${column}, vote_type`)
    .eq('user_id', userId)
    .in(column, ids);
  // Vote state is a decoration on the list; a failure here shouldn't blank it.
  if (error) {
    console.warn('[forumService] could not load your votes:', error.message ?? error);
    return votes;
  }

  for (const row of data ?? []) votes.set(row[column], row.vote_type);
  return votes;
}

export async function listForums(limit = 50): Promise<Forum[]> {
  const { data, error } = await supabase
    .from('forums')
    .select('*')
    .order('member_count', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Forum[];
}

export async function getForumByName(name: string): Promise<Forum | null> {
  const { data, error } = await supabase.from('forums').select('*').eq('name', name).maybeSingle();
  if (error) throw error;
  return (data as Forum | null) ?? null;
}

export async function listPosts(options: {
  sort: ForumSort;
  forumId?: string;
  userId?: string;
}): Promise<ForumPost[]> {
  const { sort, forumId, userId } = options;

  let query = supabase.from('forum_posts').select(POST_SELECT);
  if (forumId) query = query.eq('forum_id', forumId);

  if (sort === 'top') {
    query = query.order('vote_count', { ascending: false }).order('created_at', { ascending: false }).limit(PAGE_SIZE);
  } else {
    // 'hot' ranks a recent window client-side, since it depends on age.
    query = query.order('created_at', { ascending: false }).limit(sort === 'hot' ? HOT_POOL : PAGE_SIZE);
  }

  const { data, error } = await query;
  if (error) throw error;

  let posts = (data ?? []) as ForumPost[];
  if (sort === 'hot') {
    const now = Date.now();
    posts = [...posts]
      .sort((a, b) => hotScore(b.vote_count, b.created_at, now) - hotScore(a.vote_count, a.created_at, now))
      .slice(0, PAGE_SIZE);
  }

  const votes = await fetchMyVotes(userId, 'post', posts.map((p) => p.id));
  return posts.map((p) => ({ ...p, user_vote: votes.get(p.id) ?? null }));
}

export async function getPost(postId: string, userId?: string): Promise<ForumPost | null> {
  const { data, error } = await supabase.from('forum_posts').select(POST_SELECT).eq('id', postId).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const votes = await fetchMyVotes(userId, 'post', [postId]);
  return { ...(data as ForumPost), user_vote: votes.get(postId) ?? null };
}

export async function createPost(input: {
  forumId: string;
  userId: string;
  title: string;
  content?: string;
}): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('forum_posts')
    .insert({
      forum_id: input.forumId,
      user_id: input.userId,
      title: input.title.trim(),
      content: input.content?.trim() || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function createForum(input: {
  userId: string;
  name: string;
  displayName: string;
  description?: string;
  category: string;
}): Promise<Forum> {
  const { data, error } = await supabase
    .from('forums')
    .insert({
      name: input.name,
      display_name: input.displayName.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      created_by: input.userId,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Forum;
}

export async function listMyMemberships(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('forum_members').select('forum_id').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map((row: { forum_id: string }) => row.forum_id);
}

export async function joinForum(forumId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('forum_members').insert({ forum_id: forumId, user_id: userId });
  // 23505: already a member - joining twice is a no-op, not a failure.
  if (error && (error as { code?: string }).code !== '23505') throw error;
}

export async function leaveForum(forumId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('forum_members').delete().eq('forum_id', forumId).eq('user_id', userId);
  if (error) throw error;
}

export async function listPostComments(postId: string, userId?: string): Promise<ForumComment[]> {
  const { data, error } = await supabase
    .from('forum_comments')
    .select(COMMENT_SELECT)
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;

  const comments = (data ?? []) as ForumComment[];
  const votes = await fetchMyVotes(userId, 'comment', comments.map((c) => c.id));
  return comments.map((c) => ({ ...c, user_vote: votes.get(c.id) ?? null }));
}

export async function addPostComment(input: {
  postId: string;
  userId: string;
  content: string;
  parentId?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('forum_comments').insert({
    post_id: input.postId,
    user_id: input.userId,
    parent_comment_id: input.parentId ?? null,
    content: input.content.trim(),
  });
  if (error) throw error;
}

// A hard delete would cascade to every reply beneath the comment.
export async function softDeleteComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from('forum_comments')
    .update({ is_deleted: true, content: '[deleted]' })
    .eq('id', commentId);
  if (error) throw error;
}

/**
 * Sets, switches or clears the signed-in user's vote. `current` is the vote the
 * user has now; pressing the same arrow again clears it (a delete).
 */
export async function castVote(input: {
  target: VoteTarget;
  id: string;
  userId: string;
  current: UserVote;
  direction: VoteDirection;
}): Promise<void> {
  const column = voteColumn(input.target);

  if (input.current === input.direction) {
    const { error } = await supabase
      .from('forum_votes')
      .delete()
      .eq('user_id', input.userId)
      .eq(column, input.id);
    if (error) throw error;
    return;
  }

  // Without onConflict, upsert conflicts on the primary key only, so changing
  // an existing vote hit the (user_id, post_id) unique key and errored.
  const { error } = await supabase
    .from('forum_votes')
    .upsert(
      { user_id: input.userId, [column]: input.id, vote_type: input.direction },
      { onConflict: `user_id,${column}` }
    );
  if (error) throw error;
}
