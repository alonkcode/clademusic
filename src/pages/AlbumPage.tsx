/**
 * Album Page
 *
 * Built from the album's tracks in the Clade catalog. It used to render one
 * hardcoded mock for every album - the same title, artist, cover, release date
 * and tracklist whatever you clicked - alongside a nearby-listeners panel and a
 * comment feed that are themselves fixed mock data (neither component reads its
 * entityId at all). None of that is shown now.
 *
 * There is no albums table: a track simply carries its album name as text, and
 * TrackMenu already routes to /album/<name>. So the album is the name, and this
 * page is the set of catalog tracks sharing it.
 */

import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Music, Disc3, Share2, Clock, Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BottomNav } from '@/components/BottomNav';
import { formatDurationFull } from '@/lib/timeFormat';
import { navigateToTrack, navigateToArtist } from '@/lib/navigation';
import { usePlayer } from '@/player/PlayerContext';
import { useAlbumCatalog, type AlbumCatalogTrack } from '@/hooks/api/useAlbumCatalog';

function playableProvider(track: AlbumCatalogTrack) {
  if (track.spotify_id) return { provider: 'spotify' as const, providerTrackId: track.spotify_id };
  if (track.youtube_id) return { provider: 'youtube' as const, providerTrackId: track.youtube_id };
  return null;
}

export default function AlbumPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const { openPlayer } = usePlayer();

  const albumName = albumId ? decodeURIComponent(albumId) : '';
  const { data: tracks = [], isLoading, isError } = useAlbumCatalog(albumName);

  const coverUrl = tracks.find((t) => t.cover_url)?.cover_url ?? null;

  // The album's artists, in first-appearance order, deduplicated.
  const artists = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tracks) {
      const name = t.artist?.trim();
      if (!name || seen.has(name.toLocaleLowerCase())) continue;
      seen.add(name.toLocaleLowerCase());
      out.push(name);
    }
    return out;
  }, [tracks]);

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const t of tracks) for (const g of t.genres ?? []) if (g) set.add(g);
    return [...set];
  }, [tracks]);

  const totalDurationMs = tracks.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0);
  const totalMinutes = Math.round(totalDurationMs / 60000);
  const firstPlayable = tracks.find((t) => playableProvider(t));

  const playTrack = (track: AlbumCatalogTrack) => {
    const target = playableProvider(track);
    if (!target) {
      toast.error(`"${track.title}" has no Spotify or YouTube link yet`);
      return;
    }
    openPlayer({
      canonicalTrackId: track.id,
      ...target,
      autoplay: true,
      context: 'album-page',
      title: track.title,
      artist: track.artist,
    });
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: albumName, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied');
      }
    } catch {
      // Dismissing the native share sheet rejects; that is not an error.
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      <div className="hidden lg:block">
        <BottomNav />
      </div>

      <div className="flex-1 pb-24 lg:pb-8">
        <div className="relative h-64 lg:h-80 overflow-hidden">
          {coverUrl && (
            <div
              className="absolute inset-0 bg-cover bg-center scale-110 blur-2xl opacity-50"
              style={{ backgroundImage: `url(${coverUrl})` }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-background" />

          <button
            onClick={() => navigate(-1)}
            className="absolute top-4 left-4 z-10 p-2 rounded-full glass hover:bg-muted/50 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <button
            onClick={handleShare}
            className="absolute top-4 right-4 z-10 p-2 rounded-full glass hover:bg-muted/50 transition-colors"
            aria-label="Share album"
          >
            <Share2 className="w-5 h-5" />
          </button>

          <div className="absolute bottom-0 left-0 right-0 p-6 flex items-end gap-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-32 h-32 lg:w-44 lg:h-44 rounded-xl overflow-hidden shadow-2xl shrink-0 bg-muted flex items-center justify-center"
            >
              {coverUrl ? (
                <img src={coverUrl} alt={albumName} className="w-full h-full object-cover" />
              ) : (
                <Disc3 className="w-14 h-14 text-muted-foreground" />
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="flex-1 min-w-0"
            >
              <p className="text-sm text-muted-foreground uppercase tracking-wider mb-1">Album</p>
              <h1 className="text-2xl lg:text-4xl font-bold truncate">{albumName || 'Unknown album'}</h1>
              {artists.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 mt-1">
                  {artists.map((name, i) => (
                    <span key={name} className="text-lg">
                      <button
                        onClick={() => navigateToArtist(navigate, name, { name, coverUrl })}
                        className="text-primary hover:underline"
                      >
                        {name}
                      </button>
                      {i < artists.length - 1 && <span className="text-muted-foreground">,</span>}
                    </span>
                  ))}
                </div>
              )}
              {!isLoading && tracks.length > 0 && (
                <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Music className="w-4 h-4" />
                    {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} in catalog
                  </span>
                  {totalMinutes > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {totalMinutes} min
                    </span>
                  )}
                </div>
              )}
              {genres.length > 0 && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  {genres.slice(0, 4).map((genre) => (
                    <span key={genre} className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                      {genre}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading album…
          </div>
        ) : isError ? (
          <div className="px-4 py-16 text-center text-muted-foreground">
            Couldn't load this album right now. Try again in a moment.
          </div>
        ) : tracks.length === 0 ? (
          <div className="px-4 py-16 max-w-md mx-auto text-center space-y-4">
            <Disc3 className="w-10 h-10 mx-auto text-muted-foreground" />
            <p className="text-lg font-semibold">
              {albumName ? `${albumName} isn't in the catalog yet` : 'No album specified'}
            </p>
            <p className="text-sm text-muted-foreground">
              Albums appear here once their tracks have been added to Clade and analyzed.
            </p>
            <Button variant="outline" className="gap-2" onClick={() => navigate('/search')}>
              <Search className="w-4 h-4" />
              Search the catalog
            </Button>
          </div>
        ) : (
          <div className="px-4 py-6 max-w-4xl lg:mx-auto space-y-6">
            {firstPlayable && (
              <Button className="gap-2 bg-primary hover:bg-primary/90" onClick={() => playTrack(firstPlayable)}>
                <Play className="w-5 h-5 fill-current" />
                Play
              </Button>
            )}

            <div className="space-y-1">
              {tracks.map((track, index) => {
                const playable = !!playableProvider(track);
                return (
                  <motion.div
                    key={track.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.04 }}
                    onClick={() => navigateToTrack(navigate, track.id)}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/30 transition-colors group cursor-pointer"
                  >
                    <span className="w-6 text-center text-muted-foreground text-sm">{index + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{track.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {track.artist}
                        {track.detected_key &&
                          ` · ${track.detected_key}${track.detected_mode ? ` ${track.detected_mode}` : ''}`}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {track.duration_ms ? formatDurationFull(track.duration_ms) : '--:--'}
                    </span>
                    {playable && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playTrack(track);
                        }}
                        className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 shrink-0"
                        aria-label={`Play ${track.title}`}
                      >
                        <Play className="w-4 h-4 fill-current" />
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="lg:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
