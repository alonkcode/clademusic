/**
 * Admin-controlled system settings.
 *
 * Values live in public.system_settings as one row per key, but a key with no
 * row simply means "use the default below" - this file is the single source of
 * truth for what exists and what it defaults to, so the app behaves exactly as
 * it did before any setting is touched (and keeps working if the table has not
 * been migrated yet).
 *
 * Keys are namespaced by kind: flag.* (on/off), limit.* (rate limit) and
 * pref.* (free-form preference).
 */

export interface RateLimitValue {
  /** Actions allowed per window. 0 turns the limit off. */
  max: number;
  windowSeconds: number;
}

export interface SettingValues {
  'flag.signups_enabled': boolean;
  'flag.forum_enabled': boolean;
  'flag.billing_enabled': boolean;
  'flag.comments_enabled': boolean;
  'limit.comments': RateLimitValue;
  'limit.interactions': RateLimitValue;
  'pref.maintenance_mode': boolean;
  'pref.maintenance_message': string;
  'pref.announcement': string;
}

export type SettingKey = keyof SettingValues;
export type FlagKey = Extract<SettingKey, `flag.${string}`>;
export type LimitKey = Extract<SettingKey, `limit.${string}`>;

export const DEFAULT_SETTINGS: SettingValues = {
  'flag.signups_enabled': true,
  'flag.forum_enabled': true,
  'flag.billing_enabled': true,
  'flag.comments_enabled': true,
  'limit.comments': { max: 10, windowSeconds: 60 },
  'limit.interactions': { max: 60, windowSeconds: 60 },
  'pref.maintenance_mode': false,
  'pref.maintenance_message': "We're doing some maintenance and will be back shortly.",
  'pref.announcement': '',
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

export const TEXT_MAX_LENGTH = 500;
export const LIMIT_MAX_COUNT = 10_000;
export const LIMIT_MAX_WINDOW_SECONDS = 86_400;

export interface SettingMeta {
  label: string;
  description: string;
}

/** Display text for the admin panel. Record<> keeps it exhaustive with SettingValues. */
export const SETTING_META: Record<SettingKey, SettingMeta> = {
  'flag.signups_enabled': {
    label: 'New signups',
    description: 'When off, the sign-up form is replaced by a notice. Existing users can still sign in.',
  },
  'flag.forum_enabled': {
    label: 'Forums',
    description: 'When off, the /forum pages show an unavailable notice and forum links are hidden.',
  },
  'flag.billing_enabled': {
    label: 'Pricing & billing',
    description: 'When off, the /pricing and /billing pages show an unavailable notice and their links are hidden.',
  },
  'flag.comments_enabled': {
    label: 'Posting comments',
    description: 'When off, existing comments stay readable but nobody can post new ones.',
  },
  'limit.comments': {
    label: 'Comments',
    description: 'How many comments one browser session can post per window.',
  },
  'limit.interactions': {
    label: 'Likes, saves & vibes',
    description: 'How many like / save / bookmark / vibe toggles one browser session can make per window.',
  },
  'pref.maintenance_mode': {
    label: 'Maintenance mode',
    description: 'Shows everyone except admins the maintenance screen. Admins can still sign in and use the site.',
  },
  'pref.maintenance_message': {
    label: 'Maintenance message',
    description: 'Shown on the maintenance screen.',
  },
  'pref.announcement': {
    label: 'Site announcement',
    description: 'A dismissible notice shown to everyone once per session. Leave empty for none.',
  },
};

const clampInt = (value: unknown, min: number, max: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
};

/**
 * Coerce a raw jsonb value to the type the key expects. A stored value that
 * has the wrong shape (hand-edited row, older schema) falls back to the
 * default instead of leaking a wrong type into the app.
 */
export function sanitizeSetting<K extends SettingKey>(key: K, raw: unknown): SettingValues[K] {
  const fallback = DEFAULT_SETTINGS[key];

  if (typeof fallback === 'boolean') {
    return (typeof raw === 'boolean' ? raw : fallback) as SettingValues[K];
  }

  if (typeof fallback === 'string') {
    return (typeof raw === 'string' ? raw.slice(0, TEXT_MAX_LENGTH) : fallback) as SettingValues[K];
  }

  const candidate = (raw ?? {}) as Partial<RateLimitValue>;
  const max = clampInt(candidate.max, 0, LIMIT_MAX_COUNT);
  const windowSeconds = clampInt(candidate.windowSeconds, 1, LIMIT_MAX_WINDOW_SECONDS);
  if (max === null || windowSeconds === null) return fallback;
  return { max, windowSeconds } as SettingValues[K];
}

export interface SettingRow {
  key: string;
  value: unknown;
}

/** Layer stored rows over the defaults, ignoring keys this build does not know. */
export function mergeSettings(rows: readonly SettingRow[]): SettingValues {
  const merged: SettingValues = { ...DEFAULT_SETTINGS };
  const assign = <K extends SettingKey>(key: K, raw: unknown) => {
    merged[key] = sanitizeSetting(key, raw);
  };
  for (const row of rows) {
    if ((SETTING_KEYS as string[]).includes(row.key)) assign(row.key as SettingKey, row.value);
  }
  return merged;
}
