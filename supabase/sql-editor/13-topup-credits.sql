-- Top up live-detection credits for one account. Credits only - no role
-- change (12-grant-credits.sql also grants 'admin', which is right for the
-- owner's own account and wrong for everybody else).
--
-- Live chord + section detection spends 1 credit per capture session via
-- public.spend_credit() (see 10-hotfix-credits.sql); HarmonicHUD refuses to
-- start and shows "Out of credits for live detection this period" when the
-- balance is below the cost. This raises the balance so the feature works
-- again.
--
-- Safe to re-run:
--   - GREATEST() raises the balance to the target and never lowers one, so
--     running it twice does not double-grant and it won't undo a purchase
--     that already put the account higher.
--   - The profile backfill and the credits row are both upserts.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Change the two values marked below for a different account or amount.

BEGIN;

DO $$
DECLARE
  v_email   TEXT    := 'lonnystar@gmail.com';  -- <- account to top up
  v_balance INTEGER := 10000;                  -- <- credits to end up with
  v_user_id UUID;
  v_before  INTEGER;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth user with email % (check the address, or have them sign up first)', v_email;
  END IF;

  -- public.credits.user_id is FK -> public.profiles(id), not auth.users, so a
  -- missing profile row (signup predating the trigger, or a trigger failure)
  -- would make the insert below fail on the FK. Backfill it the same way
  -- handle_new_user() would.
  INSERT INTO public.profiles (id, email, display_name)
  SELECT u.id, u.email,
         COALESCE(
           NULLIF(u.raw_user_meta_data->>'display_name', ''),
           NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
           'listener'
         )
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (id) DO NOTHING;

  SELECT balance INTO v_before FROM public.credits WHERE user_id = v_user_id;

  INSERT INTO public.credits (user_id, balance)
  VALUES (v_user_id, v_balance)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = GREATEST(public.credits.balance, EXCLUDED.balance),
        updated_at = now();

  -- Audit trail, alongside the 'credit_spent' rows spend_credit() writes.
  INSERT INTO public.billing_events (user_id, type, payload)
  VALUES (v_user_id, 'credit_granted', jsonb_build_object(
    'target_balance', v_balance,
    'previous_balance', COALESCE(v_before, 0),
    'reason', 'manual top-up via sql-editor/13-topup-credits.sql'
  ));

  RAISE NOTICE 'credits for %: % -> %', v_email, COALESCE(v_before, 0), v_balance;
END;
$$;

COMMIT;

-- Verify: should show the account at its new balance.
SELECT u.email, c.balance, c.updated_at
FROM public.credits c
JOIN auth.users u ON u.id = c.user_id
WHERE lower(u.email) = lower('lonnystar@gmail.com');
