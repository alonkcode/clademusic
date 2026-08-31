import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompactSongSections } from '@/components/CompactSongSections';
import type { TrackSection } from '@/types';

/**
 * Tapping a stanza while the track plays must move the playhead, on either
 * provider. Spotify used to fall through the branch that handled this and do
 * nothing at all, so the tap only ever worked on YouTube.
 */

const player = {
  openPlayer: vi.fn(),
  seekTo: vi.fn(),
  youtubeOpen: false,
  youtubeTrackId: null as string | null,
  spotifyOpen: false,
  spotifyTrackId: null as string | null,
  currentSectionId: null as string | null,
  positionMs: 0,
  isPlaying: false,
};

vi.mock('@/player/PlayerContext', () => ({
  usePlayer: () => player,
}));

const sections: TrackSection[] = [
  { id: 's1', track_id: 't1', label: 'intro', start_ms: 0, end_ms: 20_000, created_at: '' },
  { id: 's2', track_id: 't1', label: 'verse', start_ms: 20_000, end_ms: 50_000, created_at: '' },
  { id: 's3', track_id: 't1', label: 'chorus', start_ms: 50_000, end_ms: 80_000, created_at: '' },
];

function renderSections() {
  return render(
    <CompactSongSections
      sections={sections}
      youtubeId="yt-1"
      spotifyId="sp-1"
      trackTitle="Test Track"
      trackArtist="Tester"
      canonicalTrackId="t1"
    />
  );
}

/** The chorus chip, found by the label it renders. */
const chorus = () => screen.getByTitle(/Play chorus from/i);

describe('Seeking to a section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(player, {
      youtubeOpen: false,
      youtubeTrackId: null,
      spotifyOpen: false,
      spotifyTrackId: null,
      isPlaying: false,
    });
  });

  it('seeks in place when the track is already playing on Spotify', () => {
    Object.assign(player, { spotifyOpen: true, spotifyTrackId: 'sp-1', isPlaying: true });
    renderSections();

    fireEvent.click(chorus());

    expect(player.seekTo).toHaveBeenCalledWith(50);
    expect(player.openPlayer).not.toHaveBeenCalled();
  });

  it('seeks in place when the track is already playing on YouTube', () => {
    Object.assign(player, { youtubeOpen: true, youtubeTrackId: 'yt-1', isPlaying: true });
    renderSections();

    fireEvent.click(chorus());

    expect(player.seekTo).toHaveBeenCalledWith(50);
    expect(player.openPlayer).not.toHaveBeenCalled();
  });

  it('starts playback at the section, not from the top, when nothing is playing', () => {
    renderSections();

    fireEvent.click(chorus());

    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.openPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ startSec: 50, canonicalTrackId: 't1', autoplay: true })
    );
  });

  it('stays on Spotify when the Spotify player is the one open', () => {
    Object.assign(player, { spotifyOpen: true, spotifyTrackId: 'sp-other' });
    renderSections();

    fireEvent.click(chorus());

    expect(player.openPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'spotify', providerTrackId: 'sp-1', startSec: 50 })
    );
  });
});
