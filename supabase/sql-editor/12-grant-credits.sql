-- Grant / top up live-detection credits for a specific account.
--
-- Live chord + section detection spends 1 credit per capture session, via
-- public.spend_credit() (see 10-hotfix-credits.sql). This tops an account
-- back up so it can keep using that feature.
--
-- Safe to re-run: it raises a balance to the target and never lowers one,
-- so running it twice does not double-grant, and it won't undo a purchase
-- that already put the account higher.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Change the two values marked below first if you want a different account
-- or amount.

BEGIN;

DO $$
DECLARE
  v_email   TEXT    := 'office@keshevplus.co.il';  -- <- account to grant
  v_balance INTEGER := 1000;                       -- <- credits to end up with
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

  RAISE NOTICE 'credits for %: % -> %', v_email, COALESCE(v_before, 0), v_balance;
END;
$$;

COMMIT;

-- Verify: should show the account with its new balance.
SELECT u.email, c.balance, c.updated_at
FROM public.credits c
JOIN auth.users u ON u.id = c.user_id
WHERE lower(u.email) = lower('office@keshevplus.co.il');
