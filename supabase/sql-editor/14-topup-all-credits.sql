-- Top up EVERY account's live-detection credits to a floor of 2500.
--
-- Bulk companion to 13-topup-credits.sql, which does one account at a time.
-- Credits only - no role changes (12-grant-credits.sql also grants 'admin',
-- which is right for the owner's own account and very wrong applied to
-- everybody).
--
-- Live chord + section detection spends 1 credit per capture session via
-- public.spend_credit() (see 10-hotfix-credits.sql); HarmonicHUD refuses to
-- start and shows "Out of credits for live detection this period" once the
-- balance is below the cost. This raises everyone's balance so the feature
-- works for all of them.
--
-- "Top up TO 2500" is read as a FLOOR, not an assignment: an account already
-- above 2500 keeps what it has. That's what makes this safe to re-run, and it
-- means a purchased or manually granted balance (13-topup-credits.sql puts
-- the owner at 10000) is never clawed back by a routine top-up. If you
-- actually want every account set to exactly 2500, including lowering the
-- ones above it, see the note at the bottom - it is a different, destructive
-- operation and is not what this script does.
--
-- Safe to re-run:
--   - The DO UPDATE ... WHERE clause skips any account already at or above
--     the floor, so a second run touches no rows, bumps no updated_at, and
--     writes no audit events.
--   - The profile backfill is an insert-if-missing.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Change the floor in the one place marked below.

BEGIN;

-- public.credits.user_id is FK -> public.profiles(id), not auth.users, so an
-- account with no profile row (a signup predating the trigger, or a trigger
-- failure) would fail the insert below on the FK and take the whole batch
-- with it. Backfill the same way handle_new_user() would.
INSERT INTO public.profiles (id, email, display_name)
SELECT u.id, u.email,
       COALESCE(
         NULLIF(u.raw_user_meta_data->>'display_name', ''),
         NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
         'listener'
       )
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

WITH floor_amount AS (
  SELECT 2500::INTEGER AS balance   -- <- credits every account ends up with, at minimum
),
-- Snapshot of what balances were before this statement. Every CTE here reads
-- the same pre-statement snapshot, so this stays the "before" picture even
-- though the upsert below runs in the same statement - that's what lets the
-- audit rows record a truthful previous_balance.
before AS (
  SELECT user_id, balance FROM public.credits
),
upserted AS (
  INSERT INTO public.credits (user_id, balance)
  SELECT u.id, f.balance
  FROM auth.users u
  CROSS JOIN floor_amount f
  -- Ordered so this statement takes row locks in a predictable sequence
  -- rather than whatever order the scan happens to produce, while
  -- spend_credit() is potentially updating single rows underneath it.
  ORDER BY u.id
  ON CONFLICT (user_id) DO UPDATE
    SET balance = EXCLUDED.balance,
        updated_at = now()
    -- The floor, expressed as a predicate rather than as GREATEST() in the
    -- SET: an account already at or above the target is not written at all,
    -- so no dead tuple, no misleading updated_at bump, and RETURNING below
    -- yields exactly the accounts this run actually changed.
    WHERE public.credits.balance < EXCLUDED.balance
  RETURNING user_id, balance
)
-- Audit trail, alongside the 'credit_spent' rows spend_credit() writes.
INSERT INTO public.billing_events (user_id, type, payload)
SELECT up.user_id, 'credit_granted', jsonb_build_object(
  'target_balance', up.balance,
  'previous_balance', COALESCE(b.balance, 0),
  'reason', 'bulk top-up of all accounts via sql-editor/14-topup-all-credits.sql'
)
FROM upserted up
LEFT JOIN before b ON b.user_id = up.user_id;

COMMIT;

-- Verify: every account should now be at or above the floor, and the count of
-- accounts below it should be 0.
SELECT COUNT(*)                                   AS accounts,
       MIN(balance)                               AS lowest_balance,
       MAX(balance)                               AS highest_balance,
       COUNT(*) FILTER (WHERE balance < 2500)     AS still_below_floor
FROM public.credits;

-- What this run changed (empty on a re-run, which is the point):
SELECT u.email,
       be.payload->>'previous_balance' AS before,
       be.payload->>'target_balance'   AS after,
       be.created_at
FROM public.billing_events be
JOIN auth.users u ON u.id = be.user_id
WHERE be.type = 'credit_granted'
  AND be.payload->>'reason' LIKE 'bulk top-up%'
ORDER BY be.created_at DESC, u.email
LIMIT 100;

-- NOT WHAT THIS SCRIPT DOES, and deliberately not enabled: setting every
-- account to exactly 2500 would LOWER any account currently above it, which
-- silently confiscates purchased or granted credits and cannot be undone from
-- the credits table alone. If that is genuinely what you want, reconstruct
-- the prior balances from public.billing_events first so it is reversible.
--   UPDATE public.credits SET balance = 2500, updated_at = now()
--   WHERE balance <> 2500;
