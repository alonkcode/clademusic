import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  LIMIT_MAX_COUNT,
  LIMIT_MAX_WINDOW_SECONDS,
  SETTING_KEYS,
  SETTING_META,
  TEXT_MAX_LENGTH,
  mergeSettings,
  sanitizeSetting,
} from '@/lib/systemSettings';

describe('mergeSettings', () => {
  it('returns the defaults untouched when nothing has been saved', () => {
    expect(mergeSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it('layers stored rows over the defaults, leaving other keys alone', () => {
    const merged = mergeSettings([
      { key: 'flag.forum_enabled', value: false },
      { key: 'limit.comments', value: { max: 3, windowSeconds: 30 } },
    ]);

    expect(merged['flag.forum_enabled']).toBe(false);
    expect(merged['limit.comments']).toEqual({ max: 3, windowSeconds: 30 });
    expect(merged['flag.billing_enabled']).toBe(DEFAULT_SETTINGS['flag.billing_enabled']);
    expect(merged['limit.interactions']).toEqual(DEFAULT_SETTINGS['limit.interactions']);
  });

  it('ignores keys this build does not know about', () => {
    const merged = mergeSettings([{ key: 'flag.from_the_future', value: false }]);
    expect(merged).toEqual(DEFAULT_SETTINGS);
    expect(merged).not.toHaveProperty('flag.from_the_future');
  });

  it('does not mutate the shared defaults', () => {
    mergeSettings([{ key: 'flag.forum_enabled', value: false }]);
    expect(DEFAULT_SETTINGS['flag.forum_enabled']).toBe(true);
  });
});

describe('sanitizeSetting', () => {
  it('falls back to the default when a stored value has the wrong type', () => {
    expect(sanitizeSetting('flag.forum_enabled', 'yes')).toBe(true);
    expect(sanitizeSetting('pref.maintenance_mode', 1)).toBe(false);
    expect(sanitizeSetting('pref.announcement', 42)).toBe('');
    expect(sanitizeSetting('limit.comments', 'lots')).toEqual(DEFAULT_SETTINGS['limit.comments']);
    expect(sanitizeSetting('limit.comments', null)).toEqual(DEFAULT_SETTINGS['limit.comments']);
  });

  it('rejects a rate limit missing either field', () => {
    expect(sanitizeSetting('limit.comments', { max: 5 })).toEqual(DEFAULT_SETTINGS['limit.comments']);
    expect(sanitizeSetting('limit.comments', { windowSeconds: 60 })).toEqual(DEFAULT_SETTINGS['limit.comments']);
    expect(sanitizeSetting('limit.comments', { max: 'x', windowSeconds: 60 })).toEqual(
      DEFAULT_SETTINGS['limit.comments']
    );
  });

  it('clamps rate limits into their allowed range and rounds to whole numbers', () => {
    expect(sanitizeSetting('limit.comments', { max: -5, windowSeconds: 60 }).max).toBe(0);
    expect(sanitizeSetting('limit.comments', { max: 1e9, windowSeconds: 60 }).max).toBe(LIMIT_MAX_COUNT);
    expect(sanitizeSetting('limit.comments', { max: 5, windowSeconds: 0 }).windowSeconds).toBe(1);
    expect(sanitizeSetting('limit.comments', { max: 5, windowSeconds: 1e9 }).windowSeconds).toBe(
      LIMIT_MAX_WINDOW_SECONDS
    );
    expect(sanitizeSetting('limit.comments', { max: 2.6, windowSeconds: 10.2 })).toEqual({ max: 3, windowSeconds: 10 });
  });

  it('keeps 0 as a valid "no limit" count', () => {
    expect(sanitizeSetting('limit.comments', { max: 0, windowSeconds: 60 }).max).toBe(0);
  });

  it('rejects non-finite numbers', () => {
    expect(sanitizeSetting('limit.comments', { max: Infinity, windowSeconds: 60 })).toEqual(
      DEFAULT_SETTINGS['limit.comments']
    );
    expect(sanitizeSetting('limit.comments', { max: NaN, windowSeconds: 60 })).toEqual(
      DEFAULT_SETTINGS['limit.comments']
    );
  });

  it('truncates over-long text', () => {
    const long = 'x'.repeat(TEXT_MAX_LENGTH + 100);
    expect(sanitizeSetting('pref.announcement', long)).toHaveLength(TEXT_MAX_LENGTH);
  });
});

describe('registry', () => {
  it('has admin-panel metadata for every setting', () => {
    for (const key of SETTING_KEYS) {
      expect(SETTING_META[key].label).toBeTruthy();
      expect(SETTING_META[key].description).toBeTruthy();
    }
  });

  it('uses only key shapes the database CHECK constraint accepts', () => {
    // Mirrors: CHECK (key ~ '^(flag|limit|pref)\.[a-z0-9_]+$') in the migration.
    for (const key of SETTING_KEYS) {
      expect(key).toMatch(/^(flag|limit|pref)\.[a-z0-9_]+$/);
    }
  });

  it('ships with every feature on and maintenance off, so nothing changes until an admin acts', () => {
    for (const key of SETTING_KEYS.filter((k) => k.startsWith('flag.'))) {
      expect(DEFAULT_SETTINGS[key]).toBe(true);
    }
    expect(DEFAULT_SETTINGS['pref.maintenance_mode']).toBe(false);
    expect(DEFAULT_SETTINGS['pref.announcement']).toBe('');
  });
});

describe('flag.chat_enabled', () => {
  it('defaults to on and is described for the admin panel', () => {
    expect(DEFAULT_SETTINGS['flag.chat_enabled']).toBe(true);
    expect(SETTING_KEYS).toContain('flag.chat_enabled');
    expect(SETTING_META['flag.chat_enabled'].label).toBe('Live chat');
  });

  it('turns off when an admin stores false, without touching the other flags', () => {
    const merged = mergeSettings([{ key: 'flag.chat_enabled', value: false }]);
    expect(merged['flag.chat_enabled']).toBe(false);
    expect(merged['flag.forum_enabled']).toBe(true);
    expect(merged['flag.comments_enabled']).toBe(true);
  });

  it('ignores a stored value of the wrong type and stays on', () => {
    expect(sanitizeSetting('flag.chat_enabled', 'off')).toBe(true);
  });
});
