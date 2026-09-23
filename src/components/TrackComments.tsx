import { useMemo, useState } from 'react';
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
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface TrackCommentsProps {
  trackId: string;
  className?: string;
}

const failed = (title: string) => toast({ title, description: 'Please try again.', variant: 'destructive' });

export function TrackComments({ trackId, className = '' }: TrackCommentsProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

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

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !user || postComment.isPending) return;

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
        className={cn('space-y-2', isReply && 'ml-12')}
      >
        <div className="flex gap-3">
          <Avatar className="w-10 h-10 flex-shrink-0">
            {comment.user_avatar_url ? (
              <img src={comment.user_avatar_url} alt="" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-sm font-semibold">
                {comment.user_display_name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">
                {comment.user_display_name || 'Anonymous'}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
              </span>
              {comment.edited_at && (
                <span className="text-xs text-muted-foreground">(edited)</span>
              )}
            </div>

            {editingComment === comment.id ? (
              <div className="space-y-2">
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="min-h-[60px]"
                  maxLength={2000}
                />
                <div className="flex gap-2">
                  <Button size="sm" disabled={editComment.isPending} onClick={() => saveEdit(comment.id)}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
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

            {/* Actions */}
            <div className="flex items-center gap-4 mt-2">
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={comment.user_liked}
                aria-label={comment.user_liked ? 'Unlike' : 'Like'}
                className={cn(
                  'h-8 gap-1.5 text-xs',
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
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setReplyingTo(comment)}
                >
                  <Reply className="w-4 h-4" />
                  Reply
                </Button>
              )}

              {user?.id === comment.user_id && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Comment options">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingComment(comment.id);
                        setEditText(comment.comment);
                      }}
                    >
                      <Edit2 className="w-4 h-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-600"
                      onClick={() => removeComment(comment.id)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Show / hide replies */}
            {!isReply && replies.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs mt-2"
                onClick={() => setShowReplies((prev) => ({ ...prev, [comment.id]: !repliesOpen }))}
              >
                {repliesOpen
                  ? 'Hide replies'
                  : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
              </Button>
            )}
          </div>
        </div>

        {/* Replies */}
        <AnimatePresence>
          {!isReply && repliesOpen && replies.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="space-y-3 mt-3"
            >
              {replies.map((reply) => renderComment(reply, true))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <MessageSquare className="w-5 h-5" />
        <h3 className="text-lg font-semibold">Comments</h3>
        <Badge variant="secondary">{comments.length}</Badge>
      </div>

      {/* Post comment */}
      {user ? (
        <form onSubmit={submitComment} className="space-y-3">
          {replyingTo && (
            <div className="p-3 bg-muted rounded-lg flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                <Reply className="w-3 h-3 inline mr-1" />
                Replying to {replyingTo.user_display_name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReplyingTo(null)}
              >
                Cancel
              </Button>
            </div>
          )}
          <Textarea
            placeholder="Share your thoughts about this track..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="min-h-[100px] resize-none"
            maxLength={2000}
          />
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              {newComment.length}/2000
            </span>
            <Button type="submit" disabled={!newComment.trim() || postComment.isPending}>
              <Send className="w-4 h-4 mr-2" />
              {postComment.isPending ? 'Posting...' : replyingTo ? 'Reply' : 'Post Comment'}
            </Button>
          </div>
        </form>
      ) : (
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative overflow-hidden rounded-xl border-2 border-dashed border-border/50 bg-gradient-to-br from-background via-background to-muted/20 p-8 text-center"
        >
          {/* Animated background gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#00F5FF]/5 via-[#FF00FF]/5 to-[#00F5FF]/5 animate-pulse" />

          {/* Content */}
          <div className="relative z-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-[#00F5FF] to-[#FF00FF] mb-4">
              <MessageSquare className="w-8 h-8 text-white" />
            </div>

            <h4 className="text-lg font-semibold mb-2 flex items-center justify-center gap-2">
              Join the Conversation
              <Sparkles className="w-4 h-4 text-[#FF00FF]" />
            </h4>

            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Sign up to share your thoughts, reply to others, and connect with music lovers who get it
            </p>

            <Button
              size="lg"
              onClick={() => navigate('/auth')}
              className="bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] hover:opacity-90 transition-opacity shadow-lg shadow-[#00F5FF]/20"
            >
              <UserPlus className="w-5 h-5 mr-2" />
              Sign Up to Comment
            </Button>

            <p className="text-xs text-muted-foreground mt-4">
              Already have an account?{' '}
              <button
                onClick={() => navigate('/auth')}
                className="text-[#00F5FF] hover:underline font-medium"
              >
                Sign in
              </button>
            </p>
          </div>
        </motion.div>
      )}

      {/* Comments list */}
      <div className="space-y-6">
        {isLoading ? (
          <div className="text-center py-8">
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
