-- ============================================================
-- 29-verify-auto-analysis.sql
--
-- Run AFTER 29-auto-analysis.sql. Exercises the new functions against real
-- rows and checks the guarantees the feature depends on:
--
--   * a track is found or created once, and a YouTube id for a song seeded
--     from Spotify reuses that row instead of duplicating it;
--   * a good capture of a track with NO analysis becomes its saved analysis,
--     with sections, per-chord timings, key, tempo and provenance;
--   * a track that already has an analysis - canonical sections, a curated
--     progression, or a curated section list - is NEVER overwritten, and the
--     capture stays pending for the admin's ordinary review;
--   * a tempo the detector was not sure of is not stored;
--   * the new functions are not callable by browsers.
--
-- Everything happens inside one transaction that is ROLLED BACK at the end, so
-- it leaves nothing behind whether it passes or not. A failure raises an
-- exception naming the check; success prints a notice.
--
-- Run it as postgres (the SQL editor's default role).
-- ============================================================

begin;

do $$
declare
  v_a uuid;          -- a brand-new track
  v_b uuid;
  v_seed uuid;       -- a track "seeded" under the other provider
  v_json uuid;       -- a track with only a curated sections list
  v_low uuid;        -- a track whose tempo will be unsure
  v_run uuid;
  v_run2 uuid;
  v_run3 uuid;
  v_run4 uuid;
  v_run5 uuid;
  v_s1 uuid;
  v_s2 uuid;
  v_res record;
  v_track public.tracks%rowtype;
  v_n integer;
  v_status text;
begin
  -- ----------------------------------------------------------
  -- 1. resolve_or_create_track
  -- ----------------------------------------------------------
  v_a := public.resolve_or_create_track('youtube', 'zzVerify0001', 'Verify track', 'Verify artist', null, 200000, null);
  v_b := public.resolve_or_create_track('youtube', 'zzVerify0001', 'Verify track', 'Verify artist');
  if v_a is null or v_a is distinct from v_b then
    raise exception 'FAIL 1a: resolve_or_create_track is not idempotent (% vs %)', v_a, v_b;
  end if;

  select * into v_track from public.tracks where id = v_a;
  if v_track.provider <> 'youtube' or v_track.external_id <> 'zzVerify0001'
     or v_track.youtube_id <> 'zzVerify0001' or v_track.duration_ms <> 200000 then
    raise exception 'FAIL 1b: the created row is wrong: %', to_jsonb(v_track);
  end if;

  insert into public.tracks (external_id, provider, title, artist, youtube_id)
  values ('zzVerifySpotify000000001', 'spotify', 'Seeded elsewhere', 'Someone', 'zzVerify0002')
  returning id into v_seed;
  if public.resolve_or_create_track('youtube', 'zzVerify0002', 'A youtube title', 'A channel') is distinct from v_seed then
    raise exception 'FAIL 1c: a YouTube id held by a Spotify-seeded row did not resolve to that row';
  end if;
  select count(*) into v_n from public.tracks where external_id = 'zzVerify0002' or youtube_id = 'zzVerify0002';
  if v_n <> 1 then
    raise exception 'FAIL 1d: a duplicate row was created for an id the catalog already had (% rows)', v_n;
  end if;

  begin
    perform public.resolve_or_create_track('apple_music', 'x1234567890', 'T', 'A');
    raise exception 'FAIL 1e: an unsupported provider was accepted';
  exception when invalid_parameter_value then
    null;
  end;
  begin
    perform public.resolve_or_create_track('youtube', 'zzVerify0009', '   ', 'A');
    raise exception 'FAIL 1f: a blank title was accepted';
  exception when invalid_parameter_value then
    null;
  end;

  -- ----------------------------------------------------------
  -- 2. A good capture of a track with nothing is promoted.
  -- ----------------------------------------------------------
  insert into public.detection_runs
    (track_id, analysis_version, detected_tonic, detected_mode, key_confidence,
     tempo_bpm, tempo_confidence, covered_from_ms, covered_to_ms)
  values (v_a, 'verify', 0, 'major', 0.8, 121.6, 0.8, 0, 120000)
  returning id into v_run;

  insert into public.detection_run_sections (run_id, label, ordinal, start_ms, end_ms, loop_roman, loop_length_bars, confidence)
  values (v_run, 'verse', 1, 0, 60000, array['I','V','vi','IV'], 4, 0.9)
  returning id into v_s1;
  insert into public.detection_run_sections (run_id, label, ordinal, start_ms, end_ms, loop_roman, loop_length_bars, confidence)
  values (v_run, 'chorus', 1, 60000, 120000, array['IV','I','V'], 3, 0.9)
  returning id into v_s2;

  insert into public.detection_run_chords (run_id, section_id, numeral, root_pitch_class, quality, start_ms, end_ms, confidence) values
    (v_run, v_s1, 'I',  0, 'major',      0, 15000, 0.9),
    (v_run, v_s1, 'V',  7, 'major',  15000, 30000, 0.9),
    (v_run, v_s1, 'vi', 9, 'minor',  30000, 45000, 0.9),
    (v_run, v_s1, 'IV', 5, 'major',  45000, 60000, 0.9),
    (v_run, v_s2, 'IV', 5, 'major',  60000, 80000, 0.9),
    (v_run, v_s2, 'I',  0, 'major',  80000, 100000, 0.9),
    (v_run, v_s2, 'V',  7, 'major', 100000, 120000, 0.9);

  select * into v_res from public.auto_promote_detection_run(v_run);
  if not v_res.promoted or v_res.reason <> 'promoted' or v_res.sections_written <> 2 then
    raise exception 'FAIL 2a: a good capture of an empty track was not promoted: %', to_jsonb(v_res);
  end if;

  select count(*) into v_n from public.track_sections where track_id = v_a;
  if v_n <> 2 then raise exception 'FAIL 2b: expected 2 canonical sections, found %', v_n; end if;

  if (select chord_timings from public.track_sections where track_id = v_a and label = 'verse')
       is distinct from array[0, 15000, 30000, 45000] then
    raise exception 'FAIL 2c: per-chord timings were not stored relative to the section start';
  end if;
  if (select progression_roman from public.track_sections where track_id = v_a and label = 'verse')
       is distinct from array['I','V','vi','IV'] then
    raise exception 'FAIL 2d: the section did not get its full chord sequence';
  end if;

  select * into v_track from public.tracks where id = v_a;
  if v_track.progression_roman is distinct from array['IV','I','V'] then
    raise exception 'FAIL 2e: track progression should be the longest chorus loop, got %', v_track.progression_roman;
  end if;
  if v_track.loop_length_bars is distinct from 3 then
    raise exception 'FAIL 2f: loop_length_bars should come from that same loop, got %', v_track.loop_length_bars;
  end if;
  if v_track.tempo is distinct from 121.6 then
    raise exception 'FAIL 2g: a confident tempo was not stored, got %', v_track.tempo;
  end if;
  if v_track.analysis_source is distinct from 'analysis' then
    raise exception 'FAIL 2h: analysis_source should be analysis, got %', v_track.analysis_source;
  end if;
  if v_track.detected_key is distinct from 'C' or v_track.detected_mode is distinct from 'major' then
    raise exception 'FAIL 2i: the key did not travel with the numerals: % %', v_track.detected_key, v_track.detected_mode;
  end if;
  if v_track.confidence_score is distinct from 0.80 then
    raise exception 'FAIL 2j: confidence_score should be the key confidence, got %', v_track.confidence_score;
  end if;

  select status into v_status from public.detection_runs where id = v_run;
  if v_status <> 'promoted' then raise exception 'FAIL 2k: the run should be marked promoted, is %', v_status; end if;
  if (select reviewed_by from public.detection_runs where id = v_run) is not null then
    raise exception 'FAIL 2l: an automatic promotion should have no reviewer';
  end if;

  -- ----------------------------------------------------------
  -- 3. A second capture of the now-analysed track stays evidence.
  -- ----------------------------------------------------------
  insert into public.detection_runs (track_id, analysis_version, detected_tonic, detected_mode, key_confidence, covered_from_ms, covered_to_ms)
  values (v_a, 'verify', 2, 'minor', 0.9, 0, 120000)
  returning id into v_run2;

  select * into v_res from public.auto_promote_detection_run(v_run2);
  if v_res.promoted or v_res.reason <> 'already_analysed' then
    raise exception 'FAIL 3a: a second capture of an analysed track was promoted: %', to_jsonb(v_res);
  end if;
  select status into v_status from public.detection_runs where id = v_run2;
  if v_status <> 'pending' then raise exception 'FAIL 3b: the declined run should stay pending, is %', v_status; end if;
  if (select count(*) from public.track_sections where track_id = v_a and source_run_id = v_run) <> 2 then
    raise exception 'FAIL 3c: the first analysis was disturbed by the second capture';
  end if;

  -- 4. Asking again about a promoted run is a no-op.
  select * into v_res from public.auto_promote_detection_run(v_run);
  if not v_res.promoted or v_res.reason <> 'run_not_pending' then
    raise exception 'FAIL 4: re-promoting a promoted run should report run_not_pending, got %', to_jsonb(v_res);
  end if;

  -- ----------------------------------------------------------
  -- 5. Curated data is never overwritten: a seeded track with a progression.
  -- ----------------------------------------------------------
  update public.tracks
     set progression_roman = array['i','IV','VI','V'], analysis_source = 'metadata', detected_key = 'F', detected_mode = 'minor'
   where id = v_seed;
  insert into public.detection_runs (track_id, analysis_version, detected_tonic, detected_mode, key_confidence, covered_from_ms, covered_to_ms)
  values (v_seed, 'verify', 7, 'major', 0.95, 0, 120000)
  returning id into v_run3;

  select * into v_res from public.auto_promote_detection_run(v_run3);
  if v_res.promoted or v_res.reason <> 'already_analysed' then
    raise exception 'FAIL 5a: a track with a curated progression was promoted over: %', to_jsonb(v_res);
  end if;
  select * into v_track from public.tracks where id = v_seed;
  if v_track.progression_roman is distinct from array['i','IV','VI','V'] or v_track.detected_key <> 'F'
     or v_track.analysis_source <> 'metadata' then
    raise exception 'FAIL 5b: curated track data was changed: %', to_jsonb(v_track);
  end if;

  -- 6. Same for a track whose only analysis is a curated section list.
  insert into public.tracks (external_id, provider, title, artist, sections)
  values ('zzVerifyJson0001', 'youtube', 'Curated sections', 'Someone',
          '[{"type":"verse","label":"Verse 1","start_time":0,"end_time":30}]'::jsonb)
  returning id into v_json;
  insert into public.detection_runs (track_id, analysis_version, detected_tonic, detected_mode, key_confidence, covered_from_ms, covered_to_ms)
  values (v_json, 'verify', 0, 'major', 0.9, 0, 120000)
  returning id into v_run4;
  select * into v_res from public.auto_promote_detection_run(v_run4);
  if v_res.promoted or v_res.reason <> 'already_analysed' then
    raise exception 'FAIL 6: a track with a curated section list was promoted over: %', to_jsonb(v_res);
  end if;

  -- 7. A run that does not exist.
  select * into v_res from public.auto_promote_detection_run('00000000-0000-0000-0000-000000000000');
  if v_res.promoted or v_res.reason <> 'run_not_found' then
    raise exception 'FAIL 7: an unknown run should report run_not_found, got %', to_jsonb(v_res);
  end if;

  -- ----------------------------------------------------------
  -- 8. A tempo the detector was not sure of is not stored.
  -- ----------------------------------------------------------
  v_low := public.resolve_or_create_track('youtube', 'zzVerify0003', 'Unsure tempo', 'Someone');
  insert into public.detection_runs
    (track_id, analysis_version, detected_tonic, detected_mode, key_confidence,
     tempo_bpm, tempo_confidence, covered_from_ms, covered_to_ms)
  values (v_low, 'verify', 0, 'major', 0.8, 90, 0.4, 0, 120000)
  returning id into v_run5;
  insert into public.detection_run_sections (run_id, label, ordinal, start_ms, end_ms, loop_roman, confidence)
  values (v_run5, 'verse', 1, 0, 60000, array['I','V'], 0.9)
  returning id into v_s1;
  insert into public.detection_run_chords (run_id, section_id, numeral, root_pitch_class, quality, start_ms, end_ms, confidence)
  values (v_run5, v_s1, 'I', 0, 'major', 0, 30000, 0.9), (v_run5, v_s1, 'V', 7, 'major', 30000, 60000, 0.9);
  select * into v_res from public.auto_promote_detection_run(v_run5);
  if not v_res.promoted then raise exception 'FAIL 8a: the capture should still be promoted: %', to_jsonb(v_res); end if;
  select * into v_track from public.tracks where id = v_low;
  if v_track.tempo is not null then
    raise exception 'FAIL 8b: an unsure tempo was stored: %', v_track.tempo;
  end if;
  if v_track.progression_roman is distinct from array['I','V'] then
    raise exception 'FAIL 8c: without a chorus the longest section loop should be used, got %', v_track.progression_roman;
  end if;

  -- ----------------------------------------------------------
  -- 9. Browsers cannot call any of it.
  -- ----------------------------------------------------------
  if has_function_privilege('anon', 'public.auto_promote_detection_run(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.auto_promote_detection_run(uuid)', 'execute') then
    raise exception 'FAIL 9a: auto_promote_detection_run is callable by anon/authenticated';
  end if;
  if has_function_privilege('anon', 'public.resolve_or_create_track(text,text,text,text,text,integer,text)', 'execute')
     or has_function_privilege('authenticated', 'public.resolve_or_create_track(text,text,text,text,text,integer,text)', 'execute') then
    raise exception 'FAIL 9b: resolve_or_create_track is callable by anon/authenticated';
  end if;
  if has_function_privilege('anon', 'public._promote_detection_run_core(uuid,uuid,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public._promote_detection_run_core(uuid,uuid,boolean)', 'execute')
     or has_function_privilege('service_role', 'public._promote_detection_run_core(uuid,uuid,boolean)', 'execute') then
    raise exception 'FAIL 9c: the shared promotion core is directly callable';
  end if;
  if not has_function_privilege('service_role', 'public.auto_promote_detection_run(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.resolve_or_create_track(text,text,text,text,text,integer,text)', 'execute') then
    raise exception 'FAIL 9d: the edge function (service_role) cannot call the new functions';
  end if;
  -- The admin RPC keeps working for signed-in users; the admin check inside it is what gates it.
  if not has_function_privilege('authenticated', 'public.promote_detection_run(uuid)', 'execute') then
    raise exception 'FAIL 9e: promote_detection_run lost its grant to authenticated';
  end if;

  raise notice 'All auto-analysis checks passed.';
end
$$;

rollback;
