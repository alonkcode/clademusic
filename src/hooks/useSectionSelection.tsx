import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';

interface SectionSelection {
  /** Index into the track's sections, ordered by start time. */
  index: number;
  select: (index: number) => void;
}

const SectionSelectionContext = createContext<SectionSelection | null>(null);

/**
 * Shares "which section of this track am I looking at" between the section
 * chips above a track and the harmonic readout below it, so tapping a stanza
 * in either place moves both. Without it each control kept its own idea of the
 * current section and the two silently disagreed.
 *
 * Scoped per track: the selection resets when the card shows a different one.
 */
export function SectionSelectionProvider({
  trackId,
  children,
}: {
  trackId: string;
  children: ReactNode;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [trackId]);

  const value = useMemo<SectionSelection>(() => ({ index, select: setIndex }), [index]);

  return <SectionSelectionContext.Provider value={value}>{children}</SectionSelectionContext.Provider>;
}

/**
 * The shared selection, or null when the component is rendered outside a
 * provider - in which case callers keep their own local state.
 */
export function useSectionSelection(): SectionSelection | null {
  return useContext(SectionSelectionContext);
}
