import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./spotifyAuthService', () => ({
  getValidAccessToken: vi.fn(),
  refreshSpotifyToken: vi.fn(),
  getSpotifyCredentials: vi.fn(),
}));

import { getValidAccessToken, refreshSpotifyToken, getSpotifyCredentials } from './spotifyAuthService';
import { getSpotifyConnectionStatus } from './spotifyUserService';

const fetchMock = vi.fn();

const res = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getValidAccessToken).mockResolvedValue('token-1');
});

describe('getSpotifyConnectionStatus', () => {
  it('is disconnected, without calling Spotify, when there is no stored token', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue(null);

    expect(await getSpotifyConnectionStatus('u1')).toBe('disconnected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is connected when /me succeeds', async () => {
    fetchMock.mockResolvedValue(res(200));

    expect(await getSpotifyConnectionStatus('u1')).toBe('connected');
  });

  // The dev-mode allowlist case: a valid token that Spotify still refuses.
  // Distinct from disconnected because reconnecting cannot fix it.
  it('is blocked when /me answers 403', async () => {
    fetchMock.mockResolvedValue(res(403));

    expect(await getSpotifyConnectionStatus('u1')).toBe('blocked');
  });

  it('is disconnected for other failures', async () => {
    fetchMock.mockResolvedValue(res(500));

    expect(await getSpotifyConnectionStatus('u1')).toBe('disconnected');
  });

  it('is disconnected when the request itself throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('offline'));

    expect(await getSpotifyConnectionStatus('u1')).toBe('disconnected');
  });

  describe('expired token (401)', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValueOnce(res(401));
      vi.mocked(getSpotifyCredentials).mockResolvedValue({ refresh_token: 'r1' } as never);
    });

    it('is disconnected when it cannot be refreshed', async () => {
      vi.mocked(refreshSpotifyToken).mockResolvedValue(null);

      expect(await getSpotifyConnectionStatus('u1')).toBe('disconnected');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('is connected when the refreshed token works, and retries with that token', async () => {
      vi.mocked(refreshSpotifyToken).mockResolvedValue('token-2');
      fetchMock.mockResolvedValueOnce(res(200));

      expect(await getSpotifyConnectionStatus('u1')).toBe('connected');
      expect(fetchMock.mock.calls[1][1]).toEqual({ headers: { Authorization: 'Bearer token-2' } });
    });

    it('is blocked when the refreshed token is then refused with 403', async () => {
      vi.mocked(refreshSpotifyToken).mockResolvedValue('token-2');
      fetchMock.mockResolvedValueOnce(res(403));

      expect(await getSpotifyConnectionStatus('u1')).toBe('blocked');
    });
  });
});
