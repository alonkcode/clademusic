import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Music, Trash2, Save, X, Loader2, ChevronLeft, ChevronRight, Crosshair } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/timeFormat';
import { usePlayer } from '@/player/PlayerContext';
import { useSaveTrackSections } from '@/hooks/api/useTrackSections';
import { useTrack } from '@/hooks/api/useTracks';
import { SectionChordList } from '@/components/SectionChordList';
import { TimecodeInput } from '@/components/TimecodeInput';
import {
  addBoundary,
  draftFromSections,
  draftProblem,
  moveBoundary,
  removeBoundary,
  setLabel,
  toSections,
  SECTION_LABELS,
  type SectionLabel,
  type SectionMarker,
} from '@/lib/harmony/sectionDraft';
import {
  addChord,
  chordChoices,
  chordSpansBySection,
  draftChordsFromSections,
  moveChord,
  removeChord,
  replaceChord,
  splitChord,
  toChordColumns,
  type ChordMarker,
  type SectionChordSource,
} from '@/lib/harmony/chordDraft';

/**
 * Marking a song's structure and chords by ear, while it plays.
 *
 * The playhead is the input device: listen, and tap at the moment a part
 * changes. Everything else - where a section ends, which occurrence of its
 * label it is - follows from the boundaries, so there is nothing to keep
 * consistent by hand and no way to leave a gap or an overlap behind. Chords
 * work the same way: they are kept at their place in the song, and belong to
 * whichever section that place falls in.
 *
 * Nothing is written until Save; Cancel discards the draft.
 */

interface SectionEditorProps {
  trackId: string;
  /** Sections currently stored for this track, used as the starting point. */
  sections: Array<{ label: string } & SectionChordSource>;
  /** The key the chord numerals are relative to, so they can also be read as letter names. */
  tonic?: number | null;
  mode?: 'major' | 'minor';
  onClose: () => void;
  className?: string;
}

const NUDGE_MS = 500;

/**
 * Every moment in the editor is shown - and typed back - to the millisecond.
 * Marking by ear lands within a few frames of the change; the last few are
 * what the nudge buttons and the typed boxes are for, and a display rounded to
 * the second would hide exactly the difference being corrected.
 */
const timecode = (ms: number) => formatTime(ms, true);

const positiveMs = (ms: unknown): number =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0;

export function SectionEditor({
  trackId,
  sections,
  tonic = null,
  mode = 'major',
  onClose,
  className,
}: SectionEditorProps) {
  const { positionMs, durationMs, seekTo } = usePlayer();
  const save = useSaveTrackSections();
  const { data: track } = useTrack(trackId);

  // Seeded once: re-deriving from `sections` on every render would throw the
  // draft away the moment a refetch landed mid-edit.
  const [draft, setDraft] = useState<SectionMarker[]>(() => draftFromSections(sections));
  const [chords, setChords] = useState<ChordMarker[]>(() => draftChordsFromSections(sections));

  // The last section ends where the track does, so Save needs a length. The
  // player only reports one once its embed has said so - the guest Spotify
  // embed often never does - which left Save disabled for good. The player
  // drawer's own seekbar falls back to the catalog's duration for the same
  // reason, so do the same here: live value first, catalog value otherwise.
  const safeDuration = positiveMs(durationMs) || positiveMs(track?.duration_ms);
  const built = useMemo(() => toSections(draft, safeDuration), [draft, safeDuration]);
  const problem = draftProblem(draft, safeDuration);

  // Which chords fall in which section is worked out from where the boundaries
  // are now, so moving one is always reflected here and in what gets saved.
  const chordSpans = useMemo(() => chordSpansBySection(chords, built), [chords, built]);
  const chordCount = chordSpans.reduce((total, spans) => total + spans.length, 0);
  const choices = useMemo(() => chordChoices(mode), [mode]);
  const startingNumeral = mode === 'minor' ? 'i' : 'I';

  // An edit that changes nothing came back as the same list: say why, rather
  // than leave a button that silently did nothing.
  const applyChordEdit = (next: ChordMarker[], refusal: string) => {
    if (next === chords) toast.error(refusal);
    else setChords(next);
  };

  const handleSave = async () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      const columns = toChordColumns(chords, built);
      const count = await save.mutateAsync({
        trackId,
        sections: built.map((s, i) => ({
          label: s.label,
          ordinal: s.ordinal,
          start_ms: s.startMs,
          end_ms: s.endMs,
          // Only a section that has chords carries the keys, so a track with
          // none saves exactly as it always did.
          ...(columns[i].progression_roman.length > 0 ? columns[i] : {}),
        })),
      });
      toast.success(`Saved ${count} section${count === 1 ? '' : 's'}.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save these sections.');
    }
  };

  return (
    <div className={cn('rounded-lg border border-border/60 bg-background/80 p-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDraft((d) => addBoundary(d, positionMs, safeDuration))}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
          title="Start a new section at the current position"
        >
          <Plus className="h-3.5 w-3.5" />
          Mark at {timecode(positionMs)}
        </button>

        <button
          type="button"
          onClick={() =>
            applyChordEdit(
              addChord(chords, positionMs, built, startingNumeral),
              "Can't add a chord here: it would sit too close to another chord, or the playhead is outside the track."
            )
          }
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-muted/60 px-3 text-[11px] font-medium text-foreground hover:bg-muted sm:min-h-8"
          title="Start a new chord at the current position"
        >
          <Music className="h-3.5 w-3.5" />
          Add chord at {timecode(positionMs)}
        </button>

        <span className="text-[11px] text-muted-foreground">
          {built.length} section{built.length === 1 ? '' : 's'} · {chordCount} chord
          {chordCount === 1 ? '' : 's'}
        </span>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={save.isPending || Boolean(problem)}
            title={problem ?? 'Save these sections'}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted/60 px-3 text-[11px] font-medium text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      </div>

      {problem && <p className="mt-2 text-[11px] text-amber-500">{problem}</p>}

      <div className="mt-3 space-y-1.5">
        {built.map((section, index) => (
          <div key={`${section.startMs}-${index}`} className="rounded-md bg-muted/40 px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={section.label}
                onChange={(e) => setDraft((d) => setLabel(d, index, e.target.value as SectionLabel))}
                aria-label={`Label for section starting at ${timecode(section.startMs)}`}
                className="h-7 rounded border border-border/60 bg-background px-1.5 text-[11px] capitalize"
              >
                {SECTION_LABELS.map((label) => (
                  <option key={label} value={label} className="capitalize">
                    {label}
                  </option>
                ))}
              </select>

              <span className="text-[11px] tabular-nums text-muted-foreground">
                {section.label} {section.ordinal}
              </span>

              {/* Seeking to a boundary is how you check you put it in the right
                  place - listen to the transition rather than trust the number. */}
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => seekTo(section.startMs / 1000)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground sm:min-h-8 sm:min-w-8"
                  aria-label={`Jump to ${timecode(section.startMs)}`}
                  title="Jump here"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </button>

                {/* The first section owns the start of the track, so its start
                    is not a boundary anyone can move. */}
                <TimecodeInput
                  valueMs={section.startMs}
                  disabled={index === 0}
                  onCommit={(ms) => setDraft((d) => moveBoundary(d, index, ms, safeDuration))}
                  aria-label={`Start of ${section.label} ${section.ordinal}`}
                  title={
                    index === 0
                      ? 'The first section starts where the track does'
                      : 'Type an exact start, to the millisecond'
                  }
                />

                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  –{timecode(section.endMs)}
                </span>
              </span>

              {index > 0 && (
                <span className="inline-flex items-center">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => moveBoundary(d, index, section.startMs - NUDGE_MS, safeDuration))
                    }
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Move this boundary earlier"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => moveBoundary(d, index, section.startMs + NUDGE_MS, safeDuration))
                    }
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Move this boundary later"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => removeBoundary(d, index))}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    aria-label="Remove this boundary"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </div>

            <SectionChordList
              spans={chordSpans[index] ?? []}
              choices={choices}
              mode={mode}
              tonic={tonic}
              onReplace={(chordIndex, numeral) => setChords((c) => replaceChord(c, chordIndex, numeral))}
              onMove={(chordIndex, ms) =>
                applyChordEdit(
                  moveChord(chords, chordIndex, ms, built),
                  "Can't move that chord: there is no room for it between its neighbours."
                )
              }
              onSplit={(chordIndex) =>
                applyChordEdit(splitChord(chords, chordIndex, built), 'That chord is too short to split.')
              }
              onRemove={(chordIndex) => setChords((c) => removeChord(c, chordIndex))}
              onAddFirst={() =>
                applyChordEdit(
                  addChord(chords, section.startMs, built, startingNumeral),
                  "Couldn't add a chord to this section."
                )
              }
              onSeek={(ms) => seekTo(ms / 1000)}
            />
          </div>
        ))}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Saving replaces this track's stored sections and chords with what's shown here. A chord stays
        where it is in the song when you move a boundary, and belongs to whichever section it lands
        in. The first chord of a section plays from the start of that section. Every time can be
        typed as <span className="font-mono">m:ss.mmm</span> and is kept to the millisecond; one
        typed outside what fits between its neighbours is held at the nearest moment that does.
      </p>
    </div>
  );
}
