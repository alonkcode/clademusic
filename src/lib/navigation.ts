/**
 * Navigation Utilities
 * 
 * Centralized navigation helpers for consistent routing
 */

import type { NavigateFunction } from 'react-router-dom';

/**
 * Navigate to track detail page with proper ID encoding
 */
export function navigateToTrack(navigate: NavigateFunction, trackId: string) {
  navigate(`/track/${encodeURIComponent(trackId)}`);
}

/**
 * Navigate to artist page with proper ID encoding.
 *
 * ArtistPage has no real per-artist data source wired up yet, so it can only
 * show what it's told - pass along whatever the caller already has (name,
 * cover art) via router state so the page shows the right artist instead of
 * its hardcoded placeholder.
 */
export function navigateToArtist(
  navigate: NavigateFunction,
  artistId: string,
  state?: { name?: string; coverUrl?: string | null }
) {
  navigate(`/artist/${encodeURIComponent(artistId)}`, state ? { state } : undefined);
}

/**
 * Navigate to album page with proper ID encoding
 */
export function navigateToAlbum(navigate: NavigateFunction, albumId: string) {
  navigate(`/album/${encodeURIComponent(albumId)}`);
}

/**
 * Get track detail URL with proper encoding
 */
export function getTrackUrl(trackId: string): string {
  return `/track/${encodeURIComponent(trackId)}`;
}

/**
 * Get artist URL with proper encoding
 */
export function getArtistUrl(artistId: string): string {
  return `/artist/${encodeURIComponent(artistId)}`;
}

/**
 * Get album URL with proper encoding
 */
export function getAlbumUrl(albumId: string): string {
  return `/album/${encodeURIComponent(albumId)}`;
}
