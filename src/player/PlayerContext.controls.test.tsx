import React, { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerContext';
import type { ProviderControls } from './providers/adapter';

/**
 * Play/pause and mute drive the active provider's controls. Each press must
 * reach the provider exactly once. A state updater is not the place to do it:
 * React is free to run an updater more than once (StrictMode does so on
 * purpose), and every extra run would send the provider a duplicate command.
 */

vi.mock('@/api/playEvents', () => ({
  recordPlayEvent: vi.fn(async () => {}),
  recordPlayHistory: vi.fn(async () => {}),
}));

type Ctx = ReturnType<typeof usePlayer>;

let latest: Ctx;
let controls: { [K in keyof ProviderControls]-?: ReturnType<typeof vi.fn> };

function Probe() {
  const ctx = usePlayer();
  useEffect(() => {
    latest = ctx;
  });
  return null;
}

beforeEach(async () => {
  controls = {
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    setMute: vi.fn(),
    teardown: vi.fn(),
  };

  render(
    <React.StrictMode>
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    </React.StrictMode>
  );

  act(() => {
    latest.openPlayer({
      canonicalTrackId: 'c1',
      provider: 'youtube',
      providerTrackId: 'yt-1',
      title: 'Title',
      artist: 'Artist',
      autoplay: true,
    });
  });
  await waitFor(() => expect(latest.provider).toBe('youtube'));

  // Registering pushes the current volume/mute to the controls once; that is
  // setup, not what these tests count.
  act(() => latest.registerProviderControls('youtube', controls));
  Object.values(controls).forEach((fn) => fn.mockClear());
});

describe('provider commands from the transport', () => {
  it('pauses the provider once per press, and plays it once per press', () => {
    expect(latest.isPlaying).toBe(true);

    act(() => latest.togglePlayPause());
    expect(latest.isPlaying).toBe(false);
    expect(controls.pause).toHaveBeenCalledTimes(1);
    expect(controls.play).not.toHaveBeenCalled();

    act(() => latest.togglePlayPause());
    expect(latest.isPlaying).toBe(true);
    expect(controls.play).toHaveBeenCalledTimes(1);
    expect(controls.pause).toHaveBeenCalledTimes(1);
  });

  it('mutes and unmutes the provider once per press', () => {
    act(() => latest.toggleMute());
    expect(latest.isMuted).toBe(true);
    expect(controls.setMute).toHaveBeenCalledTimes(1);
    expect(controls.setMute).toHaveBeenLastCalledWith(true);

    act(() => latest.toggleMute());
    expect(latest.isMuted).toBe(false);
    expect(controls.setMute).toHaveBeenCalledTimes(2);
    expect(controls.setMute).toHaveBeenLastCalledWith(false);
    expect(controls.setVolume).not.toHaveBeenCalled();
  });

  it('restores an audible level when unmuting from zero volume', () => {
    act(() => latest.setVolumeLevel(0));
    expect(latest.isMuted).toBe(true);
    controls.setVolume.mockClear();
    controls.setMute.mockClear();

    act(() => latest.toggleMute());
    expect(latest.isMuted).toBe(false);
    expect(latest.volume).toBeGreaterThan(0);
    expect(controls.setVolume).toHaveBeenCalledTimes(1);
    expect(controls.setVolume).toHaveBeenLastCalledWith(latest.volume);
    expect(controls.setMute).toHaveBeenCalledTimes(1);
    expect(controls.setMute).toHaveBeenLastCalledWith(false);
  });
});
