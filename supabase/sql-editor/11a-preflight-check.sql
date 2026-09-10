-- Read-only preflight for 11-hotfix-rls-recursion-and-fks.sql.
--
-- Changes NOTHING. Run it, read the numbers, then decide.
--
-- Every comparison below casts BOTH sides to text on purpose. In this
-- database public.tracks.id is uuid while public.playlist_tracks.track_id is
-- text (the schema came from the unified_interactions migration, which
-- declares it TEXT, rather than the playlists one, which declares it uuid) -
-- and Postgres has no uuid = text operator, so joining them directly fails
-- with 42883 instead of answering the question. Casting sidesteps that and
-- works whichever type the column turns out to be.

-- 1. THE important number: how many playlist entries would the hotfix delete?
--    0 means the hotfix touches no data at all.
SELECT count(*) AS orphan_rows_to_be_deleted
FROM public.playlist_tracks pt
WHERE NOT EXISTS (
  SELECT 1 FROM public.tracks t WHERE t.id::text = pt.track_id::text
);

-- 2. Which playlists would lose entries. Empty result = nothing affected.
SELECT p.id AS playlist_id,
       p.name AS playlist_name,
       count(*) AS entries_removed
FROM public.playlist_tracks pt
JOIN public.playlists p ON p.id = pt.playlist_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.tracks t WHERE t.id::text = pt.track_id::text
)
GROUP BY p.id, p.name
ORDER BY entries_removed DESC;

-- 3. Total rows, so the number above has a denominator.
SELECT count(*) AS total_playlist_track_rows FROM public.playlist_tracks;

-- 4. Current column type.
SELECT data_type AS playlist_tracks_track_id_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'playlist_tracks'
  AND column_name = 'track_id';

-- 5. Decides whether the playlist-detail fix can apply at all.
--    The hotfix will only convert track_id text -> uuid (and only then add
--    the foreign key) if EVERY value is a well-formed uuid. If
--    non_uuid_values is above 0 it skips that FK rather than failing, which
--    means /playlist/:id stays broken and needs a different approach - say
--    so and I will write it.
SELECT count(*) FILTER (
         WHERE track_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       ) AS non_uuid_values,
       count(*) AS checked_rows
FROM public.playlist_tracks;

-- 6. A sample of any offenders, so their shape is visible (provider ids,
--    'spotify:track:...', empty strings, and so on).
SELECT DISTINCT track_id
FROM public.playlist_tracks
WHERE track_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
LIMIT 20;
