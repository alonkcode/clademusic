-- Fix the Admin Dashboard's Users tab showing only one row: the admin's own
-- profile, no matter how many accounts actually exist.
--
-- public.profiles carries two SELECT policies (schema_bundle.sql:956,
-- 20260122_premium_billing.sql:3564), and both reduce to the same thing:
--   USING (auth.uid() = id)
-- Postgres ORs multiple permissive policies together, but there is no clause
-- anywhere that lets an admin see a row that isn't their own. useAdminUsers()
-- (src/hooks/api/useAdmin.ts) queries `profiles` straight from the browser
-- client, so RLS silently trims its result to a single row for every admin,
-- regardless of limit/offset/search - confirmed by seeding a dozen extra
-- accounts (supabase/sql-editor/20-seed-fake-users.sql) and the dashboard
-- still reporting just the one.
--
-- Adds one more permissive SELECT policy using the existing has_role()
-- helper (SECURITY DEFINER over user_roles, so no recursion risk here).
-- Purely additive: the existing owner-only policies are untouched, so
-- non-admins still only ever see their own row.

BEGIN;

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

COMMIT;

NOTIFY pgrst, 'reload schema';
