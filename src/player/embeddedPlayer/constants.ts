import { SpotifyIcon, YouTubeIcon, AppleMusicIcon } from '@/components/QuickStreamButtons';

/** Per-provider badge/label/color shown on the compact bar. */
export const providerMeta = {
  spotify: { label: 'Spotify', badge: '🎧', color: 'bg-black/90', Icon: SpotifyIcon },
  youtube: { label: 'YouTube', badge: '▶', color: 'bg-black/90', Icon: YouTubeIcon },
  apple_music: { label: 'Apple Music', badge: '', color: 'bg-neutral-900/90', Icon: AppleMusicIcon },
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string | null | undefined) => Boolean(value && UUID_RE.test(value));

/** MM:SS, for the elapsed/duration labels either side of the seekbar. */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Tooltip copy for "why does this section matter" on the section-jump chips. */
export const describeSectionWhy = (params: {
  sectionLabel: string;
  cadenceType?: string | null;
  isLooping?: boolean;
}) => {
  const { sectionLabel, cadenceType, isLooping } = params;
  const base: Record<string, string> = {
    intro: 'Sets the tonal center and groove.',
    verse: 'Builds tension and sets up the hook.',
    'pre-chorus': 'Ramps into the release.',
    chorus: 'Main hook — usually the most stable resolution.',
    bridge: 'Contrast section — often shifts harmonic color.',
    breakdown: 'Pulls back texture to build anticipation.',
    drop: 'Peak energy release.',
    outro: 'Closure and release.',
  };

  const cadence: Record<string, string> = {
    authentic: 'Strong resolution (authentic cadence).',
    plagal: 'Warm resolution (plagal cadence).',
    deceptive: 'Fake-out resolution (deceptive cadence).',
    half: 'Unresolved — hangs on dominant (half cadence).',
    loop: 'Circular loop — no final cadence.',
    modal: 'Modal harmony — color over functional resolution.',
  };

  const parts: string[] = [];
  if (isLooping) parts.push('Looping enabled.');
  parts.push(base[sectionLabel] ?? 'Section context.');
  if (cadenceType && cadence[cadenceType]) parts.push(cadence[cadenceType]);
  return parts.join(' ');
};
