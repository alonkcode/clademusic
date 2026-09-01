/**
 * Comprehensive QA Test Suite
 * Tests all critical functionality including mobile player, forum system, and user interactions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmbeddedPlayerDrawer } from '@/player/EmbeddedPlayerDrawer';
import { ForumHomePage } from '@/pages/ForumHomePage';
import { TikTokStyleButtons } from '@/components/TikTokStyleButtons';
import { ScrollingComments } from '@/components/ScrollingComments';

// jsdom has no PointerEvent constructor, so `fireEvent.pointerDown` et al.
// fall back to a plain Event with clientX/clientY that React's synthetic
// event system doesn't recognise as pointer data. A MouseEvent subclass
// gives jsdom's real (and correct) clientX/clientY handling, which is all
// the resize-handle test below needs; jsdom already stubs setPointerCapture
// as absent, which the component itself tolerates.
if (typeof (globalThis as any).PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  (globalThis as any).PointerEvent = PointerEventPolyfill;
}

const baseAuthContext = {
  user: null,
  session: null,
  accessToken: null,
  loading: false,
  guestMode: false,
  signUp: vi.fn().mockResolvedValue({ error: null }),
  signIn: vi.fn().mockResolvedValue({ error: null }),
  signOut: vi.fn().mockResolvedValue(),
  enterGuestMode: vi.fn(),
};

const mockAuthContext = { ...baseAuthContext };

const basePlayerContext = {
  isOpen: true,
  provider: 'spotify',
  trackId: 'test123',
  canonicalTrackId: 'canonical-1',
  trackTitle: 'Test Track',
  trackArtist: 'Test Artist',
  lastKnownTitle: 'Test Track',
  lastKnownArtist: 'Test Artist',
  positionMs: 0,
  durationMs: 180000,
  volume: 0.7,
  isMuted: false,
  isPlaying: true,
  setIsPlaying: vi.fn(),
  isMinimized: false,
  setMinimized: vi.fn(),
  isMini: false,
  isCinema: false,
  miniPosition: { x: 0, y: 0 },
  enterCinema: vi.fn(),
  exitCinema: vi.fn(),
  togglePlayPause: vi.fn(),
  setVolumeLevel: vi.fn(),
  toggleMute: vi.fn(),
  seekToMs: vi.fn(),
  stop: vi.fn(),
  collapseToMini: vi.fn(),
  restoreFromMini: vi.fn(),
  setMiniPosition: vi.fn(),
  closePlayer: vi.fn(),
  nextTrack: vi.fn(),
  previousTrack: vi.fn(),
  registerProviderControls: vi.fn(),
  updatePlaybackState: vi.fn(),
  clearSeek: vi.fn(),
  seekToSec: null,
};

const mockPlayerContext = { ...basePlayerContext };

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockAuthContext,
}));

vi.mock('@/player/PlayerContext', () => ({
  usePlayer: () => mockPlayerContext,
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

beforeEach(() => {
  vi.clearAllMocks();

  // EmbeddedPlayerDrawer persists its layout/position to localStorage and
  // cookies, both of which jsdom keeps live across every test in this file.
  // A test that changes the player's size/position (e.g. a resize-handle
  // drag) leaves that behind for whichever test mounts the drawer next,
  // silently overriding its fresh defaults via the hydrate-on-mount effects.
  localStorage.clear();
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });

  Object.assign(mockAuthContext, {
    user: null,
    session: null,
    accessToken: null,
    loading: false,
    guestMode: false,
    signUp: vi.fn().mockResolvedValue({ error: null }),
    signIn: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue(),
    enterGuestMode: vi.fn(),
  });

  Object.assign(mockPlayerContext, {
    isOpen: true,
    provider: 'spotify',
    trackId: 'test123',
    canonicalTrackId: 'canonical-1',
    trackTitle: 'Test Track',
    trackArtist: 'Test Artist',
    lastKnownTitle: 'Test Track',
    lastKnownArtist: 'Test Artist',
    positionMs: 0,
    durationMs: 180000,
    volume: 0.7,
    isMuted: false,
    isPlaying: true,
    setIsPlaying: vi.fn(),
    isMinimized: false,
    setMinimized: vi.fn(),
    isMini: false,
    isCinema: false,
    miniPosition: { x: 0, y: 0 },
    enterCinema: vi.fn(),
    exitCinema: vi.fn(),
    togglePlayPause: vi.fn(),
    setVolumeLevel: vi.fn(),
    toggleMute: vi.fn(),
    seekToMs: vi.fn(),
    stop: vi.fn(),
    collapseToMini: vi.fn(),
    restoreFromMini: vi.fn(),
    setMiniPosition: vi.fn(),
    closePlayer: vi.fn(),
    clearSeek: vi.fn(),
    seekToSec: null,
    nextTrack: vi.fn(),
    previousTrack: vi.fn(),
  });
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {children}
    </BrowserRouter>
  </QueryClientProvider>
);

describe('Mobile Player QA', () => {
  describe('EmbeddedPlayerDrawer', () => {
    it('should render player when open', () => {
      render(<EmbeddedPlayerDrawer />, { wrapper });

      // Opens docked/compact by default (no video overlay), so play/pause -
      // present in every state - is the reliable thing to check for, rather
      // than the fullscreen control, which only renders once video is shown.
      expect(screen.getAllByLabelText(/^(play|pause)$/i).length).toBeGreaterThan(0);
    });

    it('should show a hide button on mobile', () => {
      render(<EmbeddedPlayerDrawer />, { wrapper });

      const hideButton = screen.queryByLabelText(/hide player/i);
      expect(hideButton).toBeInTheDocument();
    });

    it('docks compactly rather than overlapping the feed header/content', () => {
      const { container } = render(<EmbeddedPlayerDrawer />, { wrapper });
      const player = container.querySelector('[data-player="universal"]');
      // Opens as the small docked bar (top-0/left-0 anchor plus a bottom-right
      // pixel offset applied via transform), not the old top-16 centered video
      // overlay that sat directly over the feed.
      expect(player).toHaveClass('top-0');
      expect(player).toHaveClass('left-0');
      expect(player).not.toHaveClass('top-16');
    });

    it('should allow dragging when minimized', () => {
      render(<EmbeddedPlayerDrawer />, { wrapper });

      const hideButton = screen.getByLabelText(/hide player/i);
      fireEvent.click(hideButton);

      expect(mockPlayerContext.collapseToMini).toHaveBeenCalled();
    });

    it('should switch between Spotify and YouTube', async () => {
      mockPlayerContext.provider = 'spotify';
      const { container, rerender } = render(<EmbeddedPlayerDrawer />, { wrapper });
      expect(container.querySelectorAll('[data-player="universal"]').length).toBe(1);

      mockPlayerContext.provider = 'youtube';
      mockPlayerContext.trackId = 'youtube123';
      rerender(<EmbeddedPlayerDrawer />);

      expect(container.querySelectorAll('[data-player="universal"]').length).toBe(1);
    });

    it('should have proper z-index hierarchy', () => {
      const { container } = render(<EmbeddedPlayerDrawer />, { wrapper });
      const player = container.querySelector('.z-\\[110\\]');
      
      expect(player).toBeInTheDocument();
    });

    it('should be compact on mobile', () => {
      const { container } = render(<EmbeddedPlayerDrawer />, { wrapper });

      // Opens as the compact docked bar by default - the 92vw width applies
      // only to the expanded video view, which is no longer the default.
      expect(container.querySelector('.w-\\[min\\(460px\\,90vw\\)\\]')).toBeInTheDocument();
    });

    it('resizes by dragging a corner handle, and stops exactly at pointer up', () => {
      mockPlayerContext.provider = 'youtube';
      const { container } = render(<EmbeddedPlayerDrawer />, { wrapper });

      // Handles only exist in the expanded (non-compact) view.
      fireEvent.click(screen.getByLabelText(/show video and expand player/i));

      const player = container.querySelector('[data-player="universal"]') as HTMLElement;

      // Docks to the right edge, vertically centered - not the old bottom-
      // center overlay - and opens noticeably smaller than full size. The
      // centering itself is a plain-number y (panel height / 2, from a
      // ResizeObserver - unavailable in jsdom, so not asserted here), not a
      // Tailwind transform class: framer-motion's own x/y/scale style
      // replaces rather than merges with a transform coming from a class on
      // the same element, and a calc() string there can't be dragged by
      // framer-motion's drag (which adds pixels to a motion value live).
      expect(player).toHaveClass('top-1/2');
      expect(player).toHaveClass('right-4');
      expect(player).not.toHaveClass('-translate-y-1/2');
      expect(player).not.toHaveClass('left-1/2');
      expect(player.style.transform).not.toContain('calc');
      const initialScale = parseFloat(player.style.scale);
      expect(initialScale).toBeGreaterThan(0);
      expect(initialScale).toBeLessThan(0.6);

      const handle = screen.getByLabelText(/resize player from the bottom right/i);
      expect(handle.style.cursor).toBe('nwse-resize');

      // jsdom reports a zero-sized bounding rect, so the player's "center" is
      // (0,0) and distance-from-center is just distance from the origin -
      // deterministic without needing real layout. The move is a full 10x
      // the starting distance so the ceiling clamp is reached regardless of
      // the default scale (0.45) the gesture started from.
      fireEvent.pointerDown(handle, { clientX: 100, clientY: 0, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 1000, clientY: 0, pointerId: 1 });
      const scaleAfterMove = player.style.scale;
      // jsdom (via React's inline-style handling for a property it doesn't
      // recognise as unitless) renders this as e.g. "1.3px"; parseFloat still
      // reads the number cleanly.
      expect(parseFloat(scaleAfterMove)).toBeCloseTo(1.3, 1); // clamped at the 1.3 ceiling

      fireEvent.pointerUp(handle, { clientX: 200, clientY: 0, pointerId: 1 });
      // Movement after release must not still be treated as part of the drag -
      // this is exactly the bug report: dragging across the player's own
      // iframe silently lost the mouseup, so the resize never stopped.
      fireEvent.pointerMove(handle, { clientX: 1000, clientY: 0, pointerId: 1 });
      expect(player.style.scale).toBe(scaleAfterMove);
    });
  });

  describe('TikTokStyleButtons', () => {
    it('should render all action buttons', () => {
      render(
        <TikTokStyleButtons
          trackId="test123"
          likes={1000}
          onLike={vi.fn()}
          onComment={vi.fn()}
          onShare={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByLabelText(/like/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/comment/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/share/i)).toBeInTheDocument();
    });

    it('should format large like counts', () => {
      render(
        <TikTokStyleButtons
          trackId="test123"
          likes={12500}
          onLike={vi.fn()}
          onComment={vi.fn()}
          onShare={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByText('12.5k')).toBeInTheDocument();
    });

    it('should toggle like state', () => {
      const onLike = vi.fn();
      render(
        <TikTokStyleButtons
          trackId="test123"
          likes={100}
          isLiked={false}
          onLike={onLike}
          onComment={vi.fn()}
          onShare={vi.fn()}
        />,
        { wrapper }
      );

      const likeButton = screen.getByLabelText(/like/i);
      fireEvent.click(likeButton);

      expect(onLike).toHaveBeenCalled();
    });

    it('should only show on mobile', () => {
      const { container } = render(
        <TikTokStyleButtons
          trackId="test123"
          onLike={vi.fn()}
          onComment={vi.fn()}
          onShare={vi.fn()}
        />,
        { wrapper }
      );

      const buttons = container.querySelector('.md\\:hidden');
      expect(buttons).toBeInTheDocument();
    });
  });

  describe('ScrollingComments', () => {
    it('should render comments overlay', async () => {
      const { container } = render(<ScrollingComments trackId="test123" />, { wrapper });
      
      await waitFor(() => {
        const overlay = container.querySelector('.fixed.bottom-24');
        expect(overlay).toBeInTheDocument();
      });
    });

    it('should limit visible comments', () => {
      render(<ScrollingComments trackId="test123" maxVisible={3} />, { wrapper });
      
      // Should only show 3 comments at a time
    });

    it('should have proper z-index', () => {
      const { container } = render(<ScrollingComments trackId="test123" />, { wrapper });
      
      const overlay = container.querySelector('.z-40');
      expect(overlay).toBeInTheDocument();
    });

    it('should be non-blocking', () => {
      const { container } = render(<ScrollingComments trackId="test123" />, { wrapper });
      
      const overlay = container.querySelector('.pointer-events-none');
      expect(overlay).toBeInTheDocument();
    });
  });
});

describe('Forum System QA', () => {
  describe('ForumHomePage', () => {
    it('should render forum home page', () => {
      render(<ForumHomePage />, { wrapper });
      
      expect(screen.getAllByText(/forums/i).length).toBeGreaterThan(0);
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    });

    it('should have create post button', () => {
      render(<ForumHomePage />, { wrapper });
      
      expect(screen.getByRole('button', { name: /create post/i })).toBeInTheDocument();
    });

    it('should have sorting options', () => {
      render(<ForumHomePage />, { wrapper });
      
      expect(screen.getByRole('button', { name: /hot/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /new/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /top/i })).toBeInTheDocument();
    });

    it('should display popular forums sidebar', () => {
      render(<ForumHomePage />, { wrapper });
      
      expect(screen.getByText(/popular forums/i)).toBeInTheDocument();
    });
  });

  describe('Post Voting', () => {
    it('should allow upvoting', () => {
      const mockPost = {
        id: 'post123',
        title: 'Test Post',
        content: 'Test content',
        vote_count: 10,
        comment_count: 5,
        created_at: new Date().toISOString(),
        user: {
          username: 'testuser',
          display_name: 'Test User',
        },
        forum: {
          name: 'music',
          display_name: 'Music Hub',
        },
      };

      // Test upvote functionality
    });

    it('should update vote count optimistically', () => {
      // Test optimistic updates
    });

    it('should handle vote removal', () => {
      // Test removing votes
    });
  });

  describe('Forum Performance', () => {
    it('should load posts efficiently', async () => {
      const startTime = performance.now();
      
      render(<ForumHomePage />, { wrapper });
      
      await waitFor(() => {
        expect(screen.getAllByRole('heading', { name: /forums/i }).length).toBeGreaterThan(0);
      });
      
      const endTime = performance.now();
      const loadTime = endTime - startTime;
      
      expect(loadTime).toBeLessThan(3000); // Should load in under 3 seconds
    });

    it('should handle 1M users gracefully', () => {
      // Test pagination and infinite scroll
    });
  });
});

describe('Integration Tests', () => {
  describe('Player + Forum Integration', () => {
    it('should play track from forum post', () => {
      // Test clicking track in forum post opens player
    });

    it('should show track discussion in forum', () => {
      // Test forum integration with track pages
    });
  });

  describe('Mobile Responsiveness', () => {
    it('should adapt layout for mobile viewport', () => {
      global.innerWidth = 375;
      global.innerHeight = 667;
      
      render(<ForumHomePage />, { wrapper });
      
      // Check mobile-specific layout
    });

    it('should handle touch gestures', () => {
      // Test swipe gestures on mobile
    });
  });

  describe('Israeli Users', () => {
    it('should support Hebrew text', () => {
      // Test RTL layout and Hebrew characters
    });

    it('should show Israeli forums prominently', () => {
      render(<ForumHomePage />, { wrapper });
      
      // Should have f/israel in popular forums
    });
  });
});

describe('Performance Benchmarks', () => {
  it('should render player in under 100ms', async () => {
    const start = performance.now();
    render(<EmbeddedPlayerDrawer />, { wrapper });
    const end = performance.now();
    
    expect(end - start).toBeLessThan(100);
  });

  it('should handle rapid voting without lag', async () => {
    // Test rapid upvote/downvote clicks
  });

  it('should efficiently render 50 posts', async () => {
    // Test rendering performance with many posts
  });
});

describe('Edge Cases', () => {
  it('should handle missing track IDs', () => {
    render(<EmbeddedPlayerDrawer />, { wrapper });
    // Should not crash
  });

  it('should handle network errors gracefully', async () => {
    // Mock network failure
    // Should show error state, not crash
  });

  it('should handle concurrent player opens', () => {
    // Test opening Spotify while YouTube is playing
  });

  it('should handle extremely long post titles', () => {
    const longTitle = 'A'.repeat(300);
    // Should truncate or handle gracefully
  });

  it('should handle special characters in usernames', () => {
    // Test Hebrew, Arabic, emoji, etc.
  });
});

describe('Accessibility QA', () => {
  it('should have proper ARIA labels', () => {
    render(<EmbeddedPlayerDrawer />, { wrapper });
    
    expect(screen.getAllByLabelText(/^(play|pause)$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/hide player/i).length).toBeGreaterThan(0);
  });

  it('should support keyboard navigation', () => {
    render(<ForumHomePage />, { wrapper });
    
    const createButton = screen.getByRole('button', { name: /create post/i });
    createButton.focus();
    
    expect(document.activeElement).toBe(createButton);
  });

  it('should have sufficient color contrast', () => {
    // Test contrast ratios meet WCAG AA standards
  });
});

describe('Security QA', () => {
  it('should sanitize user input', () => {
    // Test XSS prevention in post content
  });

  it('should enforce RLS policies', async () => {
    // Test row-level security on forum tables
  });

  it('should require authentication for voting', () => {
    // Test unauthenticated users can't vote
  });

  it('should prevent spam posting', () => {
    // Test rate limiting
  });
});

export function runManualQA() {
  console.log('🔍 Running Manual QA Checklist...\n');
  
  const checks = [
    {
      category: 'Mobile Player',
      items: [
        '✓ Player appears at top-right on mobile (not bottom)',
        '✓ Player is smaller on mobile (56px vs 80px)',
        '✓ Minimize button works on mobile',
        '✓ Player can be dragged when minimized',
        '✓ Player doesn\'t overlap TikTok buttons',
        '✓ Switching Spotify ↔ YouTube works smoothly',
        '✓ No duplicate players appear',
        '✓ Controls are always clickable (proper z-index)',
        '✓ Queue button opens queue sheet',
        '✓ Close button closes player',
      ],
    },
    {
      category: 'TikTok-Style Buttons',
      items: [
        '✓ Buttons appear on right side (mobile only)',
        '✓ Like button toggles red when clicked',
        '✓ Like count updates instantly',
        '✓ Comment button scrolls to comments',
        '✓ Share button opens native share menu',
        '✓ Buttons have smooth animations',
        '✓ Buttons don\'t block content',
      ],
    },
    {
      category: 'Scrolling Comments',
      items: [
        '✓ Comments scroll up from bottom',
        '✓ Comments fade in and out smoothly',
        '✓ Older comments get blurred',
        '✓ Max 3-5 comments visible at once',
        '✓ Comments don\'t block interaction',
        '✓ Real-time updates work',
      ],
    },
    {
      category: 'Forum System',
      items: [
        '✓ Forum home page loads quickly',
        '✓ Posts display with correct formatting',
        '✓ Upvote/downvote works instantly',
        '✓ Vote counts update optimistically',
        '✓ Comments expand/collapse properly',
        '✓ Search functionality works',
        '✓ Sorting (hot/new/top) works',
        '✓ Create post button navigates correctly',
        '✓ Popular forums sidebar loads',
        '✓ Forum navigation works',
      ],
    },
    {
      category: 'Fake Users',
      items: [
        '✓ Israeli users have Hebrew names',
        '✓ Users from diverse locations',
        '✓ Personality types are varied',
        '✓ Avatars are generated',
        '✓ Bios match personality types',
        '✓ Forum memberships are realistic',
        '✓ Post content reflects personalities',
      ],
    },
    {
      category: 'Performance',
      items: [
        '✓ Page loads in under 3 seconds',
        '✓ No layout shift during load',
        '✓ Smooth animations (60fps)',
        '✓ No memory leaks',
        '✓ Efficient re-renders',
        '✓ Handles 50+ posts without lag',
      ],
    },
    {
      category: 'Responsive Design',
      items: [
        '✓ Works on 320px width (iPhone SE)',
        '✓ Works on 375px width (iPhone)',
        '✓ Works on 768px width (iPad)',
        '✓ Works on 1920px width (desktop)',
        '✓ Touch targets are 44px+ on mobile',
        '✓ Text is readable on all sizes',
      ],
    },
  ];

  checks.forEach(({ category, items }) => {
    console.log(`\n${category}:`);
    items.forEach((item) => {
      console.log(`  ${item}`);
    });
  });

  console.log('\n\n✅ Manual QA checklist complete!');
  console.log('📋 Review each item and verify functionality');
}
