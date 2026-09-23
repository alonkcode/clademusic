import { Link } from 'react-router-dom';
import { PageLayout } from '@/components/shared';
import { useAuth } from '@/hooks/useAuth';
import { NotificationList } from '@/components/notifications/NotificationList';

export default function NotificationsPage() {
  const { user, loading } = useAuth();

  return (
    <PageLayout title="Activity">
      <div className="mx-auto flex max-w-2xl flex-col overflow-hidden rounded-xl border border-border">
        {loading ? null : user ? (
          <NotificationList />
        ) : (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            <Link to="/auth" className="text-primary underline">
              Sign in
            </Link>{' '}
            to see replies, likes and new followers.
          </p>
        )}
      </div>
    </PageLayout>
  );
}
