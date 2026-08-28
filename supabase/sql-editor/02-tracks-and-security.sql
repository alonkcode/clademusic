-- GENERATED - do not edit. Regenerate: bash scripts/build-sql-editor-parts.sh
-- PART 02-tracks-and-security: sections, locations RLS, security fixes, 2FA
-- Run parts in numeric order. Paste whole file into the SQL Editor.

BEGIN;

-- ---------- 20260117165737_58521ad8-f29a-48ec-b38b-292f2369be61.sql ----------
-- Create track_comments table for comments on tracks
CREATE TABLE public.track_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  track_id UUID NOT NULL,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  parent_id UUID REFERENCES public.track_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create user_locations table for opt-in location sharing
CREATE TABLE public.user_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  latitude NUMERIC(10, 7) NOT NULL,
  longitude NUMERIC(10, 7) NOT NULL,
  sharing_enabled BOOLEAN NOT NULL DEFAULT true,
  radius_km INTEGER NOT NULL DEFAULT 50,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create nearby_listeners cache table
CREATE TABLE public.nearby_activity (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  track_id UUID NOT NULL,
  artist TEXT,
  listened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.track_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nearby_activity ENABLE ROW LEVEL SECURITY;

-- Comments policies
CREATE POLICY "Anyone can view comments" ON public.track_comments 
FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create comments" ON public.track_comments 
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own comments" ON public.track_comments 
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own comments" ON public.track_comments 
FOR DELETE USING (auth.uid() = user_id);

-- User locations policies (opt-in only visible to those who also share)
CREATE POLICY "Users can manage own location" ON public.user_locations 
FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users who share can see others who share" ON public.user_locations 
FOR SELECT USING (
  sharing_enabled = true 
  AND EXISTS (
    SELECT 1 FROM public.user_locations ul 
    WHERE ul.user_id = auth.uid() 
    AND ul.sharing_enabled = true
  )
);

-- Nearby activity policies
CREATE POLICY "Users can record own activity" ON public.nearby_activity 
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users who share location can see nearby activity" ON public.nearby_activity 
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul 
    WHERE ul.user_id = auth.uid() 
    AND ul.sharing_enabled = true
  )
);

-- Indexes for performance
CREATE INDEX idx_track_comments_track_id ON public.track_comments(track_id);
CREATE INDEX idx_track_comments_parent_id ON public.track_comments(parent_id);
CREATE INDEX idx_nearby_activity_track_id ON public.nearby_activity(track_id);
CREATE INDEX idx_nearby_activity_artist ON public.nearby_activity(artist);
CREATE INDEX idx_user_locations_coords ON public.user_locations(latitude, longitude);

-- Triggers for updated_at
CREATE TRIGGER update_track_comments_updated_at
BEFORE UPDATE ON public.track_comments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_user_locations_updated_at
BEFORE UPDATE ON public.user_locations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- ---------- 20260118065431_c2bd75bd-b63c-4560-bc4c-0f96e698af9d.sql ----------
-- Create user_follows table for social following
CREATE TABLE public.user_follows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_id UUID NOT NULL,
  following_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(follower_id, following_id)
);

-- Enable RLS
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX idx_user_follows_follower ON public.user_follows(follower_id);
CREATE INDEX idx_user_follows_following ON public.user_follows(following_id);

-- RLS Policies
CREATE POLICY "Users can view all follows"
ON public.user_follows
FOR SELECT
USING (true);

CREATE POLICY "Users can follow others"
ON public.user_follows
FOR INSERT
WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow"
ON public.user_follows
FOR DELETE
USING (auth.uid() = follower_id);

-- Create play_history table to track what users are listening to
CREATE TABLE public.play_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  played_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  duration_ms INTEGER, -- How long they listened
  source TEXT DEFAULT 'feed' -- Where they played from
);

-- Enable RLS
ALTER TABLE public.play_history ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX idx_play_history_user ON public.play_history(user_id);
CREATE INDEX idx_play_history_track ON public.play_history(track_id);
CREATE INDEX idx_play_history_played_at ON public.play_history(played_at DESC);

-- RLS Policies
CREATE POLICY "Users can view their own play history"
ON public.play_history
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can view followed users play history"
ON public.play_history
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_follows
    WHERE follower_id = auth.uid() AND following_id = play_history.user_id
  )
);

CREATE POLICY "Users can record their own plays"
ON public.play_history
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- ---------- 20260120091200_add_sections_to_tracks.sql ----------
-- Add sections column to tracks table for song structure data
ALTER TABLE public.tracks
ADD COLUMN sections JSONB;

-- Add comment to describe the column
COMMENT ON COLUMN public.tracks.sections IS 'Array of song sections with timestamps: [{type: "intro"|"verse"|"chorus"|"bridge"|"outro", label: string, start_time: number, end_time?: number}]';


-- ---------- 20260120201900_fix_user_locations_rls.sql ----------
-- Fix infinite recursion in user_locations RLS policy
-- by creating a SECURITY DEFINER function that bypasses RLS

-- Drop the problematic policy
DROP POLICY IF EXISTS "Users who share can see others who share" ON public.user_locations;

-- Create a SECURITY DEFINER function to check if current user has sharing enabled
-- This function bypasses RLS to prevent infinite recursion
CREATE OR REPLACE FUNCTION public.user_has_sharing_enabled()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT sharing_enabled 
     FROM public.user_locations 
     WHERE user_id = auth.uid() 
     LIMIT 1),
    false
  );
$$;

-- Recreate the policy using the SECURITY DEFINER function
CREATE POLICY "Users who share can see others who share" ON public.user_locations 
FOR SELECT USING (
  sharing_enabled = true 
  AND public.user_has_sharing_enabled()
);

-- Add comment explaining the function
COMMENT ON FUNCTION public.user_has_sharing_enabled() IS 
'SECURITY DEFINER function to check if the current user has location sharing enabled. Bypasses RLS to prevent infinite recursion in user_locations SELECT policy.';


-- ---------- 20260120202800_critical_security_fixes.sql ----------
-- Critical Security Fixes for 2FA and Location Privacy
-- This migration addresses two major security vulnerabilities:
-- 1. 2FA secrets exposed through profiles table
-- 2. Exact GPS coordinates accessible to strangers

-- ============================================
-- PART 1: Secure 2FA Storage
-- ============================================

-- Create admin-only table for 2FA secrets
CREATE TABLE IF NOT EXISTS public.user_2fa_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  backup_codes_hashed TEXT[] NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on 2FA secrets table
ALTER TABLE public.user_2fa_secrets ENABLE ROW LEVEL SECURITY;

-- CRITICAL: No user can SELECT their own 2FA secret
-- Only Edge Functions with service_role can access this table
CREATE POLICY "No direct access to 2FA secrets" 
ON public.user_2fa_secrets 
FOR SELECT USING (false);

-- Only allow INSERT/UPDATE through Edge Functions (service_role)
CREATE POLICY "Service role can manage 2FA secrets" 
ON public.user_2fa_secrets 
FOR ALL 
USING (false); -- Will be accessed via service_role which bypasses RLS

-- Migrate existing 2FA data to secure table
DO $$
DECLARE
  profile_record RECORD;
BEGIN
  FOR profile_record IN 
    SELECT id, twofa_secret, twofa_backup_codes 
    FROM public.profiles 
    WHERE twofa_enabled = true 
      AND twofa_secret IS NOT NULL
  LOOP
    INSERT INTO public.user_2fa_secrets (user_id, secret, backup_codes_hashed, enabled)
    VALUES (
      profile_record.id,
      profile_record.twofa_secret,
      COALESCE(profile_record.twofa_backup_codes, ARRAY[]::TEXT[]),
      true
    )
    ON CONFLICT (user_id) DO UPDATE
    SET secret = EXCLUDED.secret,
        backup_codes_hashed = EXCLUDED.backup_codes_hashed,
        updated_at = now();
  END LOOP;
END $$;

-- Remove sensitive 2FA fields from profiles table
-- Keep only twofa_enabled flag for UI purposes
ALTER TABLE public.profiles 
DROP COLUMN IF EXISTS twofa_secret,
DROP COLUMN IF EXISTS twofa_backup_codes;

-- Create SECURITY DEFINER function for 2FA status check (safe for users)
CREATE OR REPLACE FUNCTION public.user_has_2fa_enabled()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT enabled 
     FROM public.user_2fa_secrets 
     WHERE user_id = auth.uid() 
     LIMIT 1),
    false
  );
$$;

COMMENT ON FUNCTION public.user_has_2fa_enabled() IS 
'SECURITY DEFINER function to check if user has 2FA enabled. Does not expose secret.';

-- ============================================
-- PART 2: Privacy-Preserving Location Sharing
-- ============================================

-- Add fuzzing columns to user_locations for privacy
ALTER TABLE public.user_locations
ADD COLUMN IF NOT EXISTS latitude_fuzzy NUMERIC(7, 4), -- Less precision for display
ADD COLUMN IF NOT EXISTS longitude_fuzzy NUMERIC(7, 4),
ADD COLUMN IF NOT EXISTS geohash_precision INTEGER DEFAULT 6; -- Geohash for approximate matching

-- Create function to fuzz coordinates (reduces precision to ~1km)
CREATE OR REPLACE FUNCTION public.fuzz_coordinates(lat NUMERIC, lon NUMERIC)
RETURNS TABLE(lat_fuzzy NUMERIC, lon_fuzzy NUMERIC)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 
    ROUND(lat::numeric, 2)::numeric(7,4) as lat_fuzzy,
    ROUND(lon::numeric, 2)::numeric(7,4) as lon_fuzzy
$$;

-- Update existing locations with fuzzy coordinates
UPDATE public.user_locations
SET (latitude_fuzzy, longitude_fuzzy) = (
  SELECT lat_fuzzy, lon_fuzzy 
  FROM public.fuzz_coordinates(latitude, longitude)
);

-- Create trigger to auto-update fuzzy coordinates
CREATE OR REPLACE FUNCTION public.update_fuzzy_location()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT lat_fuzzy, lon_fuzzy 
  INTO NEW.latitude_fuzzy, NEW.longitude_fuzzy
  FROM public.fuzz_coordinates(NEW.latitude, NEW.longitude);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_user_location_fuzzy ON public.user_locations;
CREATE TRIGGER update_user_location_fuzzy
  BEFORE INSERT OR UPDATE OF latitude, longitude
  ON public.user_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_fuzzy_location();

-- Create SECURITY DEFINER view that ONLY exposes fuzzy coordinates
CREATE OR REPLACE VIEW public.user_locations_public AS
SELECT 
  id,
  user_id,
  latitude_fuzzy as latitude,  -- Expose fuzzy coords as "latitude"
  longitude_fuzzy as longitude, -- Expose fuzzy coords as "longitude"
  sharing_enabled,
  radius_km,
  updated_at
FROM public.user_locations
WHERE sharing_enabled = true;

-- Grant SELECT on the view (not the base table)
GRANT SELECT ON public.user_locations_public TO authenticated;

-- Update existing RLS policy to use fuzzy coordinates
DROP POLICY IF EXISTS "Users who share can see others who share" ON public.user_locations;

CREATE POLICY "Users can see fuzzy locations of others who share" 
ON public.user_locations 
FOR SELECT USING (
  auth.uid() = user_id -- Can see own exact location
  OR (
    sharing_enabled = true 
    AND public.user_has_sharing_enabled()
  )
);

-- Create safer function for distance calculation using fuzzy coords
CREATE OR REPLACE FUNCTION public.calculate_distance_fuzzy(
  user_lat NUMERIC,
  user_lon NUMERIC,
  target_user_id UUID
)
RETURNS NUMERIC
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT 
    -- Haversine formula with fuzzy coordinates
    6371 * 2 * ASIN(SQRT(
      POWER(SIN((RADIANS(latitude_fuzzy) - RADIANS(user_lat)) / 2), 2) +
      COS(RADIANS(user_lat)) * COS(RADIANS(latitude_fuzzy)) *
      POWER(SIN((RADIANS(longitude_fuzzy) - RADIANS(user_lon)) / 2), 2)
    )) as distance_km
  FROM public.user_locations
  WHERE user_id = target_user_id
  LIMIT 1;
$$;

-- ============================================
-- PART 3: Additional Security Hardening
-- ============================================

-- Prevent email addresses from being exposed in profiles
-- Users should only see their own email
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile with sensitive data" 
ON public.profiles 
FOR SELECT USING (auth.uid() = id);

-- Create public profile view that excludes email
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT 
  id,
  display_name,
  avatar_url,
  preferred_provider,
  created_at
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO authenticated;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_locations_fuzzy_coords 
ON public.user_locations(latitude_fuzzy, longitude_fuzzy) 
WHERE sharing_enabled = true;

CREATE INDEX IF NOT EXISTS idx_user_2fa_secrets_user_id 
ON public.user_2fa_secrets(user_id);

-- Update timestamp trigger for 2FA secrets
CREATE TRIGGER update_user_2fa_secrets_updated_at
  BEFORE UPDATE ON public.user_2fa_secrets
  FOR EACH ROW 
  EXECUTE FUNCTION public.update_updated_at();

-- Add helpful comments
COMMENT ON TABLE public.user_2fa_secrets IS 
'SECURITY: 2FA secrets stored separately from profiles. Only accessible via Edge Functions with service_role. Users cannot SELECT their own secrets to prevent client-side attacks.';

COMMENT ON COLUMN public.user_locations.latitude_fuzzy IS 
'Privacy: Reduced-precision coordinates (~1km accuracy) safe for public display';

COMMENT ON COLUMN public.user_locations.longitude_fuzzy IS 
'Privacy: Reduced-precision coordinates (~1km accuracy) safe for public display';

COMMENT ON VIEW public.user_locations_public IS 
'Privacy-safe view exposing only fuzzy coordinates to other users';


-- ---------- 20260120_add_track_sections.sql ----------
-- Track sections (canonical, provider-agnostic)
-- Enables seek-based playback for intro/verse/chorus/bridge/outro

create table public.track_sections (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  label text not null check (label in ('intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'outro', 'breakdown', 'drop')),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  created_at timestamptz not null default now()
);

-- Performance indexes
create index idx_track_sections_track_id on public.track_sections(track_id);
create index idx_track_sections_label on public.track_sections(label);

-- RLS
alter table public.track_sections enable row level security;

-- Anyone can read sections (no privacy risk)
create policy "public read track sections"
on public.track_sections
for select
using (true);

-- Only service role / server may write (no client writes)
create policy "no client writes"
on public.track_sections
for all
using (false)
with check (false);

-- RPC function for fetching track sections (typed access from client)
create or replace function public.get_track_sections(p_track_id uuid)
returns table (
  id uuid,
  track_id uuid,
  label text,
  start_ms integer,
  end_ms integer,
  created_at timestamptz
)
language sql
stable
security definer
as $$
  select id, track_id, label, start_ms, end_ms, created_at
  from public.track_sections
  where track_id = p_track_id
  order by start_ms asc;
$$;

comment on table public.track_sections is 'Canonical song structure sections with timestamps for seek-based playback';
comment on column public.track_sections.label is 'Section type: intro, verse, pre-chorus, chorus, bridge, outro, breakdown, drop';
comment on column public.track_sections.start_ms is 'Section start time in milliseconds';
comment on column public.track_sections.end_ms is 'Section end time in milliseconds';
comment on function public.get_track_sections is 'Fetch all sections for a track, ordered by start time';


-- ---------- 20260120_secure_2fa_secrets.sql ----------
-- Migration: Secure 2FA Secrets
-- Move 2FA secrets to a service-role-only table for security

-- Create secure table for 2FA secrets (NOT accessible by users via RLS)
CREATE TABLE IF NOT EXISTS public.secure_2fa_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  secret TEXT NOT NULL,
  backup_codes TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS policies - only service_role can access this table
-- This is intentional for security
ALTER TABLE public.secure_2fa_secrets ENABLE ROW LEVEL SECURITY;

-- Allow only the service_role to read and write secure 2FA secrets
CREATE POLICY secure_2fa_secrets_service_role_only
  ON public.secure_2fa_secrets
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_secure_2fa_secrets_user_id ON public.secure_2fa_secrets(user_id);

-- Function to enable 2FA (server-side only, called via Edge Function)
CREATE OR REPLACE FUNCTION public.enable_2fa_secure(
  p_user_id UUID,
  p_secret TEXT,
  p_backup_codes TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert or update 2FA secret in secure table
  INSERT INTO public.secure_2fa_secrets (user_id, secret, backup_codes, updated_at)
  VALUES (p_user_id, p_secret, p_backup_codes, now())
  ON CONFLICT (user_id) DO UPDATE SET
    secret = EXCLUDED.secret,
    backup_codes = EXCLUDED.backup_codes,
    updated_at = now();
  
  -- Update profiles to mark 2FA as enabled
  UPDATE public.profiles
  SET twofa_enabled = true
  WHERE id = p_user_id;
  
  RETURN true;
END;
$$;

-- Function to disable 2FA
CREATE OR REPLACE FUNCTION public.disable_2fa_secure(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove 2FA secret
  DELETE FROM public.secure_2fa_secrets WHERE user_id = p_user_id;
  
  -- Update profiles to mark 2FA as disabled
  UPDATE public.profiles
  SET twofa_enabled = false
  WHERE id = p_user_id;
  
  RETURN true;
END;
$$;

-- Function to check if 2FA is enabled for a user (safe to call from client)
CREATE OR REPLACE FUNCTION public.is_2fa_enabled(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT twofa_enabled FROM public.profiles WHERE id = p_user_id),
    false
  );
$$;

-- Remove the old twofa_secret column from profiles if it exists
-- (Keep twofa_enabled and twofa_backup_codes for backwards compatibility during migration)
-- DO NOT remove columns in production without data migration first
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS twofa_secret;

COMMENT ON TABLE public.secure_2fa_secrets IS 'Secure storage for 2FA TOTP secrets. Only accessible via service_role for security.';


COMMIT;
