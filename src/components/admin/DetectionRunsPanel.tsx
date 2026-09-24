import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Check, X, Loader2, Undo2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  useDetectionRuns,
  useDetectionRunDetail,
  usePromoteDetectionRun,
  useRejectDetectionRun,
  useRevertDetectionRun,
  type DetectionRunStatus,
  type DetectionRunSummary,
  type RevertDetectionRunResult,
} from '@/hooks/api/useDetectionRuns';

/**
 * Review queue for live chord detection.
 *
 * A capture is stored as raw evidence and shows nobody anything until it is
 * promoted here. Reviewing means looking at what was actually heard - the
 * sections, and the chords inside them with their real timings - and deciding
 * whether that becomes the track's canonical structure.
 */

const STATUSES: Array<DetectionRunStatus | 'all'> = ['pending', 'promoted', 'rejected', 'all'];

const formatMs = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * What an undo actually did, in the reviewer's terms. The last clause matters:
 * a promotion made before undo history existed can be removed but its key can
 * not be recovered, and that should be said rather than implied.
 */
const describeRevert = (title: string, result: RevertDetectionRunResult) =>
  [
    `Undid the promotion on "${title}": removed ${plural(result.sections_removed, 'section')}.`,
    result.sections_restored > 0 ? `Put back the ${result.sections_restored} it had replaced.` : null,
    result.track_restored
      ? 'Its previous key was restored.'
      : 'Its key was left as it is - this promotion predates undo history.',
  ]
    .filter(Boolean)
    .join(' ');

function RunDetail({ runId }: { runId: string }) {
  const { data: sections, isLoading } = useDetectionRunDetail(runId);

  if (isLoading) {
    return <div className="py-3 text-xs text-muted-foreground">Loading sections…</div>;
  }
  if (!sections?.length) {
    return <div className="py-3 text-xs text-muted-foreground">This run recorded no sections.</div>;
  }

  return (
    <div className="space-y-3 py-3">
      {sections.map((section) => (
        <div key={section.section_id} className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold capitalize">
              {section.label} {section.ordinal}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatMs(section.start_ms)}–{formatMs(section.end_ms)}
            </span>
            <span className="text-xs text-muted-foreground">· loop {section.loop_roman.join('–') || '—'}</span>
            <span className="text-xs text-muted-foreground">· {percent(section.confidence)} confident</span>
          </div>

          {/* The chords as actually heard, with the offsets that make sync
              exact. Shown in full rather than as the loop, because this is
              the evidence being judged. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {section.chords.map((chord, i) => (
              <span
                key={`${section.section_id}-${i}`}
                className="inline-flex items-baseline gap-1 rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px]"
                title={`${chord.start_ms}–${chord.end_ms}ms · ${percent(chord.confidence)} confident`}
              >
                <span className="font-semibold">{chord.numeral}</span>
                <span className="text-muted-foreground">
                  +{Math.max(0, chord.start_ms - section.start_ms)}ms
                </span>
              </span>
            ))}
            {section.chords.length === 0 && (
              <span className="text-xs text-muted-foreground">No chords in this section.</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DetectionRunsPanel() {
  const [status, setStatus] = useState<DetectionRunStatus | 'all'>('pending');
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DetectionRunSummary | null>(null);
  const [reverting, setReverting] = useState<DetectionRunSummary | null>(null);

  const { data: runs, isLoading } = useDetectionRuns(status);
  const promote = usePromoteDetectionRun();
  const reject = useRejectDetectionRun();
  const revert = useRevertDetectionRun();

  const handlePromote = async (run: DetectionRunSummary) => {
    try {
      const result = await promote.mutateAsync(run.id);
      toast.success(`Promoted ${result.sections_written} sections to "${run.track_title ?? 'track'}".`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not promote this run.');
    } finally {
      setConfirming(null);
    }
  };

  const handleReject = async (run: DetectionRunSummary) => {
    try {
      await reject.mutateAsync(run.id);
      toast.success('Run rejected.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reject this run.');
    }
  };

  const handleRevert = async (run: DetectionRunSummary) => {
    try {
      const result = await revert.mutateAsync(run.id);
      toast.success(describeRevert(run.track_title ?? 'track', result));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not undo this promotion.');
    } finally {
      setReverting(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Detection runs</CardTitle>
        <CardDescription>
          Chord analyses captured from real audio. Promoting one replaces that track's sections.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={status === value ? 'default' : 'outline'}
              onClick={() => setStatus(value)}
              className="capitalize"
            >
              {value}
            </Button>
          ))}
        </div>

        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

        {!isLoading && runs?.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            {status === 'pending'
              ? 'Nothing waiting for review. Runs appear here when someone saves a live capture.'
              : `No ${status} runs.`}
          </div>
        )}

        <div className="space-y-2">
          {runs?.map((run) => {
            const isOpen = openRunId === run.id;
            const busy = promote.isPending || reject.isPending || revert.isPending;
            return (
              <div key={run.id} className="rounded-lg border border-border/60">
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => setOpenRunId(isOpen ? null : run.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={isOpen}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {run.track_title ?? 'Unknown track'}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {run.track_artist ?? 'Unknown artist'}
                        {run.contributor ? ` · by ${run.contributor}` : ''}
                      </span>
                    </span>
                  </button>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="font-mono">
                      {run.detected_key ?? '?'} {run.detected_mode ?? ''}
                    </Badge>
                    <span>{percent(run.key_confidence)}</span>
                    <span>
                      {run.section_count} sec · {run.chord_count} chords
                    </span>
                    <span>{formatMs(run.covered_to_ms - run.covered_from_ms)} covered</span>
                  </div>

                  {run.status === 'pending' ? (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => setConfirming(run)}>
                        {promote.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Promote
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void handleReject(run)}
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn('capitalize', run.status === 'promoted' && 'text-emerald-500')}
                      >
                        {run.status}
                      </Badge>
                      {run.status === 'promoted' && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setReverting(run)}>
                          {revert.isPending && reverting?.id === run.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Undo2 className="h-3.5 w-3.5" />
                          )}
                          Undo
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="border-t border-border/60 px-3">
                    <RunDetail runId={run.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      {/* Promotion replaces the track's whole canonical set, so it is worth
          one deliberate confirmation rather than a single misplaced click. */}
      <AlertDialog open={Boolean(confirming)} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make this the canonical analysis?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces every existing section on “{confirming?.track_title ?? 'this track'}” with the{' '}
              {confirming?.section_count ?? 0} from this run, and sets the track's key to{' '}
              {confirming?.detected_key ?? '?'} {confirming?.detected_mode ?? ''}. The run itself is kept, so
              a better one can be promoted over it later, and the promotion can be undone from the Promoted
              tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirming && void handlePromote(confirming)}>
              Promote
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Undo takes sections off a track the player is showing, so it gets the
          same deliberate confirmation promoting does. */}
      <AlertDialog open={Boolean(reverting)} onOpenChange={(open) => !open && setReverting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this promotion?</AlertDialogTitle>
            <AlertDialogDescription>
              This takes the {reverting?.section_count ?? 0} sections this run put on “
              {reverting?.track_title ?? 'this track'}” back off the track and returns the run to pending. If the
              promotion recorded what it replaced, the earlier sections and key come back too; otherwise the
              track keeps its current key. Only the track's current analysis can be undone - if a later run was
              promoted over this one, undo that one first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => reverting && void handleRevert(reverting)}>
              Undo promotion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
