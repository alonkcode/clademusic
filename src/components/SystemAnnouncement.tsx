import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useSetting } from '@/hooks/useSystemSettings';

const TOAST_ID = 'system-announcement';
const DISMISSED_KEY = 'clade-dismissed-announcement';

const readDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
};

const rememberDismissed = (text: string) => {
  try {
    sessionStorage.setItem(DISMISSED_KEY, text);
  } catch {
    // Storage blocked: the notice just shows again on the next page load.
  }
};

/**
 * Shows pref.announcement as a persistent toast until it is dismissed. Riding
 * on the existing toaster means it can't collide with the fixed nav, hamburger
 * or docked player the way an in-flow banner would. Dismissal is remembered
 * per text for the session, so editing the announcement shows it again.
 */
export function SystemAnnouncement() {
  const announcement = useSetting('pref.announcement').trim();
  const shown = useRef(false);

  useEffect(() => {
    if (!announcement || readDismissed() === announcement) {
      // Only take down a toast this component put up (e.g. the admin cleared
      // the text while it was showing).
      if (shown.current) toast.dismiss(TOAST_ID);
      shown.current = false;
      return;
    }

    shown.current = true;

    // Re-using the id updates the toast in place when the text changes. No
    // cleanup dismiss on purpose: a programmatic dismiss also fires onDismiss,
    // which would record a dismissal the user never made (StrictMode's
    // double-mount in dev would hide the announcement that way).
    toast.info(announcement, {
      id: TOAST_ID,
      duration: Infinity,
      closeButton: true,
      onDismiss: () => rememberDismissed(announcement),
    });
  }, [announcement]);

  return null;
}
