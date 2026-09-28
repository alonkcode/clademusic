export interface SpotifyFallbackNotice {
  title: string;
  description: string;
}

/**
 * The toast shown when Spotify full-track playback gives up and the player
 * drops to the preview embed. Kept out of the drawer because it is pure copy
 * selection: which words fit which failure, and who is told what.
 */
export function describeSpotifyFallback(reason: string, isAdmin: boolean | undefined): SpotifyFallbackNotice {
  const lower = reason.toLowerCase();
  const isDevModeBlock = lower.includes('403') || lower.includes('developer dashboard');

  const title = isDevModeBlock
    ? 'Spotify app in Development Mode'
    : lower.includes('premium')
      ? 'Spotify Premium required'
      : 'Falling back to Spotify preview';

  // The raw reason tells the LISTENER to go add their own account in the
  // Spotify Developer Dashboard - fine advice for the app's own admin, a dead
  // end for everyone else who has no access to that dashboard.
  const description =
    isDevModeBlock && !isAdmin
      ? "Full-track playback isn't available for this account yet. Playing a preview instead."
      : reason;

  return { title, description };
}
