import { Heart, MessageSquare, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrackMobileActionsProps {
  liked: boolean;
  commentCount: number;
  onLike: () => void;
  onComments: () => void;
  onShare: () => void;
  className?: string;
}

// A 44px-tall row of labelled buttons. Hover styling only where hover exists, or
// a tapped button stays highlighted until the next tap elsewhere.
const ACTION =
  'flex min-h-11 items-center justify-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 text-sm font-medium text-foreground transition-colors active:bg-muted [@media(hover:hover)]:hover:bg-muted';

/**
 * Like / comments / share as an in-flow row for phones.
 *
 * These used to be a fixed, vertically centred rail floating over the page. A
 * fixed rail covers whatever scrolls beneath it - here the last tab and the
 * comment composer's send button - at some scroll position on every phone, and
 * two of its three buttons did nothing (a random like count, and a comment
 * button whose selector matched nothing).
 */
export function TrackMobileActions({
  liked,
  commentCount,
  onLike,
  onComments,
  onShare,
  className,
}: TrackMobileActionsProps) {
  return (
    <div className={cn('grid grid-cols-3 gap-2 md:hidden', className)} role="group" aria-label="Track actions">
      <button type="button" onClick={onLike} aria-pressed={liked} className={ACTION}>
        <Heart className={cn('h-5 w-5', liked && 'fill-red-500 text-red-500')} aria-hidden="true" />
        <span>{liked ? 'Liked' : 'Like'}</span>
      </button>

      <button type="button" onClick={onComments} className={ACTION} aria-label={`Comments, ${commentCount}`}>
        <MessageSquare className="h-5 w-5" aria-hidden="true" />
        <span>{commentCount > 0 ? commentCount : 'Comments'}</span>
      </button>

      <button type="button" onClick={onShare} className={ACTION}>
        <Share2 className="h-5 w-5" aria-hidden="true" />
        <span>Share</span>
      </button>
    </div>
  );
}
