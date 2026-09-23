import { useNotificationsRealtime } from '@/hooks/api/useNotifications';

/** Mount once, inside the auth and query providers, so alerts arrive on any page. */
export function NotificationsRealtimeBridge() {
  useNotificationsRealtime();
  return null;
}
