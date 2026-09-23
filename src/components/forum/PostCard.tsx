import { Award, Bookmark, MessageSquare, Share2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { timeAgo, type UserVote, type VoteDirection } from '@/lib/forum';
import type { ForumPost } from '@/services/forumService';
import { VoteButtons } from './VoteButtons';

interface PostCardProps {
  post: ForumPost;
  onVote: (postId: string, direction: VoteDirection, current: UserVote) => Promise<void>;
  onClick?: () => void;
  /** Show the whole body instead of a 3-line preview (the single-post view). */
  expanded?: boolean;
}

export function PostCard({ post, onVote, onClick, expanded = false }: PostCardProps) {
  return (
    <Card
      className={cn('p-4 transition-colors', onClick && 'cursor-pointer hover:border-border/80')}
      onClick={onClick}
    >
      <div className="flex gap-4">
        <VoteButtons
          count={post.vote_count}
          userVote={post.user_vote}
          onVote={(direction, current) => onVote(post.id, direction, current)}
        />

        <div className="min-w-0 flex-1">
          <div className="mb-2 text-xs text-muted-foreground">
            f/{post.forum.name} • {post.user?.display_name || 'anonymous'} • {timeAgo(post.created_at)}
          </div>

          <h3 className="mb-2 break-words text-lg font-bold">{post.title}</h3>

          {post.content && (
            <p
              className={cn(
                'mb-3 whitespace-pre-wrap break-words text-sm text-muted-foreground',
                !expanded && 'line-clamp-3'
              )}
            >
              {post.content}
            </p>
          )}

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1" aria-label={`${post.comment_count} comments`}>
              <MessageSquare className="h-4 w-4" />
              {post.comment_count}
            </span>
            <Award className="h-4 w-4" />
            <Share2 className="h-4 w-4" />
            <Bookmark className="h-4 w-4" />
          </div>
        </div>
      </div>
    </Card>
  );
}
