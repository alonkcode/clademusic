export type NotificationType =
  | 'follow'
  | 'comment_reply'
  | 'comment_like'
  | 'forum_post_comment'
  | 'forum_reply'
  | 'forum_upvote'
  | 'chat_reply';

export interface NotificationData {
  snippet?: string | null;
  post_title?: string | null;
  forum?: string | null;
  room_type?: string | null;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: NotificationType;
  track_id: string | null;
  forum_post_id: string | null;
  comment_id: string | null;
  data: NotificationData | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationActor {
  display_name: string | null;
  avatar_url: string | null;
}

export interface NotificationItem extends NotificationRow {
  actor: NotificationActor | null;
}

/** e.g. "Alex replied to your comment". */
export function notificationText(n: Pick<NotificationItem, 'type' | 'comment_id' | 'actor'>): string {
  const name = n.actor?.display_name?.trim() || 'Someone';

  switch (n.type) {
    case 'follow':
      return `${name} started following you`;
    case 'comment_reply':
    case 'forum_reply':
      return `${name} replied to your comment`;
    case 'comment_like':
      return `${name} liked your comment`;
    case 'forum_post_comment':
      return `${name} commented on your post`;
    case 'forum_upvote':
      return n.comment_id ? `${name} upvoted your comment` : `${name} upvoted your post`;
    case 'chat_reply':
      return `${name} replied to your message`;
    default:
      return `${name} interacted with you`;
  }
}

/** Where tapping a notification should go, or null if there's nowhere useful. */
export function notificationLink(
  n: Pick<NotificationRow, 'type' | 'track_id' | 'forum_post_id' | 'data'>
): string | null {
  switch (n.type) {
    // There is no public profile page yet; Following is the closest social page.
    case 'follow':
      return '/following';
    case 'comment_reply':
    case 'comment_like':
      return n.track_id ? `/track/${n.track_id}` : null;
    case 'forum_post_comment':
    case 'forum_reply':
    case 'forum_upvote':
      return n.forum_post_id ? `/forum/post/${n.forum_post_id}` : '/forum';
    case 'chat_reply':
      return n.data?.room_type === 'track' && n.track_id ? `/track/${n.track_id}` : '/chat';
    default:
      return null;
  }
}
