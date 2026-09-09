import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Exercises the REAL relay in public/universal-player.html, by loading that
 * file's own <script> into jsdom - not a reimplementation of it. The file is
 * a standalone static asset that the app cannot import, so a copy of its
 * logic here would happily keep passing while the shipped file regressed.
 */
function loadRelay() {
  const html = readFileSync(resolve(__dirname, '../../../public/universal-player.html'), 'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error('no <script> found in universal-player.html');

  document.body.innerHTML = '<div id="root"></div>';
  new Function(source)();

  // Load a YouTube target so the relay arms itself and a provider frame exists.
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      source: window as unknown as Window,
      data: {
        type: 'universal-player:play',
        payload: { provider: 'youtube', id: 'abc123', src: 'https://www.youtube-nocookie.com/embed/abc123', requestId: 1 },
      },
    })
  );

  const frame = document.getElementById('provider') as HTMLIFrameElement | null;
  if (!frame?.contentWindow) throw new Error('provider frame was not created');
  return frame;
}

/** One infoDelivery message, exactly as YouTube posts it (a JSON string). */
function deliver(frame: HTMLIFrameElement, info: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://www.youtube-nocookie.com',
      source: frame.contentWindow,
      data: JSON.stringify({ event: 'infoDelivery', info, id: 1, channel: 'widget' }),
    })
  );
}

describe('YouTube state relay (public/universal-player.html)', () => {
  let frame: HTMLIFrameElement;
  let relayed: any[];

  beforeEach(() => {
    vi.restoreAllMocks();
    relayed = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: any) => {
      if (msg && msg.type === 'universal-player:state') relayed.push(msg.payload);
    }) as any);
    frame = loadRelay();
  });

  it('reports isPlaying from a full payload', () => {
    deliver(frame, { currentTime: 12, duration: 200, playerState: 1 });
    expect(relayed).toHaveLength(1);
    expect(relayed[0]).toMatchObject({ isPlaying: true, positionMs: 12000, durationMs: 200000 });
  });

  // The regression: infoDelivery is PARTIAL. A progress tick carrying only
  // currentTime must not be read as "not playing, duration 0" - that is what
  // left the transport button stuck on Play during playback and kept
  // collapsing the seekbar to 0:00.
  it('omits fields a partial payload does not carry', () => {
    deliver(frame, { currentTime: 30 });
    expect(relayed).toHaveLength(1);
    expect(relayed[0]).toEqual({ positionMs: 30000 });
    expect(relayed[0]).not.toHaveProperty('isPlaying');
    expect(relayed[0]).not.toHaveProperty('durationMs');
  });

  it('never reports a playing track as stopped across a run of partial ticks', () => {
    deliver(frame, { currentTime: 1, duration: 200, playerState: 1 });
    deliver(frame, { currentTime: 2 });
    deliver(frame, { currentTime: 3, loadedFraction: 0.4 });
    deliver(frame, { videoData: { video_id: 'abc123' } });
    expect(relayed.some((p) => p.isPlaying === false)).toBe(false);
  });

  it('treats buffering as playing, and pause/end as not playing', () => {
    deliver(frame, { playerState: 3 }); // BUFFERING - a stall inside playback
    expect(relayed.at(-1)).toEqual({ isPlaying: true });
    deliver(frame, { playerState: 2 }); // PAUSED
    expect(relayed.at(-1)).toEqual({ isPlaying: false });
    deliver(frame, { playerState: 0 }); // ENDED
    expect(relayed.at(-1)).toEqual({ isPlaying: false });
  });

  it('stays silent when a message carries nothing it tracks', () => {
    deliver(frame, { volume: 50, muted: false });
    expect(relayed).toHaveLength(0);
  });

  it('ignores a zero duration rather than relaying it as a real one', () => {
    deliver(frame, { currentTime: 5, duration: 0 });
    expect(relayed.at(-1)).toEqual({ positionMs: 5000 });
  });
});
