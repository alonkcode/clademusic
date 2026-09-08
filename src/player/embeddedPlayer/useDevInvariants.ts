import { useEffect } from 'react';
import { isTestEnv } from '@/lib/env';

/**
 * Dev-only sanity checks for the singleton player invariant: exactly one
 * `[data-player="universal"]` host and at most one provider iframe mounted,
 * plus a title present whenever the player is open. No-ops in production and
 * in tests (React 18 StrictMode's double-mount in the jsdom harness would
 * otherwise trip these).
 */
export function useDevPlayerInvariants(isOpen: boolean, resolvedTitle: string) {
  // Never allow more than one universal player mounted.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isTestEnv) return;
    if (process.env.NODE_ENV === 'production') return;
    const players = document.querySelectorAll('[data-player="universal"]');
    if (players.length > 1) {
      // Prefer not to crash the whole app in dev; log loudly.
      // This typically indicates the player host was mounted twice due to layout/route wiring.
      console.error('Invariant violated: more than one universal player mounted.');
    }
  }, []);

  // Ensure only one iframe/provider instance and metadata present.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isTestEnv) return;
    if (process.env.NODE_ENV === 'production') return;
    const frames = document.querySelectorAll('iframe[src*="spotify"], iframe[src*="youtube"]');
    if (frames.length > 1) {
      console.error('Invariant violated: multiple provider iframes detected.');
    }
    if (isOpen && !resolvedTitle) {
      console.error('Invariant violated: player rendered without title.');
    }
  }, [isOpen, resolvedTitle]);
}
