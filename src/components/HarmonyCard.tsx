import { motion } from 'framer-motion';
import { HarmonicHUD } from './HarmonicHUD';
import { Key, RotateCcw } from 'lucide-react';
import type { SongSection } from '@/types';

interface HarmonyCardProps {
  progression: string[];
  detectedKey?: string;
  detectedMode?: 'major' | 'minor' | 'unknown';
  cadenceType?: string;
  confidenceScore?: number;
  matchReason?: string;
  /** Track tempo in BPM - the loop plays at the song's own pace when known. */
  bpm?: number;
  /** Needed to detect when this exact track is the one actually playing. */
  trackId?: string;
  /** Section timestamps - enables the section rail and per-section variants. */
  sections?: SongSection[];
}

/**
 * HarmonyCard - the harmonic identity of a track.
 *
 * The dominant element is HarmonicHUD: a big glanceable chord readout with a
 * slim section rail on the edge, synced to real playback when this track is
 * playing. This wrapper stays deliberately thin - a one-line key/cadence
 * header above it, and the match reason/confidence below.
 */
export function HarmonyCard({
  progression,
  detectedKey,
  detectedMode,
  cadenceType,
  confidenceScore,
  matchReason,
  bpm,
  trackId,
  sections,
}: HarmonyCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2 w-full min-w-0"
    >
      {/* Compact key/cadence line */}
      <div className="flex items-center justify-between gap-2 px-1 min-w-0">
        <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
          <Key className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs font-medium truncate">
            {detectedKey || 'Unknown'} {detectedMode && detectedMode !== 'unknown' ? detectedMode : ''}
          </span>
        </div>
        {cadenceType && cadenceType !== 'none' && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
            <RotateCcw className="w-2.5 h-2.5" />
            <span className="capitalize">{cadenceType}</span>
          </div>
        )}
      </div>

      <HarmonicHUD
        trackId={trackId ?? ''}
        progression={progression}
        detectedKey={detectedKey}
        detectedMode={detectedMode}
        bpm={bpm}
        sections={sections}
      />

      {matchReason && (
        <p className="text-xs text-muted-foreground leading-relaxed px-1">{matchReason}</p>
      )}

      {confidenceScore !== undefined && (
        <div className="flex items-center gap-2 px-1">
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${confidenceScore * 100}%` }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
            />
          </div>
          <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
            {Math.round(confidenceScore * 100)}%
          </span>
        </div>
      )}
    </motion.div>
  );
}
