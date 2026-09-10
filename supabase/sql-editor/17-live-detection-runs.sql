-- ============================================================
-- 17-live-detection-runs.sql
--
-- Persistence for live chord detection.
--
-- Until now every result the detector produced was thrown away when the
-- capture ended: chords, section boundaries and the estimated key all lived
-- in React state and nothing ever wrote them anywhere. This adds the storage
-- that makes a capture worth doing.
--
-- The shape is deliberately two-layered:
--
--   * detection_runs / _sections / _chords hold RAW EVIDENCE - one set per
--     capture, exactly as it was heard, never edited. Several people (or the
--     same person twice) can analyse the same track and each gets their own
--     run. Keeping the raw runs is what makes it possible to re-derive a
--     better canonical answer later, or to re-write the numerals if the key
--     estimate turns out to have been wrong.
--
--   * track_sections stays CANONICAL - the one answer the app shows. Rows
--     there are promoted from a run after review, never written directly by
--     a client.
--
-- Nothing here is client-writable. Ingest goes through the
-- ingest-detection edge function using the service role, which is also what
-- lets it validate a payload before any of it is trusted.
--
-- SAFETY: this script adds things. It creates three new tables, adds columns
-- to track_sections, and replaces the get_track_sections function with one
-- that returns those new columns too. There is no DROP TABLE, DELETE,
-- TRUNCATE, ALTER COLUMN or RENAME anywhere in it, so no existing row can be
-- lost. It is also idempotent - every statement is IF NOT EXISTS or
-- DROP ... IF EXISTS followed by a create - so running it twice is a no-op
-- rather than an error.
--
-- The whole thing runs in one transaction. If any statement fails, nothing is
-- applied and the database is exactly as it was. (If your SQL editor already
-- opened a transaction, the BEGIN below just logs a harmless
-- "there is already a transaction in progress" warning.)
-- ============================================================

begin;

-- ------------------------------------------------------------
-- One capture session.
-- ------------------------------------------------------------
create table if not exists public.detection_runs (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  -- Null when the contributor's account is later deleted: the analysis stays
  -- useful even when we can no longer say who produced it.
  user_id uuid references auth.users(id) on delete set null,

  -- Provenance. Which code produced this, so a later algorithm change can
  -- find and re-run everything from an older version.
  analysis_version text not null,
  source text not null default 'live-capture'
    check (source in ('live-capture', 'server-analysis', 'manual')),

  -- The key the numerals in this run are relative to. Stored as a pitch
  -- class rather than a name so it needs no spelling convention.
  detected_tonic smallint check (detected_tonic between 0 and 11),
  detected_mode text check (detected_mode in ('major', 'minor')),
  key_confidence numeric(4,3) check (key_confidence between 0 and 1),

  -- Which stretch of the track this run actually heard. A live capture only
  -- covers what the listener sat through, so a run is evidence about a
  -- window, not about the whole song.
  covered_from_ms integer not null default 0 check (covered_from_ms >= 0),
  covered_to_ms integer not null check (covered_to_ms > covered_from_ms),

  status text not null default 'pending'
    check (status in ('pending', 'promoted', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,

  -- Lets a client retry an ingest that may or may not have landed without
  -- creating a duplicate run.
  idempotency_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- The sections one run found, with its own chords.
-- ------------------------------------------------------------
create table if not exists public.detection_run_sections (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.detection_runs(id) on delete cascade,

  label text not null check (label in
    ('intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'outro', 'breakdown', 'drop')),
  -- "Verse 1" vs "Verse 2": which occurrence of this label it is, in playing
  -- order. This is the stanza ordering, and it is derived from start_ms
  -- rather than detected.
  ordinal smallint not null default 1 check (ordinal >= 1),

  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),

  -- The section's own loop, reduced to one cycle: a verse playing I-V-vi-IV
  -- four times is a four-chord loop, not sixteen chords.
  progression_roman text[] not null default '{}',
  loop_length_bars smallint check (loop_length_bars > 0),
  confidence numeric(4,3) check (confidence between 0 and 1),

  created_at timestamptz not null default now(),

  -- One section can start at a given moment within a run. Makes re-ingesting
  -- the same payload idempotent rather than duplicating everything.
  unique (run_id, start_ms)
);

-- ------------------------------------------------------------
-- Every chord heard, with the time it was held for.
--
-- This is the table that did not exist in any form: `roman_progression` on
-- harmonic_fingerprints is a bare array of numerals with no timing at all,
-- so "the correct time of each chord" had nowhere to live.
-- ------------------------------------------------------------
create table if not exists public.detection_run_chords (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.detection_runs(id) on delete cascade,
  -- Null for a chord heard before section detection had enough audio to
  -- place it: still real, just not yet attributable to a section.
  section_id uuid references public.detection_run_sections(id) on delete cascade,

  -- Relative form, which is what the app reasons in.
  numeral text not null,
  -- ...and the absolute chord it was heard as. Kept alongside deliberately:
  -- the key estimate is the least certain step in the pipeline, and holding
  -- the raw pitch means every numeral can be recomputed if the key is later
  -- corrected, without re-listening to the song.
  root_pitch_class smallint not null check (root_pitch_class between 0 and 11),
  quality text not null check (quality in ('major', 'minor')),

  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  confidence numeric(4,3) check (confidence between 0 and 1),

  created_at timestamptz not null default now(),

  unique (run_id, start_ms)
);

-- ------------------------------------------------------------
-- Canonical sections gain what a promoted run can give them.
-- ------------------------------------------------------------
alter table public.track_sections
  add column if not exists ordinal smallint not null default 1,
  add column if not exists progression_roman text[] not null default '{}',
  add column if not exists chord_timings integer[] not null default '{}',
  add column if not exists confidence numeric(4,3),
  add column if not exists source_run_id uuid references public.detection_runs(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- ADD CONSTRAINT has no IF NOT EXISTS form, so guard it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'track_sections_ordinal_positive'
      and conrelid = 'public.track_sections'::regclass
  ) then
    alter table public.track_sections
      add constraint track_sections_ordinal_positive check (ordinal >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'track_sections_confidence_range'
      and conrelid = 'public.track_sections'::regclass
  ) then
    alter table public.track_sections
      add constraint track_sections_confidence_range
      check (confidence is null or (confidence >= 0 and confidence <= 1));
  end if;

  -- chord_timings is only meaningful when it lines up one-for-one with the
  -- progression - useSectionSync silently falls back to guessing from a
  -- default BPM when the lengths disagree, which is exactly the drift this
  -- whole feature exists to remove.
  if not exists (
    select 1 from pg_constraint
    where conname = 'track_sections_timings_match_progression'
      and conrelid = 'public.track_sections'::regclass
  ) then
    alter table public.track_sections
      add constraint track_sections_timings_match_progression
      check (
        cardinality(chord_timings) = 0
        or cardinality(chord_timings) = cardinality(progression_roman)
      );
  end if;
end $$;

-- ------------------------------------------------------------
-- Indexes. Postgres does not index foreign keys on its own, and every one of
-- these columns is either joined on, filtered on, or read by an RLS policy.
-- ------------------------------------------------------------
-- user_id is read by the RLS policy on every select, and is the foreign key
-- a cascade would have to scan without it.
create index if not exists idx_detection_runs_user on public.detection_runs(user_id);
create index if not exists idx_detection_runs_reviewed_by on public.detection_runs(reviewed_by);
-- Equality column first, ordered column last: the review queue is "pending
-- runs, newest first".
create index if not exists idx_detection_runs_status_created
  on public.detection_runs(status, created_at desc);
-- Covers lookups by track alone as well, by the leftmost-prefix rule, so no
-- separate index on track_id is needed.
create index if not exists idx_detection_runs_track_status
  on public.detection_runs(track_id, status);
create unique index if not exists idx_detection_runs_idempotency
  on public.detection_runs(idempotency_key) where idempotency_key is not null;

-- No index on detection_run_sections(run_id, ...) or
-- detection_run_chords(run_id, ...): the `unique (run_id, start_ms)`
-- constraints on both tables already create exactly that index, and a second
-- copy would cost write throughput and space for nothing.
create index if not exists idx_detection_run_chords_section
  on public.detection_run_chords(section_id);

create index if not exists idx_track_sections_source_run
  on public.track_sections(source_run_id) where source_run_id is not null;

-- ------------------------------------------------------------
-- Keep updated_at honest.
-- ------------------------------------------------------------
drop trigger if exists trg_detection_runs_updated_at on public.detection_runs;
create trigger trg_detection_runs_updated_at
before update on public.detection_runs
for each row execute function public.set_updated_at();

drop trigger if exists trg_track_sections_updated_at on public.track_sections;
create trigger trg_track_sections_updated_at
before update on public.track_sections
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- RLS.
--
-- No client writes anywhere: ingest and promotion both run server-side with
-- the service role, which bypasses these policies entirely. What the policies
-- govern is reading - a contributor can see their own captures, an admin can
-- see all of them to review.
--
-- auth.uid() and has_role() are wrapped in a scalar subquery so Postgres
-- evaluates them once per statement instead of once per row.
-- ------------------------------------------------------------
alter table public.detection_runs enable row level security;
alter table public.detection_run_sections enable row level security;
alter table public.detection_run_chords enable row level security;

drop policy if exists "read own detection runs" on public.detection_runs;
create policy "read own detection runs"
on public.detection_runs
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.has_role((select auth.uid()), 'admin'::app_role))
);

drop policy if exists "no client writes to detection runs" on public.detection_runs;
create policy "no client writes to detection runs"
on public.detection_runs
for all
to authenticated, anon
using (false)
with check (false);

drop policy if exists "read own run sections" on public.detection_run_sections;
create policy "read own run sections"
on public.detection_run_sections
for select
to authenticated
using (
  exists (
    select 1 from public.detection_runs r
    where r.id = detection_run_sections.run_id
      and (
        r.user_id = (select auth.uid())
        or (select public.has_role((select auth.uid()), 'admin'::app_role))
      )
  )
);

drop policy if exists "no client writes to run sections" on public.detection_run_sections;
create policy "no client writes to run sections"
on public.detection_run_sections
for all
to authenticated, anon
using (false)
with check (false);

drop policy if exists "read own run chords" on public.detection_run_chords;
create policy "read own run chords"
on public.detection_run_chords
for select
to authenticated
using (
  exists (
    select 1 from public.detection_runs r
    where r.id = detection_run_chords.run_id
      and (
        r.user_id = (select auth.uid())
        or (select public.has_role((select auth.uid()), 'admin'::app_role))
      )
  )
);

drop policy if exists "no client writes to run chords" on public.detection_run_chords;
create policy "no client writes to run chords"
on public.detection_run_chords
for all
to authenticated, anon
using (false)
with check (false);

-- ------------------------------------------------------------
-- Reading a run back.
--
-- The client needs one round trip to show "here is what your capture found",
-- not three. SECURITY INVOKER on purpose: this must stay subject to the RLS
-- policies above rather than quietly handing any caller any run.
-- ------------------------------------------------------------
create or replace function public.get_detection_run(p_run_id uuid)
returns table (
  section_id uuid,
  label text,
  ordinal smallint,
  start_ms integer,
  end_ms integer,
  progression_roman text[],
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
    s.progression_roman,
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

-- ------------------------------------------------------------
-- The canonical read path has to be able to see the new columns, or nothing
-- promoted into them would ever reach the app.
--
-- `progression_roman` is exposed to clients as `chords` on purpose: the
-- column keeps the name every other table uses (tracks.progression_roman),
-- while the RPC keeps the name the TypeScript TrackSection type already
-- reads. The client casts this result straight to that type, so the alias is
-- what joins the two halves.
--
-- CREATE OR REPLACE cannot change a function's return type, so this drops
-- first. Doing so is safe here because the function is only ever called by
-- name from the client.
-- ------------------------------------------------------------
drop function if exists public.get_track_sections(uuid);

create function public.get_track_sections(p_track_id uuid)
returns table (
  id uuid,
  track_id uuid,
  label text,
  ordinal smallint,
  start_ms integer,
  end_ms integer,
  chords text[],
  chord_timings integer[],
  confidence numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.track_id,
    s.label,
    s.ordinal,
    s.start_ms,
    s.end_ms,
    s.progression_roman,
    s.chord_timings,
    s.confidence,
    s.created_at
  from public.track_sections s
  where s.track_id = p_track_id
  order by s.start_ms asc;
$$;

comment on function public.get_track_sections is
  'Canonical sections for a track, ordered by start time. progression_roman is returned as "chords" to match the client type.';

comment on table public.detection_runs is
  'One live-capture analysis of one track. Raw evidence, never edited; track_sections holds the canonical answer promoted from these.';
comment on table public.detection_run_sections is
  'Sections found by a single detection run, each with its own chord loop.';
comment on table public.detection_run_chords is
  'Every chord heard in a run, with the milliseconds it was held for. The per-chord timing that makes BPM unnecessary for sync.';
comment on column public.detection_run_chords.root_pitch_class is
  'Absolute root kept alongside the numeral so numerals can be recomputed if the key estimate is corrected.';
comment on column public.track_sections.ordinal is
  'Which occurrence of this label the section is, in playing order - the "Verse 1 / Verse 2" number.';

commit;

-- ============================================================
-- Sanity check. Run this after the commit above; it reads nothing but
-- catalog metadata and changes nothing.
-- ============================================================
-- select table_name, count(*) as columns
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in ('detection_runs', 'detection_run_sections', 'detection_run_chords')
-- group by table_name;
--
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'track_sections'
-- order by ordinal_position;
