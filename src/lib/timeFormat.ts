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
