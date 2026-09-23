import { useState } from 'react';
import { Bell } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useAuth } from '@/hooks/useAuth';
import { useUnreadNotificationCount } from '@/hooks/api/useNotifications';
import { cn } from '@/lib/utils';
import { NotificationList } from './NotificationList';

export function NotificationBell({ className }: { className?: string }) {
  const { user } = useAuth();
  const { data: unread = 0, isError } = useUnreadNotificationCount();
  const [open, setOpen] = useState(false);

  // No bell rather than a broken one: the count fails to load when the
  // notifications table isn't there (or the network is down).
  if (!user || isError) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className={cn(
            'relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/60 transition hover:bg-background/80',
            className
          )}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription className="sr-only">Replies, likes and follows on your activity.</SheetDescription>
        </SheetHeader>
        <NotificationList onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
