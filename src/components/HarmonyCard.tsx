import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChordBadge } from './ChordBadge';
import { HarmonicLoop } from './HarmonicLoop';
import { Music, Key, RotateCcw, ChevronDown, Headphones } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HarmonyCardProps {
  progression: string[];
  detectedKey?: string;
  detectedMode?: 'major' | 'minor' | 'unknown';
  cadenceType?: string;
  confidenceScore?: number;
  matchReason?: string;
  /** Track tempo in BPM - the loop plays at the song's own pace when known. */
  bpm?: number;
  /** Render the audible loop expanded from the start. */
  defaultOpen?: boolean;
}

export function HarmonyCard({
  progression,
  detectedKey,
  detectedMode,
  cadenceType,
  confidenceScore,
  matchReason,
  bpm,
  defaultOpen = false,
}: HarmonyCardProps) {
  const [showLoop, setShowLoop] = useState(defaultOpen);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong rounded-2xl p-3 sm:p-4 space-y-3 w-full min-w-0 overflow-hidden"
    >
      {/* Key signature */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 text-muted-foreground min-w-0">
          <Key className="w-4 h-4 shrink-0" />
          <span className="text-sm font-medium truncate">
            {detectedKey || 'Unknown'} {detectedMode && detectedMode !== 'unknown' ? detectedMode : ''}
          </span>
        </div>
        {cadenceType && cadenceType !== 'none' && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <RotateCcw className="w-3 h-3" />
            <span className="capitalize">{cadenceType}</span>
          </div>
        )}
      </div>

      {/* Chord progression */}
      <div className="flex items-start gap-2 min-w-0">
        <Music className="w-4 h-4 text-primary shrink-0 mt-1.5" />
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {progression.map((chord, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
            >
              <ChordBadge
                chord={chord}
                size="md"
                keySignature={detectedKey}
              />
            </motion.div>
          ))}
        </div>
      </div>

      {/* Audible loop toggle - the progression as sound, not just symbols */}
      {progression.length > 0 && (
        <button
          type="button"
          onClick={() => setShowLoop((v) => !v)}
          aria-expanded={showLoop}
          className={cn(
            'w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5',
            'text-sm font-medium transition-colors min-h-[44px]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            showLoop
              ? 'bg-primary/15 text-primary'
              : 'bg-muted/50 text-foreground hover:bg-muted'
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            <Headphones className="w-4 h-4 shrink-0" />
            <span className="truncate">Hear this progression</span>
          </span>
          <ChevronDown
            className={cn('w-4 h-4 shrink-0 transition-transform', showLoop && 'rotate-180')}
          />
        </button>
      )}

      <AnimatePresence initial={false}>
        {showLoop && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <HarmonicLoop
              progression={progression}
              detectedKey={detectedKey}
              detectedMode={detectedMode}
              bpm={bpm}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Match reason */}
      {matchReason && (
        <p className="text-xs text-muted-foreground leading-relaxed pt-1 border-t border-border/50">
          {matchReason}
        </p>
      )}

      {/* Confidence indicator */}
      {confidenceScore !== undefined && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${confidenceScore * 100}%` }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
            {Math.round(confidenceScore * 100)}%
          </span>
        </div>
      )}
    </motion.div>
  );
}
