import type { ComponentProps } from 'react';
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
  mocks.player.positionMs = 30000;
  mocks.player.durationMs = 0;
  mocks.track = { duration_ms: 200000 };
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: 3, error: null });
  mocks.toastSuccess.mockClear();
  mocks.toastError.mockClear();
});

/** Verse 0:18-0:46 holds four chords a bar (7s) apart; the chorus holds none. */
const CHORDED = [
  { label: 'intro', start_ms: 0, end_ms: 18000, chords: ['I'], chord_timings: [0] },
  {
    label: 'verse',
    start_ms: 18000,
    end_ms: 46000,
    chords: ['I', 'V', 'vi', 'IV'],
    chord_timings: [0, 7000, 14000, 21000],
  },
  { label: 'chorus', start_ms: 46000, end_ms: 200000 },
];

function renderChorded(props: Partial<ComponentProps<typeof SectionEditor>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SectionEditor trackId={TRACK_ID} sections={CHORDED} onClose={vi.fn()} {...props} />
    </QueryClientProvider>
  );
}

/** What the database was asked to store, per section. */
async function savedSections() {
  fireEvent.click(saveButton());
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  const [name, args] = mocks.rpc.mock.calls[0];
  expect(name).toBe('save_track_sections');
  return args as {
    p_with_chords?: boolean;
    p_sections: Array<{ label: string; progression_roman?: string[]; chord_timings?: number[] }>;
  };
}

const chordSelect = (time: string) => screen.getByLabelText(`Chord at ${time}`);

describe('SectionEditor chords', () => {
  it('shows each stored chord in the section it belongs to', () => {
    renderChorded();

    expect(chordSelect('0:00.0')).toHaveValue('I');
    expect(chordSelect('0:18.0')).toHaveValue('I');
    expect(chordSelect('0:25.0')).toHaveValue('V');
    expect(chordSelect('0:32.0')).toHaveValue('vi');
    expect(chordSelect('0:39.0')).toHaveValue('IV');
    expect(screen.getByText(/3 sections · 5 chords/)).toBeInTheDocument();
  });

  it('saves stored chords back unchanged, flagged so the database keeps them', async () => {
    renderChorded();

    const saved = await savedSections();

    expect(saved.p_with_chords).toBe(true);
    expect(saved.p_sections[0]).toMatchObject({ progression_roman: ['I'], chord_timings: [0] });
    expect(saved.p_sections[1]).toMatchObject({
      progression_roman: ['I', 'V', 'vi', 'IV'],
      chord_timings: [0, 7000, 14000, 21000],
    });
    // No chords means no chord keys at all, not empty ones.
    expect(saved.p_sections[2]).not.toHaveProperty('progression_roman');
  });

  it('does not flag a save with no chords in it', async () => {
    renderEditor();

    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_with_chords');
  });

  it('replaces a chord without moving it', async () => {
    renderChorded();

    fireEvent.change(chordSelect('0:25.0'), { target: { value: 'ii' } });

    const saved = await savedSections();
    expect(saved.p_sections[1].progression_roman).toEqual(['I', 'ii', 'vi', 'IV']);
    expect(saved.p_sections[1].chord_timings).toEqual([0, 7000, 14000, 21000]);
  });

  it('splits a chord into two halves that both keep its numeral', async () => {
    renderChorded();

    fireEvent.click(screen.getByRole('button', { name: 'Split the chord at 0:25.0 into two halves' }));

    // V ran 0:25-0:32, so the halves meet at 0:28.5.
    expect(chordSelect('0:28.5')).toHaveValue('V');
    const saved = await savedSections();
    expect(saved.p_sections[1].progression_roman).toEqual(['I', 'V', 'V', 'vi', 'IV']);
    expect(saved.p_sections[1].chord_timings).toEqual([0, 7000, 10500, 14000, 21000]);
  });

  it('splits the last chord of a section at the middle of what is left of it', async () => {
    renderChorded();

    // IV ran 0:39-0:46 (the verse ends there).
    fireEvent.click(screen.getByRole('button', { name: 'Split the chord at 0:39.0 into two halves' }));

    const saved = await savedSections();
    expect(saved.p_sections[1].chord_timings).toEqual([0, 7000, 14000, 21000, 24500]);
  });

  it('adds a chord at the playhead, repeating the one already sounding', async () => {
    mocks.player.positionMs = 30000;
    renderChorded();

    fireEvent.click(screen.getByRole('button', { name: /add chord at 0:30/i }));

    // 0:30 is inside V (0:25-0:32).
    expect(chordSelect('0:30.0')).toHaveValue('V');
    const saved = await savedSections();
    expect(saved.p_sections[1].progression_roman).toEqual(['I', 'V', 'V', 'vi', 'IV']);
    expect(saved.p_sections[1].chord_timings).toEqual([0, 7000, 12000, 14000, 21000]);
  });

  it('says why when a chord cannot be added, and changes nothing', () => {
    mocks.player.positionMs = 25100; // 100ms after the V - too close to be a real change
    renderChorded();

    fireEvent.click(screen.getByRole('button', { name: /add chord at 0:25/i }));

    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/too close to another chord/i));
    expect(screen.getByText(/3 sections · 5 chords/)).toBeInTheDocument();
  });

  it('removes a chord, and the count follows', async () => {
    renderChorded();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the chord at 0:32.0' }));

    expect(screen.getByText(/3 sections · 4 chords/)).toBeInTheDocument();
    const saved = await savedSections();
    expect(saved.p_sections[1].progression_roman).toEqual(['I', 'V', 'IV']);
    expect(saved.p_sections[1].chord_timings).toEqual([0, 7000, 21000]);
  });

  it('gives a section with no chords its first one, playing from the section start', async () => {
    renderChorded();

    fireEvent.click(screen.getByRole('button', { name: /^add chord$/i }));

    expect(chordSelect('0:46.0')).toHaveValue('I');
    const saved = await savedSections();
    expect(saved.p_sections[2]).toMatchObject({ progression_roman: ['I'], chord_timings: [0] });
  });

  it('starts a minor key on i rather than I', async () => {
    renderChorded({ mode: 'minor' });

    fireEvent.click(screen.getByRole('button', { name: /^add chord$/i }));

    expect(chordSelect('0:46.0')).toHaveValue('i');
  });

  // Chords are kept where they were heard: moving a boundary changes which
  // section owns one, never when it sounds.
  it('leaves chords where they are when a boundary moves past them', async () => {
    renderChorded();

    // Verse starts 0:18; pushing it 500ms later leaves the I at 0:18.0 in the intro.
    fireEvent.click(screen.getAllByLabelText('Move this boundary later')[0]);

    const saved = await savedSections();
    expect(saved.p_sections[0]).toMatchObject({ progression_roman: ['I', 'I'], chord_timings: [0, 18000] });
    // The verse now begins 0:18.5 and its first remaining chord (V, 0:25) plays from there.
    expect(saved.p_sections[1]).toMatchObject({
      progression_roman: ['V', 'vi', 'IV'],
      chord_timings: [0, 13500, 20500],
    });
  });

  it('names chords as letters once the key is known', () => {
    renderChorded({ tonic: 0 });

    expect(screen.getAllByRole('option', { name: 'V · G' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: 'vi · Am' }).length).toBeGreaterThan(0);
  });

  it('still shows a chord that is not one of the offered triads', () => {
    renderChorded({
      sections: [{ label: 'verse', start_ms: 0, end_ms: 20000, chords: ['V7'], chord_timings: [0] }],
    });

    expect(chordSelect('0:00.0')).toHaveValue('V7');
  });

  it('tells the admin which script to run when the database predates chord saving', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.save_track_sections(p_sections, p_track_id, p_with_chords)' },
    });
    renderChorded();

    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastError.mock.calls[0][0]).toMatch(/32-save-track-sections-chords\.sql/);
  });
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
