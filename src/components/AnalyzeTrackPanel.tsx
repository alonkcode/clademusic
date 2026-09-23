import { AudioLines, Check, Loader2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAnalyzeTrack, type AnalyzeTarget } from '@/hooks/useAnalyzeTrack';
import { pitchClassName } from '@/lib/harmony/theory';

interface AnalyzeTrackPanelProps extends AnalyzeTarget {
  /** Sends a signed-out listener to sign in. The player owns navigation. */
  onSignIn: () => void;
}

const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Shown in the player in place of the chord readout when the track loaded has
 * no analysis at all: it turns "nothing here" into "listen once and it is
 * saved for everyone". See useAnalyzeTrack for what happens behind the button.
 */
export function AnalyzeTrackPanel({ onSignIn, ...target }: AnalyzeTrackPanelProps) {
  const { state, live, progress, unaligned, message, start, stop } = useAnalyzeTrack(target);

  const chord = live.chord
    ? `${pitchClassName(live.chord.root)}${live.chord.quality === 'minor' ? 'm' : ''}`
    : null;
  const key = live.detectedKey ? `${pitchClassName(live.detectedKey.tonic)} ${live.detectedKey.mode}` : null;
  const bpm = live.tempo ? Math.round(live.tempo.bpm) : null;
  const percent = Math.round(progress.ratio * 100);

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 bg-background/95 px-3 py-3 md:px-4"
      data-testid="analyze-track-panel"
    >
      {(state === 'idle' || state === 'stopped' || state === 'error') && (
        <>
          <AudioLines className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-sm font-semibold text-foreground">
              {state === 'stopped' ? 'Stopped before there was enough to save' : 'No chords for this track yet'}
            </p>
            <p className="text-xs text-muted-foreground" role={state === 'error' ? 'alert' : undefined}>
              {state === 'stopped'
                ? `Heard ${clock(progress.coverageMs)} of about ${clock(progress.requiredCoverageMs)}. Start again and let it play.`
                : state === 'error'
                  ? (message ?? 'Something went wrong.')
                  : 'Listen while it plays and its chords, key and BPM are saved for everyone. When your browser asks, pick this tab and tick "Share tab audio".'}
            </p>
          </div>
          <Button size="sm" onClick={() => void start()}>
            {state === 'idle' ? 'Analyze this track' : 'Try again'}
          </Button>
        </>
      )}

      {state === 'signed-out' && (
        <>
          <AudioLines className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="min-w-0 flex-1 basis-56 text-xs text-muted-foreground">
            No chords for this track yet. Sign in to analyze it and save the result for everyone.
          </p>
          <Button size="sm" onClick={onSignIn}>
            Sign in
          </Button>
        </>
      )}

      {state === 'unsupported' && (
        <>
          <AudioLines className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="min-w-0 flex-1 basis-56 text-xs text-muted-foreground">
            No chords for this track yet. Live analysis needs desktop Chrome or Edge; once someone analyzes it there,
            it is available everywhere.
          </p>
        </>
      )}

      {state === 'requesting' && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Waiting for you to share this tab's audio…
        </p>
      )}

      {(state === 'listening' || state === 'saving') && (
        <>
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" role="status" aria-live="polite">
              <span className="text-xl font-extrabold leading-none tracking-tight" data-testid="analyze-chord">
                {chord ?? '…'}
              </span>
              <span className="text-xs text-muted-foreground" data-testid="analyze-key">
                {key ? `Key ${key}` : 'Finding the key…'}
              </span>
              <span className="text-xs text-muted-foreground" data-testid="analyze-bpm">
                {bpm ? `${bpm} BPM` : 'Finding the tempo…'}
              </span>
            </div>

            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Analysis progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
            </div>

            <p className="text-[11px] text-muted-foreground">
              {state === 'saving'
                ? 'Saving…'
                : `Heard ${clock(progress.coverageMs)} of about ${clock(progress.requiredCoverageMs)} needed. It saves by itself when there is enough.`}
            </p>
            {unaligned && (
              <p className="text-[11px] text-destructive" role="alert">
                This player is not reporting its position, so the analysis cannot be tied to the song and will not be
                saved. Make sure it is playing, or use YouTube or a connected Spotify account.
              </p>
            )}
            {message && (
              <p className="text-[11px] text-destructive" role="alert">
                {message}
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={stop} disabled={state === 'saving'}>
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            Stop
          </Button>
        </>
      )}

      {state === 'saved' && (
        <p className="flex items-center gap-2 text-xs text-foreground" role="status">
          <Check className="h-4 w-4 text-primary" aria-hidden="true" />
          Saved. The chords will start rotating now.
        </p>
      )}

      {state === 'already' && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Someone just analyzed this track. Loading it…
        </p>
      )}
    </div>
  );
}
