-- GENERATED - slice of supabase/schema_bundle.sql. Do not edit.
-- PART 1/6: core-schema
-- Run parts 01..06 IN ORDER in the Supabase SQL Editor.

BEGIN;
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/*.sql (dependency order, not filename order)
-- Regenerate: bash scripts/build-schema-bundle.sh
-- Verify:     bash scripts/test-schema-bundle.sh
--
-- Apply to a FRESH project via the Supabase SQL Editor.
-- Wrapped in a transaction: it either fully applies or fully rolls back.




-- ============================================================
-- 20260114211348_2a4485e7-9d33-4c9d-9ea8-0420e1ad4044.sql

-- ============================================================
-- Create app roles enum
CREATE TYPE public.app_role AS ENUM ('user', 'admin', 'moderator');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Create providers table for connected music services
CREATE TABLE public.user_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('spotify', 'youtube', 'apple_music')),
  provider_user_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- Create tracks table with harmonic fingerprints
CREATE TABLE public.tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('spotify', 'youtube', 'apple_music')),
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  cover_url TEXT,
  preview_url TEXT,
  duration_ms INTEGER,
  detected_key TEXT,
  detected_mode TEXT CHECK (detected_mode IN ('major', 'minor', 'unknown')),
  progression_raw TEXT[],
  progression_roman TEXT[],
  loop_length_bars INTEGER,
  cadence_type TEXT CHECK (cadence_type IN ('none', 'loop', 'plagal', 'authentic', 'deceptive', 'other')),
  confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  analysis_source TEXT CHECK (analysis_source IN ('metadata', 'crowd', 'analysis')),
  energy DECIMAL(3,2),
  danceability DECIMAL(3,2),
  valence DECIMAL(3,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_id, provider)
);

-- Create user interactions table
CREATE TABLE public.user_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  track_id UUID REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('like', 'save', 'skip', 'more_harmonic', 'more_vibe', 'share')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, track_id, interaction_type)
);

-- Create user credits table
CREATE TABLE public.user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  monthly_allowance INTEGER NOT NULL DEFAULT 100,
  credits_used INTEGER NOT NULL DEFAULT 0,
  last_reset TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create crowd submissions table for chord corrections
CREATE TABLE public.chord_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  detected_key TEXT,
  detected_mode TEXT CHECK (detected_mode IN ('major', 'minor')),
  progression_roman TEXT[],
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  moderated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create system settings table for admin budget controls
CREATE TABLE public.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default system settings
INSERT INTO public.system_settings (key, value) VALUES
  ('max_analyses_per_day', '{"limit": 1000, "current": 0}'::jsonb),
  ('max_comparisons_per_day', '{"limit": 500, "current": 0}'::jsonb),
  ('global_rate_limit', '{"requests_per_minute": 60}'::jsonb);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chord_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Helper function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- User roles policies
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- User providers policies
CREATE POLICY "Users can view own providers" ON public.user_providers
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own providers" ON public.user_providers
  FOR ALL USING (auth.uid() = user_id);

-- Tracks policies (public read, admin write)
CREATE POLICY "Anyone can view tracks" ON public.tracks
  FOR SELECT USING (true);
CREATE POLICY "Admins can manage tracks" ON public.tracks
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can insert tracks" ON public.tracks
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- User interactions policies
CREATE POLICY "Users can view own interactions" ON public.user_interactions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own interactions" ON public.user_interactions
  FOR ALL USING (auth.uid() = user_id);

-- User credits policies
CREATE POLICY "Users can view own credits" ON public.user_credits
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can manage credits" ON public.user_credits
  FOR ALL USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Chord submissions policies
CREATE POLICY "Users can view submissions" ON public.chord_submissions
  FOR SELECT USING (true);
CREATE POLICY "Users can create submissions" ON public.chord_submissions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Moderators can manage submissions" ON public.chord_submissions
  FOR UPDATE USING (public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin'));

-- System settings policies (admin only)
CREATE POLICY "Admins can view settings" ON public.system_settings
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage settings" ON public.system_settings
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Trigger for profile creation on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  INSERT INTO public.user_credits (user_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function for timestamp updates
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER update_tracks_updated_at
  BEFORE UPDATE ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- ============================================================
-- 20260114211408_1be47900-6c38-4adb-b34e-5dfe41a998e4.sql

-- ============================================================
-- Fix function search path for update_updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ============================================================
-- 20260115085704_58686868-f4a3-4d8f-9b0b-766b1d0430fc.sql

-- ============================================================
-- Extend tracks table with provider link columns and ISRC
ALTER TABLE public.tracks 
ADD COLUMN IF NOT EXISTS isrc text,
ADD COLUMN IF NOT EXISTS url_spotify_web text,
ADD COLUMN IF NOT EXISTS url_spotify_app text,
ADD COLUMN IF NOT EXISTS spotify_id text,
ADD COLUMN IF NOT EXISTS url_youtube text,
ADD COLUMN IF NOT EXISTS youtube_id text;

-- Create index on ISRC for deduplication
CREATE INDEX IF NOT EXISTS idx_tracks_isrc ON public.tracks(isrc) WHERE isrc IS NOT NULL;

-- Add 2FA fields to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS twofa_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS twofa_secret text,
ADD COLUMN IF NOT EXISTS twofa_backup_codes text[],
ADD COLUMN IF NOT EXISTS preferred_provider text DEFAULT 'none';

-- Create search cache table
CREATE TABLE IF NOT EXISTS public.search_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  market text,
  results jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_search_cache_query ON public.search_cache(query);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON public.search_cache(expires_at);

-- Enable RLS on search_cache
ALTER TABLE public.search_cache ENABLE ROW LEVEL SECURITY;

-- Anyone can read cache (public feature)
CREATE POLICY "Anyone can read search cache"
ON public.search_cache
FOR SELECT
USING (true);

-- Only authenticated users can write to cache
CREATE POLICY "Authenticated users can insert cache"
ON public.search_cache
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Create feed_items table for home feed ordering
CREATE TABLE IF NOT EXISTS public.feed_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
  source text NOT NULL DEFAULT 'seed',
  rank integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_items_rank ON public.feed_items(rank);

-- Enable RLS on feed_items
ALTER TABLE public.feed_items ENABLE ROW LEVEL SECURITY;

-- Anyone can view feed items
CREATE POLICY "Anyone can view feed items"
ON public.feed_items
FOR SELECT
USING (true);

-- Only admins can manage feed items
CREATE POLICY "Admins can manage feed items"
ON public.feed_items
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create user_provider_preferences for default provider per user
CREATE TABLE IF NOT EXISTS public.user_provider_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider text NOT NULL,
  is_default boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

-- Enable RLS
ALTER TABLE public.user_provider_preferences ENABLE ROW LEVEL SECURITY;

-- Users can manage their own preferences
CREATE POLICY "Users can manage own provider preferences"
ON public.user_provider_preferences
FOR ALL
USING (auth.uid() = user_id);

-- Update profiles RLS to allow updating 2FA and provider fields
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);


-- ============================================================
-- 20260115092130_unified_music_schema.sql

-- ============================================================
-- Unified Music Search Schema Migration
-- This migration adds tables and updates existing schema for the unified music search functionality

-- Update tracks table to support canonical track shape with arrays
ALTER TABLE public.tracks 
ADD COLUMN IF NOT EXISTS artists text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS provider_ids jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS provider_links jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS popularity_score integer DEFAULT 0;

-- Update tracks to populate artists array from artist column where not already set
UPDATE public.tracks 
SET artists = ARRAY[artist]::text[]
WHERE artists = '{}' AND artist IS NOT NULL;

-- Create track_provider_links table for normalized provider-specific data
CREATE TABLE IF NOT EXISTS public.track_provider_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
  provider text NOT NULL CHECK (provider IN ('spotify', 'apple_music', 'deezer', 'soundcloud', 'youtube', 'amazon_music')),
  provider_track_id text NOT NULL,
  url_web text,
  url_app text,
  url_preview text,
  availability jsonb DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(track_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_track_provider_links_track ON public.track_provider_links(track_id);
CREATE INDEX IF NOT EXISTS idx_track_provider_links_provider ON public.track_provider_links(provider);

-- Enable RLS
ALTER TABLE public.track_provider_links ENABLE ROW LEVEL SECURITY;

-- Anyone can view provider links
CREATE POLICY "Anyone can view provider links"
ON public.track_provider_links
FOR SELECT
USING (true);

-- Authenticated users can manage provider links
CREATE POLICY "Authenticated can manage provider links"
ON public.track_provider_links
FOR ALL
USING (auth.uid() IS NOT NULL);

-- Create play_events table for tracking user play actions
CREATE TABLE IF NOT EXISTS public.play_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id uuid REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
  provider text NOT NULL,
  action text NOT NULL CHECK (action IN ('open_app', 'open_web', 'preview')),
  played_at timestamptz NOT NULL DEFAULT now(),
  context text,
  device text,
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_play_events_user ON public.play_events(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_play_events_track ON public.play_events(track_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_play_events_provider ON public.play_events(provider);

-- Enable RLS
ALTER TABLE public.play_events ENABLE ROW LEVEL SECURITY;

-- Users can view their own play events
CREATE POLICY "Users can view own play events"
ON public.play_events
FOR SELECT
USING (auth.uid() = user_id OR user_id IS NULL);

-- Users can insert play events
CREATE POLICY "Users can insert play events"
ON public.play_events
FOR INSERT
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Admins can view all play events
CREATE POLICY "Admins can view all play events"
ON public.play_events
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create track_connections table for WhoSampled-style relationships
CREATE TABLE IF NOT EXISTS public.track_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_track_id uuid REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
  to_track_id uuid REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
  connection_type text NOT NULL CHECK (connection_type IN ('sample', 'cover', 'interpolation', 'remix', 'inspiration')),
  confidence decimal(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  evidence_url text,
  evidence_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(from_track_id, to_track_id, connection_type)
);

CREATE INDEX IF NOT EXISTS idx_track_connections_from ON public.track_connections(from_track_id);
CREATE INDEX IF NOT EXISTS idx_track_connections_to ON public.track_connections(to_track_id);

-- Enable RLS
ALTER TABLE public.track_connections ENABLE ROW LEVEL SECURITY;

-- Anyone can view connections
CREATE POLICY "Anyone can view connections"
ON public.track_connections
FOR SELECT
USING (true);

-- Authenticated users can create connections
CREATE POLICY "Authenticated can create connections"
ON public.track_connections
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Admins and creators can update/delete connections
CREATE POLICY "Admins and creators can manage connections"
ON public.track_connections
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR created_by = auth.uid());

-- Update search_cache to handle longer TTL and add market index
DROP INDEX IF EXISTS idx_search_cache_query;
CREATE INDEX IF NOT EXISTS idx_search_cache_query_market ON public.search_cache(query, market);

-- Add function to clean expired cache entries
CREATE OR REPLACE FUNCTION public.cleanup_expired_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.search_cache WHERE expires_at < now();
END;
$$;

-- Add trigger to update track popularity based on play events
CREATE OR REPLACE FUNCTION public.update_track_popularity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.tracks
  SET popularity_score = (
    SELECT COUNT(*) 
    FROM public.play_events 
    WHERE track_id = NEW.track_id 
    AND played_at > now() - interval '30 days'
  )
  WHERE id = NEW.track_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_play_event_update_popularity
  AFTER INSERT ON public.play_events
  FOR EACH ROW EXECUTE FUNCTION public.update_track_popularity();

-- Update user_providers to support more providers and encrypted tokens
ALTER TABLE public.user_providers
DROP CONSTRAINT IF EXISTS user_providers_provider_check;

ALTER TABLE public.user_providers
ADD CONSTRAINT user_providers_provider_check
CHECK (provider IN ('spotify', 'apple_music', 'deezer', 'soundcloud', 'youtube', 'amazon_music', 'lastfm'));

-- Add indices for better query performance
CREATE INDEX IF NOT EXISTS idx_tracks_isrc_artists ON public.tracks(isrc, artists) WHERE isrc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_title_artist ON public.tracks USING gin(to_tsvector('english', title || ' ' || COALESCE(artist, '')));
CREATE INDEX IF NOT EXISTS idx_tracks_popularity ON public.tracks(popularity_score DESC);



COMMIT;
