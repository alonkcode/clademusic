/**
 * A continuous estimate of where playback is, for timestamping detected chords.
 *
 * Live detection samples the audio every 120ms, but the player only learns the
 * track position when the provider relays it: every 500ms for Spotify Premium,
 * and never at all for the guest Spotify embed. Timestamping frames with that
 * raw position quantized every chord to half-second steps on Premium, and on
 * the guest embed gave every frame the same frozen time - so every chord span
 * came out zero-length and a whole capture produced nothing that could be
 * saved, while the live readout carried on looking as if it worked.
 *
 * This interpolates between reports with the wall clock instead. It is kept
 * monotonic during playback on purpose: re-anchoring on every report would
 * snap time backwards whenever a report lagged slightly, which ChordTimeline
 * would read as the listener seeking and split the timeline apart at every
 * poll. So small disagreements are ignored and only a real jump - a seek, a
 * pause, a genuine drift - moves the anchor.
 */

/**
 * Disagreement between a report and the running estimate that is treated as
 * a real jump rather than reporting jitter. Polling latency and a lagging
 * provider position stay well under this; a user seek is almost always over.
 */
export const RESYNC_TOLERANCE_MS = 750;

export class PlaybackClock {
  private anchorMs: number | null = null;
  private anchorAt = 0;
  private playing = false;
  private lastReportedMs: number | null = null;
  private movingReports = 0;

  /**
   * Feed a position the provider relayed.
   *
   * @param positionMs Where the provider says playback is.
   * @param isPlaying  Whether it says playback is running.
   * @param now        performance.now() at the moment of the report.
   */
  report(positionMs: number, isPlaying: boolean, now: number): void {
    if (!Number.isFinite(positionMs)) return;

    if (isPlaying && this.lastReportedMs !== null && positionMs !== this.lastReportedMs) {
      this.movingReports += 1;
    }
    this.lastReportedMs = positionMs;

    if (this.anchorMs === null || isPlaying !== this.playing || !isPlaying) {
      this.anchor(positionMs, isPlaying, now);
      return;
    }

    const drift = positionMs - this.estimateMs(now);
    if (Math.abs(drift) > RESYNC_TOLERANCE_MS) this.anchor(positionMs, true, now);
  }

  /** Best estimate of the position right now, or null before any report. */
  positionSec(now: number): number | null {
    if (this.anchorMs === null) return null;
    return this.estimateMs(now) / 1000;
  }

  /**
   * True once the provider has reported a position that actually moved during
   * playback - meaning timestamps line up with the track itself rather than
   * just with how long the capture has been running.
   *
   * The guest Spotify embed never becomes aligned. Its captures still show
   * live chords and structure, but their times are relative to when capture
   * began, not to the song, so storing them would put wrong timestamps into
   * the catalog.
   */
  get aligned(): boolean {
    return this.movingReports > 0;
  }

  reset(): void {
    this.anchorMs = null;
    this.anchorAt = 0;
    this.playing = false;
    this.lastReportedMs = null;
    this.movingReports = 0;
  }

  private estimateMs(now: number): number {
    const base = this.anchorMs ?? 0;
    return this.playing ? base + Math.max(0, now - this.anchorAt) : base;
  }

  private anchor(positionMs: number, playing: boolean, now: number): void {
    this.anchorMs = positionMs;
    this.anchorAt = now;
    this.playing = playing;
  }
}
