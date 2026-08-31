import { useState } from 'react';
import { Play } from 'lucide-react';

interface Props {
  videoId: string;
  startSeconds?: number;
  className?: string;
}

export default function SectionYouTubeSnippet({ videoId, startSeconds = 0, className }: Props) {
  const [playing, setPlaying] = useState(false);

  const src = playing
    ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&start=${Math.max(0, Math.floor(startSeconds))}`
    : `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`;

  return (
    <div className={className || 'flex items-center gap-2'}>
      <div className="relative w-44 h-12 rounded overflow-hidden bg-black/5">
        {!playing && (
          <button
            aria-label="Play section on YouTube"
            onClick={() => setPlaying(true)}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-20 bg-white/90 rounded-full p-1 shadow"
          >
            <Play className="w-4 h-4 text-black" />
          </button>
        )}

        <iframe
          title={`yt-snippet-${videoId}-${startSeconds}`}
          src={src}
          frameBorder="0"
          allow="autoplay; encrypted-media"
          width="176"
          height="88"
          className="w-full h-full"
        />
      </div>
    </div>
  );
}
