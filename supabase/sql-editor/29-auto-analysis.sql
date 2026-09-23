-- ============================================================
-- 29-auto-analysis.sql
--
-- Analyse a track the catalog has never seen, once, and keep the result.
--
-- Until now a live capture could only be saved for a track that already had
-- a `tracks` row, and even then it sat as `pending` until an admin promoted
-- it - so an unknown track stayed unknown no matter how many people listened
-- to it. This adds the three pieces that close that gap:
--
--   * resolve_or_create_track  - find (or make) the tracks row for a
--                                Spotify/YouTube id the player is holding.
--   * auto_promote_detection_run - promote a good capture straight to
--                                canonical, but ONLY for a track that has no
--                                analysis at all. Tracks that already have
--                                curated data keep the admin-review path.
--   * detection_runs.tempo_*   - a place for the measured BPM to live.
--
-- Both new functions are callable by the service role ONLY. The
-- ingest-detection edge function is the single caller, and it decides
-- whether a capture is good enough (see _shared/autoPromotion.ts) before
-- asking; the database enforces the part that must never be wrong, which is
-- that an existing analysis is never overwritten by this path.
--
-- promote_detection_run's body moves into a shared core so the admin path
-- and the automatic path cannot drift. The admin RPC behaves exactly as it
-- did: same admin check, same errors, same tables written.
--
-- SAFETY: additive. New columns, indexes and functions; promote_detection_run
-- is replaced with an equivalent that delegates. No DROP TABLE, TRUNCATE or
-- data deletion beyond what promote_detection_run already did. Idempotent, and
-- one transaction: if any statement fails nothing is applied.
--
-- Run AFTER 17-live-detection-runs.sql and 18-promote-detection-run.sql.
-- Deploy the ingest-detection function only once this has been applied.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Tempo, as measured from the audio during the capture.
-- Kept on the run (evidence) and copied to tracks.tempo only when the
-- detector was confident in it.
-- ------------------------------------------------------------
alter table public.detection_runs
  add column if not exists tempo_bpm numeric(5,2)
    check (tempo_bpm is null or tempo_bpm between 30 and 300),
  add column if not exists tempo_confidence numeric(4,3)
    check (tempo_confidence is null or tempo_confidence between 0 and 1);

-- The seed and the app already read/write tracks.tempo; this only guards a
-- database that was provisioned before it existed.
alter table public.tracks add column if not exists tempo numeric;

-- ------------------------------------------------------------
-- Finding a track by the id the player holds. spotify_id / youtube_id were
-- never indexed, and every play of an unknown track now looks one up.
-- ------------------------------------------------------------
create index if not exists idx_tracks_spotify_id
  on public.tracks (spotify_id) where spotify_id is not null;
create index if not exists idx_tracks_youtube_id
  on public.tracks (youtube_id) where youtube_id is not null;

-- ------------------------------------------------------------
-- resolve_or_create_track
--
-- The player only ever knows a provider id ("spotify:<id>" / "youtube:<id>").
-- Look for an existing row first, including one seeded under the OTHER
-- provider that carries this id in spotify_id / youtube_id: a YouTube hit for
-- a song the catalog already has from Spotify must reuse that row, or the
-- same song would end up analysed twice under two ids.
--
-- Creating a row is race-safe: (external_id, provider) is unique, so a
-- concurrent creator makes this insert do nothing and the re-select finds
-- theirs.
-- ------------------------------------------------------------
create or replace function public.resolve_or_create_track(
  p_provider text,
  p_provider_id text,
  p_title text,
  p_artist text,
  p_album text default null,
  p_duration_ms integer default null,
  p_isrc text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_provider not in ('spotify', 'youtube') then
    raise exception 'Unsupported provider: %', p_provider using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(btrim(p_provider_id), '') = '' or coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_artist), '') = '' then
    raise exception 'A track needs a provider id, title and artist' using errcode = 'invalid_parameter_value';
  end if;

  select t.id into v_id
  from public.tracks t
  where (t.provider = p_provider and t.external_id = p_provider_id)
     or (p_provider = 'spotify' and t.spotify_id = p_provider_id)
     or (p_provider = 'youtube' and t.youtube_id = p_provider_id)
  order by (t.provider = p_provider and t.external_id = p_provider_id) desc, t.created_at asc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.tracks (
    external_id, provider, title, artist, album, duration_ms, isrc, spotify_id, youtube_id
  ) values (
    p_provider_id,
    p_provider,
    left(btrim(p_title), 300),
    left(btrim(p_artist), 300),
    left(nullif(btrim(coalesce(p_album, '')), ''), 300),
    case when p_duration_ms between 1000 and 21600000 then p_duration_ms else null end,
    nullif(btrim(coalesce(p_isrc, '')), ''),
    case when p_provider = 'spotify' then p_provider_id end,
    case when p_provider = 'youtube' then p_provider_id end
  )
  on conflict (external_id, provider) do nothing
  returning id into v_id;

  if v_id is null then
    select t.id into v_id
    from public.tracks t
    where t.provider = p_provider and t.external_id = p_provider_id;
  end if;

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- The promotion itself, shared by the admin RPC and the automatic path.
--
-- Same steps promote_detection_run always did: replace the track's sections
-- wholesale, stamp the run, and carry the key with the numerals. The one
-- addition is p_write_track_summary, which the automatic path sets so a track
-- with nothing known about it also gets its progression, tempo and provenance
-- filled in. The admin path leaves it false: an admin promoting a run onto a
-- track with curated metadata must not have that metadata overwritten.
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
begin
  select * into v_run from public.detection_runs where id = p_run_id;
  if not found then
    raise exception 'No such detection run: %', p_run_id using errcode = 'no_data_found';
  end if;
  if v_run.status = 'promoted' then
    raise exception 'That run has already been promoted' using errcode = 'invalid_parameter_value';
  end if;

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
  set status = 'promoted', reviewed_by = p_reviewer, reviewed_at = now()
  where id = v_run.id;

  if v_run.detected_tonic is not null then
    update public.tracks t
    set detected_key = (array['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'])[v_run.detected_tonic + 1],
        detected_mode = coalesce(v_run.detected_mode, t.detected_mode),
        updated_at = now()
    where t.id = v_run.track_id;
  end if;

  if p_write_track_summary then
    -- The track-level progression is the loop the song spends most of its
    -- time in: the longest chorus if there is one, otherwise the longest
    -- section that has a loop at all.
    select s.loop_roman, s.loop_length_bars
      into v_loop, v_loop_bars
    from public.detection_run_sections s
    where s.run_id = v_run.id and cardinality(s.loop_roman) > 0
    order by (s.label = 'chorus') desc, (s.end_ms - s.start_ms) desc
    limit 1;

    update public.tracks t
    set progression_roman = coalesce(v_loop, t.progression_roman),
        loop_length_bars = coalesce(v_loop_bars, t.loop_length_bars),
        -- A wrong BPM is worse than none, so it is only kept when the
        -- detector was sure of it.
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

-- The admin RPC: unchanged behaviour, now a thin wrapper.
create or replace function public.promote_detection_run(p_run_id uuid)
returns table (track_id uuid, sections_written integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not public.has_role(v_caller, 'admin'::public.app_role) then
    raise exception 'Only an admin can promote a detection run'
      using errcode = 'insufficient_privilege';
  end if;

  return query select * from public._promote_detection_run_core(p_run_id, v_caller, false);
end;
$$;

-- ------------------------------------------------------------
-- auto_promote_detection_run
--
-- Promote a run with no human in the loop - but only into a track that has
-- nothing. The track row is locked first, so two people finishing a capture
-- of the same unknown track at once cannot both win: the second finds the
-- first's sections and is told the track is already analysed, and its run
-- stays pending as ordinary evidence.
--
-- "Nothing" means no canonical sections, no progression, and no curated
-- section list. A seeded track fails that on purpose.
-- ------------------------------------------------------------
create or replace function public.auto_promote_detection_run(p_run_id uuid)
returns table (promoted boolean, reason text, sections_written integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.detection_runs%rowtype;
  v_track public.tracks%rowtype;
  v_written integer := 0;
begin
  select * into v_run from public.detection_runs where id = p_run_id;
  if not found then
    return query select false, 'run_not_found'::text, 0;
    return;
  end if;
  if v_run.status <> 'pending' then
    return query select (v_run.status = 'promoted'), 'run_not_pending'::text, 0;
    return;
  end if;

  select * into v_track from public.tracks t where t.id = v_run.track_id for update;
  if not found then
    return query select false, 'track_not_found'::text, 0;
    return;
  end if;

  if exists (select 1 from public.track_sections ts where ts.track_id = v_track.id)
     or coalesce(cardinality(v_track.progression_roman), 0) > 0
     or (v_track.sections is not null
         and jsonb_typeof(v_track.sections) = 'array'
         and jsonb_array_length(v_track.sections) > 0)
  then
    return query select false, 'already_analysed'::text, 0;
    return;
  end if;

  select c.sections_written into v_written
  from public._promote_detection_run_core(p_run_id, null, true) c;

  return query select true, 'promoted'::text, v_written;
end;
$$;

-- ------------------------------------------------------------
-- Who can call what.
--
-- The two new entry points and the shared core are the service role's alone.
-- Functions created in public are executable by everyone by default, so each
-- is revoked explicitly. promote_detection_run keeps the grants 18 gave it
-- (CREATE OR REPLACE preserves them); it is restated here so this file is
-- correct on its own.
-- ------------------------------------------------------------
revoke all on function public.resolve_or_create_track(text, text, text, text, text, integer, text)
  from public, anon, authenticated;
revoke all on function public._promote_detection_run_core(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.auto_promote_detection_run(uuid)
  from public, anon, authenticated;

grant execute on function public.resolve_or_create_track(text, text, text, text, text, integer, text)
  to service_role;
grant execute on function public.auto_promote_detection_run(uuid)
  to service_role;

revoke execute on function public.promote_detection_run(uuid) from public, anon;
grant execute on function public.promote_detection_run(uuid) to authenticated;

comment on function public.resolve_or_create_track is
  'Find the tracks row for a Spotify/YouTube id (also matching the other provider''s id column), creating it if the catalog has never seen the track. Service role only.';
comment on function public.auto_promote_detection_run is
  'Promote a pending run to canonical without review, but only for a track with no existing analysis. Service role only.';
comment on column public.detection_runs.tempo_bpm is
  'BPM measured from the audio during the capture. Copied to tracks.tempo only when tempo_confidence >= 0.6.';

commit;

-- ============================================================
-- Sanity checks. Read-only; run after the commit above.
-- ============================================================
-- 1. The new functions exist and only service_role can execute them:
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute')          as anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--        has_function_privilege('service_role', p.oid, 'execute')  as service_role
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('resolve_or_create_track', 'auto_promote_detection_run', '_promote_detection_run_core');
-- expected: anon = false, authenticated = false, service_role = true
--           (the core is false / false / false - it is only reached through a definer function)
--
-- 2. The admin RPC is still callable by signed-in users (the admin check is inside it):
-- select has_function_privilege('authenticated', 'public.promote_detection_run(uuid)', 'execute');
--
-- 3. New columns and indexes:
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'detection_runs' and column_name like 'tempo%';
-- select indexname from pg_indexes
-- where schemaname = 'public' and indexname in ('idx_tracks_spotify_id', 'idx_tracks_youtube_id');
--
-- 4. Track resolution (as postgres in the SQL editor). The two calls must return the SAME id,
--    and a second provider id for a seeded song must not create a duplicate:
-- select public.resolve_or_create_track('youtube', 'dQw4w9WgXcQ', 'Test track', 'Test artist');
-- select public.resolve_or_create_track('youtube', 'dQw4w9WgXcQ', 'Test track', 'Test artist');
-- -- clean up the probe row afterwards:
-- -- delete from public.tracks where external_id = 'dQw4w9WgXcQ' and provider = 'youtube';
