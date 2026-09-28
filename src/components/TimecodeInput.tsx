import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatTime, parseTimecode } from '@/lib/timeFormat';

/**
 * A timestamp you can type, to the millisecond.
 *
 * Marking by ear gets a boundary or a chord close, and nudging walks it in;
 * the exact moment usually comes from reading it off somewhere else and typing
 * it. What is typed is held exactly as typed until it is committed -
 * reformatting between keystrokes would fight the caret - and the committed
 * value is shown back formatted, so a value the caller clamps is visibly the
 * value that was kept.
 */

interface TimecodeInputProps {
  valueMs: number;
  /** Given the parsed value on Enter or blur, never mid-typing. */
  onCommit: (ms: number) => void;
  disabled?: boolean;
  'aria-label': string;
  title?: string;
  className?: string;
}

export function TimecodeInput({
  valueMs,
  onCommit,
  disabled,
  title,
  className,
  'aria-label': ariaLabel,
}: TimecodeInputProps) {
  // null means "nothing typed yet", which is not the same as an empty box.
  const [typed, setTyped] = useState<string | null>(null);
  const invalid = typed !== null && parseTimecode(typed) === null;

  const commit = () => {
    if (typed === null) return;
    const ms = parseTimecode(typed);
    setTyped(null);
    if (ms !== null && ms !== valueMs) onCommit(ms);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      spellCheck={false}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      value={typed ?? formatTime(valueMs, true)}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Blur is what commits, so Enter and clicking away behave the same.
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setTyped(null);
      }}
      className={cn(
        'w-[5.5rem] min-h-11 rounded border border-border/60 bg-background px-1 text-center font-mono text-[11px] tabular-nums sm:min-h-8',
        'disabled:cursor-not-allowed disabled:opacity-60',
        invalid && 'border-destructive text-destructive',
        className
      )}
    />
  );
}
