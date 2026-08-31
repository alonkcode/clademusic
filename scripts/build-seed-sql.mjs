/**
 * Emit supabase/sql-editor/07-seed.sql from the TypeScript seed data.
 *
 * Why not scripts/seed.js: that talks to PostgREST and needs a service-role key
 * (the publishable key is blocked by RLS on insert). Plain SQL pasted into the
 * SQL Editor runs as the table owner and needs no keys at all.
 *
 *   node scripts/build-seed-sql.mjs
 */
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tmp = path.join(root, 'node_modules', '.cache', 'seed-bundle.mjs');

mkdirSync(path.dirname(tmp), { recursive: true });

// The seed module imports types from '@/types'; those are erased at build time,
// so stub the alias rather than pulling in the whole app.
await build({
  entryPoints: [path.join(root, 'src/data/seedTracksWithProviders.ts')],
  outfile: tmp,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  plugins: [{
    name: 'stub-alias',
    setup(b) {
      b.onResolve({ filter: /^@\// }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
    },
  }],
});

const { seedTracksWithProviders: tracks } = await import(pathToFileURL(tmp).href);

const q = (v) => (v === undefined || v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === undefined || v === null || Number.isNaN(v) ? 'NULL' : String(v));
const arr = (v) =>
  !Array.isArray(v) || v.length === 0
    ? 'NULL'
    : `ARRAY[${v.map((x) => q(x)).join(',')}]::text[]`;
const json = (v) => (v === undefined || v === null ? 'NULL' : `${q(JSON.stringify(v))}::jsonb`);

const lines = [];
lines.push('-- GENERATED - regenerate: node scripts/build-seed-sql.mjs');
lines.push('-- Seed content for a freshly provisioned project.');
lines.push('-- Safe to re-run: upserts on (external_id, provider).');
lines.push('-- Run AFTER parts 01-06.');
lines.push('');
lines.push('BEGIN;');
lines.push('');

for (const t of tracks) {
  // external_id/provider carry the table's uniqueness constraint, so use the
  // provider id we actually have and let the upsert make this idempotent.
  const provider = t.spotify_id ? 'spotify' : 'youtube';
  const externalId = t.spotify_id || t.youtube_id;
  if (!externalId) continue;

  lines.push(`INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  ${q(externalId)}, ${q(provider)}, ${q(t.title)}, ${q(t.artist)}, ${q(t.album)},
  ${num(t.duration_ms)}, ${q(t.isrc)}, ${q(t.cover_url)},
  ${q(t.detected_key)}, ${q(t.detected_mode)}, ${arr(t.progression_roman)}, ${num(t.loop_length_bars)},
  ${q(t.spotify_id)}, ${q(t.youtube_id)}, ${json(t.sections)},
  ${num(t.energy)}, ${num(t.danceability)}, ${num(t.valence)}, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;`);
  lines.push('');
}

// Provider links, so the player can resolve both services per track.
lines.push(`-- Provider links (drives the Spotify/YouTube switcher)
INSERT INTO public.track_provider_links (track_id, provider, provider_track_id, url_web)
SELECT t.id, 'spotify', t.spotify_id, 'https://open.spotify.com/track/' || t.spotify_id
FROM public.tracks t WHERE t.spotify_id IS NOT NULL
ON CONFLICT (track_id, provider) DO NOTHING;

INSERT INTO public.track_provider_links (track_id, provider, provider_track_id, url_web)
SELECT t.id, 'youtube', t.youtube_id, 'https://www.youtube.com/watch?v=' || t.youtube_id
FROM public.tracks t WHERE t.youtube_id IS NOT NULL
ON CONFLICT (track_id, provider) DO NOTHING;
`);

// Feed items, so the feed has something to show on first load.
lines.push(`-- Feed items (the feed reads these)
INSERT INTO public.feed_items (track_id, source, rank)
SELECT t.id, 'seed', row_number() OVER (ORDER BY t.created_at)
FROM public.tracks t
WHERE NOT EXISTS (SELECT 1 FROM public.feed_items f WHERE f.track_id = t.id);
`);

lines.push('COMMIT;');
lines.push('');
lines.push('-- Sanity: expect non-zero on all three.');
lines.push(`SELECT
  (SELECT count(*) FROM public.tracks)               AS tracks,
  (SELECT count(*) FROM public.track_provider_links) AS provider_links,
  (SELECT count(*) FROM public.feed_items)           AS feed_items;`);

const out = path.join(root, 'supabase/sql-editor/07-seed.sql');
writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`Wrote ${out} (${tracks.length} tracks)`);
