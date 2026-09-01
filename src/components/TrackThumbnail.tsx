import type { ReactNode } from 'react';
import { useTrackCoverArt, type CoverArtQuery } from '@/hooks/useTrackCoverArt';

/**
 * A cover-art `<img>` that resolves a real Spotify image when the track's
 * own cover_url is missing or one of the seed catalog's generic placeholder
 * photos. Exists so a `.map()` over search results/queue rows can get that
 * behavior without calling the hook directly inside the loop (not allowed -
 * hooks can't run inside a callback).
 *
 * Renders `fallback` (nothing, by default) while no image is available -
 * pass the caller's existing no-cover placeholder (an icon tile, say) to
 * keep that in place rather than leaving an empty gap.
 */
export function TrackThumbnail({
  track,
  className,
  alt = '',
  fallback = null,
}: {
  track: CoverArtQuery;
  className?: string;
  alt?: string;
  fallback?: ReactNode;
}) {
  const coverUrl = useTrackCoverArt(track);
  if (!coverUrl) return <>{fallback}</>;
  return <img src={coverUrl} alt={alt} className={className} />;
}
