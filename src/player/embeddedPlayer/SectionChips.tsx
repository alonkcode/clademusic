import { Repeat } from 'lucide-react';
import type { TrackSection } from '@/types';

interface SectionChipsProps {
  sections: TrackSection[];
  /** Display name per section, index-aligned with `sections` ("Verse 2"). */
  sectionNames: string[];
  currentSectionId: string | null | undefined;
  /** Why the active section matters; shown in its chip's tooltip. */
  sectionWhy: string | null;
  /** The section the playhead is in - the one the loop button acts on. */
  activeSection: TrackSection | null;
  loopSectionId: string | null | undefined;
  onSelect: (section: TrackSection) => void;
  /** Called with the section to loop, or null to stop looping. */
  onSetLoop: (sectionId: string | null) => void;
}

/** One-tap jump chips for a track's sections, plus a loop toggle for the active one. */
export function SectionChips({
  sections,
  sectionNames,
  currentSectionId,
  sectionWhy,
  activeSection,
  loopSectionId,
  onSelect,
  onSetLoop,
}: SectionChipsProps) {
  if (sections.length === 0) return null;

  const isLoopingActive = !!activeSection && loopSectionId === activeSection.id;

  return (
    <div className="mt-3 flex items-center gap-2">
      <div className="flex-1 flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        {sections.map((section, index) => {
          const isActive = currentSectionId === section.id;
          const sectionName = sectionNames[index];
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section)}
              className={[
                'flex-shrink-0 rounded-full px-3 py-1 text-[11px] md:text-xs font-semibold transition border',
                isActive
                  ? 'bg-primary text-primary-foreground border-primary/50'
                  : 'bg-muted/60 text-muted-foreground border-border/60 hover:bg-muted',
              ].join(' ')}
              aria-label={`Jump to ${sectionName}`}
              title={`Jump to ${sectionName}${sectionWhy && isActive ? ` — ${sectionWhy}` : ''}`}
            >
              {sectionName}
            </button>
          );
        })}
      </div>

      {activeSection && (
        <button
          type="button"
          onClick={() => onSetLoop(isLoopingActive ? null : activeSection.id)}
          className={[
            'inline-flex h-8 w-8 items-center justify-center rounded-full border transition',
            isLoopingActive
              ? 'border-primary/50 bg-primary/20 text-primary'
              : 'border-border/60 bg-muted/60 text-muted-foreground hover:bg-muted',
          ].join(' ')}
          aria-label={isLoopingActive ? 'Disable section loop' : 'Loop section'}
          title={isLoopingActive ? 'Disable section loop' : 'Loop section'}
        >
          <Repeat className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
