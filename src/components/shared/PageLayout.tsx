import { ReactNode } from 'react';
import { BottomNav } from '@/components/BottomNav';
import { ProfileCircle } from './ProfileCircle';

interface PageLayoutProps {
  /** Page title shown in header */
  title?: string;
  /** Custom header content (replaces title) */
  headerContent?: ReactNode;
  /** Right-aligned header action buttons */
  headerActions?: ReactNode;
  /** Main content */
  children: ReactNode;
  /** Use fixed header (default: sticky) */
  fixedHeader?: boolean;
  /** Hide bottom navigation */
  hideNav?: boolean;
  /** Additional class for main content */
  mainClassName?: string;
  /** Full-width content (no max-w constraint) */
  fullWidth?: boolean;
}

/**
 * Standard page layout wrapper with consistent header, main, and navigation.
 * Reduces duplication across pages by providing a common structure.
 */
export function PageLayout({
  title,
  headerContent,
  headerActions,
  children,
  fixedHeader = false,
  hideNav = false,
  mainClassName = '',
  fullWidth = false,
}: PageLayoutProps) {
  const headerPositionClass = fixedHeader
    ? 'fixed top-0 left-0 right-0'
    : 'sticky top-0';

  const containerWidth = fullWidth ? '' : 'max-w-7xl mx-auto';
  // A fixed header takes real content clearance (it's out of document
  // flow); a sticky one already occupies real space at the top, so it
  // only needs a small breathing-room gap, not that same clearance on top
  // of its own height. These used to both apply pt-16 *and* a separate
  // py-4 top padding regardless of which header style was in play -
  // stacking two paddings meant for two different reasons is what made
  // fixedHeader pages open with a large, empty dead zone before any
  // content (roughly double the header's own real height).
  const mainPadding = fixedHeader ? 'pt-20 pb-24' : 'pt-4 pb-24';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className={`z-40 glass-strong safe-top ${headerPositionClass}`}>
        {/* pl-14/16 (not px-4) clears BottomNav's own floating hamburger
            button, fixed at top-left independently of this header - without
            it the title/first header item renders directly under that
            button and is largely hidden behind it. */}
        <div className={`pl-14 sm:pl-16 pr-4 py-4 ${containerWidth}`}>
          {headerContent ? (
            headerContent
          ) : (
            <div className="grid grid-cols-3 items-center">
              <div className="flex items-center gap-3 justify-self-start min-w-0">
                {title ? <h1 className="text-xl font-bold truncate">{title}</h1> : null}
              </div>

              <div />

              <div className="flex items-center gap-3 justify-self-end">
                {headerActions}
                <ProfileCircle />
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className={`px-4 ${containerWidth} space-y-6 ${mainPadding} ${mainClassName}`}>
        {children}
      </main>

      {/* Bottom Navigation */}
      {!hideNav && <BottomNav />}
    </div>
  );
}
