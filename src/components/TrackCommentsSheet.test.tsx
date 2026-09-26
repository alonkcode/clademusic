import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrackCommentsSheet } from './TrackCommentsSheet';

// The thread has its own tests and needs auth/query providers; here only the
// sheet around it is under test.
vi.mock('@/components/TrackComments', () => ({
  TrackComments: (props: { trackId: string; hideHeader?: boolean }) => (
    <div data-testid="thread" data-track={props.trackId} data-hide-header={String(!!props.hideHeader)} />
  ),
}));

const renderSheet = (over: Partial<React.ComponentProps<typeof TrackCommentsSheet>> = {}) => {
  const onOpenChange = vi.fn();
  render(
    <TrackCommentsSheet
      trackId="t-1"
      trackTitle="Blinding Lights"
      count={8}
      open
      onOpenChange={onOpenChange}
      {...over}
    />
  );
  return { onOpenChange };
};

describe('TrackCommentsSheet', () => {
  it('renders nothing while closed', () => {
    renderSheet({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a dialog titled Comments with the count', () => {
    renderSheet();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Comments')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('describes the dialog for screen readers using the track title', () => {
    renderSheet();
    expect(screen.getByText('Discussion about Blinding Lights')).toBeInTheDocument();
  });

  it('hosts the thread for the right track without repeating its own heading', () => {
    renderSheet();
    const thread = screen.getByTestId('thread');
    expect(thread).toHaveAttribute('data-track', 't-1');
    expect(thread).toHaveAttribute('data-hide-header', 'true');
  });

  it('puts the thread in its own scroll container so a tall thread scrolls instead of being clipped', () => {
    renderSheet();
    const scroller = screen.getByTestId('thread').parentElement!;
    expect(scroller).toHaveClass('overflow-y-auto');
    expect(scroller).toHaveClass('overscroll-contain');
    expect(scroller).toHaveClass('min-h-0');
  });

  it('has one close button, and it is a 44px target (not the sheet default 16px one)', () => {
    renderSheet();
    const closers = screen.getAllByRole('button', { name: /close/i });
    expect(closers).toHaveLength(1);
    expect(closers[0]).toHaveAccessibleName('Close comments');
    expect(closers[0]).toHaveClass('h-11', 'w-11');
  });

  it('asks to close when the close button is pressed', () => {
    const { onOpenChange } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Not unit-tested: that the sheet sits above the docked player. It relies on
  // var()/min()/calc() in inline style, which jsdom's CSS parser discards, so it
  // is covered in a real browser instead (the sheet's bottom edge was measured
  // against a 72px --clade-player-height on 375-390px-wide phones).
});
