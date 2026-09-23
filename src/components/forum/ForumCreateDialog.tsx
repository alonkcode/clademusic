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
import { useCreateForum } from '@/hooks/api/useForum';
import { FORUM_NAME_PATTERN, normalizeForumName } from '@/lib/forum';

const CATEGORIES = [
  { value: 'music', label: 'Music' },
  { value: 'regional', label: 'Regional' },
  { value: 'creation', label: 'Creation' },
  { value: 'education', label: 'Education' },
  { value: 'general', label: 'General' },
];

interface ForumCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ForumCreateDialog({ open, onOpenChange }: ForumCreateDialogProps) {
  const navigate = useNavigate();
  const createForum = useCreateForum();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');

  useEffect(() => {
    if (!open) return;
    setName('');
    setDisplayName('');
    setDescription('');
    setCategory('general');
  }, [open]);

  const normalizedName = normalizeForumName(name);
  const nameValid = FORUM_NAME_PATTERN.test(normalizedName);
  const canSubmit = nameValid && displayName.trim().length > 0 && !createForum.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      const forum = await createForum.mutateAsync({
        name: normalizedName,
        displayName,
        description,
        category,
      });
      toast({ title: `f/${forum.name} created`, description: "You're its first member." });
      onOpenChange(false);
      navigate(`/forum/${forum.name}`);
    } catch (error) {
      console.error('Error creating forum:', error);
      const taken = (error as { code?: string })?.code === '23505';
      toast({
        title: 'Could not create forum',
        description: taken ? 'That forum name is already taken.' : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create a forum</DialogTitle>
            <DialogDescription>Build a community around your passion.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="forum-name">Name</Label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">f/</span>
              <Input
                id="forum-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={21}
                placeholder="jazz_fans"
                autoComplete="off"
              />
            </div>
            <p className={`text-xs ${name && !nameValid ? 'text-destructive' : 'text-muted-foreground'}`}>
              3-21 characters: lowercase letters, numbers and underscores.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="forum-display-name">Display name</Label>
            <Input
              id="forum-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
              placeholder="Jazz Fans"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="forum-description">Description (optional)</Label>
            <Textarea
              id="forum-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="forum-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="forum-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createForum.isPending ? 'Creating…' : 'Create forum'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
