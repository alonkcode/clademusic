-- Read-only preflight for 11-hotfix-rls-recursion-and-fks.sql.
--
-- That script is safe apart from ONE statement that actually removes rows:
-- it deletes playlist_tracks entries pointing at a track_id that no longer
-- exists in public.tracks. Those rows are already broken (the playlist shows
-- a song the catalogue does not have) and Postgres refuses to add the
-- foreign key while they are there - but it is still deletion, so look first.
--
-- This file changes NOTHING. Run it, read the numbers, then decide.
-- If orphan_rows_to_be_deleted is 0, the hotfix touches no data at all.

-- 1. How many playlist entries would the hotfix delete?
SELECT count(*) AS orphan_rows_to_be_deleted
FROM public.playlist_tracks pt
WHERE NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = pt.track_id);

-- 2. Which playlists would lose entries, and how many each?
--    Empty result = nothing is affected.
SELECT p.id AS playlist_id,
       p.name AS playlist_name,
       count(*) AS entries_removed
FROM public.playlist_tracks pt
JOIN public.playlists p ON p.id = pt.playlist_id
WHERE NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = pt.track_id)
GROUP BY p.id, p.name
ORDER BY entries_removed DESC;

-- 3. Total rows in the table, for scale - so "N deleted" has a denominator.
SELECT count(*) AS total_playlist_track_rows FROM public.playlist_tracks;

-- 4. What type is track_id currently? The hotfix only converts text -> uuid
--    when every value is already a well-formed uuid, and skips the FK
--    entirely otherwise rather than failing.
SELECT data_type AS playlist_tracks_track_id_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'playlist_tracks'
  AND column_name = 'track_id';
