-- ============================================================
-- 31-save-track-sections-mirror.sql
--
-- Make a hand-edited section list stick everywhere it is shown.
--
-- save_track_sections (19) writes the canonical public.track_sections table,
-- and the player drawer reads that. But the feed's cards read the track row's
-- own legacy `tracks.sections` jsonb column directly, and that column was only
-- ever written by the seed. So after Save the drawer showed the edit and the
-- feed - after a reload, from the database - showed the old sections again:
-- to the person who made the edit it simply had not been remembered.
--
-- This replaces save_track_sections with the same function plus one step: the
-- saved structure is mirrored onto tracks.sections in that column's existing
-- shape, in the same transaction, so the two can never disagree.
--
--   [{"type":"verse","label":"Verse 1","start_time":18,"end_time":46}, ...]
--
-- `type` is the canonical label, `label` the display name (numbered only where
-- a label repeats, matching the app's sectionDisplayNames), times are seconds.
--
-- SAFETY: CREATE OR REPLACE of one function; applying this script changes no
-- data. Grants are restated because they are what keeps this admin-only.
-- Run AFTER 19-save-track-sections.sql.
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

  -- Mirror onto the track row's own copy, read by the feed. Built from what
  -- was just stored rather than from the input, so it is by construction what
  -- the canonical table holds.
  update public.tracks t
  set sections = coalesce(
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'type', s.label,
                     'label', initcap(s.label)
                              || case when s.total > 1 then ' ' || s.occurrence::text else '' end,
                     'start_time', round(s.start_ms / 1000.0, 3),
                     'end_time', round(s.end_ms / 1000.0, 3)
                   )
                   order by s.start_ms
                 )
          from (
            select
              ts.label,
              ts.start_ms,
              ts.end_ms,
              count(*) over (partition by ts.label) as total,
              row_number() over (partition by ts.label order by ts.start_ms) as occurrence
            from public.track_sections ts
            where ts.track_id = p_track_id
          ) s
        ),
        '[]'::jsonb
      ),
      updated_at = now()
  where t.id = p_track_id;

  return v_count;
end;
$$;

revoke execute on function public.save_track_sections(uuid, jsonb) from public, anon;
grant execute on function public.save_track_sections(uuid, jsonb) to authenticated;

comment on function public.save_track_sections is
  'Admin only. Replaces a track''s sections with a hand-marked set and mirrors them onto tracks.sections for the feed. Structure only - chords come from promoting a detection run.';

commit;

-- ============================================================
-- Sanity check. Read-only; run after the commit above.
-- ============================================================
-- The function body should now mention the mirror:
-- select position('update public.tracks' in pg_get_functiondef('public.save_track_sections(uuid, jsonb)'::regprocedure)) > 0 as mirrors_to_tracks;
-- expected: true
