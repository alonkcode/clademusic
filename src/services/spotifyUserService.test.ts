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

  it('is disconnected for a definite refusal such as 404', async () => {
    fetchMock.mockResolvedValue(res(404));

    expect(await getSpotifyConnectionStatus('u1')).toBe('disconnected');
  });

  // Transient failures must not be reported as a disconnection: the player
  // reads that as "drop to the free preview and show Reconnect", and React
  // Query would cache the wrong answer. Throwing lets it retry and keep the
  // last known status.
  it.each([429, 500, 502, 503])('throws instead of reporting disconnected when /me answers %i', async (status) => {
    fetchMock.mockResolvedValue(res(status));

    await expect(getSpotifyConnectionStatus('u1')).rejects.toThrow(String(status));
  });

  it('throws instead of reporting disconnected when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    await expect(getSpotifyConnectionStatus('u1')).rejects.toThrow('offline');
  });

  it('throws when the retry after a token refresh is itself rate limited', async () => {
    fetchMock.mockResolvedValueOnce(res(401));
    vi.mocked(getSpotifyCredentials).mockResolvedValue({ refresh_token: 'r1' } as never);
    vi.mocked(refreshSpotifyToken).mockResolvedValue('token-2');
    fetchMock.mockResolvedValueOnce(res(429));

    await expect(getSpotifyConnectionStatus('u1')).rejects.toThrow('429');
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
