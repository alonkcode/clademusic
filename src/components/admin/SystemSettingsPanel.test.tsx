import { useState, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SystemSettingsProvider } from '@/hooks/useSystemSettings';
import { SystemSettingsPanel } from '@/components/admin/SystemSettingsPanel';

// A stand-in for the system_settings table that actually remembers writes, so
// the panel's refetch after a save sees what was saved.
const db = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; value: unknown }>,
  upserts: [] as Array<{ row: { key: string; value: unknown }; options: unknown }>,
  writeError: null as { message: string } | null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: db.rows.map((r) => ({ ...r })), error: null }),
      upsert: (row: { key: string; value: unknown }, options: unknown) => {
        db.upserts.push({ row, options });
        if (db.writeError) return Promise.resolve({ data: null, error: db.writeError });
        db.rows = [...db.rows.filter((r) => r.key !== row.key), { ...row }];
        return Promise.resolve({ data: null, error: null });
      },
    }),
  },
}));

vi.mock('sonner', () => ({ toast: db.toast }));

beforeEach(() => {
  db.rows = [];
  db.upserts = [];
  db.writeError = null;
  db.toast.success.mockClear();
  db.toast.error.mockClear();
});

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <SystemSettingsProvider>{children}</SystemSettingsProvider>
    </QueryClientProvider>
  );
}

const renderPanel = () =>
  render(
    <Providers>
      <SystemSettingsPanel />
    </Providers>
  );

const flagSwitch = (label: string) => screen.getByRole('switch', { name: label });

describe('SystemSettingsPanel', () => {
  it('shows every flag on and maintenance off when nothing has been saved', async () => {
    renderPanel();

    await waitFor(() => expect(flagSwitch('Forums')).toBeInTheDocument());
    for (const label of ['New signups', 'Forums', 'Pricing & billing', 'Posting comments']) {
      expect(flagSwitch(label)).toBeChecked();
    }
    expect(flagSwitch('Maintenance mode')).not.toBeChecked();
  });

  it('reflects values already saved in the database', async () => {
    db.rows = [{ key: 'flag.forum_enabled', value: false }];
    renderPanel();

    await waitFor(() => expect(flagSwitch('Forums')).not.toBeChecked());
    expect(flagSwitch('Pricing & billing')).toBeChecked();
  });

  describe('feature flags', () => {
    it('saves the moment a switch is flipped, and the switch stays flipped', async () => {
      renderPanel();
      await waitFor(() => expect(flagSwitch('Forums')).toBeChecked());

      fireEvent.click(flagSwitch('Forums'));

      await waitFor(() => expect(db.upserts).toHaveLength(1));
      expect(db.upserts[0].row).toEqual({ key: 'flag.forum_enabled', value: false });
      expect(db.upserts[0].options).toEqual({ onConflict: 'key' });
      await waitFor(() => expect(db.toast.success).toHaveBeenCalledWith('Forums saved'));
      expect(flagSwitch('Forums')).not.toBeChecked();
    });

    it('puts the switch back and reports the error when the save fails', async () => {
      db.rows = [{ key: 'flag.forum_enabled', value: true }];
      db.writeError = { message: 'permission denied' };
      renderPanel();
      await waitFor(() => expect(flagSwitch('Forums')).toBeChecked());

      fireEvent.click(flagSwitch('Forums'));

      await waitFor(() => expect(db.toast.error).toHaveBeenCalledWith("Couldn't save Forums: permission denied"));
      await waitFor(() => expect(flagSwitch('Forums')).toBeChecked());
      expect(db.toast.success).not.toHaveBeenCalled();
    });
  });

  describe('maintenance mode', () => {
    it('asks for confirmation before locking everyone out, and writes nothing if cancelled', async () => {
      renderPanel();
      await waitFor(() => expect(flagSwitch('Maintenance mode')).toBeInTheDocument());

      fireEvent.click(flagSwitch('Maintenance mode'));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Turn on maintenance mode?')).toBeInTheDocument();
      expect(db.upserts).toHaveLength(0);

      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(db.upserts).toHaveLength(0);
      expect(flagSwitch('Maintenance mode')).not.toBeChecked();
    });

    it('turns on once confirmed', async () => {
      renderPanel();
      await waitFor(() => expect(flagSwitch('Maintenance mode')).toBeInTheDocument());

      fireEvent.click(flagSwitch('Maintenance mode'));
      fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));

      await waitFor(() => expect(db.upserts).toHaveLength(1));
      expect(db.upserts[0].row).toEqual({ key: 'pref.maintenance_mode', value: true });
      await waitFor(() => expect(flagSwitch('Maintenance mode')).toBeChecked());
    });

    it('turns off straight away, with no confirmation', async () => {
      db.rows = [{ key: 'pref.maintenance_mode', value: true }];
      renderPanel();
      await waitFor(() => expect(flagSwitch('Maintenance mode')).toBeChecked());

      fireEvent.click(flagSwitch('Maintenance mode'));

      await waitFor(() => expect(db.upserts).toHaveLength(1));
      expect(db.upserts[0].row).toEqual({ key: 'pref.maintenance_mode', value: false });
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  describe('rate limits', () => {
    const commentsMax = () => screen.getByLabelText('Comments: maximum actions per window');
    const commentsWindow = () => screen.getByLabelText('Comments: window in seconds');
    // Each limit row has its own Save; this finds the one beside the comments inputs.
    const commentsSave = () => within(commentsMax().parentElement as HTMLElement).getByRole('button', { name: 'Save' });

    it('starts from the current limit with Save disabled until something changes', async () => {
      renderPanel();
      await waitFor(() => expect(commentsMax()).toHaveValue(10));

      expect(commentsWindow()).toHaveValue(60);
      expect(commentsSave()).toBeDisabled();
    });

    it('saves a changed limit as { max, windowSeconds }', async () => {
      renderPanel();
      await waitFor(() => expect(commentsMax()).toHaveValue(10));

      fireEvent.change(commentsMax(), { target: { value: '3' } });
      fireEvent.change(commentsWindow(), { target: { value: '30' } });
      expect(commentsSave()).toBeEnabled();
      fireEvent.click(commentsSave());

      await waitFor(() => expect(db.upserts).toHaveLength(1));
      expect(db.upserts[0].row).toEqual({ key: 'limit.comments', value: { max: 3, windowSeconds: 30 } });
      await waitFor(() => expect(commentsSave()).toBeDisabled());
    });

    it('refuses values that would be nonsense: a 0-second window, a negative or fractional count, blanks', async () => {
      renderPanel();
      await waitFor(() => expect(commentsMax()).toHaveValue(10));

      for (const [max, window] of [
        ['5', '0'],
        ['-1', '60'],
        ['2.5', '60'],
        ['', '60'],
        ['5', ''],
        ['99999', '60'],
      ]) {
        fireEvent.change(commentsMax(), { target: { value: max } });
        fireEvent.change(commentsWindow(), { target: { value: window } });
        expect(commentsSave(), `max=${JSON.stringify(max)} window=${JSON.stringify(window)}`).toBeDisabled();
      }
      expect(db.upserts).toHaveLength(0);
    });

    it('accepts 0 as "no limit"', async () => {
      renderPanel();
      await waitFor(() => expect(commentsMax()).toHaveValue(10));

      fireEvent.change(commentsMax(), { target: { value: '0' } });
      expect(commentsSave()).toBeEnabled();
      fireEvent.click(commentsSave());

      await waitFor(() => expect(db.upserts).toHaveLength(1));
      expect(db.upserts[0].row).toEqual({ key: 'limit.comments', value: { max: 0, windowSeconds: 60 } });
    });
  });

  describe('text preferences', () => {
    const announcement = () => screen.getByPlaceholderText(/harmony detection goes live/i);
    const announcementSave = () =>
      within(announcement().parentElement as HTMLElement).getByRole('button', { name: 'Save' });

    it('saves the announcement trimmed, and clears it with an empty save', async () => {
      renderPanel();
      await waitFor(() => expect(announcement()).toBeInTheDocument());
      expect(announcementSave()).toBeDisabled();

      fireEvent.change(announcement(), { target: { value: '  Back Friday  ' } });
      fireEvent.click(announcementSave());
      await waitFor(() => expect(db.upserts).toHaveLength(1));
      expect(db.upserts[0].row).toEqual({ key: 'pref.announcement', value: 'Back Friday' });

      await waitFor(() => expect(announcement()).toHaveValue('Back Friday'));
      fireEvent.change(announcement(), { target: { value: '' } });
      fireEvent.click(announcementSave());
      await waitFor(() => expect(db.upserts).toHaveLength(2));
      expect(db.upserts[1].row).toEqual({ key: 'pref.announcement', value: '' });
    });
  });
});
