import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrackMobileActions } from './TrackMobileActions';

const setup = (over: Partial<React.ComponentProps<typeof TrackMobileActions>> = {}) => {
  const handlers = { onLike: vi.fn(), onComments: vi.fn(), onShare: vi.fn() };
  render(<TrackMobileActions liked={false} commentCount={0} {...handlers} {...over} />);
  return handlers;
};

describe('TrackMobileActions', () => {
  it('is a labelled group of three buttons, shown on phones only', () => {
    setup();
    const group = screen.getByRole('group', { name: 'Track actions' });
    expect(group).toHaveClass('md:hidden');
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('reflects the like state for assistive tech and in the label', () => {
    setup({ liked: true });
    const like = screen.getByRole('button', { name: 'Liked' });
    expect(like).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows Like (unpressed) when not liked', () => {
    setup({ liked: false });
    expect(screen.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the comment count, and names the button with it', () => {
    setup({ commentCount: 12 });
    expect(screen.getByRole('button', { name: 'Comments, 12' })).toHaveTextContent('12');
  });

  it('falls back to a "Comments" word when there are none yet', () => {
    setup({ commentCount: 0 });
    expect(screen.getByRole('button', { name: 'Comments, 0' })).toHaveTextContent('Comments');
  });

  it('calls the matching handler for each button', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    fireEvent.click(screen.getByRole('button', { name: /^Comments/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(h.onLike).toHaveBeenCalledTimes(1);
    expect(h.onComments).toHaveBeenCalledTimes(1);
    expect(h.onShare).toHaveBeenCalledTimes(1);
  });

  it('gives every button a 44px minimum height', () => {
    setup();
    for (const b of screen.getAllByRole('button')) expect(b).toHaveClass('min-h-11');
  });

  it('does not depend on hover, which sticks after a tap on touch screens', () => {
    setup();
    for (const b of screen.getAllByRole('button')) {
      expect(b.className).toContain('[@media(hover:hover)]:hover:bg-muted');
      expect(b.className).not.toMatch(/(^|\s)hover:bg-/);
    }
  });
});
