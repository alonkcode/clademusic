import { Crosshair, Plus, Scissors, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/timeFormat';
import { MIN_CHORD_MS, type ChordChoice, type ChordSpan } from '@/lib/harmony/chordDraft';
import { chordDisplayName, parseRomanChord } from '@/lib/harmony/theory';
import { TimecodeInput } from '@/components/TimecodeInput';

/**
 * One section's chords in the section editor: change what a chord is, move
 * when it lands, split it into two halves, or take it out. Presentation only -
 * every edit is handed back to the editor, which owns the draft.
 */

interface SectionChordListProps {
  spans: ChordSpan[];
  choices: ChordChoice[];
  mode: 'major' | 'minor';
  /** Pitch class of the key's tonic, when known, so a numeral can also be read as a letter name. */
  tonic: number | null;
  onReplace: (index: number, numeral: string) => void;
  /** Move a chord's onset; the editor clamps it between its neighbours. */
  onMove: (index: number, ms: number) => void;
  onSplit: (index: number) => void;
  onRemove: (index: number) => void;
  /** Give a section with no chords its first one. */
  onAddFirst: () => void;
  onSeek: (ms: number) => void;
}

/** Milliseconds, like the boundaries: a chord change is heard, not rounded. */
const formatChordTime = (ms: number) => formatTime(ms, true);

/** "vi", or "vi · Am" once the key is known. */
function chordLabel(numeral: string, mode: 'major' | 'minor', tonic: number | null): string {
  if (tonic === null) return numeral;
  const parsed = parseRomanChord(numeral, mode);
  return parsed ? `${numeral} · ${chordDisplayName(parsed, tonic)}` : numeral;
}

// 44px on a phone, where a finger is the pointer; compact where a mouse is.
const TOUCH_TARGET = 'inline-flex min-h-11 min-w-11 items-center justify-center sm:min-h-8 sm:min-w-8';

export function SectionChordList({
  spans,
  choices,
  mode,
  tonic,
  onReplace,
  onMove,
  onSplit,
  onRemove,
  onAddFirst,
  onSeek,
}: SectionChordListProps) {
  if (spans.length === 0) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">No chords</span>
        <button
          type="button"
          onClick={onAddFirst}
          className={cn(
            TOUCH_TARGET,
            'gap-1 rounded-full bg-muted/60 px-3 text-[11px] font-medium text-muted-foreground hover:bg-muted'
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add chord
        </button>
      </div>
    );
  }

  const inKey = choices.filter((c) => c.inKey);
  const borrowed = choices.filter((c) => !c.inKey);

  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {spans.map((span, position) => {
        const time = formatChordTime(span.startMs);
        // A numeral that is not one of the offered triads (a 7th, say) must
        // still show as itself rather than a blank select.
        const offered = choices.some((c) => c.numeral === span.numeral);
        const option = (c: ChordChoice) => (
          <option key={c.numeral} value={c.numeral}>
            {chordLabel(c.numeral, mode, tonic)}
          </option>
        );

        return (
          <li
            key={span.index}
            className="inline-flex items-center rounded-md border border-border/60 bg-background"
          >
            <select
              value={span.numeral}
              onChange={(e) => onReplace(span.index, e.target.value)}
              aria-label={`Chord at ${time}`}
              className="min-h-11 rounded-l-md bg-transparent px-1.5 text-[12px] font-medium sm:min-h-8"
            >
              {!offered && <option value={span.numeral}>{chordLabel(span.numeral, mode, tonic)}</option>}
              <optgroup label="In the key">{inKey.map(option)}</optgroup>
              <optgroup label="Other chords">{borrowed.map(option)}</optgroup>
            </select>

            {/* Seeking to a chord is how you check it: listen for the change. */}
            <button
              type="button"
              onClick={() => onSeek(span.startMs)}
              className={cn(
                TOUCH_TARGET,
                'border-l border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
              aria-label={`Jump to ${time}`}
              title="Jump here"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>

            {/* A section's first chord sounds from the section's start, so its
                onset is the boundary's - move that instead. */}
            <TimecodeInput
              valueMs={span.startMs}
              disabled={position === 0}
              onCommit={(ms) => onMove(span.index, ms)}
              aria-label={`Start of the chord at ${time}`}
              title={
                position === 0
                  ? 'The first chord of a section plays from the start of that section'
                  : 'Type an exact start, to the millisecond'
              }
              className="rounded-none border-y-0 border-l border-r-0"
            />

            <button
              type="button"
              onClick={() => onSplit(span.index)}
              disabled={span.endMs - span.startMs < 2 * MIN_CHORD_MS}
              className={cn(
                TOUCH_TARGET,
                'text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
              )}
              aria-label={`Split the chord at ${time} into two halves`}
              title="Split into two chords of half the length"
            >
              <Scissors className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => onRemove(span.index)}
              className={cn(TOUCH_TARGET, 'rounded-r-md text-muted-foreground hover:text-destructive')}
              aria-label={`Remove the chord at ${time}`}
              title="Remove this chord - its neighbour holds on through the time"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
