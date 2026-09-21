import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    expect(result[0].label).toBe('Intro');
    expect(result[0].start_ms).toBe(0);
    expect(result[0].end_ms).toBe(18000);
    expect(result[1].label).toBe('Verse 1');
    expect(result[1].start_ms).toBe(18000);
    expect(result[2].label).toBe('Chorus');
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
    expect(result[0].label).toBe('Verse 1');
    expect(result[0].start_ms).toBe(0);
    expect(result[0].end_ms).toBe(30000);
  });
});
