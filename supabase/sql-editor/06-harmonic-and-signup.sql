-- GENERATED - slice of supabase/schema_bundle.sql. Do not edit.
-- PART 6/6: harmonic-and-signup
-- Run parts 01..06 IN ORDER in the Supabase SQL Editor.

BEGIN;

-- ============================================================
-- 202601240001_test_runs.sql

-- ============================================================
-- Create test_runs table for logging CI and automated test suite results
create table if not exists public.test_runs (
  id uuid primary key default gen_random_uuid(),
  suite text not null check (suite in ('sanity','pentest','performance')),
  status text not null check (status in ('passed','failed','running','cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  commit_sha text,
  branch text,
  run_id text,
  artifacts_url text,
  summary_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists test_runs_suite_started_idx on public.test_runs (suite, started_at desc);
create index if not exists test_runs_status_started_idx on public.test_runs (status, started_at desc);
create index if not exists test_runs_run_id_suite_idx on public.test_runs (run_id, suite);

-- Trigger to maintain updated_at
create or replace function public.set_test_runs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger set_test_runs_updated_at
before update on public.test_runs
for each row execute procedure public.set_test_runs_updated_at();

-- Ensure admin role for seeded admin user
insert into public.user_roles (user_id, role)
select u.id, 'admin'::public.app_role
from auth.users u
where u.email = 'repoisrael@gmail.com'
  and not exists (
    select 1 from public.user_roles ur where ur.user_id = u.id and ur.role = 'admin'
  );

-- RPC to return latest test run per suite
create or replace function public.latest_test_runs()
returns table (
  suite text,
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  commit_sha text,
  branch text,
  run_id text,
  artifacts_url text,
  summary_json jsonb
) language sql stable as $$
  select distinct on (suite)
    suite,
    status,
    started_at,
    finished_at,
    duration_ms,
    commit_sha,
    branch,
    run_id,
    artifacts_url,
    summary_json
  from public.test_runs
  order by suite, started_at desc;
$$;



-- ============================================================
-- 20260124_billing_core.sql

-- ============================================================
-- Billing & Subscriptions core schema (Stripe)
-- Creates subscriptions, credits, billing_events

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'trialing',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON public.subscriptions(plan);

-- Credits table
CREATE TABLE IF NOT EXISTS public.credits (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Billing events log (idempotency + audit)
CREATE TABLE IF NOT EXISTS public.billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider_event_id TEXT UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_user ON public.billing_events(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_type ON public.billing_events(type);
CREATE INDEX IF NOT EXISTS idx_billing_events_created ON public.billing_events(created_at DESC);

-- RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- Users can see their own subscription/credits
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own credits" ON public.credits
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage subscriptions" ON public.subscriptions
  USING (auth.role() = 'service_role') WITH CHECK (true);

CREATE POLICY "Service role can manage credits" ON public.credits
  USING (auth.role() = 'service_role') WITH CHECK (true);

CREATE POLICY "Service role can manage billing events" ON public.billing_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (true);

-- Utility: upsert credits
CREATE OR REPLACE FUNCTION public.set_credits(p_user_id UUID, p_balance INTEGER)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.credits (user_id, balance, updated_at)
  VALUES (p_user_id, p_balance, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = EXCLUDED.balance,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE public.subscriptions IS 'Stripe-backed subscription state per user';
COMMENT ON TABLE public.credits IS 'Credit balance per user, resets on renewal';
COMMENT ON TABLE public.billing_events IS 'Raw billing/provider events for audit/idempotency';



-- ============================================================
-- 20260125_harmonic_analysis_core.sql

-- ============================================================
-- Harmonic analysis core tables and indexes
-- Created 2026-01-25

-- Extension for uuid generation if not already present
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- Table: harmonic_fingerprints
create table if not exists public.harmonic_fingerprints (
  id uuid primary key default gen_random_uuid(),
  track_id text not null,
  isrc text,
  audio_hash text,
  tonal_center jsonb not null,
  roman_progression jsonb not null default '[]'::jsonb,
  loop_length_bars integer not null default 4 check (loop_length_bars > 0),
  cadence_type text not null,
  modal_color text,
  borrowed_chords jsonb,
  section_progressions jsonb,
  confidence_score numeric not null check (confidence_score >= 0 and confidence_score <= 1),
  analysis_timestamp timestamptz not null default now(),
  analysis_version text not null,
  is_provisional boolean not null default true,
  detected_key text,
  detected_mode text,
  reuse_until timestamptz not null default (now() + interval '90 days'),
  reanalyze_after timestamptz not null default (now() + interval '365 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uniqueness and idempotency
create unique index if not exists idx_hf_track_id on public.harmonic_fingerprints(track_id);
create unique index if not exists idx_hf_audio_hash on public.harmonic_fingerprints(audio_hash) where audio_hash is not null;
create unique index if not exists idx_hf_isrc on public.harmonic_fingerprints(isrc) where isrc is not null;

-- Lookup and filtering indexes
create index if not exists idx_hf_roman_progression on public.harmonic_fingerprints using gin (roman_progression jsonb_path_ops);
create index if not exists idx_hf_cadence_type on public.harmonic_fingerprints(cadence_type);
create index if not exists idx_hf_loop_length_bars on public.harmonic_fingerprints(loop_length_bars);
create index if not exists idx_hf_confidence_score on public.harmonic_fingerprints(confidence_score);
create index if not exists idx_hf_reuse_until on public.harmonic_fingerprints(reuse_until);
create index if not exists idx_hf_reanalyze_after on public.harmonic_fingerprints(reanalyze_after);

-- Table: analysis_jobs
create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  track_id text not null,
  isrc text,
  audio_hash text,
  status text not null check (status in ('queued','processing','completed','failed','cached')),
  progress numeric not null default 0 check (progress >= 0 and progress <= 1),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  analysis_version text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_aj_track_status on public.analysis_jobs(track_id, status);
create index if not exists idx_aj_started_at on public.analysis_jobs(started_at desc);
create index if not exists idx_aj_audio_hash on public.analysis_jobs(audio_hash) where audio_hash is not null;
create index if not exists idx_aj_isrc on public.analysis_jobs(isrc) where isrc is not null;

-- Disable RLS for now (can be enabled with policies later)
alter table public.harmonic_fingerprints disable row level security;
alter table public.analysis_jobs disable row level security;

-- Update timestamp trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_hf_updated_at on public.harmonic_fingerprints;
create or replace trigger trg_hf_updated_at
before update on public.harmonic_fingerprints
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_aj_updated_at on public.analysis_jobs;
create or replace trigger trg_aj_updated_at
before update on public.analysis_jobs
for each row execute procedure public.set_updated_at();



-- ============================================================
-- bundle-fixes/10-harmonic-retention.sql

-- ============================================================
-- Replacement for the two generated columns on harmonic_fingerprints.
--
-- The migration declared:
--   reuse_until     timestamptz GENERATED ALWAYS AS (analysis_timestamp + interval '90 days')  STORED
--   reanalyze_after timestamptz GENERATED ALWAYS AS (analysis_timestamp + interval '365 days') STORED
--
-- Postgres rejects both with:
--   ERROR: 42P17: generation expression is not immutable
--
-- `timestamptz + interval` is STABLE, not IMMUTABLE: adding an interval has to
-- resolve against the session TimeZone setting (it is what makes DST arithmetic
-- correct), and a STORED generated column may only use immutable expressions.
--
-- The build script rewrites those two lines into plain columns with defaults;
-- this trigger keeps them correct when analysis_timestamp is set or changed,
-- which is the behaviour the generated columns were meant to provide.

CREATE OR REPLACE FUNCTION public.set_harmonic_retention()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.reuse_until     := COALESCE(NEW.analysis_timestamp, now()) + interval '90 days';
  NEW.reanalyze_after := COALESCE(NEW.analysis_timestamp, now()) + interval '365 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hf_retention ON public.harmonic_fingerprints;
CREATE TRIGGER trg_hf_retention
  BEFORE INSERT OR UPDATE OF analysis_timestamp ON public.harmonic_fingerprints
  FOR EACH ROW EXECUTE FUNCTION public.set_harmonic_retention();



-- ============================================================
-- 20260204130000_playback_telemetry.sql

-- ============================================================
-- Playback telemetry (controller-layer analytics)
-- Created 2026-02-04
--
-- Purpose:
-- - Count playback intents/sessions without rehosting audio
-- - Support provider-first playback where canonical track id may not be a DB UUID
-- - Avoid FK constraints to `tracks` for external provider-only playback
--
-- IMPORTANT:
-- - These are internal analytics events, not provider royalty "streams".

create extension if not exists "pgcrypto";

create table if not exists public.playback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  anonymous_id text,
  session_id uuid not null,
  event_type text not null check (event_type in ('intent','state','qualified_play','link_out','error')),
  provider text not null,
  provider_track_id text,
  canonical_track_key text, -- e.g. UUID or 'spotify:<id>' / 'youtube:<id>'
  isrc text,
  position_ms integer,
  duration_ms integer,
  played_ms integer,
  context text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_playback_events_user_time on public.playback_events(user_id, created_at desc);
create index if not exists idx_playback_events_anon_time on public.playback_events(anonymous_id, created_at desc) where anonymous_id is not null;
create index if not exists idx_playback_events_session on public.playback_events(session_id, created_at asc);
create index if not exists idx_playback_events_provider on public.playback_events(provider, created_at desc);
create index if not exists idx_playback_events_isrc on public.playback_events(isrc) where isrc is not null;
create index if not exists idx_playback_events_canonical on public.playback_events(canonical_track_key) where canonical_track_key is not null;

alter table public.playback_events enable row level security;

-- Users can read their own events (authenticated only).
create policy "Users can view own playback events"
  on public.playback_events
  for select
  using (auth.uid() = user_id);

-- Users can insert their own events OR anonymous (guest) events.
create policy "Users can insert playback events"
  on public.playback_events
  for insert
  with check (auth.uid() = user_id or user_id is null);

comment on table public.playback_events is 'Controller-layer playback analytics (intents, sessions, qualified plays). Not a royalty settlement source.';




-- ============================================================
-- 20260828120000_harden_signup_trigger.sql

-- ============================================================
-- Harden the signup trigger.
--
-- Problem: public.handle_new_user() runs AFTER INSERT ON auth.users and does
-- three unguarded INSERTs. Because the trigger runs inside the same transaction
-- as the auth.users insert, ANY failure in it (a duplicate row, a missing
-- table, an RLS/permission surprise) rolls back the whole statement. GoTrue
-- then reports the opaque "Database error saving new user" and registration is
-- dead in the water with nothing useful in the client.
--
-- Fix, in two parts:
--   1. Make every insert idempotent (ON CONFLICT DO NOTHING), so a retried or
--      partially-applied signup cannot collide with itself.
--   2. Catch any remaining exception and log a warning instead of propagating.
--      Creating the account is the critical path; provisioning the profile rows
--      is recoverable and must never be able to block it.
--
-- COALESCE on display_name also guards the case where email is NULL (phone or
-- OAuth signups), which would otherwise yield a NULL display name.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(
        NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
        NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
        'listener'
      )
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: could not create profile for %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: could not assign role for %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    INSERT INTO public.user_credits (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: could not create credits for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Recreate the trigger idempotently so this migration is safe to re-run.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill anything the old, fragile trigger dropped on the floor.
INSERT INTO public.profiles (id, email, display_name)
SELECT
  u.id,
  u.email,
  COALESCE(
    NULLIF(u.raw_user_meta_data->>'display_name', ''),
    NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
    'listener'
  )
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'user'
FROM auth.users u
LEFT JOIN public.user_roles r ON r.user_id = u.id
WHERE r.user_id IS NULL
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_credits (user_id)
SELECT u.id
FROM auth.users u
LEFT JOIN public.user_credits c ON c.user_id = u.id
WHERE c.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;



COMMIT;
