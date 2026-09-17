import { describe, it, expect } from 'vitest';
import { shouldRetryQuery } from './usePlaylists';

describe('shouldRetryQuery', () => {
  // A PostgREST/Postgres error code means the server already gave its settled
  // answer. Retrying those is what held /playlist/:id on "Loading..." for
  // ~8.6s before it could say "Playlist not found".
  it('does not retry a server answer that carries a PostgREST code', () => {
    expect(shouldRetryQuery(0, { code: 'PGRST200', message: 'no relationship' })).toBe(false);
    expect(shouldRetryQuery(0, { code: 'PGRST116', message: 'no rows' })).toBe(false);
  });

  it('does not retry a Postgres error code such as an invalid uuid', () => {
    expect(shouldRetryQuery(0, { code: '22P02', message: 'invalid input syntax for type uuid' })).toBe(false);
  });

  it('still retries a network failure, which carries no code', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError('Failed to fetch'))).toBe(true);
  });

  it('gives up on network failures after two retries', () => {
    expect(shouldRetryQuery(2, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('treats an empty code as no code', () => {
    expect(shouldRetryQuery(0, { code: '' })).toBe(true);
  });

  it('tolerates a null error', () => {
    expect(shouldRetryQuery(0, null)).toBe(true);
  });
});
