import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The section editor's Save button.
 *
 * Save is disabled until it knows how long the track is (the last section ends
 * where the track does). It only ever asked the player, and the player often
 * never reports a length - the guest Spotify embed in particular - so Save
 * stayed greyed out for good. It now falls back to the catalog's duration, as
 * the player drawer's own seekbar already did.
 */

const mocks = vi.hoisted(() => ({
  player: { positionMs: 30000, durationMs: 0, seekTo: vi.fn() },
  track: { duration_ms: 200000 } as { duration_ms?: number } | null,
  rpc: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/player/PlayerContext', () => ({ usePlayer: () => mocks.player }));
vi.mock('@/hooks/api/useTracks', () => ({ useTrack: () => ({ data: mocks.track }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

const { SectionEditor } = await import('./SectionEditor');

const TRACK_ID = '11111111-1111-1111-1111-111111111111';

const STORED = [
  { label: 'intro', start_ms: 0 },
  { label: 'verse', start_ms: 18000 },
  { label: 'chorus', start_ms: 46000 },
];

function renderEditor(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <SectionEditor trackId={TRACK_ID} sections={STORED} onClose={onClose} />
    </QueryClientProvider>
  );
  return { onClose, invalidate };
}

const saveButton = () => screen.getByRole('button', { name: /^save$/i });

beforeEach(() => {
  mocks.player.durationMs = 0;
  mocks.track = { duration_ms: 200000 };
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: 3, error: null });
  mocks.toastSuccess.mockClear();
  mocks.toastError.mockClear();
});

describe('SectionEditor Save button', () => {
  it('is enabled from the catalog duration when the player reports none', () => {
    renderEditor();

    expect(saveButton()).not.toBeDisabled();
    expect(screen.queryByText(/hasn't reported this track's length/i)).not.toBeInTheDocument();
  });

  it('stays disabled, saying why, only when no duration is known anywhere', () => {
    mocks.track = { duration_ms: undefined };
    renderEditor();

    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/hasn't reported this track's length/i)).toBeInTheDocument();
  });

  it('prefers the length the player reports over the catalog one', async () => {
    mocks.player.durationMs = 190000;
    renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    const [, args] = mocks.rpc.mock.calls[0];
    expect(args.p_sections.at(-1).end_ms).toBe(190000);
  });

  it('writes every stored section back, each ending where the next begins', async () => {
    renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc).toHaveBeenCalledWith('save_track_sections', {
      p_track_id: TRACK_ID,
      p_sections: [
        { label: 'intro', ordinal: 1, start_ms: 0, end_ms: 18000 },
        { label: 'verse', ordinal: 1, start_ms: 18000, end_ms: 46000 },
        { label: 'chorus', ordinal: 1, start_ms: 46000, end_ms: 200000 },
      ],
    });
  });

  it('confirms, closes, and refreshes both the sections and the track rows the feed reads', async () => {
    const { onClose, invalidate } = renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Saved 3 sections.');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['track-sections', TRACK_ID] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tracks'] });
  });

  it('tells the admin what to run when the save function is not installed', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.save_track_sections in the schema cache' },
    });
    const { onClose } = renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastError.mock.calls[0][0]).toMatch(/19-save-track-sections\.sql/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the editor open and shows the reason when the database rejects the save', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Section 2 overlaps the one before it' } });
    const { onClose } = renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Section 2 overlaps the one before it'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
