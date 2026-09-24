import { describe, it, expect, vi, beforeEach } from 'vitest';
import { draftFromSections, toSections } from '@/lib/harmony/sectionDraft';

const mocks = vi.hoisted(() => ({
  rpcResponse: { data: null as any, error: null as any },
  fromResponse: { data: null as any, error: null as any },
  rpc: vi.fn(() => Promise.resolve(mocks.rpcResponse)),
  maybeSingle: vi.fn(() => Promise.resolve(mocks.fromResponse)),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mocks.maybeSingle,
        })),
      })),
    })),
  },
}));

const { getTrackSections } = await import('./trackSections');

const TRACK_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  mocks.rpcResponse.data = null;
  mocks.rpcResponse.error = null;
  mocks.fromResponse.data = null;
  mocks.fromResponse.error = null;
  mocks.rpc.mockClear();
  mocks.maybeSingle.mockClear();
});

describe('getTrackSections fallback', () => {
  it('returns track_sections rows when the RPC returns data', async () => {
    mocks.rpcResponse.data = [
      { id: 's1', track_id: TRACK_ID, label: 'verse', start_ms: 0, end_ms: 10000, created_at: '2024-01-01T00:00:00Z' },
    ];

    const result = await getTrackSections(TRACK_ID);

    expect(mocks.rpc).toHaveBeenCalledWith('get_track_sections', { p_track_id: TRACK_ID });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('verse');
  });

  it('falls back to tracks.sections JSONB when track_sections RPC returns empty', async () => {
    mocks.rpcResponse.data = [];
    mocks.fromResponse.data = {
      sections: [
        { type: 'intro', label: 'Intro', start_time: 0, end_time: 18 },
        { type: 'verse', label: 'Verse 1', start_time: 18, end_time: 46 },
        { type: 'chorus', label: 'Chorus', start_time: 46, end_time: 74 },
      ],
    };

    const result = await getTrackSections(TRACK_ID);

    expect(result).toHaveLength(3);
    // `label` is the canonical section type, not the column's display name
    // ("Verse 1"): the section editor and sectionVariant only recognise the
    // canonical ones. Display names are derived by sectionDisplayNames.
    expect(result[0].label).toBe('intro');
    expect(result[0].start_ms).toBe(0);
    expect(result[0].end_ms).toBe(18000);
    expect(result[1].label).toBe('verse');
    expect(result[1].start_ms).toBe(18000);
    expect(result[2].label).toBe('chorus');
  });

  it('returns empty when both RPC and tracks.sections are empty', async () => {
    mocks.rpcResponse.data = [];
    mocks.fromResponse.data = { sections: null };

    const result = await getTrackSections(TRACK_ID);

    expect(result).toEqual([]);
  });

  it('falls back to tracks.sections when the RPC errors', async () => {
    mocks.rpcResponse.error = { message: 'function does not exist' };
    mocks.fromResponse.data = {
      sections: [
        { type: 'verse', label: 'Verse 1', start_time: 0, end_time: 30 },
      ],
    };

    const result = await getTrackSections(TRACK_ID);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('verse');
    expect(result[0].start_ms).toBe(0);
    expect(result[0].end_ms).toBe(30000);
  });
});

/**
 * Regression: a seeded track keeps its structure only in the tracks.sections
 * jsonb column, whose `label` is a display name ("Verse 1", "Final Chorus").
 * getTrackSections used to pass that through as TrackSection.label, so the
 * section editor - which only knows the canonical labels - recognised none of
 * it and opened on a lone Intro. Saving from there replaced the track's real
 * sections with that one row.
 */
describe('getTrackSections fallback yields something the section editor can use', () => {
  // Shape and labels exactly as 07-seed.sql stores them for Blinding Lights.
  const SEEDED = [
    { type: 'intro', label: 'Intro', start_time: 0, end_time: 18 },
    { type: 'verse', label: 'Verse 1', start_time: 18, end_time: 46 },
    { type: 'chorus', label: 'Chorus', start_time: 46, end_time: 74 },
    { type: 'verse', label: 'Verse 2', start_time: 74, end_time: 102 },
    { type: 'chorus', label: 'Chorus 2', start_time: 102, end_time: 130 },
    { type: 'bridge', label: 'Bridge', start_time: 130, end_time: 158 },
    { type: 'chorus', label: 'Final Chorus', start_time: 158, end_time: 186 },
    { type: 'outro', label: 'Outro', start_time: 186, end_time: 200 },
  ];

  beforeEach(() => {
    mocks.rpcResponse.data = [];
    mocks.fromResponse.data = { sections: SEEDED };
  });

  it('numbers each label by occurrence, as the canonical table stores it', async () => {
    const sections = await getTrackSections(TRACK_ID);
    expect(sections.map((s) => `${s.label}#${s.ordinal}`)).toEqual([
      'intro#1', 'verse#1', 'chorus#1', 'verse#2', 'chorus#2', 'bridge#1', 'chorus#3', 'outro#1',
    ]);
  });

  it('gives the editor every stored section to start from, not a lone Intro', async () => {
    const sections = await getTrackSections(TRACK_ID);
    const draft = draftFromSections(sections.map((s) => ({ label: s.label, start_ms: s.start_ms })));

    expect(draft).toHaveLength(8);
    // ...and saving it unchanged reproduces the same boundaries.
    expect(toSections(draft, 200000).map((s) => s.startMs)).toEqual([
      0, 18000, 46000, 74000, 102000, 130000, 158000, 186000,
    ]);
  });

  it('skips an entry whose type is not a known section label rather than inventing one', async () => {
    mocks.fromResponse.data = {
      sections: [
        { type: 'verse', start_time: 0, end_time: 10 },
        { type: 'jam', start_time: 10, end_time: 20 },
      ],
    };

    const sections = await getTrackSections(TRACK_ID);
    expect(sections.map((s) => s.label)).toEqual(['verse']);
  });
});
