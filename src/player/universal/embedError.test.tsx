import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { PlayerProvider, usePlayer } from '@/player/PlayerContext';
import { UniversalPlayerHost } from './UniversalPlayerHost';

/**
 * What the app does when the embed refuses to play - a removed or private
 * video, one whose owner blocks embedding, one blocked in the viewer's country.
 * YouTube sends onError and then nothing at all, so before this the transport
 * kept showing Pause and PlayerContext's clock kept counting up over a video
 * that had never started.
 */
type Ctx = ReturnType<typeof usePlayer>;

function Harness({ onCtx, onEmbedError }: { onCtx: (c: Ctx) => void; onEmbedError?: (e: unknown) => void }) {
  const ctx = usePlayer();
  useEffect(() => {
    onCtx(ctx);
  });
  return <UniversalPlayerHost request={{ provider: 'youtube', id: 'dQw4w9WgXcQ', autoplay: true }} onEmbedError={onEmbedError} />;
}

async function setup() {
  let latest: Ctx | null = null;
  const onEmbedError = vi.fn();
  const { container } = render(
    <PlayerProvider>
      <Harness onCtx={(c) => (latest = c)} onEmbedError={onEmbedError} />
    </PlayerProvider>
  );
  await waitFor(() => expect(latest).toBeTruthy());
  const frame = container.querySelector('#universal-player') as HTMLIFrameElement;

  const fail = (code: number | null, id = 'dQw4w9WgXcQ') =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: frame.contentWindow,
          data: { type: 'universal-player:error', payload: { code, provider: 'youtube', id } },
        })
      );
    });

  return { get: () => latest!, fail, onEmbedError, container };
}

describe('embed refusing to play', () => {
  it('stops reporting playback, so the clock cannot run over a dead video', async () => {
    const { get, fail } = await setup();

    act(() => {
      get().openPlayer({ canonicalTrackId: 't1', provider: 'youtube', providerTrackId: 'dQw4w9WgXcQ', title: 'T', artist: 'A', autoplay: true });
    });
    await waitFor(() => expect(get().isPlaying).toBe(true));
    // Pretend some optimistic position accumulated, as the clock would do.
    act(() => get().updatePlaybackState({ positionMs: 13000 }));
    await waitFor(() => expect(get().positionMs).toBe(13000));

    fail(150);

    await waitFor(() => {
      expect(get().isPlaying).toBe(false);
      expect(get().positionMs).toBe(0);
      expect(get().durationMs).toBe(0);
    });
  });

  it('reports the failure upward with a reason the listener can read', async () => {
    const { get, fail, onEmbedError } = await setup();
    act(() => {
      get().openPlayer({ canonicalTrackId: 't1', provider: 'youtube', providerTrackId: 'dQw4w9WgXcQ', title: 'T', artist: 'A', autoplay: true });
    });
    await waitFor(() => expect(get().isPlaying).toBe(true));

    fail(150);
    await waitFor(() => expect(onEmbedError).toHaveBeenCalled());
    const [arg] = onEmbedError.mock.calls.at(-1)!;
    expect(arg).toMatchObject({ code: 150 });
    expect(String((arg as { message: string }).message)).toMatch(/outside YouTube/i);
  });

  // The host's own panel also states the reason and offers the escape hatch,
  // for when the video panel is open.
  it('states the reason and offers a deep link in the video panel', async () => {
    const { get, fail } = await setup();
    act(() => {
      get().openPlayer({ canonicalTrackId: 't1', provider: 'youtube', providerTrackId: 'dQw4w9WgXcQ', title: 'T', artist: 'A', autoplay: true });
    });
    await waitFor(() => expect(get().isPlaying).toBe(true));

    fail(150);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("The owner doesn't allow this video to play outside YouTube.")
    );
    expect(screen.getByRole('link', { name: /Open .* on YouTube/i })).toHaveAttribute(
      'href',
      expect.stringContaining('youtube.com/watch')
    );
  });

  it('ignores an error meant for a track that is no longer loaded', async () => {
    const { get, fail } = await setup();
    act(() => {
      get().openPlayer({ canonicalTrackId: 't1', provider: 'youtube', providerTrackId: 'dQw4w9WgXcQ', title: 'T', artist: 'A', autoplay: true });
    });
    await waitFor(() => expect(get().isPlaying).toBe(true));

    fail(100, 'someOtherId');

    // Still playing: a late error from a previous video must not stop this one.
    expect(get().isPlaying).toBe(true);
  });
});
