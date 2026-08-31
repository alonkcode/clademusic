/**
 * Loader for Spotify's embed IFrame API (https://open.spotify.com/embed/iframe-api/v1).
 *
 * Pulled out of SpotifyEmbedPreview so it can be preloaded well before any
 * track is played: creating the API's iframe and waiting for its handshake
 * easily takes over a second on a cold load, and calling `controller.play()`
 * only once that resolves happens far enough from the original click that
 * browsers can (and do) refuse to treat it as user-initiated, leaving Spotify
 * paused until the listener presses its own play button. Fetching the script
 * ahead of time - as soon as the app starts, not on the first Spotify click -
 * means the only work left at click time is creating a controller for the
 * requested track, which is fast enough to stay inside the click's activation
 * window.
 */

export type SpotifyIframeApi = {
  createController: (
    element: HTMLElement,
    options: { uri: string; theme?: number; width?: string; height?: string },
    callback: (controller: SpotifyIframeController) => void
  ) => void;
};

export type SpotifyIframeController = {
  play: () => void;
  pause: () => void;
  togglePlay?: () => void;
  seek?: (seconds: number) => void;
  loadUri?: (uri: string) => void;
  addListener: (event: string, cb: (data: any) => void) => void;
  removeListener?: (event: string, cb?: (data: any) => void) => void;
  setVolume?: (volume: number) => void;
  destroy?: () => void;
};

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void;
    SpotifyIframeApi?: SpotifyIframeApi;
  }
}

const IFRAME_API_URL = 'https://open.spotify.com/embed/iframe-api/v1';
let iframeApiPromise: Promise<SpotifyIframeApi> | null = null;

export function loadSpotifyIframeApi(): Promise<SpotifyIframeApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.SpotifyIframeApi) return Promise.resolve(window.SpotifyIframeApi);
  if (iframeApiPromise) return iframeApiPromise;

  iframeApiPromise = new Promise<SpotifyIframeApi>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Spotify IFrame API load timeout')), 10000);
    window.onSpotifyIframeApiReady = (api) => {
      clearTimeout(timeout);
      window.SpotifyIframeApi = api;
      resolve(api);
    };

    const existing = document.querySelector(`script[src="${IFRAME_API_URL}"]`);
    if (existing) return;

    const script = document.createElement('script');
    script.src = IFRAME_API_URL;
    script.async = true;
    script.onerror = () => {
      iframeApiPromise = null;
      reject(new Error('Failed to load Spotify IFrame API'));
    };
    document.body.appendChild(script);
  });

  return iframeApiPromise;
}

/**
 * Fire-and-forget warmup. Call once, early (app mount) - a failure here just
 * means the first real play falls back to loading it on demand, same as
 * before this existed.
 */
export function preloadSpotifyIframeApi(): void {
  loadSpotifyIframeApi().catch(() => {
    // On-demand load in SpotifyEmbedPreview will retry and surface any error.
  });
}
