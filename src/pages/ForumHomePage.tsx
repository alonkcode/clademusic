/// <reference lib="dom.iterable" />
/// <reference lib="es2015.iterable" />

import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { CladeBrand, ProfileCircle } from '@/components/shared';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, TrendingUp, Plus } from 'lucide-react';
import {
  useForumByName,
  useForumPost,
  useForumPosts,
  useForums,
  useForumVote,
  useMyForumMemberships,
  useToggleMembership,
} from '@/hooks/api/useForum';
import type { UserVote, VoteDirection } from '@/lib/forum';
import type { Forum, ForumSort } from '@/services/forumService';
import { PostCard } from '@/components/forum/PostCard';
import { ForumPostComposer } from '@/components/forum/ForumPostComposer';
import { ForumCreateDialog } from '@/components/forum/ForumCreateDialog';
import { ForumCommentThread } from '@/components/forum/ForumCommentThread';

const Spinner = () => (
  <div className="text-center py-12">
    <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-current border-r-transparent" />
  </div>
);

export function ForumHomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // /forum, /forum/:forumName and /forum/post/:postId all render this same
  // component (see App.tsx), so the params decide which view to show.
  const { forumName, postId } = useParams<{ forumName?: string; postId?: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<ForumSort>('hot');
  const [composerOpen, setComposerOpen] = useState(false);
  const [createForumOpen, setCreateForumOpen] = useState(false);

  const { data: forums = [] } = useForums();
  const { data: memberships = [] } = useMyForumMemberships();
  const { data: currentForum = null, isLoading: forumLoading } = useForumByName(forumName);
  const { data: singlePost, isLoading: singlePostLoading } = useForumPost(postId);
  const { data: posts = [], isLoading: postsLoading } = useForumPosts({
    sort: sortBy,
    forumId: currentForum?.id,
    enabled: !forumName || !!currentForum,
  });
  const toggleMembership = useToggleMembership();
  const castVote = useForumVote();

  const forumMissing = !!forumName && !forumLoading && !currentForum;

  const filteredForums = useMemo(() => {
    if (!searchQuery.trim()) return forums;
    const q = searchQuery.toLowerCase();
    return forums.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.display_name.toLowerCase().includes(q) ||
        (f.description || '').toLowerCase().includes(q)
    );
  }, [forums, searchQuery]);

  const filteredPosts = useMemo(() => {
    if (!searchQuery.trim()) return posts;
    const q = searchQuery.toLowerCase();
    return posts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.content || '').toLowerCase().includes(q) ||
        p.forum.display_name.toLowerCase().includes(q) ||
        p.forum.name.toLowerCase().includes(q) ||
        (p.user?.display_name || '').toLowerCase().includes(q)
    );
  }, [posts, searchQuery]);

  const requireSignIn = () => {
    if (user) return true;
    navigate('/auth');
    return false;
  };

  const handlePostVote = async (id: string, direction: VoteDirection, current: UserVote) => {
    if (!requireSignIn()) throw new Error('Sign in required');
    try {
      await castVote.mutateAsync({ target: 'post', id, current, direction });
    } catch (error) {
      console.error('Error voting on post:', error);
      toast({ title: 'Vote failed', description: 'Please try again.', variant: 'destructive' });
      throw error;
    }
  };

  const handleToggleMembership = async (forum: Forum) => {
    if (!requireSignIn()) return;
    const joined = memberships.includes(forum.id);
    try {
      await toggleMembership.mutateAsync({ forumId: forum.id, joined });
      toast({ title: joined ? `Left f/${forum.name}` : `Joined f/${forum.name}` });
    } catch (error) {
      console.error('Error updating membership:', error);
      toast({
        title: joined ? 'Could not leave forum' : 'Could not join forum',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4">
          {/* Wraps on a phone: brand and actions on one row, search below them.
              As a single row the actions ran off the right edge. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex items-center gap-3">
              <CladeBrand size="sm" />
              <h1 className="text-2xl font-bold">Forums</h1>
            </div>

            <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1 max-w-2xl">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search forums and posts..."
                  className="pl-10"
                />
              </div>
            </div>

            <div className="ml-auto flex items-center gap-3 sm:ml-0">
              <Button onClick={() => requireSignIn() && setComposerOpen(true)}>
                <Plus className="h-5 w-5 mr-2" />
                Create Post
              </Button>

              <NotificationBell />
              <ProfileCircle />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            {(['hot', 'new', 'top'] as const).map((sort) => (
              <Button
                key={sort}
                variant={sortBy === sort ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSortBy(sort)}
              >
                {sort === 'hot' && <TrendingUp className="h-4 w-4 mr-2" />}
                <span>{sort.charAt(0).toUpperCase() + sort.slice(1)}</span>
              </Button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {(forumName || postId) && (
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/forum" className="hover:text-foreground transition">Forums</Link>
            {forumName && <><span>/</span><span className="text-foreground">f/{forumName}</span></>}
            {postId && <><span>/</span><span className="text-foreground">{singlePost?.title ?? 'post'}</span></>}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {postId ? (
              singlePostLoading ? (
                <Spinner />
              ) : !singlePost ? (
                <Card className="p-8 text-center text-muted-foreground">
                  This post doesn't exist or was removed.
                </Card>
              ) : (
                <>
                  <PostCard post={singlePost} onVote={handlePostVote} expanded />
                  <ForumCommentThread postId={singlePost.id} isLocked={!!singlePost.is_locked} />
                </>
              )
            ) : forumMissing ? (
              <Card className="p-8 text-center text-muted-foreground">
                f/{forumName} doesn't exist.
              </Card>
            ) : postsLoading || forumLoading ? (
              <Spinner />
            ) : filteredPosts.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                {forumName ? `No posts in f/${forumName} yet.` : 'No posts yet.'}
              </Card>
            ) : (
              filteredPosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onVote={handlePostVote}
                  onClick={() => navigate(`/forum/post/${post.id}`)}
                />
              ))
            )}
          </div>

          <div className="space-y-4">
            <Card className="p-4">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Popular Forums
              </h2>

              <div className="space-y-3">
                {filteredForums.map((forum) => {
                  const joined = memberships.includes(forum.id);
                  return (
                    // A <button> containing the real "Join" <button> below is
                    // invalid HTML (React warns on it) and behaves
                    // inconsistently across browsers - a div with button
                    // semantics gets the same clickability and keyboard access
                    // without nesting one interactive element inside another.
                    // Plain div, not motion.div: framer-motion gesture props
                    // attach their own native pointer listeners, separate from
                    // React's synthetic events, so Join's stopPropagation()
                    // had no effect on them and the row's onClick fired too.
                    <div
                      key={forum.id}
                      role="button"
                      tabIndex={0}
                      // Without an explicit label the row's accessible name is
                      // its full text content ("f/music 0 members Join"),
                      // swallowing the nested Join button's own name.
                      aria-label={`Open f/${forum.name}`}
                      onClick={() => navigate(`/forum/${forum.name}`)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/forum/${forum.name}`);
                        }
                      }}
                      // No hover:translate-x - shifting the row (and the Join
                      // button riding along with it) mid-click can leave
                      // mouseup landing past where the button moved to, which
                      // let a Join click fall through to this row's onClick.
                      className="w-full text-left p-3 rounded-lg hover:bg-accent transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold">f/{forum.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {forum.member_count.toLocaleString()} members
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={joined ? 'secondary' : 'outline'}
                          disabled={toggleMembership.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleMembership(forum);
                          }}
                        >
                          {joined ? 'Joined' : 'Join'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="text-lg font-bold mb-2">Create a Forum</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Build a community around your passion
              </p>
              <Button className="w-full" onClick={() => requireSignIn() && setCreateForumOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Forum
              </Button>
            </Card>
          </div>
        </div>
      </div>

      <ForumPostComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        forums={forums}
        defaultForumId={currentForum?.id}
      />
      <ForumCreateDialog open={createForumOpen} onOpenChange={setCreateForumOpen} />
    </div>
  );
}
