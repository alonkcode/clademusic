-- Backfill youtube_id for the historical/"ancestor" catalog tracks that had no
-- streaming link at all, so they stop rendering "No streaming links".
--
-- These 13 recordings (duplicated across the seed-ancestor-* and historical-*
-- sets, 20 rows in total) were seeded without a spotify_id or youtube_id.
-- They were always unplayable; commit 33cc446a, which made the feed shuffle a
-- wider pool instead of returning the database's fixed row order, is simply
-- what started surfacing them.
--
-- Every id below was looked up and then verified against YouTube's oEmbed
-- endpoint, which returns the real title and channel and fails for a dead or
-- private video. The channel each one resolved to is recorded beside it, so a
-- reviewer can judge the match rather than trust it. None were guessed.
--
-- Matched to the artist string already in the row, NOT blindly by title:
-- "Hush" is here twice (Billy Joe Royal's 1967 original and Joe South's own
-- recording) and they are different videos.
--
-- Safe to re-run: only rows that still have no link are touched, so a value
-- you have since corrected by hand is never overwritten.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.

BEGIN;

WITH links(title, artist, youtube_id, channel) AS (
  VALUES
    -- Official artist "- Topic" / VEVO channels.
    ('Funky Drummer',            'James Brown',                          'QXw6YZltKJk', 'James Brown - Topic'),
    ('Strange Fruit',            'Billie Holiday',                       '649wWWkW_1o', 'BillieHolidayVEVO'),
    ('Apache',                   'Incredible Bongo Band',                '-Udnb6F1A0g', 'Incredible Bongo Band - Topic'),
    ('Impeach the President',    'The Honey Drippers',                   'wVycUX1y0XE', 'The Honey Drippers - Topic'),
    ('Rocket 88',                'Jackie Brenston and His Delta Cats',   '54R4ak69ItE', 'Jackie Brenston - Topic'),
    ('Laléna',                   'Donovan',                              '1kA3nZwGHHA', 'Donovan - Topic'),
    ('Hush',                     'Joe South',                            'lknJe0zUQXk', 'Joe South - Topic'),
    ('Assembly Line',            'Commodores',                           'qGZh_EwIU6c', 'Commodores - Topic'),
    ('Can the Circle Be Unbroken','The Carter Family',                   'YJfQTKbx8vY', 'The Carter Family - Topic'),
    ('Synthetic Substitution',   'Melvin Bliss',                         'aPw0ua8U6fc', 'Reservoir Recordings (label)'),

    -- No official upload exists for these three. The chosen video is the
    -- correct recording, but on a third-party channel, so it can be taken
    -- down in a way a Topic upload generally is not.
    ('Crazy Blues',              'Mamie Smith and her Jazz Hounds',      'nvLuCm2kSDE', 'Classic Mood Experience'),
    ('Hush',                     'Billy Joe Royal',                      'QoJP65nAMGA', 'TheRunner75'),
    -- Deliberately NOT the "Louis Armstrong And The All-Stars - Topic"
    -- upload: the All-Stars are a later band, and that is a different, later
    -- recording. This catalog row is the 1928 Hot Five original, so it points
    -- at an archival 78rpm transfer of that take instead.
    ('West End Blues',           'Louis Armstrong and His Hot Five',     'XkOSCQyRJsE', 'The78Prof (1928 Hot Five transfer)')
)
UPDATE public.tracks t
SET youtube_id = l.youtube_id
FROM links l
WHERE t.title = l.title
  AND t.artist = l.artist
  AND COALESCE(NULLIF(t.youtube_id, ''), NULL) IS NULL
  AND COALESCE(NULLIF(t.spotify_id, ''), NULL) IS NULL;

COMMIT;

-- Verify: should return 0 rows once this has run.
SELECT id, title, artist
FROM public.tracks
WHERE COALESCE(NULLIF(youtube_id, ''), NULL) IS NULL
  AND COALESCE(NULLIF(spotify_id, ''), NULL) IS NULL
ORDER BY artist, title;
