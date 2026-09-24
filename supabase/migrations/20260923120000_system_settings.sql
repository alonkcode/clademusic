-- Admin-controlled system settings: feature flags, rate limits and site
-- preferences, edited from the Settings tab of the Admin Dashboard.
--
-- One row per setting, keyed by a namespaced name (flag.*, limit.*, pref.*).
-- There is deliberately NO seed data: the app ships its own defaults
-- (src/lib/systemSettings.ts), and a key with no row means "use the default".
-- Rows appear the first time an admin changes a setting, so the defaults live
-- in exactly one place and cannot drift from a copy here.
--
-- Everyone can READ this table - guests need the flags to know whether the
-- sign-up form is open or the site is in maintenance - so it must never hold
-- anything secret. Only admins can write.

BEGIN;

CREATE TABLE IF NOT EXISTS public.system_settings (
  key        text PRIMARY KEY CHECK (key ~ '^(flag|limit|pref)\.[a-z0-9_]+$'),
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- The schema bundle ships the table without updated_by or the key CHECK
-- (it has id PK + key UNIQUE + no updated_by). If the table already exists
-- from the bundle, add the missing column so the trigger below can write it.
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view settings" ON public.system_settings;
DROP POLICY IF EXISTS "System settings are publicly readable" ON public.system_settings;
CREATE POLICY "System settings are publicly readable"
  ON public.system_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can manage system settings" ON public.system_settings;
CREATE POLICY "Admins can manage system settings"
  ON public.system_settings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Stamp who changed a row and when on the server, so the client cannot
-- claim someone else made the change.
CREATE OR REPLACE FUNCTION public.stamp_system_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_system_settings ON public.system_settings;
CREATE TRIGGER stamp_system_settings
  BEFORE INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_system_settings();

COMMIT;

NOTIFY pgrst, 'reload schema';
