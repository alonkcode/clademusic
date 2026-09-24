-- ============================================================
-- 30-undo-promotion.sql
--
-- Make promoting a detection run reversible.
--
-- Promotion replaces a track's canonical sections wholesale and overwrites the
-- track's key. Until now nothing recorded what it replaced, so a mistaken
-- promotion (or a promoted demo/seed run) could be removed but not truly
-- undone. This adds:
--
--   * detection_runs.pre_promotion - a snapshot taken at the moment of
--                                    promotion: the track's sections and the
--                                    track-level fields the promotion writes.
--   * _promote_detection_run_core  - 29's shared core, unchanged except that
--                                    it now takes that snapshot. Both the
--                                    admin path and the automatic path go
--                                    through it, so both become undoable.
--   * revert_detection_run         - the admin RPC behind the Undo button.
--   * _revert_detection_run_core   - the same thing without the admin check,
--                                    for the SQL Editor and service role.
--
-- What Undo does, for the run that is CURRENTLY the track's canonical
-- analysis:
--   - removes the sections that run wrote,
--   - puts back the sections it replaced and the track's previous key/mode
--     (and, for an automatic promotion, its previous progression/tempo/
--     provenance) when a snapshot exists,
--   - returns the run to 'pending' so it can be reviewed again.
--
-- A run promoted BEFORE this script has no snapshot. Undoing it still removes
-- what it wrote and returns it to pending, but the previous key and sections
-- cannot be recovered - nothing recorded them - and the function says so
-- rather than pretending. Runs promoted after this script are fully restored.
--
-- Only the run that is currently canonical can be undone. If a later
-- promotion (or a hand edit) has since replaced it, undo that one first: its
-- snapshot holds this run's sections, so undoing in reverse order walks the
-- track back through its history.
--
-- Run AFTER 29-auto-analysis.sql, which creates the shared core this replaces.
--
-- CAUTION: re-running 29 afterwards puts back its version of the core, which
-- does not take snapshots. This file is idempotent - run it again to restore
-- snapshotting.
--
-- SAFETY: additive. One new nullable column, one replaced function that keeps
-- its signature and grants, two new functions. No DROP, TRUNCATE or
-- data deletion. One transaction: if any statement fails nothing is applied.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public._promote_detection_run_core(uuid,uuid,boolean)') is null then
    raise exception 'Run 29-auto-analysis.sql first: this script extends the shared promotion core it creates.';
  end if;
end $$;

-- ------------------------------------------------------------
-- The snapshot. jsonb rather than a side table: it is one small document per
-- promotion, read only by the run's own undo, and it lives and dies with the
-- run (a deleted run takes its snapshot with it).
--
--   { "sections": [ <every track_sections row that was replaced> ],
--     "track":    { detected_key, detected_mode, progression_roman,
--                   loop_length_bars, tempo, confidence_score, analysis_source } }
-- ------------------------------------------------------------
alter table public.detection_runs
  add column if not exists pre_promotion jsonb;

comment on column public.detection_runs.pre_promotion is
  'What promoting this run replaced: the track''s previous sections and track-level fields. Used by undo; null for runs promoted before it was recorded, and once the run is pending again.';

-- ------------------------------------------------------------
-- 29's core, plus the snapshot. Everything else is exactly as it was, so the
-- admin and automatic paths still cannot drift apart.
--
-- The track row is locked before the snapshot is read so two promotions of the
-- same track serialise: the second snapshots what the first left, which is
-- what makes undoing them in reverse order correct.
-- ------------------------------------------------------------
create or replace function public._promote_detection_run_core(
  p_run_id uuid,
  p_reviewer uuid,
  p_write_track_summary boolean
)
returns table (track_id uuid, sections_written integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.detection_runs%rowtype;
  v_written integer := 0;
  v_loop text[];
  v_loop_bars smallint;
  v_snapshot jsonb;
begin
  select * into v_run from public.detection_runs where id = p_run_id;
  if not found then
    raise exception 'No such detection run: %', p_run_id using errcode = 'no_data_found';
  end if;
  if v_run.status = 'promoted' then
    raise exception 'That run has already been promoted' using errcode = 'invalid_parameter_value';
  end if;

  perform 1 from public.tracks t where t.id = v_run.track_id for update;

  select jsonb_build_object(
    'sections', coalesce(
      (select jsonb_agg(to_jsonb(ts) order by ts.start_ms)
         from public.track_sections ts
        where ts.track_id = v_run.track_id),
      '[]'::jsonb
    ),
    'track', (
      select jsonb_build_object(
        'detected_key', t.detected_key,
        'detected_mode', t.detected_mode,
        'progression_roman', t.progression_roman,
        'loop_length_bars', t.loop_length_bars,
        'tempo', t.tempo,
        'confidence_score', t.confidence_score,
        'analysis_source', t.analysis_source
      )
      from public.tracks t
      where t.id = v_run.track_id
    )
  ) into v_snapshot;

  delete from public.track_sections ts where ts.track_id = v_run.track_id;

  with promoted as (
    insert into public.track_sections (
      track_id, label, ordinal, start_ms, end_ms,
      progression_roman, chord_timings, confidence, source_run_id
    )
    select
      v_run.track_id,
      s.label,
      s.ordinal,
      s.start_ms,
      s.end_ms,
      coalesce(c.numerals, '{}'),
      coalesce(c.timings, '{}'),
      s.confidence,
      v_run.id
    from public.detection_run_sections s
    left join lateral (
      select
        array_agg(ch.numeral order by ch.start_ms) as numerals,
        array_agg(greatest(0, ch.start_ms - s.start_ms) order by ch.start_ms) as timings
      from public.detection_run_chords ch
      where ch.section_id = s.id
    ) c on true
    where s.run_id = v_run.id
    order by s.start_ms
    returning 1
  )
  select count(*) into v_written from promoted;

  update public.detection_runs
  set status = 'promoted',
      reviewed_by = p_reviewer,
      reviewed_at = now(),
      pre_promotion = v_snapshot
  where id = v_run.id;

  if v_run.detected_tonic is not null then
    update public.tracks t
    set detected_key = (array['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'])[v_run.detected_tonic + 1],
        detected_mode = coalesce(v_run.detected_mode, t.detected_mode),
        updated_at = now()
    where t.id = v_run.track_id;
  end if;

  if p_write_track_summary then
    select s.loop_roman, s.loop_length_bars
      into v_loop, v_loop_bars
    from public.detection_run_sections s
    where s.run_id = v_run.id and cardinality(s.loop_roman) > 0
    order by (s.label = 'chorus') desc, (s.end_ms - s.start_ms) desc
    limit 1;

    update public.tracks t
    set progression_roman = coalesce(v_loop, t.progression_roman),
        loop_length_bars = coalesce(v_loop_bars, t.loop_length_bars),
        tempo = case
                  when v_run.tempo_bpm is not null and coalesce(v_run.tempo_confidence, 0) >= 0.6
                    then v_run.tempo_bpm
                  else t.tempo
                end,
        confidence_score = coalesce(round(v_run.key_confidence, 2), t.confidence_score),
        analysis_source = 'analysis',
        updated_at = now()
    where t.id = v_run.track_id;
  end if;

  return query select v_run.track_id, v_written;
end;
$$;

-- ------------------------------------------------------------
-- Undo one promotion.
--
-- Lock order matches promotion (track first, then the run), so an undo and a
-- promotion racing on the same track wait for each other instead of
-- deadlocking. The run is re-read after the lock: its status is only
-- trustworthy once nobody else can change it.
-- ------------------------------------------------------------
create or replace function public._revert_detection_run_core(p_run_id uuid)
returns table (
  track_id uuid,
  sections_removed integer,
  sections_restored integer,
  track_restored boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.detection_runs%rowtype;
  v_removed integer := 0;
  v_restored integer := 0;
  v_track_restored boolean := false;
  v_prev_sections jsonb;
  v_prev_track jsonb;
begin
  select * into v_run from public.detection_runs where id = p_run_id;
  if not found then
    raise exception 'No such detection run: %', p_run_id using errcode = 'no_data_found';
  end if;

  perform 1 from public.tracks t where t.id = v_run.track_id for update;
  select * into v_run from public.detection_runs where id = p_run_id for update;

  if v_run.status <> 'promoted' then
    raise exception 'Only a promoted run can be undone' using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1 from public.track_sections ts
    where ts.track_id = v_run.track_id and ts.source_run_id = v_run.id
  ) then
    raise exception
      'This run is no longer the canonical analysis for its track - a later promotion or edit replaced it. Undo that one first.'
      using errcode = 'invalid_parameter_value';
  end if;

  delete from public.track_sections ts
  where ts.track_id = v_run.track_id and ts.source_run_id = v_run.id;
  get diagnostics v_removed = row_count;

  if v_run.pre_promotion is not null then
    v_prev_sections := v_run.pre_promotion -> 'sections';

    -- Only put the old sections back onto an empty track. If anything else has
    -- been written since (a hand edit), overwriting it would be the same
    -- mistake promotion makes, and this is the undo.
    if jsonb_typeof(v_prev_sections) = 'array'
       and jsonb_array_length(v_prev_sections) > 0
       and not exists (select 1 from public.track_sections ts where ts.track_id = v_run.track_id)
    then
      -- A restored row may point at a run that has since been deleted; the
      -- foreign key would reject it, so that link is dropped rather than the
      -- section.
      insert into public.track_sections
      select *
      from jsonb_populate_recordset(
        null::public.track_sections,
        (
          select jsonb_agg(
            case
              when e ->> 'source_run_id' is not null
                and not exists (
                  select 1 from public.detection_runs d where d.id = (e ->> 'source_run_id')::uuid
                )
              then jsonb_set(e, '{source_run_id}', 'null'::jsonb)
              else e
            end
          )
          from jsonb_array_elements(v_prev_sections) e
        )
      );
      get diagnostics v_restored = row_count;
    end if;

    v_prev_track := v_run.pre_promotion -> 'track';
    if jsonb_typeof(v_prev_track) = 'object' then
      update public.tracks t
      set detected_key = v_prev_track ->> 'detected_key',
          detected_mode = v_prev_track ->> 'detected_mode',
          progression_roman = case
            when jsonb_typeof(v_prev_track -> 'progression_roman') = 'array'
              then array(select jsonb_array_elements_text(v_prev_track -> 'progression_roman'))
          end,
          loop_length_bars = (v_prev_track ->> 'loop_length_bars')::integer,
          tempo = (v_prev_track ->> 'tempo')::numeric,
          confidence_score = (v_prev_track ->> 'confidence_score')::numeric,
          analysis_source = v_prev_track ->> 'analysis_source',
          updated_at = now()
      where t.id = v_run.track_id;
      v_track_restored := true;
    end if;
  end if;

  update public.detection_runs
  set status = 'pending',
      reviewed_by = null,
      reviewed_at = null,
      pre_promotion = null
  where id = v_run.id;

  return query select v_run.track_id, v_removed, v_restored, v_track_restored;
end;
$$;

-- The admin RPC behind the Undo button.
create or replace function public.revert_detection_run(p_run_id uuid)
returns table (
  track_id uuid,
  sections_removed integer,
  sections_restored integer,
  track_restored boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not public.has_role(v_caller, 'admin'::public.app_role) then
    raise exception 'Only an admin can undo a promotion'
      using errcode = 'insufficient_privilege';
  end if;

  return query select * from public._revert_detection_run_core(p_run_id);
end;
$$;

-- ------------------------------------------------------------
-- Who can call what. The core is reachable only through a definer function or
-- the SQL Editor (which runs as postgres); the RPC needs the same grants the
-- other admin RPCs have, with the admin check inside it.
-- ------------------------------------------------------------
revoke all on function public._revert_detection_run_core(uuid) from public, anon, authenticated;
revoke execute on function public.revert_detection_run(uuid) from public, anon;
grant execute on function public.revert_detection_run(uuid) to authenticated;

comment on function public.revert_detection_run is
  'Undo the promotion of the run that is currently canonical for its track: removes its sections, restores what it replaced when recorded, and returns the run to pending. Admin only.';

commit;

-- ============================================================
-- Sanity checks. Read-only; run after the commit above.
-- ============================================================
-- 1. The RPC is callable by signed-in users, the core is not:
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute')          as anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('revert_detection_run', '_revert_detection_run_core', '_promote_detection_run_core');
-- expected: revert_detection_run false / true; both cores false / false
--
-- 2. Which promoted runs can be fully restored (snapshot recorded) and which
--    can only be removed (promoted before this script):
-- select r.status, (r.pre_promotion is not null) as has_snapshot, count(*)
-- from public.detection_runs r
-- group by 1, 2
-- order by 1, 2;
--
-- 3. Undo every promoted seed run from the SQL Editor (newest first, so a
--    track promoted twice unwinds in order). Runs that were replaced by a
--    later promotion cannot be undone on their own and are skipped with a
--    notice; the seed cleanup in 28 removes those.
-- do $$
-- declare r record;
-- begin
--   for r in
--     select id from public.detection_runs
--     where idempotency_key like 'seed-demo-%' and status = 'promoted'
--     order by reviewed_at desc
--   loop
--     begin
--       perform * from public._revert_detection_run_core(r.id);
--     exception when others then
--       raise notice 'skipped %: %', r.id, sqlerrm;
--     end;
--   end loop;
-- end $$;
