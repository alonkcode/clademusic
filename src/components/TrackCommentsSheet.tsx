import { MessageSquare, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { TrackComments } from '@/components/TrackComments';

interface TrackCommentsSheetProps {
  trackId: string;
  trackTitle?: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A track's comment thread as a bottom sheet with its own scroll.
 *
 * The feed card has a fixed, overflow-hidden height (one card fills the screen),
 * so a thread expanded inline was simply clipped - the newest comments, and on a
 * small phone even the composer, sat below the fold with nothing to scroll.
 * Here the thread gets a dedicated scroll container, and because the sheet is
 * portalled out of the feed, scrolling it can't be read as a swipe to the next
 * track.
 */
export function TrackCommentsSheet({ trackId, trackTitle, count, open, onOpenChange }: TrackCommentsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideClose
        // Sits on top of the docked player bar instead of under it, so the last
        // comments and the player controls both stay reachable. The player
        // publishes its height as --clade-player-height (unset when closed).
        style={{
          bottom: 'var(--clade-player-height, 0px)',
          height: 'min(85dvh, calc(100dvh - var(--clade-player-height, 0px) - 4rem))',
        }}
        className="mx-auto flex w-full max-w-xl flex-col gap-0 rounded-t-3xl p-0"
      >
        <SheetHeader className="flex-row items-center justify-between space-y-0 border-b border-border/60 py-1 pl-4 pr-2 text-left sm:text-left">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare className="h-5 w-5 shrink-0" aria-hidden="true" />
            <SheetTitle className="text-base">Comments</SheetTitle>
            <Badge variant="secondary">{count}</Badge>
          </div>
          <SheetDescription className="sr-only">
            {trackTitle ? `Discussion about ${trackTitle}` : 'Discussion about this track'}
          </SheetDescription>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Close comments">
              <X className="h-5 w-5" />
            </Button>
          </SheetClose>
        </SheetHeader>

        {/* overscroll-contain: reaching the end of the thread must not chain the
            gesture into the page behind. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <TrackComments trackId={trackId} hideHeader />
        </div>
      </SheetContent>
    </Sheet>
  );
}
