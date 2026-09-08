-- Grant / top up live-detection credits for a specific account, and make it
-- an admin.
--
-- Live chord + section detection spends 1 credit per capture session, via
-- public.spend_credit() (see 10-hotfix-credits.sql). This tops an account
-- back up so it can keep using that feature, and grants it the 'admin' role
-- (public.app_role has 'user' | 'admin' | 'moderator' - there is no separate
-- "owner" tier, 'admin' is the highest one) so it can reach /admin.
--
-- Safe to re-run:
--   - credits: raises the balance to the target and never lowers one, so
--     running it twice does not double-grant, and it won't undo a purchase
--     that already put the account higher.
--   - admin role: guarded by NOT EXISTS, so re-running doesn't insert a
--     duplicate role row.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Change the two values marked below first if you want a different account
-- or amount.

BEGIN;

DO $$
DECLARE
  v_email   TEXT    := 'alonkcode@gmail.com';  -- <- account to grant
  v_balance INTEGER := 1000;                   -- <- credits to end up with
  v_user_id UUID;
  v_before  INTEGER;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth user with email % (check the address, or sign up first)', v_email;
  END IF;

  SELECT balance INTO v_before FROM public.credits WHERE user_id = v_user_id;

  INSERT INTO public.credits (user_id, balance)
  VALUES (v_user_id, v_balance)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = GREATEST(public.credits.balance, EXCLUDED.balance),
        updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  SELECT v_user_id, 'admin'::public.app_role
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_user_id AND role = 'admin'::public.app_role
  );

  RAISE NOTICE 'credits for %: % -> %; admin role granted', v_email, COALESCE(v_before, 0), v_balance;
END;
$$;

COMMIT;

-- Verify: should show the account with its new balance and an admin row.
SELECT u.email, c.balance, c.updated_at
FROM public.credits c
JOIN auth.users u ON u.id = c.user_id
WHERE lower(u.email) = lower('alonkcode@gmail.com');

SELECT u.email, ur.role
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
WHERE lower(u.email) = lower('alonkcode@gmail.com');
