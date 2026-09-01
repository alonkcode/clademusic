import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompactSongSections } from '@/components/CompactSongSections';
import type { TrackSection } from '@/types';

/**
 * A card's section chips used to light up from the global player's
 * positionMs whenever *anything* was playing, without checking that the
 * playing track was this card's own track. On a feed with several cards,
 * that meant an unrelated track's playback position could coincidentally
 * fall inside one of this card's own section ranges and glow it "active" -
 * which is also exactly what made the harmonic readout below (gated on
 * canonicalTrackId via useSectionSync) look permanently out of step with
 * the chips above it.
 */

const player = {
  openPlayer: vi.fn(),
  seekTo: vi.fn(),
  youtubeOpen: false,
  youtubeTrackId: null as string | null,
  spotifyOpen: false,
  spotifyTrackId: null as string | null,
  currentSectionId: null as string | null,
  positionMs: 55_000,
  isPlaying: true,
  provider: 'youtube',
  trackId: 'yt-other',
  canonicalTrackId: 'OTHER_TRACK',
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

const chorus = () => screen.getByTitle(/Play chorus from/i);

describe('Section chip highlighting only follows a track that is actually playing', () => {
  it('does not light up from another track\'s playback position', () => {
    Object.assign(player, { canonicalTrackId: 'OTHER_TRACK', isPlaying: true, positionMs: 55_000, currentSectionId: null });
    renderSections();

    // positionMs (55s) falls inside the chorus range (50-80s), but the track
    // actually playing ("OTHER_TRACK") is not this card's track ("t1").
    expect(chorus().className).not.toContain('ring-primary');
  });

  it('does light up from position once this card\'s own track is the one playing', () => {
    Object.assign(player, { canonicalTrackId: 't1', isPlaying: true, positionMs: 55_000, currentSectionId: null });
    renderSections();

    expect(chorus().className).toContain('ring-primary');
  });
});
