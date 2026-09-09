import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BottomNav } from './BottomNav';

/**
 * Regression: the sheet's own header (CladeMark logo + "Navigate") renders
 * directly over the hamburger trigger's own on-screen position once open,
 * but the logo is an unfilled, thin-stroke SVG - mostly transparent pixels -
 * so the trigger stayed fully visible AND clickable right through it,
 * looking like a second, confusing icon inside the menu itself.
 */
describe('BottomNav hamburger trigger', () => {
  it('hides and disables the trigger once the sheet is open, restoring it on close', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <BottomNav />
      </MemoryRouter>
    );

    const trigger = screen.getByLabelText('Open navigation');
    expect(trigger).not.toHaveClass('opacity-0');

    fireEvent.click(trigger);
    expect(trigger).toHaveClass('opacity-0');
    expect(trigger).toHaveClass('pointer-events-none');

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);
    expect(trigger).not.toHaveClass('opacity-0');
    expect(trigger).not.toHaveClass('pointer-events-none');
  });
});
