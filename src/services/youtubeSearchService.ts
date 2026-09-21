/**
 * YouTube Search Service
 *
 * Automatically search for music videos on YouTube, via the search-youtube
 * Supabase Edge Function (server-side YOUTUBE_API_KEY - see that function's
 * header comment for why this doesn't call googleapis.com directly).
 */

import { supabase } from '@/integrations/supabase/client';

const YT_FUNCTION = 'search-youtube';

// If we encounter auth/quota errors, disable further YouTube API calls for this session
let youtubeSearchDisabled = false;
let youtubeSearchDisabledReason: string | null = null;
let youtubeWarningLogged = false;

function disableYouTubeSearch(reason: string) {
  youtubeSearchDisabled = true;
  youtubeSearchDisabledReason = reason;
  if (!youtubeWarningLogged) {
    console.warn('[YouTubeSearch] disabled:', reason);
    youtubeWarningLogged = true;
  }
}

// search-youtube forwards YouTube's own 401/403 as-is and everything else as
// 502, specifically so this can tell "not going to work again this session"
// apart from "transient, worth retrying next call".
function isAuthOrQuotaError(error: unknown): boolean {
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  return status === 401 || status === 403;
}

async function invokeYouTube<T>(body: Record<string, unknown>): Promise<T | null> {
  if (youtubeSearchDisabled) return null;

  const { data, error } = await supabase.functions.invoke(YT_FUNCTION, { body });
  if (error) {
    if (isAuthOrQuotaError(error)) {
      disableYouTubeSearch(`search-youtube returned an auth/quota error: ${error.message}`);
    } else {
      console.error('search-youtube invoke error', error);
    }
    return null;
  }
  return data as T;
}

function extractYouTubeId(input: string): string | null {
  if (!input) return null;
  // Direct 11-char ID
  const directId = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(directId)) return directId;

  // youtu.be short links
  const shortMatch = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch?.[1]) return shortMatch[1];

  // youtube.com/watch?v=VIDEOID
  const paramMatch = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (paramMatch?.[1]) return paramMatch[1];

  return null;
}

interface YouTubeSearchResult {
  items: Array<{
    id: { videoId: string };
    snippet: {
      title: string;
      description: string;
      channelTitle: string;
    };
  }>;
}

interface YouTubeVideosResult {
  items?: Array<{
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: {
        high?: { url: string };
        default?: { url: string };
      };
    };
    contentDetails?: {
      duration?: string;
    };
  }>;
}

export interface VideoResult {
  videoId: string;
  title: string;
  channel: string;
  type: 'official' | 'cover' | 'live' | 'lyric' | 'audio';
}

/**
 * Fetch a single YouTube video by ID and return minimal metadata as a Track-like object
 */
export async function getYouTubeVideo(videoId: string) {
  try {
    const data = await invokeYouTube<YouTubeVideosResult>({
      endpoint: 'videos',
      ids: videoId,
      part: 'snippet,contentDetails',
    });
    const item = data?.items?.[0];
    if (!item) return null;

    // Rough parse of title into artist - title when possible
    const titleText: string = item.snippet?.title || '';
    const [maybeArtist, maybeTitle] = titleText.includes(' - ') ? titleText.split(' - ', 2) : [undefined, titleText];

    // Convert ISO 8601 duration to ms
    const durationIso: string = item.contentDetails?.duration || '';
    const durationMs = iso8601DurationToMs(durationIso);

    return {
      id: `youtube:${videoId}`,
      title: maybeTitle || titleText,
      artist: maybeArtist || item.snippet?.channelTitle,
      cover_url: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url,
      youtube_id: videoId,
      duration_ms: durationMs,
      provider: 'youtube' as const,
    };
  } catch (err) {
    console.error('getYouTubeVideo error', err);
    return null;
  }
}

function iso8601DurationToMs(iso: string): number {
  // Very small parser for PT#M#S
  try {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    const hours = parseInt(m[1] || '0', 10);
    const minutes = parseInt(m[2] || '0', 10);
    const seconds = parseInt(m[3] || '0', 10);
    return ((hours * 3600) + (minutes * 60) + seconds) * 1000;
  } catch {
    return 0;
  }
}

/**
 * Search YouTube for a song
 * Returns multiple video types: official, covers, live performances, etc.
 */
export async function searchYouTubeVideos(
  artist: string,
  title: string
): Promise<VideoResult[]> {
  if (youtubeSearchDisabled) {
    if (!youtubeWarningLogged && youtubeSearchDisabledReason) {
      console.warn('[YouTubeSearch] skipped because disabled:', youtubeSearchDisabledReason);
      youtubeWarningLogged = true;
    }
    return [];
  }

  try {
    const results: VideoResult[] = [];

    // If user typed/pasted a YouTube URL or direct video ID, short-circuit to a single fetch
    const directId = extractYouTubeId(title ? `${artist} ${title}` : artist);
    if (directId) {
      const directMeta = await fetchYouTubeVideoSnippet(directId);
      if (directMeta) {
        return [{ videoId: directId, title: directMeta.title, channel: directMeta.channel, type: 'official' }];
      }
    }

    // Search 1: Official video/audio
    const officialQuery = `${artist} ${title} official`.trim();
    const officialResults = await searchYouTube(officialQuery, 3);
    results.push(...officialResults.map(r => ({ ...r, type: 'official' as const })));

    // Search 2: Live performances
    const liveQuery = `${artist} ${title} live`.trim();
    const liveResults = await searchYouTube(liveQuery, 2);
    results.push(...liveResults.map(r => ({ ...r, type: 'live' as const })));

    // Search 3: Covers
    const coverQuery = `${title || artist} cover`.trim();
    const coverResults = await searchYouTube(coverQuery, 2);
    results.push(...coverResults.map(r => ({ ...r, type: 'cover' as const })));

    // Remove duplicates by videoId
    const unique = results.filter((v, i, arr) =>
      arr.findIndex(x => x.videoId === v.videoId) === i
    );

    return unique;
  } catch (error) {
    console.error('Error searching YouTube:', error);
    return [];
  }
}

/**
 * Search YouTube API
 */
async function searchYouTube(
  query: string,
  maxResults: number
): Promise<Omit<VideoResult, 'type'>[]> {
  const data = await invokeYouTube<YouTubeSearchResult>({ endpoint: 'search', query, maxResults });
  if (!data) return [];

  return data.items.map(item => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
  }));
}

async function fetchYouTubeVideoSnippet(videoId: string): Promise<{ title: string; channel: string } | null> {
  const data = await invokeYouTube<YouTubeVideosResult>({ endpoint: 'videos', ids: videoId, part: 'snippet' });
  const item = data?.items?.[0];
  if (!item) return null;
  return {
    title: item.snippet?.title || 'YouTube video',
    channel: item.snippet?.channelTitle || 'YouTube',
  };
}
