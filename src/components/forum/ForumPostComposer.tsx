import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useCreatePost } from '@/hooks/api/useForum';
import type { Forum } from '@/services/forumService';

const TITLE_MIN = 3;
const TITLE_MAX = 300;
const BODY_MAX = 10000;

interface ForumPostComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forums: Forum[];
  defaultForumId?: string;
}

export function ForumPostComposer({ open, onOpenChange, forums, defaultForumId }: ForumPostComposerProps) {
  const navigate = useNavigate();
  const createPost = useCreatePost();
  const [forumId, setForumId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (!open) return;
    setForumId(defaultForumId ?? forums[0]?.id ?? '');
    setTitle('');
    setContent('');
    // Only re-seed the form when it opens, not when the forum list refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedTitle = title.trim();
  const canSubmit =
    !!forumId && trimmedTitle.length >= TITLE_MIN && trimmedTitle.length <= TITLE_MAX && !createPost.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      const post = await createPost.mutateAsync({ forumId, title, content });
      toast({ title: 'Post created' });
      onOpenChange(false);
      navigate(`/forum/post/${post.id}`);
    } catch (error) {
      console.error('Error creating post:', error);
      toast({ title: 'Could not create post', description: 'Please try again.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create a post</DialogTitle>
            <DialogDescription>Share something with a forum.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="post-forum">Forum</Label>
            <Select value={forumId} onValueChange={setForumId}>
              <SelectTrigger id="post-forum">
                <SelectValue placeholder="Choose a forum" />
              </SelectTrigger>
              <SelectContent>
                {forums.map((forum) => (
                  <SelectItem key={forum.id} value={forum.id}>
                    f/{forum.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-title">Title</Label>
            <Input
              id="post-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
              placeholder="A short, descriptive title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-body">Text (optional)</Label>
            <Textarea
              id="post-body"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={BODY_MAX}
              rows={6}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createPost.isPending ? 'Posting…' : 'Post'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
