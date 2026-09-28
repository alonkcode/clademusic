/**
 * Time Formatting Utilities
 * 
 * Centralized time/duration formatting functions used across the app
 */

/**
 * Format milliseconds to MM:SS
 */
export function formatTime(ms: number, includeMilliseconds = false): string {
  const value = Math.max(0, ms);
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor(value % 1000);

  if (!includeMilliseconds) {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

/**
 * Format seconds to MM:SS
 */
export function formatTimeFromSeconds(seconds: number, includeMilliseconds = false): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);

  if (!includeMilliseconds) {
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  return `${mins}:${secs.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

/**
 * Format milliseconds to compact duration (e.g., "3m 45s" or "45s")
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format milliseconds to full MM:SS format
 */
export function formatDurationFull(ms: number): string {
  return formatTime(ms);
}

/**
 * Read a typed timecode back into milliseconds.
 *
 * Accepts what {@link formatTime} writes and the shorter forms people type:
 * `1:23.456`, `1:23`, `23.4`, `83` (a bare number is seconds), with an
 * optional hours field. The fraction is a fraction of a second, so `.4` is
 * 400ms and `.456` is 456ms - the same reading either way round.
 *
 * Returns null for anything that is not a time, so a half-typed value can be
 * left alone rather than snapped to a number nobody asked for.
 */
export function parseTimecode(input: string): number | null {
  const parts = input.trim().split(':');
  if (parts.length > 3) return null;

  const seconds = parts.pop();
  if (seconds === undefined || !/^\d+(\.\d+)?$/.test(seconds)) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;

  const minutes = parts.length > 0 ? Number(parts[parts.length - 1]) : 0;
  const hours = parts.length > 1 ? Number(parts[0]) : 0;

  return Math.round((hours * 3600 + minutes * 60 + Number(seconds)) * 1000);
}
