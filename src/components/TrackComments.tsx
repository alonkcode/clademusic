import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, Heart, Reply, Edit2, Trash2, MoreVertical, UserPlus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { useRateLimitGuard, useSetting } from '@/hooks/useSystemSettings';
import { toast } from '@/hooks/use-toast';
import {
  useDeleteTrackComment,
  useEditTrackComment,
  usePostTrackComment,
  useToggleCommentLike,
  useTrackComments,
  useTrackCommentsRealtime,
} from '@/hooks/api/useComments';
import { groupComments, type TrackComment } from '@/lib/trackComments';
import { useNavigate } from 'react-router-dom';
import { timeAgo } from '@/lib/forum';
import { cn } from '@/lib/utils';

interface TrackCommentsProps {
  trackId: string;
  className?: string;
  /** Skip the "Comments (n)" heading when a surrounding sheet already shows it. */
  hideHeader?: boolean;
}

const failed = (title: string) => toast({ title, description: 'Please try again.', variant: 'destructive' });

// Inputs under 16px make iOS Safari zoom the page on focus, so mobile is text-base.
const INPUT_TEXT = 'text-base sm:text-sm';
// 44px is the minimum comfortable touch target; desktop keeps the compact size.
const TOUCH = 'h-11 sm:h-8';
const COMPOSER_MAX_PX = 140;
// Touch browsers keep :hover applied after a tap, which left every tapped ghost
// button as a solid pink pill until the next tap elsewhere. Only style hover
// where hover exists. (keepTextColor: a liked heart must stay red.)
const noStickyHover = (keepTextColor = false) =>
  cn('[@media(hover:none)]:hover:bg-transparent', !keepTextColor && '[@media(hover:none)]:hover:text-inherit');

export function TrackComments({ trackId, className = '', hideHeader = false }: TrackCommentsProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const commentsEnabled = useSetting('flag.comments_enabled');
  const allowCommentPost = useRateLimitGuard('limit.comments');

  const { data: comments = [], isLoading } = useTrackComments(trackId);
  useTrackCommentsRealtime(trackId);
  const postComment = usePostTrackComment(trackId);
  const editComment = useEditTrackComment(trackId);
  const deleteComment = useDeleteTrackComment(trackId);
  const toggleLike = useToggleCommentLike(trackId);

  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<TrackComment | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showReplies, setShowReplies] = useState<Record<string, boolean>>({});

  const { roots, repliesByRoot } = useMemo(() => groupComments(comments), [comments]);

  // Grows with what is typed (up to a few lines) instead of a fixed block.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [newComment]);

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !user || postComment.isPending) return;
    if (!commentsEnabled || !allowCommentPost()) return;

    const parent = replyingTo;
    try {
      await postComment.mutateAsync({ comment: newComment, replyTo: parent?.id });
      setNewComment('');
      setReplyingTo(null);
      // Show the reply that was just posted rather than leaving it collapsed.
      if (parent) setShowReplies((prev) => ({ ...prev, [parent.id]: true }));
    } catch (error) {
      console.error('Error posting comment:', error);
      failed('Could not post comment');
    }
  };

  const handleLike = (comment: TrackComment) => {
    if (!user) {
      navigate('/auth');
      return;
    }
    toggleLike.mutate(
      { commentId: comment.id, liked: comment.user_liked },
      { onError: () => failed('Could not update like') }
    );
  };

  const saveEdit = async (commentId: string) => {
    if (!editText.trim()) return;

    try {
      await editComment.mutateAsync({ commentId, comment: editText });
      setEditingComment(null);
      setEditText('');
    } catch (error) {
      console.error('Error editing comment:', error);
      failed('Could not save edit');
    }
  };

  const removeComment = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;

    try {
      await deleteComment.mutateAsync(commentId);
    } catch (error) {
      console.error('Error deleting comment:', error);
      failed('Could not delete comment');
    }
  };

  const renderComment = (comment: TrackComment, isReply = false) => {
    const replies = repliesByRoot.get(comment.id) ?? [];
    const repliesOpen = !!showReplies[comment.id];

    return (
      <motion.div
        key={comment.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        // A 48px indent left replies about 250px of text on a phone.
        className={cn('space-y-1 sm:space-y-2', isReply && 'ml-6 sm:ml-12')}
      >
        <div className="flex gap-2.5 sm:gap-3">
          <Avatar className={cn('flex-shrink-0', isReply ? 'h-7 w-7 sm:h-8 sm:w-8' : 'h-9 w-9 sm:h-10 sm:w-10')}>
            {comment.user_avatar_url ? (
              <img src={comment.user_avatar_url} alt="" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-semibold sm:text-sm">
                {comment.user_display_name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
          </Avatar>

          <div className="flex-1 min-w-0">
            {/* The name truncates and the time never wraps, so a long display
                name can't push "about 2 hours ago" onto a second line. */}
            <div className="mb-0.5 flex min-w-0 items-baseline gap-x-2 sm:mb-1">
              <span className="min-w-0 truncate font-medium text-sm">
                {comment.user_display_name || 'Anonymous'}
              </span>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {timeAgo(comment.created_at)}
              </span>
              {comment.edited_at && (
                <span className="shrink-0 text-xs text-muted-foreground">(edited)</span>
              )}
            </div>

            {editingComment === comment.id ? (
              <div className="space-y-2">
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className={cn('min-h-[72px]', INPUT_TEXT)}
                  maxLength={2000}
                  aria-label="Edit your comment"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="h-11 sm:h-9" disabled={editComment.isPending} onClick={() => saveEdit(comment.id)}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn('h-11 sm:h-9', noStickyHover())}
                    onClick={() => {
                      setEditingComment(null);
                      setEditText('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm break-words whitespace-pre-wrap">{comment.comment}</p>
            )}

            {/* Actions. Each button carries its own 44px hit area, so the row
                is pulled left to keep the icons aligned with the text above.
                "View replies" lives in the same row rather than a second 44px
                row of its own, which nearly doubled each comment's height. */}
            <div className="-ml-2.5 mt-0.5 flex flex-wrap items-center gap-0.5 sm:ml-0 sm:mt-2 sm:gap-4">
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={comment.user_liked}
                aria-label={comment.user_liked ? 'Unlike' : 'Like'}
                className={cn(
                  TOUCH,
                  'min-w-11 gap-1.5 text-xs sm:min-w-0',
                  noStickyHover(comment.user_liked),
                  comment.user_liked && 'text-red-500 hover:text-red-600'
                )}
                onClick={() => handleLike(comment)}
              >
                <Heart className={cn('w-4 h-4', comment.user_liked && 'fill-current')} />
                {comment.likes_count > 0 && comment.likes_count}
              </Button>

              {!isReply && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(TOUCH, 'gap-1.5 text-xs', noStickyHover())}
                  onClick={() => setReplyingTo(comment)}
                >
                  <Reply className="w-4 h-4" />
                  Reply
                </Button>
              )}

              {!isReply && replies.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(TOUCH, 'text-xs', noStickyHover())}
                  aria-expanded={repliesOpen}
                  onClick={() => setShowReplies((prev) => ({ ...prev, [comment.id]: !repliesOpen }))}
                >
                  {repliesOpen
                    ? 'Hide replies'
                    : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                </Button>
              )}

              {user?.id === comment.user_id && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className={cn(TOUCH, 'w-11 p-0 sm:w-8', noStickyHover())} aria-label="Comment options">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="min-h-11 sm:min-h-0"
                      onClick={() => {
                        setEditingComment(comment.id);
                        setEditText(comment.comment);
                      }}
                    >
                      <Edit2 className="w-4 h-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="min-h-11 text-red-600 sm:min-h-0"
                      onClick={() => removeComment(comment.id)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>

        {/* Replies */}
        <AnimatePresence>
          {!isReply && repliesOpen && replies.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-2 space-y-3 sm:mt-3"
            >
              {replies.map((reply) => renderComment(reply, true))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <div className={cn('space-y-5 sm:space-y-6', className)}>
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Comments</h3>
          <Badge variant="secondary">{comments.length}</Badge>
        </div>
      )}

      {/* Post comment */}
      {!commentsEnabled ? (
        <p className="rounded-lg border border-dashed border-border/50 p-4 text-center text-sm text-muted-foreground">
          Commenting is temporarily turned off.
        </p>
      ) : user ? (
        <form onSubmit={submitComment} className="space-y-2 sm:space-y-3">
          {replyingTo && (
            <div className="flex items-center justify-between rounded-lg bg-muted py-1 pl-3 pr-1 sm:py-3 sm:pr-3">
              <span className="min-w-0 truncate text-sm text-muted-foreground">
                <Reply className="w-3 h-3 inline mr-1" />
                Replying to {replyingTo.user_display_name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn('h-11 shrink-0 sm:h-9', noStickyHover())}
                onClick={() => setReplyingTo(null)}
              >
                Cancel
              </Button>
            </div>
          )}
          {/* On a phone the input and an icon-only send button share one row (a
              stacked textarea + labelled button cost ~30% of a small screen
              before the first comment); from `sm` up it is the roomier stack. */}
          <div className="flex items-end gap-2 sm:flex-col sm:items-stretch sm:gap-3">
            <Textarea
              ref={composerRef}
              rows={1}
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              className={cn('min-h-[48px] flex-1 resize-none sm:min-h-[100px] sm:flex-none', INPUT_TEXT)}
              maxLength={2000}
              aria-label="Write a comment"
            />
            <div className="flex shrink-0 items-center justify-between gap-3 sm:w-full sm:shrink">
              {/* The count only matters near the limit on a phone, and once there
                  is something to count elsewhere. */}
              <span
                className={cn('text-xs text-muted-foreground', newComment.length >= 1800 ? 'inline' : 'hidden sm:inline')}
                aria-live="off"
              >
                {newComment.length > 0 ? `${newComment.length}/2000` : ''}
              </span>
              <Button
                type="submit"
                aria-label={postComment.isPending ? 'Posting comment' : replyingTo ? 'Post reply' : 'Post comment'}
                className="h-11 w-11 p-0 sm:h-10 sm:w-auto sm:px-4"
                disabled={!newComment.trim() || postComment.isPending}
              >
                <Send className="h-4 w-4 sm:mr-2" />
                <span className="sr-only sm:not-sr-only">
                  {postComment.isPending ? 'Posting...' : replyingTo ? 'Reply' : 'Post Comment'}
                </span>
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative overflow-hidden rounded-xl border-2 border-dashed border-border/50 bg-gradient-to-br from-background via-background to-muted/20 p-4 text-center sm:p-8"
        >
          {/* Animated background gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#00F5FF]/5 via-[#FF00FF]/5 to-[#00F5FF]/5 motion-safe:animate-pulse" />

          {/* Content. Compact on a phone (no hero icon): this sits above every
              comment, and at full size it pushed them all below the fold. */}
          <div className="relative z-10">
            <div className="mb-4 hidden h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#00F5FF] to-[#FF00FF] sm:inline-flex">
              <MessageSquare className="h-8 w-8 text-white" />
            </div>

            <h4 className="mb-1 flex items-center justify-center gap-2 text-base font-semibold sm:mb-2 sm:text-lg">
              Join the Conversation
              <Sparkles className="w-4 h-4 text-[#FF00FF]" />
            </h4>

            <p className="mx-auto mb-3 max-w-md text-xs text-muted-foreground sm:mb-6 sm:text-sm">
              Sign up to share your thoughts, reply to others, and connect with music lovers who get it
            </p>

            <Button
              size="lg"
              onClick={() => navigate('/auth')}
              className="w-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] shadow-lg shadow-[#00F5FF]/20 transition-opacity hover:opacity-90 sm:w-auto"
            >
              <UserPlus className="w-5 h-5 mr-2" />
              Sign Up to Comment
            </Button>

            <p className="mt-2 text-xs text-muted-foreground sm:mt-4">
              Already have an account?{' '}
              <button
                onClick={() => navigate('/auth')}
                className="inline-flex min-h-11 items-center px-1 font-medium text-[#00F5FF] hover:underline sm:min-h-0"
              >
                Sign in
              </button>
            </p>
          </div>
        </motion.div>
      )}

      {/* Comments list */}
      <div className="space-y-5 sm:space-y-6">
        {isLoading ? (
          <div className="text-center py-8" role="status" aria-label="Loading comments">
            <div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : roots.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              No comments yet. Be the first to share your thoughts!
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {roots.map((comment) => renderComment(comment))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
