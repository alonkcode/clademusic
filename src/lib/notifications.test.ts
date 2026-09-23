import { describe, it, expect } from 'vitest';
import { notificationLink, notificationText, type NotificationRow } from './notifications';

const actor = (display_name: string | null) => ({ display_name, avatar_url: null });

const row = (over: Partial<NotificationRow>): NotificationRow => ({
  id: 'n1',
  user_id: 'me',
  actor_id: 'them',
  type: 'follow',
  track_id: null,
  forum_post_id: null,
  comment_id: null,
  data: null,
  read_at: null,
  created_at: '2026-09-23T12:00:00Z',
  ...over,
});

describe('notificationText', () => {
  it('names the actor for each type', () => {
    const a = actor('Alex');
    expect(notificationText({ type: 'follow', comment_id: null, actor: a })).toBe('Alex started following you');
    expect(notificationText({ type: 'comment_reply', comment_id: null, actor: a })).toBe('Alex replied to your comment');
    expect(notificationText({ type: 'forum_reply', comment_id: null, actor: a })).toBe('Alex replied to your comment');
    expect(notificationText({ type: 'comment_like', comment_id: null, actor: a })).toBe('Alex liked your comment');
    expect(notificationText({ type: 'forum_post_comment', comment_id: null, actor: a })).toBe('Alex commented on your post');
    expect(notificationText({ type: 'chat_reply', comment_id: null, actor: a })).toBe('Alex replied to your message');
  });

  it('distinguishes an upvoted comment from an upvoted post', () => {
    const a = actor('Alex');
    expect(notificationText({ type: 'forum_upvote', comment_id: 'c1', actor: a })).toBe('Alex upvoted your comment');
    expect(notificationText({ type: 'forum_upvote', comment_id: null, actor: a })).toBe('Alex upvoted your post');
  });

  it('falls back to "Someone" when the actor is unknown or unnamed', () => {
    expect(notificationText({ type: 'follow', comment_id: null, actor: null })).toBe('Someone started following you');
    expect(notificationText({ type: 'follow', comment_id: null, actor: actor(null) })).toBe('Someone started following you');
    expect(notificationText({ type: 'follow', comment_id: null, actor: actor('  ') })).toBe('Someone started following you');
  });
});

describe('notificationLink', () => {
  it('sends a follow to the following page', () => {
    expect(notificationLink(row({ type: 'follow' }))).toBe('/following');
  });

  it('sends track comment activity to the track', () => {
    expect(notificationLink(row({ type: 'comment_reply', track_id: 't1' }))).toBe('/track/t1');
    expect(notificationLink(row({ type: 'comment_like', track_id: 't1' }))).toBe('/track/t1');
  });

  it('has nowhere to go for a track comment with no track', () => {
    expect(notificationLink(row({ type: 'comment_reply', track_id: null }))).toBeNull();
  });

  it('sends forum activity to the post, or the forum index without one', () => {
    expect(notificationLink(row({ type: 'forum_reply', forum_post_id: 'p1' }))).toBe('/forum/post/p1');
    expect(notificationLink(row({ type: 'forum_upvote', forum_post_id: 'p1' }))).toBe('/forum/post/p1');
    expect(notificationLink(row({ type: 'forum_post_comment', forum_post_id: null }))).toBe('/forum');
  });

  it('sends a track-room chat reply to the track and any other to global chat', () => {
    expect(notificationLink(row({ type: 'chat_reply', track_id: 't1', data: { room_type: 'track' } }))).toBe('/track/t1');
    expect(notificationLink(row({ type: 'chat_reply', data: { room_type: 'global' } }))).toBe('/chat');
    expect(notificationLink(row({ type: 'chat_reply', track_id: 't1', data: { room_type: 'global' } }))).toBe('/chat');
  });
});
