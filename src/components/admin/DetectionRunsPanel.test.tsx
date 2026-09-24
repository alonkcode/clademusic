import { useState, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DetectionRunsPanel } from '@/components/admin/DetectionRunsPanel';
import type { DetectionRunSummary } from '@/hooks/api/useDetectionRuns';

// A stand-in for the review queue's RPCs that remembers what was called and
// applies an undo, so the panel's refetch afterwards sees the run back in
// pending.
const db = vi.hoisted(() => ({
  runs: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  revertResult: { track_id: 't1', sections_removed: 8, sections_restored: 0, track_restored: false },
  revertError: null as { message: string } | null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      db.calls.push({ fn, args });
      if (fn === 'list_detection_runs') {
        const status = args.p_status as string;
        return Promise.resolve({
          data: db.runs.filter((r) => status === 'all' || r.status === status).map((r) => ({ ...r })),
          error: null,
        });
      }
      if (fn === 'revert_detection_run') {
        if (db.revertError) return Promise.resolve({ data: null, error: db.revertError });
        db.runs = db.runs.map((r) => (r.id === args.p_run_id ? { ...r, status: 'pending' } : r));
        return Promise.resolve({ data: [db.revertResult], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
  },
}));

vi.mock('sonner', () => ({ toast: db.toast }));

const run = (over: Partial<DetectionRunSummary>): Record<string, unknown> => ({
  id: 'run-1',
  track_id: 't1',
  track_title: 'Levitating',
  track_artist: 'Dua Lipa',
  contributor: 'maya_katz_7',
  status: 'promoted',
  detected_key: 'B',
  detected_mode: 'minor',
  key_confidence: 0.77,
  covered_from_ms: 0,
  covered_to_ms: 196_000,
  section_count: 8,
  chord_count: 88,
  created_at: '2026-09-22T10:00:00Z',
  ...over,
});

beforeEach(() => {
  db.runs = [];
  db.calls = [];
  db.revertResult = { track_id: 't1', sections_removed: 8, sections_restored: 0, track_restored: false };
  db.revertError = null;
  db.toast.success.mockClear();
  db.toast.error.mockClear();
});

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const renderPanel = () =>
  render(
    <Providers>
      <DetectionRunsPanel />
    </Providers>
  );

const openTab = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const revertCalls = () => db.calls.filter((c) => c.fn === 'revert_detection_run');

describe('DetectionRunsPanel undo', () => {
  it('offers Undo on promoted runs only', async () => {
    db.runs = [run({ id: 'p1', status: 'pending' }), run({ id: 'r1', status: 'promoted', track_title: 'Thriller' })];
    renderPanel();

    await screen.findByText('Levitating');
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promote' })).toBeInTheDocument();

    openTab('promoted');
    await screen.findByText('Thriller');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Promote' })).not.toBeInTheDocument();
  });

  it('asks first, and does nothing if cancelled', async () => {
    db.runs = [run({ id: 'r1' })];
    renderPanel();
    openTab('promoted');

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Undo this promotion?')).toBeInTheDocument();
    expect(within(dialog).getByText(/8 sections this run put on/)).toBeInTheDocument();
    expect(revertCalls()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(revertCalls()).toHaveLength(0);
    expect(screen.getByText('Levitating')).toBeInTheDocument();
  });

  it('undoes the chosen run, and the run leaves the Promoted tab', async () => {
    db.runs = [run({ id: 'r1' }), run({ id: 'r2', track_title: 'Thriller' })];
    renderPanel();
    openTab('promoted');
    await screen.findByText('Thriller');

    // Second row's Undo, so the call has to carry that run's id, not the first's.
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Undo promotion' }));

    await waitFor(() => expect(revertCalls()).toHaveLength(1));
    expect(revertCalls()[0].args).toEqual({ p_run_id: 'r2' });
    await waitFor(() => expect(screen.queryByText('Thriller')).not.toBeInTheDocument());
    expect(screen.getByText('Levitating')).toBeInTheDocument();
  });

  it('says plainly that the key could not be restored for a promotion made before undo history', async () => {
    db.runs = [run({ id: 'r1' })];
    renderPanel();
    openTab('promoted');

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo promotion' }));

    await waitFor(() => expect(db.toast.success).toHaveBeenCalledTimes(1));
    const message = db.toast.success.mock.calls[0][0] as string;
    expect(message).toContain('removed 8 sections');
    expect(message).toContain('Levitating');
    expect(message).toContain('predates undo history');
    expect(message).not.toContain('restored');
  });

  it('reports what was put back when the promotion had recorded it', async () => {
    db.runs = [run({ id: 'r1' })];
    db.revertResult = { track_id: 't1', sections_removed: 8, sections_restored: 3, track_restored: true };
    renderPanel();
    openTab('promoted');

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo promotion' }));

    await waitFor(() => expect(db.toast.success).toHaveBeenCalledTimes(1));
    const message = db.toast.success.mock.calls[0][0] as string;
    expect(message).toContain('Put back the 3 it had replaced');
    expect(message).toContain('previous key was restored');
    expect(message).not.toContain('predates');
  });

  it('shows the database reason when the run is no longer the current analysis, and keeps the run listed', async () => {
    db.runs = [run({ id: 'r1' })];
    db.revertError = { message: 'This run is no longer the canonical analysis for its track. Undo that one first.' };
    renderPanel();
    openTab('promoted');

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo promotion' }));

    await waitFor(() =>
      expect(db.toast.error).toHaveBeenCalledWith(
        'This run is no longer the canonical analysis for its track. Undo that one first.'
      )
    );
    expect(db.toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByText('Levitating')).toBeInTheDocument();
  });
});
