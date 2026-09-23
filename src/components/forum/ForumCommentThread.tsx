import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Reply, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  useAddPostComment,
  useDeletePostComment,
  useForumCommentsRealtime,
  useForumVote,
  usePostComments,
} from '@/hooks/api/useForum';
import { buildCommentTree, timeAgo, type CommentNode, type UserVote, type VoteDirection } from '@/lib/forum';
import type { ForumComment } from '@/services/forumService';
import { VoteButtons } from './VoteButtons';

const MAX_COMMENT_LENGTH = 10000;
// Deeper replies stop indenting so long threads stay readable on a phone.
const MAX_INDENT_DEPTH = 5;

interface CommentComposerProps {
  placeholder: string;
  submitLabel: string;
  onSubmit: (content: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
}

function CommentComposer({ placeholder, submitLabel, onSubmit, onCancel, autoFocus }: CommentComposerProps) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;

    setSubmitting(true);
    try {
      await onSubmit(content);
      setContent('');
    } catch {
      // The caller already told the user; keep their text so they can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        maxLength={MAX_COMMENT_LENGTH}
        rows={3}
        autoFocus={autoFocus}
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!content.trim() || submitting}>
          {submitting ? 'Posting…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

interface CommentItemProps {
  node: CommentNode<ForumComment>;
  currentUserId: string | undefined;
  commentsEnabled: boolean;
  onReply: (parentId: string, content: string) => Promise<void>;
  onDelete: (commentId: string) => void;
  onVote: (commentId: string, direction: VoteDirection, current: UserVote) => Promise<void>;
}

function CommentItem({ node, currentUserId, commentsEnabled, onReply, onDelete, onVote }: CommentItemProps) {
  const { comment } = node;
  const [replying, setReplying] = useState(false);
  const isOwn = !!currentUserId && comment.user_id === currentUserId;

  return (
    <div>
      <div className="py-3">
        <div className="mb-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{comment.user?.display_name || 'anonymous'}</span>
          {' • '}
          {timeAgo(comment.created_at)}
        </div>

        <p
          className={
            comment.is_deleted
              ? 'text-sm italic text-muted-foreground'
              : 'whitespace-pre-wrap break-words text-sm'
          }
        >
          {comment.is_deleted ? '[deleted]' : comment.content}
        </p>

        {!comment.is_deleted && (
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <VoteButtons
              orientation="horizontal"
              count={comment.vote_count}
              userVote={comment.user_vote}
              onVote={(direction, current) => onVote(comment.id, direction, current)}
            />
            {commentsEnabled && (
              <button
                type="button"
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => setReplying((v) => !v)}
              >
                <Reply className="h-3.5 w-3.5" />
                Reply
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                className="flex items-center gap-1 hover:text-destructive"
                onClick={() => onDelete(comment.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
          </div>
        )}

        {replying && (
          <div className="mt-3">
            <CommentComposer
              autoFocus
              placeholder="Write a reply…"
              submitLabel="Reply"
              onCancel={() => setReplying(false)}
              onSubmit={async (content) => {
                await onReply(comment.id, content);
                setReplying(false);
              }}
            />
          </div>
        )}
      </div>

      {node.children.length > 0 && (
        <div className={node.depth < MAX_INDENT_DEPTH ? 'ml-4 border-l border-border pl-4' : ''}>
          {node.children.map((child) => (
            <CommentItem
              key={child.comment.id}
              node={child}
              currentUserId={currentUserId}
              commentsEnabled={commentsEnabled}
              onReply={onReply}
              onDelete={onDelete}
              onVote={onVote}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ForumCommentThreadProps {
  postId: string;
  isLocked?: boolean;
}

export function ForumCommentThread({ postId, isLocked = false }: ForumCommentThreadProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const commentsEnabled = !isLocked;

  const { data: comments = [], isLoading, isError } = usePostComments(postId);
  const addComment = useAddPostComment(postId);
  const deleteComment = useDeletePostComment(postId);
  const castVote = useForumVote();
  useForumCommentsRealtime(postId);

  const tree = useMemo(() => buildCommentTree(comments), [comments]);

  const post = async (content: string, parentId: string | null) => {
    if (!user) {
      navigate('/auth');
      throw new Error('Sign in required');
    }

    try {
      await addComment.mutateAsync({ content, parentId });
    } catch (error) {
      console.error('Error posting comment:', error);
      toast({ title: 'Could not post comment', description: 'Please try again.', variant: 'destructive' });
      throw error;
    }
  };

  const handleDelete = (commentId: string) => {
    deleteComment.mutate(commentId, {
      onError: () =>
        toast({ title: 'Could not delete comment', description: 'Please try again.', variant: 'destructive' }),
    });
  };

  const handleVote = async (commentId: string, direction: VoteDirection, current: UserVote) => {
    if (!user) {
      navigate('/auth');
      throw new Error('Sign in required');
    }
    try {
      await castVote.mutateAsync({ target: 'comment', id: commentId, current, direction });
    } catch (error) {
      console.error('Error voting on comment:', error);
      toast({ title: 'Vote failed', description: 'Please try again.', variant: 'destructive' });
      throw error;
    }
  };

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <h2 className="text-lg font-bold">
        {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
      </h2>

      {commentsEnabled ? (
        user ? (
          <CommentComposer
            placeholder="What are your thoughts?"
            submitLabel="Comment"
            onSubmit={(content) => post(content, null)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            <Link to="/auth" className="text-primary underline">
              Sign in
            </Link>{' '}
            to join the discussion.
          </p>
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          This post is locked.
        </p>
      )}

      {isLoading ? (
        <div className="py-6 text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-current border-r-transparent" />
        </div>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">Comments couldn't be loaded.</p>
      ) : tree.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet. Start the conversation.</p>
      ) : (
        <div className="divide-y divide-border/60">
          {tree.map((node) => (
            <CommentItem
              key={node.comment.id}
              node={node}
              currentUserId={user?.id}
              commentsEnabled={commentsEnabled}
              onReply={(parentId, content) => post(content, parentId)}
              onDelete={handleDelete}
              onVote={handleVote}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
