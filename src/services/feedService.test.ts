import { describe, it, expect } from 'vitest';
import type { Track } from '@/types';
import type { TasteDNAProfile } from '@/api/tasteDNA';
import { rankFeed, type FeedSignals } from './feedService';

const track = (id: string, extra: Partial<Track> = {}): Track =>
  ({ id, title: `Track ${id}`, artist: 'Artist', ...extra }) as Track;

const dna: TasteDNAProfile = {
  favoriteProgressions: [{ progression: ['I', 'V', 'vi', 'IV'], count: 4, tracks: [] }],
  preferredModes: [{ mode: 'minor', percentage: 100, count: 4 }],
  energyPreference: 0.8,
  cadencePreference: 'loop',
  averageTempo: 120,
  totalTracksAnalyzed: 4,
};

const noSignals = (): FeedSignals => ({
  tasteDNA: null,
  followingListeners: new Map(),
  skipped: new Set(),
});

const ids = (tracks: Track[]) => tracks.map((t) => t.id);

describe('rankFeed', () => {
  it('returns the pool untouched when there are no signals', () => {
    const pool = [track('a'), track('b'), track('c')];
    expect(rankFeed(pool, noSignals())).toBe(pool);
  });

  it('puts the track closest to the listener taste first', () => {
    const near = track('near', { detected_mode: 'minor', energy: 0.8, tempo: 120 });
    const far = track('far', { detected_mode: 'major', energy: 0.1, tempo: 60 });

    const ranked = rankFeed([far, near], { ...noSignals(), tasteDNA: dna });

    expect(ids(ranked)).toEqual(['near', 'far']);
  });

  it('lifts tracks that followed users have been playing', () => {
    const pool = [track('a'), track('b'), track('c')];

    const ranked = rankFeed(pool, { ...noSignals(), followingListeners: new Map([['c', 3]]) });

    expect(ranked[0].id).toBe('c');
  });

  it('ranks more followed listeners above fewer', () => {
    const pool = [track('a'), track('b'), track('c')];

    const ranked = rankFeed(pool, {
      ...noSignals(),
      followingListeners: new Map([
        ['a', 1],
        ['c', 2],
      ]),
    });

    expect(ids(ranked).slice(0, 2)).toEqual(['c', 'a']);
  });

  it('moves skipped tracks to the back', () => {
    const pool = [track('a'), track('b'), track('c')];

    const ranked = rankFeed(pool, { ...noSignals(), skipped: new Set(['a']) });

    expect(ids(ranked)).toEqual(['b', 'c', 'a']);
  });

  it('keeps pool order between equally scored tracks', () => {
    const pool = [track('a'), track('b'), track('c'), track('d')];

    const ranked = rankFeed(pool, { ...noSignals(), followingListeners: new Map([['zzz', 1]]) });

    expect(ids(ranked)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is deterministic for the same pool and signals', () => {
    const pool = [
      track('a', { energy: 0.2 }),
      track('b', { energy: 0.9 }),
      track('c'),
      track('d', { tempo: 118 }),
      track('e'),
    ];
    const signals = { ...noSignals(), tasteDNA: dna, followingListeners: new Map([['c', 1]]) };

    expect(ids(rankFeed(pool, signals))).toEqual(ids(rankFeed(pool, signals)));
  });

  it('does not lose or duplicate tracks', () => {
    const pool = Array.from({ length: 30 }, (_, i) =>
      track(`t${i}`, i % 3 === 0 ? { energy: i / 30, tempo: 60 + i } : {})
    );

    const ranked = rankFeed(pool, {
      tasteDNA: dna,
      followingListeners: new Map([['t4', 2]]),
      skipped: new Set(['t7', 't9']),
    });

    expect(ranked).toHaveLength(pool.length);
    expect(new Set(ids(ranked)).size).toBe(pool.length);
  });

  it('surfaces tracks with no analysis data through exploration slots instead of burying them', () => {
    const analysed = Array.from({ length: 8 }, (_, i) =>
      track(`m${i}`, { detected_mode: 'minor', energy: 0.8, tempo: 120 })
    );
    const unknown = [track('u0'), track('u1')];

    const ranked = rankFeed([...analysed, ...unknown], { ...noSignals(), tasteDNA: dna });

    // Every 4th slot (index 3, 7, ...) is an exploration pick, in pool order.
    expect(ranked[3].id).toBe('u0');
    expect(ranked[7].id).toBe('u1');
  });

  it('still returns unscored tracks when nothing can be scored', () => {
    const pool = [track('a'), track('b')];

    const ranked = rankFeed(pool, { ...noSignals(), tasteDNA: dna });

    expect(ids(ranked)).toEqual(['a', 'b']);
  });
});
