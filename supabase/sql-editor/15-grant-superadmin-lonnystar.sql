-- Grant lonnystar@gmail.com the highest role, a top-tier subscription, and an
-- effectively unlimited credit balance.
--
-- Three things worth knowing before you run this, because the schema does not
-- have the exact words used to ask for them:
--
--   "superadmin" -> 'admin'. public.app_role is ENUM ('user','admin',
--     'moderator'); there is no superadmin tier. 'admin' is the highest one
--     and is what AdminRoute/useIsAdmin actually gate /admin on, so it is the
--     real "can do everything" role. Adding a new enum value would also mean
--     changing that gate, which this script deliberately does not do.
--
--   "premium" -> 'pro'. BillingPage's PLAN_COPY defines exactly free |
--     starter | pro, and falls back to rendering 'free' for anything it does
--     not recognise. Writing plan='premium' would therefore show the account
--     as Free - the opposite of the intent. 'pro' is the top paid tier.
--
--   "unlimited credits" -> 1,000,000,000. public.credits.balance is a plain
--     INTEGER that spend_credit() decrements; there is no unlimited flag to
--     set. A billion is effectively unlimited at 1 credit per capture session
--     and stays well inside INTEGER's 2,147,483,647 ceiling. If you want
--     spending to genuinely never decrement for admins, that is a change to
--     spend_credit() itself and affects everyone - ask and I will write it.
--
-- Safe to re-run: the role insert is guarded by NOT EXISTS, the credit grant
-- uses GREATEST so it never lowers a balance, and the subscription upsert
-- keys on the existing row.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Not the CLI: supabase/config.toml points at a different project than the
-- app actually uses.

BEGIN;

DO $$
DECLARE
  v_email   TEXT    := 'lonnystar@gmail.com';
  v_balance INTEGER := 1000000000;
  v_plan    TEXT    := 'pro';
  v_user_id UUID;
  v_before  INTEGER;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth user with email % - the account must sign up first', v_email;
  END IF;

  -- A profiles row is required: credits and subscriptions both FK to it.
  INSERT INTO public.profiles (id, email, display_name)
  SELECT v_user_id, v_email, split_part(v_email, '@', 1)
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id);

  -- Highest role.
  INSERT INTO public.user_roles (user_id, role)
  SELECT v_user_id, 'admin'::public.app_role
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user_id AND role = 'admin'::public.app_role
  );

  -- Credits.
  SELECT balance INTO v_before FROM public.credits WHERE user_id = v_user_id;
  INSERT INTO public.credits (user_id, balance)
  VALUES (v_user_id, v_balance)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = GREATEST(public.credits.balance, EXCLUDED.balance),
        updated_at = now();

  -- Top-tier subscription, active for a long horizon so it does not lapse.
  -- No Stripe ids: this is a comped account, not a real billed one, and
  -- leaving them NULL keeps it from colliding with a genuine Stripe customer.
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = v_user_id) THEN
    UPDATE public.subscriptions
    SET plan = v_plan,
        status = 'active',
        current_period_start = now(),
        current_period_end = now() + INTERVAL '100 years',
        updated_at = now()
    WHERE user_id = v_user_id;
  ELSE
    INSERT INTO public.subscriptions (user_id, plan, status, current_period_start, current_period_end)
    VALUES (v_user_id, v_plan, 'active', now(), now() + INTERVAL '100 years');
  END IF;

  RAISE NOTICE 'granted % : role=admin, plan=%, credits % -> %',
    v_email, v_plan, COALESCE(v_before, 0), v_balance;
END;
$$;

COMMIT;

-- Verify: one row each for role, plan and balance.
SELECT u.email, ur.role, s.plan, s.status, s.current_period_end, c.balance
FROM auth.users u
LEFT JOIN public.user_roles    ur ON ur.user_id = u.id AND ur.role = 'admin'::public.app_role
LEFT JOIN public.subscriptions s  ON s.user_id  = u.id
LEFT JOIN public.credits       c  ON c.user_id  = u.id
WHERE lower(u.email) = lower('lonnystar@gmail.com');
