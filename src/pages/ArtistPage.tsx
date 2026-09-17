/**
 * Artist Page
 *
 * Built entirely from the tracks this artist has in the Clade catalog. It used
 * to render one hardcoded mock - the same "Kendrick Lamar" tracks, albums,
 * "Verified Artist" badge, 28.5M followers and 92% popularity for every
 * artist - plus play/shuffle buttons wired to nothing, a follow toggle that
 * only lived in local state, and comment/listener panels that are themselves
 * fixed mock data. None of that is shown now. What is shown is real: the
 * artist's catalog tracks (primary and featured credits), the albums they come
 * from, and their harmonic profile - keys and progressions - which is what this
 * app is actually about.
 */

import { useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Users, Music, Disc3, Share2, Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BottomNav } from '@/components/BottomNav';
import { formatDurationFull } from '@/lib/timeFormat';
import { navigateToTrack } from '@/lib/navigation';
import { usePlayer } from '@/player/PlayerContext';
import { useArtistCatalog, type ArtistCatalogTrack } from '@/hooks/api/useArtistCatalog';

function playableProvider(track: ArtistCatalogTrack) {
  if (track.spotify_id) return { provider: 'spotify' as const, providerTrackId: track.spotify_id };
  if (track.youtube_id) return { provider: 'youtube' as const, providerTrackId: track.youtube_id };
  return null;
}

export default function ArtistPage() {
  const { artistId } = useParams<{ artistId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { openPlayer } = usePlayer();

  // A caller that already knows the display name/art (Profile's Top Artists)
  // passes it through router state; a direct visit falls back to the URL.
  const navState = location.state as { name?: string; coverUrl?: string | null } | null;
  const artistName = navState?.name ?? (artistId ? decodeURIComponent(artistId) : '');

  const { data: tracks = [], isLoading, isError } = useArtistCatalog(artistName);

  const coverUrl = navState?.coverUrl ?? tracks.find((t) => t.cover_url)?.cover_url ?? null;

  const albums = useMemo(() => {
    const byName = new Map<string, { name: string; cover: string | null; count: number }>();
    for (const t of tracks) {
      if (!t.album) continue;
      const entry = byName.get(t.album) ?? { name: t.album, cover: t.cover_url, count: 0 };
      entry.count += 1;
      entry.cover = entry.cover ?? t.cover_url;
      byName.set(t.album, entry);
    }
    return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [tracks]);

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const t of tracks) for (const g of t.genres ?? []) if (g) set.add(g);
    return [...set];
  }, [tracks]);

  const keyUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tracks) {
      if (!t.detected_key) continue;
      const label = t.detected_mode ? `${t.detected_key} ${t.detected_mode}` : t.detected_key;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [tracks]);

  const tempos = tracks.map((t) => t.tempo).filter((v): v is number => typeof v === 'number' && v > 0);
  const tracksWithProgressions = tracks.filter((t) => t.progression_roman && t.progression_roman.length > 0);

  const firstPlayable = tracks.find((t) => playableProvider(t));

  const playTrack = (track: ArtistCatalogTrack) => {
    const target = playableProvider(track);
    if (!target) {
      toast.error(`"${track.title}" has no Spotify or YouTube link yet`);
      return;
    }
    openPlayer({
      canonicalTrackId: track.id,
      ...target,
      autoplay: true,
      context: 'artist-page',
      title: track.title,
      artist: track.artist,
    });
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: artistName, url });
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
        {/* Hero */}
        <div className="relative h-64 lg:h-80 overflow-hidden">
          {coverUrl && (
            <div
              className="absolute inset-0 bg-cover bg-center scale-110 blur-sm opacity-60"
              style={{ backgroundImage: `url(${coverUrl})` }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/70 to-background" />

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
            aria-label="Share artist"
          >
            <Share2 className="w-5 h-5" />
          </button>

          <div className="absolute bottom-0 left-0 right-0 p-6 flex items-end gap-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-28 h-28 lg:w-40 lg:h-40 rounded-full overflow-hidden shadow-2xl ring-4 ring-background shrink-0 bg-muted flex items-center justify-center"
            >
              {coverUrl ? (
                <img src={coverUrl} alt={artistName} className="w-full h-full object-cover" />
              ) : (
                <Users className="w-14 h-14 text-muted-foreground" />
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="flex-1 min-w-0"
            >
              <p className="text-sm text-primary uppercase tracking-wider font-medium">Artist</p>
              <h1 className="text-3xl lg:text-5xl font-bold mt-1 truncate">{artistName || 'Unknown artist'}</h1>
              {!isLoading && tracks.length > 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} in the Clade catalog
                  {albums.length > 0 && ` · ${albums.length} ${albums.length === 1 ? 'album' : 'albums'}`}
                </p>
              )}
              {genres.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {genres.slice(0, 4).map((genre) => (
                    <span key={genre} className="px-3 py-1 text-xs rounded-full bg-muted/50 text-muted-foreground">
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
            Loading {artistName}…
          </div>
        ) : isError ? (
          <div className="px-4 py-16 text-center text-muted-foreground">
            Couldn't load this artist right now. Try again in a moment.
          </div>
        ) : tracks.length === 0 ? (
          <div className="px-4 py-16 max-w-md mx-auto text-center space-y-4">
            <Music className="w-10 h-10 mx-auto text-muted-foreground" />
            <p className="text-lg font-semibold">
              {artistName ? `${artistName} isn't in the catalog yet` : 'No artist specified'}
            </p>
            <p className="text-sm text-muted-foreground">
              Tracks appear here once they've been added to Clade and analyzed.
            </p>
            <Button variant="outline" className="gap-2" onClick={() => navigate('/search')}>
              <Search className="w-4 h-4" />
              Search the catalog
            </Button>
          </div>
        ) : (
          <>
            {firstPlayable && (
              <div className="px-4 pt-6">
                <Button className="gap-2 bg-primary hover:bg-primary/90" onClick={() => playTrack(firstPlayable)}>
                  <Play className="w-5 h-5 fill-current" />
                  Play
                </Button>
              </div>
            )}

            <div className="px-4 py-6 max-w-4xl lg:mx-auto">
              <Tabs defaultValue="tracks">
                <TabsList className="glass mb-6">
                  <TabsTrigger value="tracks">Tracks</TabsTrigger>
                  <TabsTrigger value="harmony">Harmony</TabsTrigger>
                  {albums.length > 0 && <TabsTrigger value="albums">Albums</TabsTrigger>}
                </TabsList>

                <TabsContent value="tracks" className="space-y-1">
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
                        <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-muted flex items-center justify-center">
                          {track.cover_url ? (
                            <img src={track.cover_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Music className="w-6 h-6 text-muted-foreground" />
                          )}
                        </div>
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
                </TabsContent>

                <TabsContent value="harmony" className="space-y-6">
                  {keyUsage.length > 0 && (
                    <section className="space-y-3">
                      <h2 className="font-bold text-lg">Keys</h2>
                      <div className="flex flex-wrap gap-2">
                        {keyUsage.map(([label, count]) => (
                          <span key={label} className="px-3 py-1.5 rounded-full glass text-sm font-mono">
                            {label}
                            {count > 1 && <span className="text-muted-foreground"> ×{count}</span>}
                          </span>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="space-y-3">
                    <h2 className="font-bold text-lg">Progressions</h2>
                    {tracksWithProgressions.length > 0 ? (
                      <div className="space-y-2">
                        {tracksWithProgressions.map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-3 p-3 rounded-xl glass">
                            <span className="text-sm truncate">{t.title}</span>
                            <span className="font-mono text-sm text-primary shrink-0">
                              {t.progression_roman!.join(' – ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No progressions analyzed for this artist yet.</p>
                    )}
                  </section>

                  {tempos.length > 0 && (
                    <section className="space-y-2">
                      <h2 className="font-bold text-lg">Tempo</h2>
                      <p className="text-sm text-muted-foreground font-mono">
                        {Math.min(...tempos) === Math.max(...tempos)
                          ? `${Math.round(tempos[0])} BPM`
                          : `${Math.round(Math.min(...tempos))}–${Math.round(Math.max(...tempos))} BPM`}
                      </p>
                    </section>
                  )}
                </TabsContent>

                {albums.length > 0 && (
                  <TabsContent value="albums">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {albums.map((album) => (
                        <div key={album.name}>
                          <div className="aspect-square rounded-xl overflow-hidden mb-2 shadow-lg bg-muted flex items-center justify-center">
                            {album.cover ? (
                              <img src={album.cover} alt={album.name} className="w-full h-full object-cover" />
                            ) : (
                              <Disc3 className="w-12 h-12 text-muted-foreground" />
                            )}
                          </div>
                          <p className="font-medium text-sm truncate">{album.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {album.count} {album.count === 1 ? 'track' : 'tracks'} in catalog
                          </p>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                )}
              </Tabs>
            </div>
          </>
        )}
      </div>

      <div className="lg:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
