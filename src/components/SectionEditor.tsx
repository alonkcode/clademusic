import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Save, X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlayer } from '@/player/PlayerContext';
import { useSaveTrackSections } from '@/hooks/api/useTrackSections';
import { useTrack } from '@/hooks/api/useTracks';
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

/**
 * Marking a song's structure by ear, while it plays.
 *
 * The playhead is the input device: listen, and tap at the moment a part
 * changes. Everything else - where a section ends, which occurrence of its
 * label it is - follows from the boundaries, so there is nothing to keep
 * consistent by hand and no way to leave a gap or an overlap behind.
 *
 * Nothing is written until Save; Cancel discards the draft.
 */

interface SectionEditorProps {
  trackId: string;
  /** Sections currently stored for this track, used as the starting point. */
  sections: Array<{ label: string; start_ms: number }>;
  onClose: () => void;
  className?: string;
}

const NUDGE_MS = 500;

function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const positiveMs = (ms: unknown): number =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0;

export function SectionEditor({ trackId, sections, onClose, className }: SectionEditorProps) {
  const { positionMs, durationMs, seekTo } = usePlayer();
  const save = useSaveTrackSections();
  const { data: track } = useTrack(trackId);

  // Seeded once: re-deriving from `sections` on every render would throw the
  // draft away the moment a refetch landed mid-edit.
  const [draft, setDraft] = useState<SectionMarker[]>(() => draftFromSections(sections));

  // The last section ends where the track does, so Save needs a length. The
  // player only reports one once its embed has said so - the guest Spotify
  // embed often never does - which left Save disabled for good. The player
  // drawer's own seekbar falls back to the catalog's duration for the same
  // reason, so do the same here: live value first, catalog value otherwise.
  const safeDuration = positiveMs(durationMs) || positiveMs(track?.duration_ms);
  const built = useMemo(() => toSections(draft, safeDuration), [draft, safeDuration]);
  const problem = draftProblem(draft, safeDuration);

  const handleSave = async () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      const count = await save.mutateAsync({
        trackId,
        sections: built.map((s) => ({
          label: s.label,
          ordinal: s.ordinal,
          start_ms: s.startMs,
          end_ms: s.endMs,
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
          Mark at {formatMs(positionMs)}
        </button>

        <span className="text-[11px] text-muted-foreground">
          {built.length} section{built.length === 1 ? '' : 's'}
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
          <div
            key={`${section.startMs}-${index}`}
            className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5"
          >
            <select
              value={section.label}
              onChange={(e) => setDraft((d) => setLabel(d, index, e.target.value as SectionLabel))}
              aria-label={`Label for section starting at ${formatMs(section.startMs)}`}
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
            <button
              type="button"
              onClick={() => seekTo(section.startMs / 1000)}
              className="rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums hover:bg-background/70"
              title="Jump here"
            >
              {formatMs(section.startMs)}–{formatMs(section.endMs)}
            </button>

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
        ))}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Saving replaces this track's stored sections. Chord timings aren't kept — moving a boundary
        changes which chords fall inside a section, so they'd end up on the wrong part. Promote a
        detection run to put chords back.
      </p>
    </div>
  );
}
