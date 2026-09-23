import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Bell } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from '@/hooks/api/useNotifications';
import { notificationLink, notificationText, type NotificationItem } from '@/lib/notifications';

interface NotificationListProps {
  /** Called after a row is opened, e.g. to close the sheet it's shown in. */
  onNavigate?: () => void;
  className?: string;
}

export function NotificationList({ onNavigate, className }: NotificationListProps) {
  const navigate = useNavigate();
  const { data: notifications = [], isLoading, isError } = useNotifications();
  const { data: unread = 0 } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const open = (n: NotificationItem) => {
    if (!n.read_at) markRead.mutate(n.id);
    const link = notificationLink(n);
    onNavigate?.();
    if (link) navigate(link);
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {unread > 0 && (
        <div className="flex justify-end border-b border-border px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Mark all as read
          </Button>
        </div>
      )}

      {/* The docked player is fixed over the bottom of the viewport; without
          this clearance the last rows scroll underneath it. */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: 'calc(var(--clade-player-height, 0px) + env(safe-area-inset-bottom))' }}
      >
        {isLoading ? (
          <div className="py-10 text-center">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-current border-r-transparent" />
          </div>
        ) : isError ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Notifications couldn't be loaded right now.
          </p>
        ) : notifications.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Bell className="mx-auto mb-3 h-10 w-10 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              Nothing yet. Replies, likes and new followers will show up here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60',
                    !n.read_at && 'bg-accent/10'
                  )}
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={n.actor?.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                      {n.actor?.display_name?.[0]?.toUpperCase() || '?'}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{notificationText(n)}</p>
                    {n.data?.snippet && (
                      <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
                        {n.data.snippet}
                      </p>
                    )}
                    {n.data?.post_title && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {n.data.forum ? `f/${n.data.forum} · ` : ''}
                        {n.data.post_title}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>

                  {!n.read_at && (
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                      aria-label="Unread"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
