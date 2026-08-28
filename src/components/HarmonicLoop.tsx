import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Music4, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHarmonicLoop } from '@/hooks/useHarmonicLoop';
import { chordDisplayName, PITCH_CLASSES, pitchClassName } from '@/lib/harmony/theory';
import { ROMAN_NUMERALS } from '@/types';

interface HarmonicLoopProps {
  progression: string[];
  detectedKey?: string;
  detectedMode?: 'major' | 'minor' | 'unknown';
  bpm?: number;
  className?: string;
  /** Compact mode drops the tempo/volume row - for tight feed cards. */
  compact?: boolean;
}

const CHORD_VAR: Record<string, string> = {
  I: '--chord-i', II: '--chord-ii', III: '--chord-iii',
  IV: '--chord-iv', V: '--chord-v', VI: '--chord-vi', VII: '--chord-vii',
};

/**
 * HarmonicLoop - hear the skeleton of a song.
 *
 * Renders the track's Roman-numeral progression as a rotating dial and plays it
 * back as real synthesised chords, in any key the listener chooses. This is the
 * point where Clade's relative-harmony data stops being metadata and becomes
 * something you can listen to and compare by ear.
 */
export function HarmonicLoop({
  progression,
  detectedKey,
  detectedMode,
  bpm,
  className,
  compact = false,
}: HarmonicLoopProps) {
  const loop = useHarmonicLoop({ progression, detectedKey, mode: detectedMode, bpm });
  const {
    chords, tonic, setTonic, tempo, setTempo, volume, setVolume,
    isPlaying, activeStep, toggle, isPlayable, transposition,
  } = loop;

  // Dial geometry: chords sit evenly around a circle.
  const nodes = useMemo(() => {
    const count = chords.length || 1;
    return chords.map((chord, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      return {
        chord,
        index,
        x: 50 + Math.cos(angle) * 34,
        y: 50 + Math.sin(angle) * 34,
      };
    });
  }, [chords]);

  if (!isPlayable) return null;

  const keyLabel = `${pitchClassName(tonic)} ${detectedMode === 'minor' ? 'minor' : 'major'}`;

  return (
    <div
      className={cn(
        'glass-strong rounded-2xl p-3 sm:p-4 md:p-5 space-y-4 w-full min-w-0',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Music4 className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">Hear the progression</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {keyLabel}
              {transposition > 0 && (
                <span className="text-primary">
                  {' '}&middot; +{transposition} semitone{transposition > 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? 'Stop progression' : 'Play progression'}
          aria-pressed={isPlaying}
          className={cn(
            'shrink-0 flex items-center justify-center rounded-full transition-all duration-200',
            'w-11 h-11 sm:w-12 sm:h-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            isPlaying
              ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
              : 'bg-primary/15 text-primary hover:bg-primary/25'
          )}
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 translate-x-[1px]" />}
        </button>
      </div>

      {/* The dial */}
      <div className="relative mx-auto w-full max-w-[15rem] sm:max-w-[17rem] aspect-square">
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <circle
            cx="50" cy="50" r="34"
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="0.5"
            strokeDasharray="2 3"
          />
        </svg>

        {nodes.map(({ chord, index, x, y }) => {
          const active = index === activeStep;
          const colorVar = CHORD_VAR[chord.base] ?? '--chord-i';
          return (
            <motion.button
              key={`${chord.source}-${index}`}
              type="button"
              onClick={toggle}
              animate={{ scale: active ? 1.18 : 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                backgroundColor: `hsl(var(${colorVar}) / ${active ? 0.9 : 0.16})`,
                borderColor: `hsl(var(${colorVar}) / ${active ? 1 : 0.4})`,
                color: active ? 'hsl(var(--background))' : `hsl(var(${colorVar}))`,
                boxShadow: active ? `0 0 24px hsl(var(${colorVar}) / 0.55)` : 'none',
              }}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border',
                'flex flex-col items-center justify-center font-mono font-semibold',
                'w-[22%] h-[22%] min-w-[2.5rem] min-h-[2.5rem] transition-colors duration-150'
              )}
              aria-label={`${chord.source} - ${chordDisplayName(chord, tonic)}`}
            >
              <span className="text-[clamp(0.65rem,3.2vw,0.95rem)] leading-none">
                {ROMAN_NUMERALS[chord.source as keyof typeof ROMAN_NUMERALS]?.label ?? chord.source}
              </span>
              <span className="text-[clamp(0.5rem,2.2vw,0.65rem)] font-normal opacity-75 leading-none mt-0.5">
                {chordDisplayName(chord, tonic)}
              </span>
            </motion.button>
          );
        })}

        {/* Centre readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[clamp(1.1rem,5vw,1.6rem)] font-bold gradient-text leading-none">
            {pitchClassName(tonic)}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
            {tempo} bpm
          </span>
        </div>
      </div>

      {/* Key selector - transpose the loop into any key and hear it there */}
      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Play in key</p>
        <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
          {PITCH_CLASSES.map((name, pc) => (
            <button
              key={name}
              type="button"
              onClick={() => setTonic(pc)}
              aria-pressed={pc === tonic}
              className={cn(
                'h-8 rounded-md text-[11px] font-mono font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                pc === tonic
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted'
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {!compact && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border/50">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-10 shrink-0">Tempo</span>
            <input
              type="range" min={50} max={180} step={1} value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
              className="flex-1 min-w-0 accent-primary"
              aria-label="Loop tempo in BPM"
            />
            <span className="w-10 text-right font-mono tabular-nums">{tempo}</span>
          </label>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Volume2 className="w-3.5 h-3.5 shrink-0" />
            <input
              type="range" min={0} max={1} step={0.01} value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="flex-1 min-w-0 accent-primary"
              aria-label="Loop volume"
            />
          </label>
        </div>
      )}
    </div>
  );
}
