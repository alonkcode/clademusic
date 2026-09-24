-- Seed fake (but musically realistic) live-detection runs for the admin
-- review queue.
--
-- Until a few people have used the Listen button and saved a capture, the
-- Detection runs tab in the admin dashboard has almost nothing in it. This
-- fills it with runs shaped like what useLiveChordDetection really produces,
-- so the queue, the run detail, and Promote/Reject can be exercised.
--
-- What "realistic" means here:
--
--   * Real tracks. Each run is attached to a track already in the catalog
--     (detection_runs.track_id is a foreign key), preferring tracks that have
--     no run yet so the queue shows many songs, not one song many times.
--
--   * The track's own key and length. The harmony is written in the
--     catalog's detected_key/detected_mode when it has one, and the section
--     structure is fitted to duration_ms, so a 3:20 song does not get a
--     12-minute analysis.
--
--   * Pop structure. Intro / verse / pre-chorus / chorus / bridge / outro
--     laid out on a bar grid, each label with its own repeating chord loop
--     (verse and chorus differ; the second chorus repeats the first), chords
--     held a bar or half a bar, and boundaries that wander by ~100 ms the way
--     a detector's do rather than sitting on a perfect grid.
--
--   * Numerals spelled like the app spells them (lib/harmony/keyEstimation.ts:
--     bVII in major, VI/VII in minor, lowercase for minor chords), and
--     computed relative to the DETECTED key, with the absolute pitch class
--     stored alongside.
--
--   * Imperfect evidence. About 15% of runs mistake the key for its relative
--     major/minor (same chords, different numerals, low key confidence) -
--     exactly the kind of run a reviewer should reject. About 40% only cover
--     part of the song, and some join after the intro. Chord confidences are
--     mostly 0.64-0.95 with the odd shaky one.
--
-- Contributors: runs are attributed only to accounts from
-- 20-seed-fake-users.sql (@fakeseed.test), never to a real person's account.
-- If none exist the runs are unattributed (the tab shows no "by ..." name).
--
-- Status: runs are inserted 'pending', plus a few 'rejected' so that tab is
-- not empty. None are inserted as 'promoted', on purpose: promotion is what
-- rewrites track_sections and the track's key, and a row saying "promoted"
-- with no sections behind it would be a lie. Click Promote on a pending run
-- to see the real thing.
--
-- Requires 17-live-detection-runs.sql and 18-promote-detection-run.sql (the
-- loop_roman column) to have been applied.
--
-- Safe to re-run: every run gets its own tag and each execution just adds a
-- fresh batch on tracks that still have no run.
--
-- UNDO (removes every seeded run; the runs' own sections and chords cascade):
--   DELETE FROM public.track_sections WHERE source_run_id IN
--     (SELECT id FROM public.detection_runs WHERE idempotency_key LIKE 'seed-demo-%');
--   DELETE FROM public.detection_runs WHERE idempotency_key LIKE 'seed-demo-%';
-- Run BOTH, in this order. The first takes the sections of any seed run you
-- PROMOTED off the real tracks; the second alone would leave them there. If a
-- run was promoted before 30-undo-promotion.sql existed, nothing recorded the
-- track's previous key, so it stays as promoted (the seed uses each track's
-- own catalog key, so for all but the ~15% wrong-key runs that is the value
-- it already had). Once 30 is applied, the admin panel's Undo button reverses
-- a promotion fully instead.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Tune the v_* knobs at the top of the DO block first.

BEGIN;

DO $$
DECLARE
  -- ---- knobs -------------------------------------------------------------
  v_run_count       INTEGER := 8;     -- runs on distinct tracks
  v_second_opinions INTEGER := 2;     -- extra runs on tracks already picked (to test "promote a better one over it")
  v_reject_every    INTEGER := 5;     -- every Nth run is inserted already rejected (0 = none)
  v_days_back       INTEGER := 14;    -- created_at is spread over this many days

  -- ---- music -------------------------------------------------------------
  -- Same spelling tables as keyEstimation.ts, indexed by semitones above the tonic.
  v_major_names TEXT[] := ARRAY['I','bII','II','bIII','III','IV','#IV','V','bVI','VI','bVII','VII'];
  v_minor_names TEXT[] := ARRAY['I','bII','II','III','#III','IV','#IV','V','VI','#VI','VII','#VII'];
  v_pitch_names TEXT[] := ARRAY['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  -- Loops are "semitones-above-tonic:quality" steps relative to the TRUE key,
  -- M = major triad, m = minor triad. One step is one chord.
  v_major_verse   TEXT[] := ARRAY['0:M 7:M 9:m 5:M', '9:m 5:M 0:M 7:M', '0:M 9:m 5:M 7:M', '0:M 5:M 0:M 7:M'];
  v_major_chorus  TEXT[] := ARRAY['5:M 0:M 7:M 9:m', '0:M 7:M 9:m 5:M', '0:M 10:M 5:M 10:M', '5:M 7:M 9:m 0:M'];
  v_major_pre     TEXT[] := ARRAY['9:m 5:M 2:m 7:M', '2:m 7:M 2:m 7:M', '5:M 7:M 5:M 7:M'];
  v_major_bridge  TEXT[] := ARRAY['2:m 7:M 0:M 5:M', '4:m 9:m 5:M 7:M', '5:M 7:M 4:m 9:m'];
  v_minor_verse   TEXT[] := ARRAY['0:m 8:M 3:M 10:M', '0:m 5:m 8:M 7:M', '0:m 10:M 8:M 7:M', '0:m 5:m 10:M 3:M'];
  v_minor_chorus  TEXT[] := ARRAY['8:M 10:M 0:m 7:M', '3:M 10:M 8:M 10:M', '8:M 3:M 10:M 0:m', '0:m 8:M 3:M 10:M'];
  v_minor_pre     TEXT[] := ARRAY['5:m 7:M 5:m 7:M', '8:M 10:M 8:M 10:M', '5:m 8:M 10:M 7:M'];
  v_minor_bridge  TEXT[] := ARRAY['5:m 8:M 3:M 10:M', '8:M 10:M 3:M 7:M', '3:M 8:M 5:m 7:M'];

  -- Song shapes as "label:bars". The one whose implied tempo lands nearest a
  -- believable BPM for the track's length is used.
  v_templates TEXT[] := ARRAY[
    'intro:4 verse:8 pre-chorus:4 chorus:8 verse:8 pre-chorus:4 chorus:8 bridge:8 chorus:8 outro:4',
    'intro:4 verse:8 chorus:8 verse:8 chorus:8 bridge:8 chorus:8 outro:4',
    'verse:8 chorus:8 verse:8 chorus:8 bridge:4 chorus:8 outro:4',
    'intro:8 verse:16 chorus:8 verse:16 chorus:8 bridge:8 chorus:16 outro:8'
  ];

  -- ---- per-run working state ----------------------------------------------
  v_track         RECORD;
  v_duration      INTEGER;
  v_user_id       UUID;
  v_created       TIMESTAMPTZ;
  v_status        TEXT;

  v_true_tonic    INTEGER;
  v_true_mode     TEXT;
  v_run_tonic     INTEGER;
  v_run_mode      TEXT;
  v_key_conf      NUMERIC;

  v_verse_loop    TEXT;
  v_chorus_loop   TEXT;
  v_pre_loop      TEXT;
  v_bridge_loop   TEXT;

  v_t             INTEGER;
  v_cands         INTEGER[];
  v_best          INTEGER;
  v_best_diff     NUMERIC;
  v_total_bars    INTEGER;
  v_fit_bpm       NUMERIC;
  v_bpm           INTEGER;
  v_bar_ms        INTEGER;
  v_cpb           INTEGER;   -- chords per bar

  v_parts         TEXT[];
  v_labels        TEXT[];
  v_bars          INTEGER[];
  v_n             INTEGER;
  v_bound         INTEGER[];
  v_lead          INTEGER;
  v_cum           INTEGER;
  v_b             INTEGER;
  v_first         INTEGER;
  v_last          INTEGER;
  v_cover_from    INTEGER;
  v_cover_to      INTEGER;

  v_run_id        UUID;
  v_ord           JSONB;
  v_ord_n         INTEGER;
  v_label         TEXT;
  v_loop          TEXT;
  v_steps         TEXT[];
  v_l             INTEGER;
  v_roots         INTEGER[];
  v_quals         TEXT[];
  v_nums          TEXT[];
  v_rel           INTEGER;
  v_num           TEXT;
  v_s_start       INTEGER;
  v_s_end         INTEGER;
  v_nc            INTEGER;
  v_cb            INTEGER[];
  v_cc            NUMERIC[];
  v_sum           NUMERIC;
  v_c             NUMERIC;
  v_x             INTEGER;
  v_section_id    UUID;

  v_k             INTEGER;
  v_j             INTEGER;
  v_runs_made     INTEGER := 0;
  v_sections_made INTEGER := 0;
  v_chords_made   INTEGER := 0;
BEGIN
  FOR v_track IN
    WITH picked AS (
      SELECT t.id, t.title, t.artist, t.duration_ms, t.detected_key, t.detected_mode
      FROM public.tracks t
      WHERE NOT EXISTS (SELECT 1 FROM public.detection_runs r WHERE r.track_id = t.id)
        AND (t.duration_ms IS NULL OR t.duration_ms >= 60000)
      ORDER BY random()
      LIMIT v_run_count
    )
    SELECT * FROM picked
    UNION ALL
    (SELECT * FROM picked ORDER BY random() LIMIT v_second_opinions)
  LOOP
    v_duration := COALESCE(v_track.duration_ms, 180000 + floor(random() * 60000)::int);

    -- Who "captured" it: a fake account, never a real one.
    SELECT p.id INTO v_user_id
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE u.email LIKE '%@fakeseed.test'
    ORDER BY random()
    LIMIT 1;
    IF random() < 0.1 THEN v_user_id := NULL; END IF;  -- an account that was later deleted

    v_created := now() - (random() * v_days_back || ' days')::interval;
    v_status := CASE
      WHEN v_reject_every > 0 AND (v_runs_made + 1) % v_reject_every = 0 THEN 'rejected'
      ELSE 'pending'
    END;

    -- ---- the key the music is really in, and the key the run believes ------
    v_true_tonic := array_position(v_pitch_names, v_track.detected_key) - 1;
    IF v_true_tonic IS NULL THEN
      v_true_tonic := CASE v_track.detected_key
        WHEN 'Db' THEN 1 WHEN 'Eb' THEN 3 WHEN 'Gb' THEN 6 WHEN 'Ab' THEN 8 WHEN 'Bb' THEN 10
        ELSE floor(random() * 12)::int
      END;
    END IF;
    v_true_mode := CASE
      WHEN v_track.detected_mode IN ('major', 'minor') THEN v_track.detected_mode
      WHEN random() < 0.7 THEN 'major'
      ELSE 'minor'
    END;

    v_run_tonic := v_true_tonic;
    v_run_mode := v_true_mode;
    v_key_conf := round((0.62 + random() * 0.30)::numeric, 3);
    IF random() < 0.15 THEN
      -- Relative-key confusion: same chords, read from the wrong tonic.
      IF v_true_mode = 'major' THEN
        v_run_tonic := (v_true_tonic + 9) % 12;
        v_run_mode := 'minor';
      ELSE
        v_run_tonic := (v_true_tonic + 3) % 12;
        v_run_mode := 'major';
      END IF;
      v_key_conf := round((0.41 + random() * 0.17)::numeric, 3);
    END IF;

    -- ---- one chord loop per section role ----------------------------------
    IF v_true_mode = 'major' THEN
      v_verse_loop  := v_major_verse[1 + floor(random() * array_length(v_major_verse, 1))::int];
      v_chorus_loop := v_major_chorus[1 + floor(random() * array_length(v_major_chorus, 1))::int];
      v_pre_loop    := v_major_pre[1 + floor(random() * array_length(v_major_pre, 1))::int];
      v_bridge_loop := v_major_bridge[1 + floor(random() * array_length(v_major_bridge, 1))::int];
    ELSE
      v_verse_loop  := v_minor_verse[1 + floor(random() * array_length(v_minor_verse, 1))::int];
      v_chorus_loop := v_minor_chorus[1 + floor(random() * array_length(v_minor_chorus, 1))::int];
      v_pre_loop    := v_minor_pre[1 + floor(random() * array_length(v_minor_pre, 1))::int];
      v_bridge_loop := v_minor_bridge[1 + floor(random() * array_length(v_minor_bridge, 1))::int];
    END IF;

    -- ---- pick a song shape that fits the track's length -------------------
    v_cands := ARRAY[]::int[];
    v_best := 1;
    v_best_diff := 1e9;
    FOR v_t IN 1..array_length(v_templates, 1) LOOP
      SELECT sum(split_part(x, ':', 2)::int) INTO v_total_bars
      FROM unnest(string_to_array(v_templates[v_t], ' ')) AS x;
      v_fit_bpm := v_total_bars * 240000.0 / (v_duration * 0.96);
      IF v_fit_bpm BETWEEN 76 AND 140 THEN v_cands := v_cands || v_t; END IF;
      IF abs(v_fit_bpm - 100) < v_best_diff THEN
        v_best_diff := abs(v_fit_bpm - 100);
        v_best := v_t;
      END IF;
    END LOOP;
    IF COALESCE(array_length(v_cands, 1), 0) > 0 THEN
      v_t := v_cands[1 + floor(random() * array_length(v_cands, 1))::int];
    ELSE
      v_t := v_best;
    END IF;

    v_parts := string_to_array(v_templates[v_t], ' ');
    v_n := array_length(v_parts, 1);
    v_labels := ARRAY[]::text[];
    v_bars := ARRAY[]::int[];
    v_total_bars := 0;
    FOR v_k IN 1..v_n LOOP
      v_labels := v_labels || split_part(v_parts[v_k], ':', 1);
      v_bars := v_bars || split_part(v_parts[v_k], ':', 2)::int;
      v_total_bars := v_total_bars + v_bars[v_k];
    END LOOP;

    v_bpm := LEAST(150, GREATEST(72, round(v_total_bars * 240000.0 / (v_duration * 0.96))::int));
    v_bar_ms := round(240000.0 / v_bpm)::int;
    v_cpb := CASE WHEN v_bpm < 100 AND random() < 0.25 THEN 2 ELSE 1 END;

    -- Section boundaries on the bar grid, a short lead-in before the first
    -- downbeat, and ~120 ms of wander on every interior edge.
    v_lead := floor(random() * 700)::int;
    v_bound := ARRAY[v_lead];
    v_cum := 0;
    FOR v_k IN 1..v_n LOOP
      v_cum := v_cum + v_bars[v_k];
      v_b := v_lead + v_cum * v_bar_ms;
      IF v_k < v_n THEN v_b := v_b + floor(random() * 241)::int - 120; END IF;
      v_b := LEAST(v_b, v_duration);
      v_b := GREATEST(v_b, v_bound[v_k] + 1000);
      v_bound := v_bound || v_b;
    END LOOP;

    -- ---- which stretch of the song this capture actually sat through ------
    v_first := CASE WHEN v_n > 4 AND random() < 0.15 THEN 2 ELSE 1 END;
    v_last := v_n;
    IF random() < 0.4 THEN
      v_last := LEAST(v_n, GREATEST(v_first + 2, ceil(v_n * (0.5 + random() * 0.35))::int));
    END IF;
    WHILE v_last > 1 AND v_bound[v_last] >= v_duration - 3000 LOOP
      v_last := v_last - 1;
    END LOOP;
    IF v_first > v_last THEN v_first := v_last; END IF;

    v_cover_from := CASE
      WHEN v_first = 1 THEN 0
      ELSE GREATEST(0, v_bound[v_first] - floor(random() * 800)::int)
    END;
    v_cover_to := LEAST(v_bound[v_last + 1], v_duration);

    INSERT INTO public.detection_runs (
      track_id, user_id, analysis_version, source,
      detected_tonic, detected_mode, key_confidence,
      covered_from_ms, covered_to_ms,
      status, reviewed_at, idempotency_key, created_at, updated_at
    )
    VALUES (
      v_track.id, v_user_id, '1.0.0', 'live-capture',
      v_run_tonic, v_run_mode, v_key_conf,
      v_cover_from, v_cover_to,
      v_status,
      CASE WHEN v_status = 'rejected' THEN v_created + (random() * 6 || ' hours')::interval END,
      'seed-demo-' || gen_random_uuid()::text,
      v_created, v_created
    )
    RETURNING id INTO v_run_id;
    v_runs_made := v_runs_made + 1;

    -- ---- sections, then the chords inside them ----------------------------
    v_ord := '{}'::jsonb;
    FOR v_k IN v_first..v_last LOOP
      v_label := v_labels[v_k];
      v_s_start := v_bound[v_k];
      v_s_end := LEAST(v_bound[v_k + 1], v_duration);

      -- Intro leans on the verse harmony and outro on the chorus, as they
      -- usually do.
      v_loop := CASE v_label
        WHEN 'chorus' THEN v_chorus_loop
        WHEN 'outro' THEN v_chorus_loop
        WHEN 'pre-chorus' THEN v_pre_loop
        WHEN 'bridge' THEN v_bridge_loop
        ELSE v_verse_loop
      END;
      v_steps := string_to_array(v_loop, ' ');
      v_l := array_length(v_steps, 1);

      -- The loop as absolute pitches, and as numerals in the DETECTED key.
      v_roots := ARRAY[]::int[];
      v_quals := ARRAY[]::text[];
      v_nums := ARRAY[]::text[];
      FOR v_j IN 1..v_l LOOP
        v_roots := v_roots || ((v_true_tonic + split_part(v_steps[v_j], ':', 1)::int) % 12);
        v_quals := v_quals || CASE split_part(v_steps[v_j], ':', 2) WHEN 'm' THEN 'minor' ELSE 'major' END;
        v_rel := ((v_roots[v_j] - v_run_tonic) % 12 + 12) % 12;
        v_num := CASE WHEN v_run_mode = 'major' THEN v_major_names[v_rel + 1] ELSE v_minor_names[v_rel + 1] END;
        -- Accidentals are already lowercase, so this only lowers the roman letters.
        IF v_quals[v_j] = 'minor' THEN v_num := lower(v_num); END IF;
        v_nums := v_nums || v_num;
      END LOOP;

      -- A clipped final section holds fewer chords, not squashed ones.
      v_nc := LEAST(
        v_bars[v_k] * v_cpb,
        GREATEST(1, round((v_s_end - v_s_start)::numeric / (v_bar_ms::numeric / v_cpb))::int)
      );

      v_cb := ARRAY[]::int[];
      FOR v_j IN 0..v_nc LOOP
        v_x := v_s_start + round(v_j::numeric * (v_s_end - v_s_start) / v_nc)::int;
        IF v_j > 0 AND v_j < v_nc THEN v_x := v_x + floor(random() * 121)::int - 60; END IF;
        v_cb := v_cb || v_x;
      END LOOP;

      v_cc := ARRAY[]::numeric[];
      v_sum := 0;
      FOR v_j IN 1..v_nc LOOP
        v_c := round(
          (CASE WHEN random() < 0.08 THEN 0.38 + random() * 0.17 ELSE 0.64 + random() * 0.31 END)::numeric,
          3
        );
        v_cc := v_cc || v_c;
        v_sum := v_sum + v_c;
      END LOOP;

      v_ord := jsonb_set(v_ord, ARRAY[v_label], to_jsonb(COALESCE((v_ord ->> v_label)::int, 0) + 1));
      v_ord_n := (v_ord ->> v_label)::int;

      INSERT INTO public.detection_run_sections (
        run_id, label, ordinal, start_ms, end_ms,
        loop_roman, loop_length_bars, confidence
      )
      VALUES (
        v_run_id, v_label, v_ord_n, v_s_start, v_s_end,
        v_nums, GREATEST(1, v_l / v_cpb), round(v_sum / v_nc, 3)
      )
      RETURNING id INTO v_section_id;
      v_sections_made := v_sections_made + 1;

      FOR v_j IN 1..v_nc LOOP
        INSERT INTO public.detection_run_chords (
          run_id, section_id, numeral, root_pitch_class, quality,
          start_ms, end_ms, confidence
        )
        VALUES (
          v_run_id, v_section_id,
          v_nums[((v_j - 1) % v_l) + 1],
          v_roots[((v_j - 1) % v_l) + 1],
          v_quals[((v_j - 1) % v_l) + 1],
          v_cb[v_j], v_cb[v_j + 1], v_cc[v_j]
        );
        v_chords_made := v_chords_made + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Seeded % detection run(s): % section(s), % chord(s)',
    v_runs_made, v_sections_made, v_chords_made;
  IF v_runs_made = 0 THEN
    RAISE NOTICE 'No tracks qualified - every track may already have a run, or the catalog is empty.';
  END IF;
END $$;

COMMIT;

-- What landed. The SQL Editor shows only the last statement's result.
SELECT
  r.status,
  t.title,
  t.artist,
  CASE WHEN r.detected_tonic IS NULL THEN NULL
       ELSE (ARRAY['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'])[r.detected_tonic + 1] || ' ' || r.detected_mode
  END AS detected_key,
  r.key_confidence,
  (SELECT count(*) FROM public.detection_run_sections s WHERE s.run_id = r.id) AS sections,
  (SELECT count(*) FROM public.detection_run_chords c WHERE c.run_id = r.id) AS chords,
  round((r.covered_to_ms - r.covered_from_ms) / 1000.0) AS covered_seconds,
  p.username AS contributor
FROM public.detection_runs r
JOIN public.tracks t ON t.id = r.track_id
LEFT JOIN public.profiles p ON p.id = r.user_id
WHERE r.idempotency_key LIKE 'seed-demo-%'
ORDER BY r.created_at DESC;
