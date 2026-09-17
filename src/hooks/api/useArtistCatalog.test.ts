import { describe, it, expect } from 'vitest';
import { creditsArtist, escapeLike } from './useArtistCatalog';

describe('escapeLike', () => {
  // The first version of this was mangled by shell escaping into a template
  // literal that emitted the text "${ch}" instead of a backslash, so a name
  // containing % or _ produced a broken pattern. Nothing tested it directly.
  it('escapes the LIKE wildcards so they match literally', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
  });

  it('escapes a literal backslash too', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });

  it('leaves ordinary names untouched', () => {
    expect(escapeLike('Ed Sheeran')).toBe('Ed Sheeran');
    expect(escapeLike('Mark Ronson ft. Bruno Mars')).toBe('Mark Ronson ft. Bruno Mars');
  });

  it('never emits template-literal residue', () => {
    expect(escapeLike('50% off_sale')).not.toContain('${');
  });
});

describe('creditsArtist', () => {
  it('matches the sole credited artist, case-insensitively', () => {
    expect(creditsArtist('Ed Sheeran', 'Ed Sheeran')).toBe(true);
    expect(creditsArtist('Ed Sheeran', 'ed sheeran')).toBe(true);
  });

  it('matches both the primary and the featured artist of a ft. credit', () => {
    expect(creditsArtist('The Weeknd ft. Daft Punk', 'The Weeknd')).toBe(true);
    expect(creditsArtist('The Weeknd ft. Daft Punk', 'Daft Punk')).toBe(true);
    expect(creditsArtist('Mark Ronson ft. Bruno Mars', 'Bruno Mars')).toBe(true);
  });

  it('handles the other common credit separators', () => {
    expect(creditsArtist('Calvin Harris feat. Rihanna', 'Rihanna')).toBe(true);
    expect(creditsArtist('Jay-Z & Kanye West', 'Kanye West')).toBe(true);
    expect(creditsArtist('Lil Nas X, Billy Ray Cyrus', 'Billy Ray Cyrus')).toBe(true);
  });

  it('does not match a name that is only a substring of another', () => {
    expect(creditsArtist('Adeleine', 'Adele')).toBe(false);
    expect(creditsArtist('The Weeknd ft. Daft Punk', 'Daft')).toBe(false);
  });

  it('still matches a band whose own name contains a separator', () => {
    expect(creditsArtist('Simon & Garfunkel', 'Simon & Garfunkel')).toBe(true);
  });

  it('does not split on "and", which would break real names apart', () => {
    expect(creditsArtist('Earth, Wind and Fire', 'Fire')).toBe(false);
  });

  it('rejects empty input rather than matching everything', () => {
    expect(creditsArtist('Ed Sheeran', '')).toBe(false);
    expect(creditsArtist(null, 'Ed Sheeran')).toBe(false);
  });
});
