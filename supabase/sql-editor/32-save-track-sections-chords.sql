-- ============================================================
-- 32-save-track-sections-chords.sql
--
-- Let the section editor store chords, not just structure.
--
-- save_track_sections (19, 31) deliberately wrote structure only, because the
-- editor could not show chords: carrying old ones across a moved boundary
-- would have attached them to the wrong part while still looking exact. The
-- editor now shows and edits every chord, and sends each section's chords with
-- it, relative to the section's own start:
--
--   { "label": "verse", "ordinal": 1, "start_ms": 18000, "end_ms": 46000,
--     "progression_roman": ["I","V","vi","IV"],
--     "chord_timings":     [0, 7000, 14000, 21000] }
--
-- so what is saved is exactly what the editor showed.
--
-- New parameter p_with_chords: chords are stored only when the caller says the
-- array carries them. The client sends it only when there are chords, so
-- structure-only saves keep working and a save WITH chords against a database
-- that has not run this script fails with "function not found" rather than
-- returning "saved" for data that was never written.
--
-- Chords are validated here as well as in the client, which is not the only
-- possible caller: one timing per numeral (the table's CHECK insists, and
-- chordIndexAt assumes it), strictly ascending, and inside the section.
--
-- The mirror onto tracks.sections (31) now carries chords and chord_timings
-- too, in that column's existing shape, so the feed cards and the player
-- drawer cannot disagree about what a section plays.
--
-- SAFETY: drops and recreates ONE function; touches no data. Adding a
-- parameter makes a new function rather than replacing the old one, and
-- leaving the two-argument version would make every two-argument call
-- ambiguous. Grants are restated because they are what keeps this admin-only.
-- Run AFTER 19-save-track-sections.sql and 31-save-track-sections-mirror.sql.
-- ============================================================

begin;

drop function if exists public.save_track_sections(uuid, jsonb);

create function public.save_track_sections(
  p_track_id uuid,
  p_sections jsonb,
  p_with_chords boolean default false
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
      e -> 'progression_roman' as numerals,
      e -> 'chord_timings' as timings,
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

    if p_with_chords and (v_row.numerals is not null or v_row.timings is not null) then
      if jsonb_typeof(v_row.numerals) is distinct from 'array'
         or jsonb_typeof(v_row.timings) is distinct from 'array' then
        raise exception 'Section %: progression_roman and chord_timings must both be arrays', v_row.position
          using errcode = 'invalid_parameter_value';
      end if;
      if jsonb_array_length(v_row.numerals) <> jsonb_array_length(v_row.timings) then
        raise exception 'Section %: every chord needs exactly one timing', v_row.position
          using errcode = 'invalid_parameter_value';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(v_row.numerals) as n(x) where btrim(n.x) = ''
      ) then
        raise exception 'Section %: a chord has no name', v_row.position
          using errcode = 'invalid_parameter_value';
      end if;
      -- Each onset inside the section and later than the one before it.
      if exists (
        select 1
        from (
          select
            x::integer as onset,
            lag(x::integer) over (order by n) as previous
          from jsonb_array_elements_text(v_row.timings) with ordinality as a(x, n)
        ) q
        where q.onset < 0
           or q.onset >= v_row.end_ms - v_row.start_ms
           or (q.previous is not null and q.onset <= q.previous)
      ) then
        raise exception 'Section %: chords must start inside the section, in order', v_row.position
          using errcode = 'invalid_parameter_value';
      end if;
    end if;
  end loop;

  delete from public.track_sections where track_id = p_track_id;

  -- Chords only when the caller said the array carries them. Without the flag
  -- this is the structure-only save it always was: an old client's payload
  -- has no chords to store, and one the caller did not vouch for is not
  -- guessed at.
  insert into public.track_sections (
    track_id, label, ordinal, start_ms, end_ms, progression_roman, chord_timings
  )
  select
    p_track_id,
    e ->> 'label',
    coalesce((e ->> 'ordinal')::smallint, 1),
    (e ->> 'start_ms')::integer,
    (e ->> 'end_ms')::integer,
    case when p_with_chords and jsonb_typeof(e -> 'progression_roman') = 'array'
      then array(
        select a.x
        from jsonb_array_elements_text(e -> 'progression_roman') with ordinality as a(x, n)
        order by a.n
      )
      else '{}'::text[]
    end,
    case when p_with_chords and jsonb_typeof(e -> 'chord_timings') = 'array'
      then array(
        select a.x::integer
        from jsonb_array_elements_text(e -> 'chord_timings') with ordinality as a(x, n)
        order by a.n
      )
      else '{}'::integer[]
    end
  from jsonb_array_elements(p_sections) as e;

  get diagnostics v_count = row_count;

  -- Mirror onto the track row's own copy, read by the feed. Built from what
  -- was just stored rather than from the input, so it is by construction what
  -- the canonical table holds. chords / chord_timings are added only for a
  -- section that has some, exactly as the column has always been shaped.
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
                   || case when cardinality(s.chords) > 0
                        then jsonb_build_object(
                               'chords', to_jsonb(s.chords),
                               'chord_timings', to_jsonb(s.timings)
                             )
                        else '{}'::jsonb
                      end
                   order by s.start_ms
                 )
          from (
            select
              ts.label,
              ts.start_ms,
              ts.end_ms,
              ts.progression_roman as chords,
              ts.chord_timings as timings,
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

revoke execute on function public.save_track_sections(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_track_sections(uuid, jsonb, boolean) to authenticated;

comment on function public.save_track_sections is
  'Admin only. Replaces a track''s sections with a hand-edited set, and their chords when p_with_chords is true, and mirrors them onto tracks.sections for the feed.';

commit;

-- ============================================================
-- Sanity checks. Read-only; run after the commit above.
-- ============================================================
-- Exactly one save_track_sections should exist, taking three arguments:
-- select pg_get_function_identity_arguments(oid) from pg_proc
--  where proname = 'save_track_sections' and pronamespace = 'public'::regnamespace;
-- expected: p_track_id uuid, p_sections jsonb, p_with_chords boolean   (one row)
