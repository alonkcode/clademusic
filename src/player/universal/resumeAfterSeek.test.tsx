import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { PlayerProvider, usePlayer } from '@/player/PlayerContext';
import { UniversalPlayerHost } from './UniversalPlayerHost';

/**
 * Resume-after-seek on the embed path. Found in a browser pass against the
 * live site: after seeking to 221.7s and playing on to 229.8s, pause then play
 * resumed at 223.4s - play() was re-sending the stale seek target. These drive
 * the real PlayerProvider and UniversalPlayerHost and read the commands that
 * actually reach the iframe.
 */
type Ctx = ReturnType<typeof usePlayer>;

function Harness({ onCtx }: { onCtx: (ctx: Ctx) => void }) {
  const ctx = usePlayer();
  useEffect(() => {
    onCtx(ctx);
  });
  return <UniversalPlayerHost request={{ provider: 'youtube', id: 'dQw4w9WgXcQ', autoplay: true }} />;
}

async function setup() {
  let latest: Ctx | null = null;
  const { container } = render(
    <PlayerProvider>
      <Harness onCtx={(c) => (latest = c)} />
    </PlayerProvider>
  );
  await waitFor(() => expect(latest).toBeTruthy());

  const frame = container.querySelector('#universal-player') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  const commands = () =>
    post.mock.calls
      .map(([msg]) => msg as { type?: string; payload?: { command?: string; seconds?: number } })
      .filter((msg) => msg?.type === 'universal-player:command')
      .map((msg) => msg.payload!);

  return { get: () => latest!, post, commands };
}

describe('embed path: resuming after a seek', () => {
  it('pause then play after a seekbar/section seek resumes in place, without re-seeking', async () => {
    const { get, post, commands } = await setup();

    act(() => {
      get().openPlayer({ canonicalTrackId: 't1', provider: 'youtube', providerTrackId: 'dQw4w9WgXcQ', title: 'T', artist: 'A', autoplay: true });
    });
    await waitFor(() => expect(get().isPlaying).toBe(true));

    act(() => get().seekTo(221.7));
    expect(commands()).toContainEqual({ command: 'seek', seconds: 221.7 });
    // Delivered on the spot, so nothing is left pending for play() to re-apply.
    await waitFor(() => expect(get().seekToSec).toBeNull());

    act(() => get().togglePlayPause()); // pause
    await waitFor(() => expect(get().isPlaying).toBe(false));

    post.mockClear();
    act(() => get().togglePlayPause()); // play
    await waitFor(() => expect(get().isPlaying).toBe(true));

    expect(commands().map((c) => c.command)).toContain('play');
    expect(commands().some((c) => c.command === 'seek')).toBe(false);
  });

  it('pause then play after a quicklink handoff does not jump back to the handoff point', async () => {
    const { get, post, commands } = await setup();

    // openPlayer writes the handoff position straight into seekToSec; on this
    // path the embed already starts there via its URL's start= parameter.
    act(() => {
      get().openPlayer({ canonicalTrackId: 't1', provider: 'youtube', providerTrackId: 'dQw4w9WgXcQ', title: 'T', artist: 'A', autoplay: true, startSec: 60 });
    });
    await waitFor(() => expect(get().isPlaying).toBe(true));

    act(() => get().togglePlayPause()); // pause
    await waitFor(() => expect(get().isPlaying).toBe(false));

    post.mockClear();
    act(() => get().togglePlayPause()); // play
    await waitFor(() => expect(get().isPlaying).toBe(true));

    expect(commands().some((c) => c.command === 'seek')).toBe(false);
    await waitFor(() => expect(get().seekToSec).toBeNull());
  });
});
