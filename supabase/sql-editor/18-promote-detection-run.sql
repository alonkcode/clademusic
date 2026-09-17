-- ============================================================
-- 18-promote-detection-run.sql
--
-- Turning raw evidence into the canonical answer.
--
-- 17-live-detection-runs.sql stored captures as detection_runs: never
-- edited, never shown to anyone but their author and an admin. This adds the
-- step that makes one of them the track's canonical structure, and the
-- reject that closes the other ones out.
--
-- Promotion REPLACES a track's sections wholesale rather than merging. The
-- canonical set has to be internally coherent - non-overlapping, in order,
-- ordinals counted straight through - and merging two analyses cannot
-- promise that. The raw runs are all still there, so a better answer can be
-- re-derived and promoted over this one at any time.
--
-- SAFETY: additive except for one rename, on a table that is still empty.
-- No DROP TABLE, DELETE of existing data, or TRUNCATE. Runs in one
-- transaction: if any statement fails nothing is applied.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- The same name meant two different things in the two tables.
--
-- On detection_run_sections it holds the REDUCED LOOP - a verse playing
-- I-V-vi-IV four times stores four chords. On track_sections it has to hold
-- the FULL sequence, because useSectionSync indexes chord_timings into it in
-- parallel and a CHECK enforces that the two match in length. Calling both
-- `progression_roman` invited exactly the mix-up that would silently break
-- chord sync, so the run-level one says what it actually is.
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'detection_run_sections'
      and column_name = 'progression_roman'
  ) then
    alter table public.detection_run_sections rename column progression_roman to loop_roman;
  end if;
end $$;

comment on column public.detection_run_sections.loop_roman is
  'The section''s repeating unit, one cycle - not the full chord sequence, which lives in detection_run_chords.';

-- ------------------------------------------------------------
-- Promote one run to canonical.
--
-- SECURITY DEFINER because it writes track_sections, which RLS closes to
-- every client. That makes the admin check inside it load-bearing rather
-- than decorative: without it, any authenticated caller could rewrite any
-- track's structure.
-- ------------------------------------------------------------
create or replace function public.promote_detection_run(p_run_id uuid)
returns table (track_id uuid, sections_written integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_run public.detection_runs%rowtype;
  v_written integer := 0;
begin
  if v_caller is null or not public.has_role(v_caller, 'admin'::public.app_role) then
    raise exception 'Only an admin can promote a detection run'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_run from public.detection_runs where id = p_run_id;
  if not found then
    raise exception 'No such detection run: %', p_run_id using errcode = 'no_data_found';
  end if;
  if v_run.status = 'promoted' then
    raise exception 'That run has already been promoted' using errcode = 'invalid_parameter_value';
  end if;

  -- Wholesale replacement: see the header. Anything previously canonical for
  -- this track goes, including an earlier promotion's rows.
  delete from public.track_sections ts where ts.track_id = v_run.track_id;

  -- chord_timings are relative to the section's own start, because that is
  -- what useSectionSync subtracts before comparing. The numerals come from
  -- the run's chords in time order, so the two arrays line up one-for-one -
  -- which the CHECK on the table insists on, and which is the whole reason
  -- chord sync no longer has to dead-reckon from a tempo.
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
  set status = 'promoted', reviewed_by = v_caller, reviewed_at = now()
  where id = v_run.id;

  -- The key the numerals are relative to has to travel with them, or the
  -- readout renders them against whatever the catalog had and transposes
  -- every chord name by the difference.
  if v_run.detected_tonic is not null then
    update public.tracks t
    set detected_key = (array['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'])[v_run.detected_tonic + 1],
        detected_mode = coalesce(v_run.detected_mode, t.detected_mode),
        updated_at = now()
    where t.id = v_run.track_id;
  end if;

  return query select v_run.track_id, v_written;
end;
$$;

-- ------------------------------------------------------------
-- Close out a run without promoting it.
-- ------------------------------------------------------------
create or replace function public.reject_detection_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not public.has_role(v_caller, 'admin'::public.app_role) then
    raise exception 'Only an admin can reject a detection run'
      using errcode = 'insufficient_privilege';
  end if;

  update public.detection_runs
  set status = 'rejected', reviewed_by = v_caller, reviewed_at = now()
  where id = p_run_id and status <> 'promoted';

  if not found then
    raise exception 'No pending run to reject: %', p_run_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- The review queue.
--
-- One row per run with what a reviewer needs to triage it - which track, who
-- captured it, how much it covers, how sure it was - without a query per run
-- from the client.
-- ------------------------------------------------------------
create or replace function public.list_detection_runs(
  p_status text default 'pending',
  p_limit integer default 50
)
returns table (
  id uuid,
  track_id uuid,
  track_title text,
  track_artist text,
  contributor text,
  status text,
  detected_key text,
  detected_mode text,
  key_confidence numeric,
  covered_from_ms integer,
  covered_to_ms integer,
  section_count bigint,
  chord_count bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.track_id,
    t.title,
    t.artist,
    p.username,
    r.status,
    case when r.detected_tonic is null then null
         else (array['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'])[r.detected_tonic + 1]
    end,
    r.detected_mode,
    r.key_confidence,
    r.covered_from_ms,
    r.covered_to_ms,
    (select count(*) from public.detection_run_sections s where s.run_id = r.id),
    (select count(*) from public.detection_run_chords c where c.run_id = r.id),
    r.created_at
  from public.detection_runs r
  join public.tracks t on t.id = r.track_id
  left join public.profiles p on p.id = r.user_id
  where public.has_role((select auth.uid()), 'admin'::public.app_role)
    and (p_status = 'all' or r.status = p_status)
  order by r.created_at desc
  limit greatest(1, least(p_limit, 200));
$$;

-- These are the admin's tools; nobody else should be able to call them at
-- all, and the checks inside are the second line rather than the only one.
revoke execute on function public.promote_detection_run(uuid) from public, anon;
revoke execute on function public.reject_detection_run(uuid) from public, anon;
revoke execute on function public.list_detection_runs(text, integer) from public, anon;
grant execute on function public.promote_detection_run(uuid) to authenticated;
grant execute on function public.reject_detection_run(uuid) to authenticated;
grant execute on function public.list_detection_runs(text, integer) to authenticated;

-- ------------------------------------------------------------
-- get_detection_run selected the column the rename above moved, so it would
-- have failed the moment a reviewer opened a run. Its output column is
-- renamed to match, since nothing reads it yet.
--
-- CREATE OR REPLACE cannot change a return type, so this drops first.
-- ------------------------------------------------------------
drop function if exists public.get_detection_run(uuid);

create function public.get_detection_run(p_run_id uuid)
returns table (
  section_id uuid,
  label text,
  ordinal smallint,
  start_ms integer,
  end_ms integer,
  loop_roman text[],
  confidence numeric,
  chords jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id,
    s.label,
    s.ordinal,
    s.start_ms,
    s.end_ms,
    s.loop_roman,
    s.confidence,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'numeral', c.numeral,
            'root_pitch_class', c.root_pitch_class,
            'quality', c.quality,
            'start_ms', c.start_ms,
            'end_ms', c.end_ms,
            'confidence', c.confidence
          )
          order by c.start_ms
        )
        from public.detection_run_chords c
        where c.section_id = s.id
      ),
      '[]'::jsonb
    )
  from public.detection_run_sections s
  where s.run_id = p_run_id
  order by s.start_ms;
$$;

comment on function public.promote_detection_run is
  'Admin only. Replaces a track''s canonical sections with one run''s analysis and marks the run promoted.';
comment on function public.reject_detection_run is
  'Admin only. Closes a run out without changing anything canonical.';
comment on function public.list_detection_runs is
  'Admin only. The review queue: one row per run with the track and totals needed to triage it.';

commit;
