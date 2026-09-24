import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SongSection } from '@/types';

/**
 * Opening the section editor from the HUD.
 *
 * The editor seeds its draft once, from whatever sections it is given when it
 * mounts. Opened before the stored sections had loaded, it held a lone Intro
 * for good - and Save would then have replaced the track's real sections with
 * that single row. The HUD now keys the editor on what is stored, so it
 * re-seeds when the sections arrive.
 */

const mocks = vi.hoisted(() => ({
  player: {
    canonicalTrackId: null as string | null,
    isPlaying: false,
    positionMs: 0,
    durationMs: 200000,
    seekTo: vi.fn(),
  },
}));

vi.mock('@/player/PlayerContext', () => ({ usePlayer: () => mocks.player }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }));
vi.mock('@/hooks/api/useAdmin', () => ({ useIsAdmin: () => ({ data: true }) }));
vi.mock('@/hooks/api/useCredits', () => ({
  useCredits: () => ({ data: 10 }),
  useSpendCredit: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/api/useTracks', () => ({ useTrack: () => ({ data: { duration_ms: 200000 } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

const { HarmonicHUD } = await import('./HarmonicHUD');

const TRACK_ID = '11111111-1111-1111-1111-111111111111';

const STORED: SongSection[] = [
  { type: 'intro', label: 'Intro', start_time: 0, end_time: 18 },
  { type: 'verse', label: 'Verse 1', start_time: 18, end_time: 46 },
  { type: 'chorus', label: 'Chorus', start_time: 46, end_time: 74 },
  { type: 'verse', label: 'Verse 2', start_time: 74, end_time: 100 },
];

function hud(sections: SongSection[]) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <HarmonicHUD trackId={TRACK_ID} progression={['I', 'V', 'vi', 'IV']} sections={sections} />
    </QueryClientProvider>
  );
}

const editButton = () => screen.getByRole('button', { name: /edit song sections/i });
const labelSelects = () => screen.queryAllByLabelText(/^Label for section starting at/i) as HTMLSelectElement[];

describe('HarmonicHUD section editor', () => {
  it('opens on the stored sections, keeping their types', () => {
    render(hud(STORED));

    fireEvent.click(editButton());

    expect(labelSelects().map((s) => s.value)).toEqual(['intro', 'verse', 'chorus', 'verse']);
  });

  it('re-seeds when the stored sections load after Edit was already clicked', () => {
    const { rerender } = render(hud([]));

    fireEvent.click(editButton());
    // Nothing stored yet: a lone Intro, the editor's starting point.
    expect(labelSelects().map((s) => s.value)).toEqual(['intro']);

    rerender(hud(STORED));

    expect(labelSelects().map((s) => s.value)).toEqual(['intro', 'verse', 'chorus', 'verse']);
  });
});
