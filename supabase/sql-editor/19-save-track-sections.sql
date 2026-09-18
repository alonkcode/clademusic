-- ============================================================
-- 19-save-track-sections.sql
--
-- Hand-edited song structure.
--
-- Detection produces sections from audio; this is for marking them by ear
-- instead - listening, tapping a boundary at the playhead, saying what each
-- part is. Same destination, different source, so it writes the same
-- canonical table rather than a parallel one: whatever the app shows should
-- come from one place regardless of how it got there.
--
-- Like promote_detection_run this has to be SECURITY DEFINER, because RLS
-- closes track_sections to every client - which makes the admin check inside
-- the real guard rather than a formality.
--
-- SAFETY: creates one function. It replaces a track's sections when CALLED,
-- but applying this script changes no data.
-- ============================================================

begin;

create or replace function public.save_track_sections(
  p_track_id uuid,
  p_sections jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_count integer;
  v_prev_end integer := -1;
  v_row record;
begin
  if v_caller is null or not public.has_role(v_caller, 'admin'::public.app_role) then
    raise exception 'Only an admin can edit a track''s sections'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.tracks where id = p_track_id) then
    raise exception 'No such track: %', p_track_id using errcode = 'no_data_found';
  end if;

  if jsonb_typeof(p_sections) <> 'array' then
    raise exception 'sections must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  -- Sections tile one timeline, so they have to arrive in order and must not
  -- overlap. useActiveSection resolves an overlap by first match, so bad data
  -- here would not error anywhere - it would quietly highlight the wrong part
  -- of the song. Checked server-side because the client is not the only
  -- possible caller.
  for v_row in
    select
      (e ->> 'label')::text as label,
      coalesce((e ->> 'ordinal')::smallint, 1) as ordinal,
      (e ->> 'start_ms')::integer as start_ms,
      (e ->> 'end_ms')::integer as end_ms,
      ordinality as position
    from jsonb_array_elements(p_sections) with ordinality as t(e, ordinality)
    order by ordinality
  loop
    if v_row.label is null or v_row.label not in
       ('intro','verse','pre-chorus','chorus','bridge','outro','breakdown','drop') then
      raise exception 'Unknown section label at position %: %', v_row.position, v_row.label
        using errcode = 'invalid_parameter_value';
    end if;
    if v_row.start_ms is null or v_row.end_ms is null or v_row.end_ms <= v_row.start_ms then
      raise exception 'Section % must end after it starts', v_row.position
        using errcode = 'invalid_parameter_value';
    end if;
    if v_row.start_ms < v_prev_end then
      raise exception 'Section % overlaps the one before it', v_row.position
        using errcode = 'invalid_parameter_value';
    end if;
    v_prev_end := v_row.end_ms;
  end loop;

  delete from public.track_sections where track_id = p_track_id;

  -- Deliberately no progression_roman or chord_timings. Moving a boundary
  -- changes which chords fall inside a section, so carrying the old ones
  -- across would attach chords to the wrong part while still looking exact.
  -- A section edited by hand describes structure only; promoting a detection
  -- run is what puts chords back.
  insert into public.track_sections (track_id, label, ordinal, start_ms, end_ms)
  select
    p_track_id,
    e ->> 'label',
    coalesce((e ->> 'ordinal')::smallint, 1),
    (e ->> 'start_ms')::integer,
    (e ->> 'end_ms')::integer
  from jsonb_array_elements(p_sections) as e;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.save_track_sections(uuid, jsonb) from public, anon;
grant execute on function public.save_track_sections(uuid, jsonb) to authenticated;

comment on function public.save_track_sections is
  'Admin only. Replaces a track''s sections with a hand-marked set. Structure only - chords come from promoting a detection run.';

commit;
