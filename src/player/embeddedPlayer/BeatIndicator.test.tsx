import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BeatIndicator } from './BeatIndicator';

describe('BeatIndicator', () => {
  it('shows the rounded tempo when one is known', () => {
    render(<BeatIndicator bpm={128.4} positionMs={0} isPlaying />);
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('BPM')).toBeInTheDocument();
  });

  // The catalog's tracks.tempo is nullable and frequently unset, so this is
  // the common path, not an edge case. Rendering an idle dot beside a blank
  // number would read as a broken readout rather than as absent data.
  it('renders nothing at all without a usable tempo', () => {
    const { container } = render(<BeatIndicator bpm={undefined} positionMs={0} isPlaying />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for out-of-range or non-finite tempo data', () => {
    for (const bad of [0, -5, NaN, 1000]) {
      const { container } = render(<BeatIndicator bpm={bad} positionMs={0} isPlaying />);
      expect(container).toBeEmptyDOMElement();
    }
  });

  it('still shows the tempo while paused - only the flashing stops', () => {
    render(<BeatIndicator bpm={90} positionMs={0} isPlaying={false} />);
    expect(screen.getByText('90')).toBeInTheDocument();
  });
});
