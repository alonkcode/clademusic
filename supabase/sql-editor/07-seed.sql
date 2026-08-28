-- GENERATED - regenerate: node scripts/build-seed-sql.mjs
-- Seed content for a freshly provisioned project.
-- Safe to re-run: upserts on (external_id, provider).
-- Run AFTER parts 01-06.

BEGIN;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '0VjIjW4GlUZAMYd2vXMi3b', 'spotify', 'Blinding Lights', 'The Weeknd', 'After Hours',
  200040, 'USUG11904665', 'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36',
  'F', 'minor', ARRAY['i','IV','VI','V']::text[], 4,
  '0VjIjW4GlUZAMYd2vXMi3b', '4NRXx6U8ABQ', '[{"type":"intro","label":"Intro","start_time":0,"end_time":18},{"type":"verse","label":"Verse 1","start_time":18,"end_time":46},{"type":"chorus","label":"Chorus","start_time":46,"end_time":74},{"type":"verse","label":"Verse 2","start_time":74,"end_time":102},{"type":"chorus","label":"Chorus 2","start_time":102,"end_time":130},{"type":"bridge","label":"Bridge","start_time":130,"end_time":158},{"type":"chorus","label":"Final Chorus","start_time":158,"end_time":186},{"type":"outro","label":"Outro","start_time":186,"end_time":200}]'::jsonb,
  0.73, 0.51, 0.33, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '7qiZfU4dY1lWllzX7mPBI3', 'spotify', 'Shape of You', 'Ed Sheeran', '÷ (Divide)',
  233713, 'GBAHS1600463', 'https://i.scdn.co/image/ab67616d0000b273ba5db46f4b838ef6027e6f96',
  'C#', 'minor', ARRAY['i','iv','VI','III']::text[], 4,
  '7qiZfU4dY1lWllzX7mPBI3', 'JGwWNGJdvx8', '[{"type":"intro","label":"Intro","start_time":0,"end_time":7},{"type":"verse","label":"Verse 1","start_time":7,"end_time":27},{"type":"pre-chorus","label":"Pre-Chorus","start_time":27,"end_time":35},{"type":"chorus","label":"Chorus","start_time":35,"end_time":54},{"type":"verse","label":"Verse 2","start_time":54,"end_time":74},{"type":"pre-chorus","label":"Pre-Chorus 2","start_time":74,"end_time":82},{"type":"chorus","label":"Chorus 2","start_time":82,"end_time":101},{"type":"bridge","label":"Bridge","start_time":101,"end_time":140},{"type":"chorus","label":"Final Chorus","start_time":140,"end_time":198},{"type":"outro","label":"Outro","start_time":198,"end_time":233}]'::jsonb,
  0.65, 0.83, 0.93, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '7tFiyTwD0nx5a1eklYtX2J', 'spotify', 'Bohemian Rhapsody', 'Queen', 'A Night at the Opera',
  354320, 'GBUM71029604', 'https://i.scdn.co/image/ab67616d0000b273e8b066f70c206551210d902b',
  'Bb', 'major', ARRAY['I','vi','IV','V']::text[], 4,
  '7tFiyTwD0nx5a1eklYtX2J', 'fJ9rUzIMcZQ', NULL,
  0.4, 0.24, 0.22, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '32OlwWuMpZ6b0aN2RZOeMS', 'spotify', 'Uptown Funk', 'Mark Ronson ft. Bruno Mars', 'Uptown Special',
  269667, 'GBARL1401524', 'https://i.scdn.co/image/ab67616d0000b2737a7dc13e81e7284a18c35e20',
  'D', 'minor', ARRAY['i','iv','i','V']::text[], 4,
  '32OlwWuMpZ6b0aN2RZOeMS', 'OPf0YbXqDm0', NULL,
  0.89, 0.86, 0.93, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '3bNv3VuyjBrxfwNJU4sVTV', 'spotify', 'Someone Like You', 'Adele', '21',
  285000, 'GBBKS1000328', 'https://i.scdn.co/image/ab67616d0000b2732118bf9b198b05a95ded6300',
  'A', 'major', ARRAY['I','V','vi','IV']::text[], 4,
  '3bNv3VuyjBrxfwNJU4sVTV', 'hLQl3WQQoQ0', NULL,
  0.3, 0.5, 0.19, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '2Fxmhks0bxGSBdJ92vM42m', 'spotify', 'Bad Guy', 'Billie Eilish', 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?',
  194088, 'USUM71900764', 'https://i.scdn.co/image/ab67616d0000b2732a038d3bf875d23e4aeaa84e',
  'G', 'minor', ARRAY['i','iv','VI','III']::text[], 4,
  '2Fxmhks0bxGSBdJ92vM42m', 'DyDfgMOUjCI', NULL,
  0.43, 0.7, 0.56, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '5CQ30WqJwcep0pYcV4AMNc', 'spotify', 'Stairway to Heaven', 'Led Zeppelin', 'Led Zeppelin IV',
  482830, 'USAT29900466', 'https://i.scdn.co/image/ab67616d0000b273c8a11e48c91a982d086afc69',
  'A', 'minor', ARRAY['i','VII','VI','V']::text[], 4,
  '5CQ30WqJwcep0pYcV4AMNc', 'QkF3oxziUI4', NULL,
  0.34, 0.23, 0.18, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '1rgnBhdG2JDFTbYkYRZAku', 'spotify', 'Dance Monkey', 'Tones and I', 'The Kids Are Coming',
  209438, 'QZES71982312', 'https://i.scdn.co/image/ab67616d0000b2737fcead687e99583072cc217b',
  'F#', 'minor', ARRAY['i','III','VII','iv']::text[], 4,
  '1rgnBhdG2JDFTbYkYRZAku', 'q0hyYWKXF0Q', NULL,
  0.59, 0.82, 0.54, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '39LLxExYz6ewLAcYrzQQyP', 'spotify', 'Levitating', 'Dua Lipa', 'Future Nostalgia',
  203807, 'GBAHT2000159', 'https://i.scdn.co/image/ab67616d0000b273bd26ede1ae69327010d49946',
  'B', 'minor', ARRAY['i','VII','III','VI']::text[], 4,
  '39LLxExYz6ewLAcYrzQQyP', 'TUVcZfQe-Kw', NULL,
  0.83, 0.7, 0.91, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '40riOy7x9W7GXjyGp4pjAv', 'spotify', 'Hotel California', 'Eagles', 'Hotel California',
  391376, 'USEE10001267', 'https://i.scdn.co/image/ab67616d0000b273e52a59a28efa4773dd2bfe1b',
  'B', 'minor', ARRAY['i','V','VII','IV']::text[], 4,
  '40riOy7x9W7GXjyGp4pjAv', 'EqPtz5qN7HM', NULL,
  0.51, 0.56, 0.41, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '5wj4E6IsrVtn8IBJQOd0Cl', 'spotify', 'Wonderwall', 'Oasis', '(What''s the Story) Morning Glory?',
  258773, 'GBAAN9500004', 'https://i.scdn.co/image/ab67616d0000b2730f56e28dd0e72eb739bf2e26',
  'F#', 'minor', ARRAY['i','III','VII','IV']::text[], 4,
  '5wj4E6IsrVtn8IBJQOd0Cl', 'bx1Bh8ZvH84', NULL,
  0.59, 0.41, 0.29, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '5ghIJDpPoe3CfHMGu71E6T', 'spotify', 'Smells Like Teen Spirit', 'Nirvana', 'Nevermind',
  301920, 'USGF19942501', 'https://i.scdn.co/image/ab67616d0000b273e175a19e530c898d167d39bf',
  'F', 'minor', ARRAY['i','iv','III','VI']::text[], 4,
  '5ghIJDpPoe3CfHMGu71E6T', 'hTWKbfoikeg', NULL,
  0.91, 0.5, 0.39, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '7o2CTH4ctstm8TNelqjb51', 'spotify', 'Sweet Child O'' Mine', 'Guns N'' Roses', 'Appetite for Destruction',
  356133, 'USGF18700525', 'https://i.scdn.co/image/ab67616d0000b27321ebf49b3292c3f0f575f0f5',
  'D', 'major', ARRAY['I','V','vi','IV']::text[], 4,
  '7o2CTH4ctstm8TNelqjb51', '1w7OgIMMRc4', NULL,
  0.65, 0.4, 0.48, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '4OSBTYWVwsQhGLF9NHvIbR', 'spotify', 'Rolling in the Deep', 'Adele', '21',
  228293, 'GBBKS1000300', 'https://i.scdn.co/image/ab67616d0000b2732118bf9b198b05a95ded6300',
  'C', 'minor', ARRAY['i','III','VII','iv']::text[], 4,
  '4OSBTYWVwsQhGLF9NHvIbR', 'rYEDA3JcQqw', NULL,
  0.74, 0.73, 0.53, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '2LlQb7Uoj1kKyGhlkBf9aC', 'spotify', 'Thriller', 'Michael Jackson', 'Thriller',
  357800, 'USSM18200074', 'https://i.scdn.co/image/ab67616d0000b2733f47acb3f2c0bcc563442bfb',
  'C#', 'minor', ARRAY['i','iv','VI','III']::text[], 4,
  '2LlQb7Uoj1kKyGhlkBf9aC', 'sOnqjkJTMaA', NULL,
  0.73, 0.7, 0.66, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '5ChkMS8OtdzJeqyybCc9R5', 'spotify', 'Billie Jean', 'Michael Jackson', 'Thriller',
  293827, 'USSM18200059', 'https://i.scdn.co/image/ab67616d0000b2733f47acb3f2c0bcc563442bfb',
  'F#', 'minor', ARRAY['i','iv','i','VII']::text[], 4,
  '5ChkMS8OtdzJeqyybCc9R5', 'Zi_XLOBDo_Y', NULL,
  0.8, 0.9, 0.66, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '4bHsxqR3GMrXTxEPLuK5ue', 'spotify', 'Don''t Stop Believin''', 'Journey', 'Escape',
  250987, 'USSM18100115', 'https://i.scdn.co/image/ab67616d0000b27386669c1fa2cfb68e1385758f',
  'E', 'major', ARRAY['I','V','vi','IV']::text[], 4,
  '4bHsxqR3GMrXTxEPLuK5ue', '1k8craCGpgs', NULL,
  0.76, 0.61, 0.81, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '2WfaOiMkCvy7F5fcp2zZ8L', 'spotify', 'Take On Me', 'a-ha', 'Hunting High and Low',
  225280, 'USWD11571107', 'https://i.scdn.co/image/ab67616d0000b27328ea72c45e10bfc14e8a6fba',
  'A', 'major', ARRAY['I','V','vi','IV']::text[], 4,
  '2WfaOiMkCvy7F5fcp2zZ8L', 'djV11Xbc914', NULL,
  0.9, 0.57, 0.87, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '5Z01UMMf7V1o0MzF86s6WJ', 'spotify', 'Lose Yourself', 'Eminem', '8 Mile',
  326200, 'USIR10211076', 'https://i.scdn.co/image/ab67616d0000b27313b72e02bbb6fcb81d12c3e1',
  'D', 'minor', ARRAY['i','iv','VI','III']::text[], 4,
  '5Z01UMMf7V1o0MzF86s6WJ', '_Yhyp-_hX2s', NULL,
  0.8, 0.75, 0.47, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '7MXVkk9YMctZqd1Srtv4MB', 'spotify', 'Starboy', 'The Weeknd ft. Daft Punk', 'Starboy',
  230453, 'USUG11601314', 'https://i.scdn.co/image/ab67616d0000b2734718e2b124f79258be7bc452',
  'D', 'minor', ARRAY['i','VII','VI','V']::text[], 4,
  '7MXVkk9YMctZqd1Srtv4MB', '34Na4j8AVgA', NULL,
  0.59, 0.68, 0.49, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '2VxeLyX666F8uXCJ0dZF8B', 'spotify', 'Shallow', 'Lady Gaga & Bradley Cooper', 'A Star Is Born Soundtrack',
  215733, 'USUM71810761', 'https://i.scdn.co/image/ab67616d0000b2736f7f45d26d9f396ef2c2a11b',
  'G', 'major', ARRAY['I','IV','vi','V']::text[], 4,
  '2VxeLyX666F8uXCJ0dZF8B', 'bo_efYhYU2A', NULL,
  0.39, 0.57, 0.32, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '6u7jPi22kF8CTQ3rb9DHE7', 'spotify', 'Old Town Road', 'Lil Nas X', '7 EP',
  157067, 'USSM11903594', 'https://i.scdn.co/image/ab67616d0000b27315a82d80a5cdc90feb6e41b7',
  'E', 'minor', ARRAY['i','iv','VI','III']::text[], 4,
  '6u7jPi22kF8CTQ3rb9DHE7', 'r7qovpFAGrQ', NULL,
  0.61, 0.88, 0.64, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '2dLLR6qlu5UJ5gk0dKz0h3', 'spotify', 'Royals', 'Lorde', 'Pure Heroine',
  217920, 'NZUM71200009', 'https://i.scdn.co/image/ab67616d0000b273b1b4ab568c850275894705d9',
  'D', 'major', ARRAY['I','vi','IV','I']::text[], 4,
  '2dLLR6qlu5UJ5gk0dKz0h3', 'nlcIKh6sBtc', NULL,
  0.39, 0.63, 0.21, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '6UelLqGlWMcVH1E5c4H7lY', 'spotify', 'Watermelon Sugar', 'Harry Styles', 'Fine Line',
  174000, 'USSM11912382', 'https://i.scdn.co/image/ab67616d0000b273da5d5aeeabacacc1263c0f4b',
  'D', 'major', ARRAY['I','IV','vi','V']::text[], 4,
  '6UelLqGlWMcVH1E5c4H7lY', 'E07s5ZYygMg', NULL,
  0.82, 0.55, 0.56, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '2dpaYNEQHiRxtZbfNsse99', 'spotify', 'Happier', 'Marshmello & Bastille', 'Happier',
  214773, 'USRC11801792', 'https://i.scdn.co/image/ab67616d0000b273ef9b2f9c52dbbdf46e3b03b3',
  'C', 'major', ARRAY['vi','IV','I','V']::text[], 4,
  '2dpaYNEQHiRxtZbfNsse99', 'm7Bc3pLyij0', NULL,
  0.73, 0.69, 0.66, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '0tgVpDi06FyKpA1z0VMD4v', 'spotify', 'Perfect', 'Ed Sheeran', '÷ (Divide)',
  263400, 'GBAHS1700012', 'https://i.scdn.co/image/ab67616d0000b273ba5db46f4b838ef6027e6f96',
  'Ab', 'major', ARRAY['I','vi','IV','V']::text[], 4,
  '0tgVpDi06FyKpA1z0VMD4v', '2Vv-BfVoq4g', NULL,
  0.45, 0.6, 0.47, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '21jGcNKet2qwijlDFuPiPb', 'spotify', 'Circles', 'Post Malone', 'Hollywood''s Bleeding',
  215280, 'USUM71914039', 'https://i.scdn.co/image/ab67616d0000b2739478c87599550dd73bfa7e02',
  'E', 'minor', ARRAY['i','VII','IV','VI']::text[], 4,
  '21jGcNKet2qwijlDFuPiPb', 'wXhTHyIgQ_U', NULL,
  0.51, 0.7, 0.55, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '6v3KW9xbzN5yKLt9YKDYA2', 'spotify', 'Señorita', 'Shawn Mendes & Camila Cabello', 'Señorita',
  191267, 'USUG11901057', 'https://i.scdn.co/image/ab67616d0000b273ab02dcdf7bd37c3e6f1a7f47',
  'A', 'minor', ARRAY['i','iv','VI','III']::text[], 4,
  '6v3KW9xbzN5yKLt9YKDYA2', 'Pkh8UtuejGw', NULL,
  0.54, 0.76, 0.75, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '02MWAaffLxlfxAUY7c5dvx', 'spotify', 'Heat Waves', 'Glass Animals', 'Dreamland',
  238805, 'GBUM72002398', 'https://i.scdn.co/image/ab67616d0000b2739e495fb707973f3390850eea',
  'B', 'major', ARRAY['I','IV','vi','V']::text[], 4,
  '02MWAaffLxlfxAUY7c5dvx', 'mRD0-GxqHVo', NULL,
  0.52, 0.76, 0.47, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '5wANPM4fQCJwkGd4rN57mH', 'spotify', 'Drivers License', 'Olivia Rodrigo', 'SOUR',
  242014, 'USUG12100284', 'https://i.scdn.co/image/ab67616d0000b273e85259a1cae29a8d91f2093d',
  'Bb', 'major', ARRAY['I','V','vi','IV']::text[], 4,
  '5wANPM4fQCJwkGd4rN57mH', 'ZmDBbnmKpqQ', NULL,
  0.36, 0.59, 0.13, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '5HCyWlXZPP0y6Gqq8TgA20', 'spotify', 'Stay', 'The Kid LAROI & Justin Bieber', 'F*CK LOVE 3: OVER YOU',
  141806, 'USSM12105078', 'https://i.scdn.co/image/ab67616d0000b2738c697a84f95d21ae2e3e0f65',
  'C', 'major', ARRAY['I','V','vi','IV']::text[], 4,
  '5HCyWlXZPP0y6Gqq8TgA20', 'kTJczUoc26U', NULL,
  0.76, 0.59, 0.48, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '2xLMifQCjDGFmkHkpNLD9h', 'spotify', 'Sicko Mode', 'Travis Scott ft. Drake', 'ASTROWORLD',
  312820, 'USSM11803162', 'https://i.scdn.co/image/ab67616d0000b2732f2ad32c6e9d8c0cc8dbb8cd',
  'A', 'minor', ARRAY['i','VII','VI','iv']::text[], 4,
  '2xLMifQCjDGFmkHkpNLD9h', '6ONRf7h3Mdk', NULL,
  0.73, 0.83, 0.45, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '0pqnGHJpmpxLKifKRmU6WP', 'spotify', 'Believer', 'Imagine Dragons', 'Evolve',
  204347, 'USUM71614364', 'https://i.scdn.co/image/ab67616d0000b27375045a9c63b77a243d7b2dd7',
  'G', 'minor', ARRAY['i','VII','VI','iv']::text[], 4,
  '0pqnGHJpmpxLKifKRmU6WP', '7wtfhZwyrcc', NULL,
  0.78, 0.77, 0.67, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '4aWmUDTfIPGksMNLV2rQP2', 'spotify', 'Despacito', 'Luis Fonsi ft. Daddy Yankee', 'Vida',
  228827, 'USZ4V1600054', 'https://i.scdn.co/image/ab67616d0000b273f4f88ca6fec9e5de0016c5b0',
  'B', 'minor', ARRAY['i','VI','III','VII']::text[], 4,
  '4aWmUDTfIPGksMNLV2rQP2', 'kJQP7kiw5Fk', NULL,
  0.82, 0.66, 0.82, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '5cF0dROlMOK5uNZtivgu50', 'spotify', 'Attention', 'Charlie Puth', 'Voicenotes',
  211440, 'USAT21701234', 'https://i.scdn.co/image/ab67616d0000b273a59fc4aa8862c9c6f5c8d0e9',
  'E', 'minor', ARRAY['i','iv','VI','III']::text[], 4,
  '5cF0dROlMOK5uNZtivgu50', 'nfs8NYg7yQM', NULL,
  0.8, 0.74, 0.48, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '1rfofaqEpACxVEHIZBJe6W', 'spotify', 'Havana', 'Camila Cabello ft. Young Thug', 'Camila',
  217067, 'USSM11707787', 'https://i.scdn.co/image/ab67616d0000b2735a50d8e7d8cb9b2c9e9cd97a',
  'G', 'minor', ARRAY['i','iv','VII','III']::text[], 4,
  '1rfofaqEpACxVEHIZBJe6W', 'BQ0mxQXmLsk', NULL,
  0.52, 0.77, 0.39, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '6DCZcSspjsKoFjzjrWoCd4', 'spotify', 'God''s Plan', 'Drake', 'Scorpion',
  198973, 'USCM51800073', 'https://i.scdn.co/image/ab67616d0000b273f907de96b9a4fbc04accc0d5',
  'C', 'major', ARRAY['vi','IV','I','V']::text[], 4,
  '6DCZcSspjsKoFjzjrWoCd4', 'xpVfcZ0ZcFM', NULL,
  0.45, 0.75, 0.36, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '0e7ipj03S05BNilyu5bRzt', 'spotify', 'Rockstar', 'Post Malone ft. 21 Savage', 'Beerbongs & Bentleys',
  218147, 'USUM71710087', 'https://i.scdn.co/image/ab67616d0000b2739478c87599550dd73bfa7e02',
  'D', 'minor', ARRAY['i','iv','VI','III']::text[], 4,
  '0e7ipj03S05BNilyu5bRzt', 'UceaB4D0jpo', NULL,
  0.52, 0.59, 0.13, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '0RiRZpuVRbi7oqRdSMwhQY', 'spotify', 'Sunflower', 'Post Malone & Swae Lee', 'Spider-Man: Into the Spider-Verse',
  158040, 'USUM71813168', 'https://i.scdn.co/image/ab67616d0000b27377d61cc5ece38a92632e91a5',
  'D', 'major', ARRAY['I','IV','vi','V']::text[], 4,
  '0RiRZpuVRbi7oqRdSMwhQY', 'ApXoWvfEYVU', NULL,
  0.48, 0.76, 0.91, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '5p7ujcrUXASCNwRaWNHR1C', 'spotify', 'Without Me', 'Halsey', 'Manic',
  201661, 'USUM71813600', 'https://i.scdn.co/image/ab67616d0000b2737a6339d6ddfd579f77559d4e',
  'E', 'minor', ARRAY['i','VII','VI','III']::text[], 4,
  '5p7ujcrUXASCNwRaWNHR1C', 'ZAfAud_M_mg', NULL,
  0.49, 0.73, 0.27, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '2Fxmhks0bxGSBdJ92vM42m', 'spotify', 'bad guy', 'Billie Eilish', 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?',
  194088, 'USUM71900764', 'https://i.scdn.co/image/ab67616d0000b2732a038d3bf875d23e4aeaa84e',
  'G', 'minor', ARRAY['i','iv','VI','III']::text[], 4,
  '2Fxmhks0bxGSBdJ92vM42m', 'DyDfgMOUjCI', NULL,
  0.43, 0.7, 0.56, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '3e9HZxeyfWwjeyPAMmEAmx', 'spotify', 'Thank U, Next', 'Ariana Grande', 'Thank U, Next',
  207027, 'USUM71819098', 'https://i.scdn.co/image/ab67616d0000b2733f5f90df436aafa0caac2f26',
  'D', 'major', ARRAY['I','IV','vi','V']::text[], 4,
  '3e9HZxeyfWwjeyPAMmEAmx', 'gl1aHhXnN1k', NULL,
  0.65, 0.72, 0.67, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '0u2P5u6lvoDfwTYjAADbn4', 'spotify', 'Lovely', 'Billie Eilish & Khalid', '13 Reasons Why (Season 2)',
  200186, 'USUM71804190', 'https://i.scdn.co/image/ab67616d0000b273d3e94d9a1a1e93a0aab6b42b',
  'E', 'minor', ARRAY['i','VI','III','VII']::text[], 4,
  '0u2P5u6lvoDfwTYjAADbn4', 'V1Pl8CzNzCw', NULL,
  0.3, 0.35, 0.12, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '1Qrg8KqiBpW07V7PNxwwwL', 'spotify', 'Kill Bill', 'SZA', 'SOS',
  153947, 'USRC12203346', 'https://i.scdn.co/image/ab67616d0000b27370dbc9f47669d120e3f0f992',
  'C', 'minor', ARRAY['i','iv','VII','III']::text[], 4,
  '1Qrg8KqiBpW07V7PNxwwwL', 'hm_Gy5jnXGI', NULL,
  0.44, 0.64, 0.39, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '0yLdNVWF3Srea0uzk55zFn', 'spotify', 'Flowers', 'Miley Cyrus', 'Endless Summer Vacation',
  200455, 'USSM12209515', 'https://i.scdn.co/image/ab67616d0000b273f429549123dbe8552764ba2d',
  'A', 'minor', ARRAY['i','iv','VI','III']::text[], 4,
  '0yLdNVWF3Srea0uzk55zFn', 'G7KNmW9a75Y', NULL,
  0.68, 0.71, 0.64, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '0V3wPSX9ygBnCm8psDIegu', 'spotify', 'Anti-Hero', 'Taylor Swift', 'Midnights',
  200690, 'USUG12206429', 'https://i.scdn.co/image/ab67616d0000b273bb54dde68cd23e2a268ae0f5',
  'E', 'major', ARRAY['I','V','vi','IV']::text[], 4,
  '0V3wPSX9ygBnCm8psDIegu', 'b1kbLwvqugk', NULL,
  0.64, 0.64, 0.53, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '4Dvkj6JhhA12EX05fT7y2e', 'spotify', 'As It Was', 'Harry Styles', 'Harry''s House',
  167303, 'USSM12200612', 'https://i.scdn.co/image/ab67616d0000b2732e8ed79e177ff6011076f5f0',
  'F', 'major', ARRAY['I','IV','vi','V']::text[], 4,
  '4Dvkj6JhhA12EX05fT7y2e', 'H5v3kku4y6Q', NULL,
  0.73, 0.52, 0.66, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

INSERT INTO public.tracks (
  external_id, provider, title, artist, album, duration_ms, isrc, cover_url,
  detected_key, detected_mode, progression_roman, loop_length_bars,
  spotify_id, youtube_id, sections, energy, danceability, valence, analysis_source
) VALUES (
  '1PckUlxKqWQs3RlWXVBLw3', 'spotify', 'About Damn Time', 'Lizzo', 'Special',
  191627, 'USAT22203441', 'https://i.scdn.co/image/ab67616d0000b273fc398e84c4b5d8b933e3e859',
  'A', 'major', ARRAY['I','IV','V','vi']::text[], 4,
  '1PckUlxKqWQs3RlWXVBLw3', 'IXXxciRUMzE', NULL,
  0.81, 0.97, 0.9, 'metadata'
)
ON CONFLICT (external_id, provider) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  progression_roman = EXCLUDED.progression_roman,
  detected_key = EXCLUDED.detected_key,
  detected_mode = EXCLUDED.detected_mode,
  sections = EXCLUDED.sections;

-- Provider links (drives the Spotify/YouTube switcher)
INSERT INTO public.track_provider_links (track_id, provider, provider_track_id, url_web)
SELECT t.id, 'spotify', t.spotify_id, 'https://open.spotify.com/track/' || t.spotify_id
FROM public.tracks t WHERE t.spotify_id IS NOT NULL
ON CONFLICT (track_id, provider) DO NOTHING;

INSERT INTO public.track_provider_links (track_id, provider, provider_track_id, url_web)
SELECT t.id, 'youtube', t.youtube_id, 'https://www.youtube.com/watch?v=' || t.youtube_id
FROM public.tracks t WHERE t.youtube_id IS NOT NULL
ON CONFLICT (track_id, provider) DO NOTHING;

-- Feed items (the feed reads these)
INSERT INTO public.feed_items (track_id, source, rank)
SELECT t.id, 'seed', row_number() OVER (ORDER BY t.created_at)
FROM public.tracks t
WHERE NOT EXISTS (SELECT 1 FROM public.feed_items f WHERE f.track_id = t.id);

COMMIT;

-- Sanity: expect non-zero on all three.
SELECT
  (SELECT count(*) FROM public.tracks)               AS tracks,
  (SELECT count(*) FROM public.track_provider_links) AS provider_links,
  (SELECT count(*) FROM public.feed_items)           AS feed_items;