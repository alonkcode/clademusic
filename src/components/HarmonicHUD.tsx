import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Sliders, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSectionSync } from '@/hooks/useSectionSync';
import { useHarmonicLoop } from '@/hooks/useHarmonicLoop';
import { chordDisplayName, parseRomanChord, pitchClassName, PITCH_CLASSES } from '@/lib/harmony/theory';
import { ROMAN_NUMERALS } from '@/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { SongSection, SongSectionType } from '@/types';

interface HarmonicHUDProps {
  trackId: string;
  progression: string[];
  detectedKey?: string;
  detectedMode?: 'major' | 'minor' | 'unknown';
  bpm?: number;
  sections?: SongSection[];
  className?: string;
}

const CHORD_VAR: Record<string, string> = {
  I: '--chord-i', II: '--chord-ii', III: '--chord-iii',
  IV: '--chord-iv', V: '--chord-v', VI: '--chord-vi', VII: '--chord-vii',
};

/** Short, glanceable label for a section marker at tiny sizes. */
const SECTION_ABBR: Record<SongSectionType, string> = {
  intro: 'In', verse: 'Vs', 'pre-chorus': 'Pr', chorus: 'Ch',
  bridge: 'Br', outro: 'Out', breakdown: 'Dn', drop: 'Dr',
};

/**
 * HarmonicHUD — the dominant, always-visible harmonic display for a track.
 *
 * Two moments this serves:
 *  - LIVE: the track is actually playing through the app player. The big
 *    center chord and the section rail track real playback position exactly
 *    (via useSectionSync), so what you see is what you hear - no separate
 *    synthesized audio runs here.
 *  - PREVIEW: nothing is playing. Tapping a section marker changes the
 *    progression shown and, if the loop is armed, what the synth plays -
 *    this is "the chord progression changes when you change the section".
 *
 * Deliberately small footprint by default: the detailed key/tempo/volume
 * controls live in a bottom sheet, not inline, so the card stays scannable.
 */
export function HarmonicHUD({
  trackId,
  progression,
  detectedKey,
  detectedMode,
  bpm,
  sections,
  className,
}: HarmonicHUDProps) {
  const [controlsOpen, setControlsOpen] = useState(false);

  const sync = useSectionSync({
    trackId,
    progression,
    sections,
    detectedMode,
    bpm,
  });

  const loop = useHarmonicLoop({
    progression: sync.progression,
    detectedKey,
    mode: detectedMode,
    bpm,
  });

  if (progression.length === 0) return null;

  const activeIndex = sync.isLiveSynced ? sync.liveChordIndex : loop.activeStep;
  const chords = sync.progression
    .map((symbol) => parseRomanChord(symbol, detectedMode === 'minor' ? 'minor' : 'major'))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const current = chords[Math.max(activeIndex, 0)] ?? chords[0];
  const tonic = loop.tonic;

  const orderedSections = [...(sections ?? [])].sort((a, b) => a.start_time - b.start_time);

  return (
    <div className={cn('relative w-full min-w-0 rounded-2xl glass-strong overflow-hidden', className)}>
      {/* Section rail - small symbols hugging the right edge of the card */}
      {orderedSections.length > 1 && (
        <div
          className="absolute right-1.5 top-1.5 bottom-1.5 z-10 flex flex-col items-center justify-center gap-1"
          role="tablist"
          aria-label="Song sections"
        >
          {orderedSections.map((section, i) => {
            const active = i === sync.activeSectionIndex;
            return (
              <button
                key={`${section.type}-${i}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={section.label || section.type}
                disabled={sync.isLiveSynced}
                onClick={() => sync.selectSection(i)}
                className={cn(
                  'shrink-0 rounded-full font-mono font-semibold transition-all duration-200',
                  'flex items-center justify-center leading-none',
                  'text-[8px] w-6 h-6 sm:w-7 sm:h-7',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  sync.isLiveSynced ? 'cursor-default' : 'cursor-pointer hover:scale-110',
                  active
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/40 scale-110'
                    : 'bg-background/60 text-muted-foreground border border-border/60'
                )}
                title={section.label || section.type}
              >
                {SECTION_ABBR[section.type] ?? section.type.slice(0, 2)}
              </button>
            );
          })}
        </div>
      )}

      {/* Live indicator - small symbol, top-left edge */}
      {sync.isLiveSynced && (
        <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-primary/90 px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground">
          <Radio className="w-2.5 h-2.5 animate-pulse" />
          <span className="hidden xs:inline">LIVE</span>
        </div>
      )}

      {/* Dominant center readout */}
      <div className="flex flex-col items-center justify-center py-4 sm:py-5 px-8 sm:px-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${current?.source}-${sync.activeSectionIndex}`}
            initial={{ opacity: 0, scale: 0.85, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="text-center"
          >
            <span
              className="block font-extrabold leading-none tracking-tight"
              style={{
                fontSize: 'clamp(2.25rem, 11vw, 3.5rem)',
                color: current ? `hsl(var(${CHORD_VAR[current.base] ?? '--chord-i'}))` : undefined,
              }}
            >
              {current ? chordDisplayName(current, tonic) : '—'}
            </span>
            <span className="block text-[11px] sm:text-xs text-muted-foreground font-mono mt-0.5">
              {current ? ROMAN_NUMERALS[current.source as keyof typeof ROMAN_NUMERALS]?.label ?? current.source : ''}
              {sync.activeSection && (
                <span className="opacity-70"> · {sync.activeSection.label || sync.activeSection.type}</span>
              )}
            </span>
          </motion.div>
        </AnimatePresence>

        {/* Full progression, small, current one highlighted */}
        <div className="flex items-center gap-1 mt-2.5 flex-wrap justify-center">
          {chords.map((chord, i) => (
            <span
              key={i}
              className={cn(
                'font-mono font-semibold rounded px-1.5 py-0.5 text-[10px] transition-all',
                i === activeIndex
                  ? 'scale-110'
                  : 'opacity-40'
              )}
              style={{
                backgroundColor: `hsl(var(${CHORD_VAR[chord.base] ?? '--chord-i'}) / ${i === activeIndex ? 0.9 : 0.15})`,
                color: i === activeIndex ? 'hsl(var(--background))' : `hsl(var(${CHORD_VAR[chord.base] ?? '--chord-i'}))`,
              }}
            >
              {ROMAN_NUMERALS[chord.source as keyof typeof ROMAN_NUMERALS]?.label ?? chord.source}
            </span>
          ))}
        </div>
      </div>

      {/* Small edge controls, bottom */}
      <div className="flex items-center justify-between px-2.5 sm:px-3 pb-2 sm:pb-2.5">
        {sync.isLiveSynced ? (
          <span className="text-[10px] text-muted-foreground">synced to playback</span>
        ) : (
          <button
            type="button"
            onClick={loop.toggle}
            aria-label={loop.isPlaying ? 'Stop preview' : 'Preview this section'}
            className={cn(
              'inline-flex items-center justify-center rounded-full transition-colors',
              'w-8 h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              loop.isPlaying ? 'bg-primary text-primary-foreground' : 'bg-primary/15 text-primary hover:bg-primary/25'
            )}
          >
            {loop.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 translate-x-[1px]" />}
          </button>
        )}

        <button
          type="button"
          onClick={() => setControlsOpen(true)}
          aria-label="Key and tempo controls"
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[32px]"
        >
          <Sliders className="w-3 h-3" />
          {pitchClassName(tonic)} {detectedMode === 'minor' ? 'min' : 'maj'}
        </button>
      </div>

      {/* Detailed controls - bottom sheet, so the card itself stays small */}
      <Sheet open={controlsOpen} onOpenChange={setControlsOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="text-left">
            <SheetTitle className="text-base">Play in a different key</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-6 gap-1.5 mt-4">
            {PITCH_CLASSES.map((name, pc) => (
              <button
                key={name}
                type="button"
                onClick={() => loop.setTonic(pc)}
                aria-pressed={pc === tonic}
                className={cn(
                  'h-11 rounded-lg text-sm font-mono font-medium transition-colors',
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

          <div className="space-y-4 mt-5">
            <label className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="w-14 shrink-0">Tempo</span>
              <input
                type="range" min={50} max={180} step={1} value={loop.tempo}
                onChange={(e) => loop.setTempo(Number(e.target.value))}
                className="flex-1 accent-primary h-2"
                aria-label="Tempo in BPM"
              />
              <span className="w-12 text-right font-mono tabular-nums">{loop.tempo}</span>
            </label>
            <label className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="w-14 shrink-0">Volume</span>
              <input
                type="range" min={0} max={1} step={0.01} value={loop.volume}
                onChange={(e) => loop.setVolume(Number(e.target.value))}
                className="flex-1 accent-primary h-2"
                aria-label="Preview volume"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={loop.toggle}
            className={cn(
              'w-full mt-5 h-12 rounded-xl font-medium transition-colors flex items-center justify-center gap-2',
              loop.isPlaying ? 'bg-primary text-primary-foreground' : 'bg-primary/15 text-primary'
            )}
          >
            {loop.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {loop.isPlaying ? 'Stop preview' : 'Preview this progression'}
          </button>
        </SheetContent>
      </Sheet>
    </div>
  );
}
