import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applyVoteToCount, nextVote, type UserVote, type VoteDirection } from '@/lib/forum';

interface VoteButtonsProps {
  count: number;
  userVote: UserVote;
  /** Should throw if the vote didn't go through; the arrows then roll back. */
  onVote: (direction: VoteDirection, current: UserVote) => Promise<void>;
  orientation?: 'vertical' | 'horizontal';
}

export function VoteButtons({ count, userVote, onVote, orientation = 'vertical' }: VoteButtonsProps) {
  const [localCount, setLocalCount] = useState(count);
  const [localVote, setLocalVote] = useState<UserVote>(userVote);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setLocalCount(count);
    setLocalVote(userVote);
  }, [count, userVote]);

  const press = async (direction: VoteDirection, e: React.MouseEvent) => {
    e.stopPropagation();
    if (pending) return;

    const previous = { count: localCount, vote: localVote };
    const next = nextVote(localVote, direction);
    setLocalVote(next);
    setLocalCount(applyVoteToCount(localCount, localVote, next));
    setPending(true);
    try {
      await onVote(direction, previous.vote);
    } catch {
      setLocalVote(previous.vote);
      setLocalCount(previous.count);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className={cn(
        'flex items-center gap-1',
        orientation === 'vertical' ? 'flex-col' : 'flex-row'
      )}
    >
      <button
        type="button"
        aria-label="Upvote"
        aria-pressed={localVote === 'up'}
        onClick={(e) => press('up', e)}
        className={cn('rounded p-0.5 hover:bg-accent', localVote === 'up' && 'text-primary')}
      >
        <ArrowUp className="h-5 w-5" />
      </button>

      <span className="min-w-[1.5rem] text-center text-sm font-bold">{localCount}</span>

      <button
        type="button"
        aria-label="Downvote"
        aria-pressed={localVote === 'down'}
        onClick={(e) => press('down', e)}
        className={cn('rounded p-0.5 hover:bg-accent', localVote === 'down' && 'text-destructive')}
      >
        <ArrowDown className="h-5 w-5" />
      </button>
    </div>
  );
}
