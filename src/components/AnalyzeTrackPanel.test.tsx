import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChordSpan, SectionProgression } from '@/lib/harmony/chordTimeline';

const mocks = vi.hoisted(() => ({
  live: {} as any,
  user: { id: 'user-1' } as { id: string } | null,
  submit: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useLiveChordDetection', () => ({ useLiveChordDetection: () => mocks.live }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@/api/detectionRuns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/detectionRuns')>()),
  submitDetectionRun: mocks.submit,
}));

const { AnalyzeTrackPanel } = await import('./AnalyzeTrackPanel');
const { shouldOfferAnalysis } = await import('@/hooks/useAnalyzeTrack');

const YOUTUBE_ID = 'dQw4w9WgXcQ';
const CATALOG_UUID = '11111111-2222-3333-4444-555555555555';

const span = (root: number, quality: 'major' | 'minor', startSec: number, endSec: number): ChordSpan => ({
  root,
  quality,
  startSec,
  endSec,
  confidence: 0.9,
});

const section = (type: SectionProgression['section']['type'], startSec: number, endSec: number): SectionProgression => {
  const q = (endSec - startSec) / 4;
  const chords = [span(0, 'major', startSec, startSec + q), span(7, 'major', startSec + q, startSec + 2 * q), span(9, 'minor', startSec + 2 * q, startSec + 3 * q), span(5, 'major', startSec + 3 * q, endSec)];
  return { section: { type, label: type, startSec, endSec }, chords, loop: chords.map((c) => ({ root: c.root, quality: c.quality })) };
};

/** 3 sections x 4 chords over `seconds` - clears every threshold from 90 s up. */
const capture = (seconds: number): SectionProgression[] => {
  const third = seconds / 3;
  return [section('verse', 0, third), section('chorus', third, 2 * third), section('verse', 2 * third, seconds)];
};

const baseLive = () => ({
  status: 'idle',
  supported: true,
  chord: null,
  errorMessage: null,
  detectedSections: [],
  chordSpans: [],
  sectionProgressions: [],
  detectedKey: null,
  tempo: null,
  timingAligned: true,
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  reset: vi.fn(),
});

const capturing = (over: Record<string, unknown> = {}) => ({
  ...baseLive(),
  status: 'capturing',
  chord: { root: 9, quality: 'minor', score: 0.9 },
  detectedKey: { tonic: 0, mode: 'major', confidence: 0.8 },
  tempo: { bpm: 121.6, confidence: 0.8 },
  ...over,
});

const target = {
  provider: 'youtube',
  providerTrackId: YOUTUBE_ID,
  canonicalTrackId: `youtube:${YOUTUBE_ID}`,
  title: 'A song',
  artist: 'Someone',
  durationMs: 240_000,
};

let queryClient: QueryClient;

function renderPanel(over: Partial<React.ComponentProps<typeof AnalyzeTrackPanel>> = {}) {
  const onSignIn = vi.fn();
  const ui = (props: Partial<React.ComponentProps<typeof AnalyzeTrackPanel>>) => (
    <QueryClientProvider client={queryClient}>
      <AnalyzeTrackPanel {...target} onSignIn={onSignIn} {...props} />
    </QueryClientProvider>
  );
  const view = render(ui(over));
  return { onSignIn, rerender: (next: Partial<React.ComponentProps<typeof AnalyzeTrackPanel>> = over) => view.rerender(ui(next)) };
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.live = baseLive();
  mocks.user = { id: 'user-1' };
  mocks.submit.mockReset();
  mocks.toast.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shouldOfferAnalysis', () => {
  const base = {
    isIdle: false,
    isLoading: false,
    provider: 'youtube',
    title: 'A song',
    artist: 'Someone',
    hasProgression: false,
    hasSections: false,
  };

  it('offers it for a loaded track whose lookup finished empty', () => {
    expect(shouldOfferAnalysis(base)).toBe(true);
    expect(shouldOfferAnalysis({ ...base, provider: 'spotify' })).toBe(true);
  });

  it.each([
    ['nothing is loaded', { isIdle: true }],
    ['the lookup is still running', { isLoading: true }],
    ['the track already has a progression', { hasProgression: true }],
    ['the track already has sections', { hasSections: true }],
    ['the provider cannot be catalogued', { provider: 'apple_music' }],
    ['there is no provider', { provider: null }],
    ['there is no title', { title: '' }],
    ['the artist is blank', { artist: '   ' }],
  ])('does not offer it when %s', (_label, over) => {
    expect(shouldOfferAnalysis({ ...base, ...over })).toBe(false);
  });
});

describe('AnalyzeTrackPanel', () => {
  it('offers a one-click analysis, and the click starts the capture', () => {
    renderPanel();
    expect(screen.getByText('No chords for this track yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this track' }));
    expect(mocks.live.start).toHaveBeenCalledTimes(1);
  });

  it('sends a signed-out listener to sign in instead of starting a capture', () => {
    mocks.user = null;
    const { onSignIn } = renderPanel();
    expect(screen.queryByRole('button', { name: 'Analyze this track' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(mocks.live.start).not.toHaveBeenCalled();
  });

  it('explains that this browser cannot do it, with no button to press', () => {
    mocks.live = { ...baseLive(), supported: false };
    renderPanel();
    expect(screen.getByText(/needs desktop Chrome or Edge/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows what is being heard while it listens, without saving yet', () => {
    mocks.live = capturing({ sectionProgressions: capture(30) });
    renderPanel();
    expect(screen.getByTestId('analyze-chord').textContent).toBe('Am');
    expect(screen.getByTestId('analyze-key').textContent).toBe('Key C major');
    expect(screen.getByTestId('analyze-bpm').textContent).toBe('122 BPM');
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('says so while the key and tempo are still unknown', () => {
    mocks.live = capturing({ detectedKey: null, tempo: null, chord: null });
    renderPanel();
    expect(screen.getByTestId('analyze-key').textContent).toBe('Finding the key…');
    expect(screen.getByTestId('analyze-bpm').textContent).toBe('Finding the tempo…');
  });

  it('saves by itself once the capture is good enough, and stops listening', async () => {
    mocks.submit.mockResolvedValue({ runId: 'run-1', trackId: CATALOG_UUID, promoted: true, reason: 'promoted' });
    mocks.live = capturing({ sectionProgressions: capture(120) });
    renderPanel();

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const payload = mocks.submit.mock.calls[0][0];
    expect(payload.trackRef).toMatchObject({ provider: 'youtube', providerTrackId: YOUTUBE_ID, title: 'A song', artist: 'Someone', durationMs: 240000 });
    expect(payload).not.toHaveProperty('trackId');
    expect(payload.tempo).toEqual({ bpm: 121.6, confidence: 0.8 });
    expect(payload.key.tonic).toBe(0);

    await waitFor(() => expect(screen.getByText(/Saved\./)).toBeTruthy());
    expect(mocks.live.stop).toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Analysis saved' }));
    // The resolver is pointed at the new row straight away.
    expect(queryClient.getQueryData(['resolved-track-id', `youtube:${YOUTUBE_ID}`])).toBe(CATALOG_UUID);
  });

  it('sends the catalog row too when the track already has one', async () => {
    mocks.submit.mockResolvedValue({ runId: 'run-1', trackId: CATALOG_UUID, promoted: true });
    mocks.live = capturing({ sectionProgressions: capture(120) });
    renderPanel({ resolvedTrackId: CATALOG_UUID });
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.submit.mock.calls[0][0].trackId).toBe(CATALOG_UUID);
  });

  it('never sends a capture the player cannot tie to the song, and says why after a moment', async () => {
    vi.useFakeTimers();
    mocks.live = capturing({ sectionProgressions: capture(120), timingAligned: false });
    renderPanel();

    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.queryByText(/not reporting its position/)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(screen.getByText(/not reporting its position/)).toBeTruthy();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('does not send for a listener who is not signed in', async () => {
    mocks.user = null;
    mocks.live = capturing({ sectionProgressions: capture(120) });
    renderPanel();
    await Promise.resolve();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('accepts that someone else analysed the track first', async () => {
    mocks.submit.mockResolvedValue({ runId: 'run-1', trackId: CATALOG_UUID, promoted: false, reason: 'already_analysed' });
    mocks.live = capturing({ sectionProgressions: capture(120) });
    renderPanel();

    await waitFor(() => expect(screen.getByText(/Someone just analyzed this track/)).toBeTruthy());
    expect(mocks.live.stop).toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['resolved-track-id', `youtube:${YOUTUBE_ID}`])).toBe(CATALOG_UUID);
  });

  it('keeps listening when the server wants more, retries only after more of the song, and gives up after three', async () => {
    mocks.submit.mockResolvedValue({ runId: 'run-x', trackId: CATALOG_UUID, promoted: false, reason: 'insufficient_coverage' });

    mocks.live = capturing({ sectionProgressions: capture(120) });
    const { rerender } = renderPanel();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.live.stop).not.toHaveBeenCalled();

    // Only 5 s more: not worth another stored run.
    mocks.live = capturing({ sectionProgressions: capture(125) });
    rerender();
    await act(async () => {});
    expect(mocks.submit).toHaveBeenCalledTimes(1);

    // 20 s more: try again.
    mocks.live = capturing({ sectionProgressions: capture(140) });
    rerender();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));

    mocks.live = capturing({ sectionProgressions: capture(160) });
    rerender();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByText(/Could not save this yet/)).toBeTruthy());

    // Out of attempts, however much more it hears.
    mocks.live = capturing({ sectionProgressions: capture(200) });
    rerender();
    await act(async () => {});
    expect(mocks.submit).toHaveBeenCalledTimes(3);
  });

  it('shows the server error and stays available when a send fails', async () => {
    mocks.submit.mockRejectedValue(new Error('Daily analysis limit reached. Try again tomorrow.'));
    mocks.live = capturing({ sectionProgressions: capture(120) });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Daily analysis limit reached/)).toBeTruthy());
    expect(mocks.live.stop).not.toHaveBeenCalled();
  });

  it('reports how far it got when the capture ends early, and offers another go', () => {
    mocks.live = {
      ...baseLive(),
      status: 'idle',
      chordSpans: [span(0, 'major', 0, 30)],
      sectionProgressions: capture(30),
      detectedKey: { tonic: 0, mode: 'major', confidence: 0.8 },
    };
    renderPanel();
    expect(screen.getByText('Stopped before there was enough to save')).toBeTruthy();
    expect(screen.getByText(/Heard 0:30 of about 1:30/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.live.start).toHaveBeenCalledTimes(1);
  });

  it('shows why a capture could not start', () => {
    mocks.live = { ...baseLive(), status: 'error', errorMessage: 'Sharing was cancelled.' };
    renderPanel();
    expect(screen.getByRole('alert').textContent).toBe('Sharing was cancelled.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('uses the normalised id from the canonical id, not whatever form the player kept', async () => {
    mocks.submit.mockResolvedValue({ runId: 'r', trackId: CATALOG_UUID, promoted: true });
    mocks.live = capturing({ sectionProgressions: capture(120) });
    renderPanel({ providerTrackId: `https://www.youtube.com/watch?v=${YOUTUBE_ID}` });
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.submit.mock.calls[0][0].trackRef.providerTrackId).toBe(YOUTUBE_ID);
  });
});
