import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface BarIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'type'> {
  /** The accessible name - and the hover tooltip too, unless `title` says otherwise. */
  label: string;
  children: ReactNode;
}

/**
 * A round, borderless icon button for the player bar. What differs between the
 * bar's buttons is only where they show (`hidden sm:inline-flex`, ...) and how
 * large they are at each breakpoint, so callers pass exactly that as
 * `className` and the shared look lives here.
 */
export function BarIconButton({ label, title = label, className = '', children, ...rest }: BarIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      className={`shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
