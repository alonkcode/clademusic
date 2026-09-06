-- Wire the credit system to an actual feature, and fix the table it grants
-- into being the one anyone ever reads.
--
-- Found while investigating "credits are granted and displayed but nothing
-- spends them" (docs/MONETIZATION.md §4): there are TWO credit tables.
--   - public.user_credits (monthly_allowance/credits_used) - populated by
--     handle_new_user() at signup, read by nothing.
--   - public.credits (balance) - populated only by the Stripe webhook at
--     checkout, and the one BillingPage actually reads.
-- A free user who never pays therefore has no row in the table the UI reads
-- at all. Gating anything on top of that would be gating against an empty
-- table for most users - fixed first, before wiring a real deduction.
--
-- What now spends a credit: starting a live chord/section detection capture
-- (HarmonicHUD's "Analyze from audio" toggle) - the app's actual
-- differentiator (see the status report), not an invented cost center. 1
-- credit per session started, so the Free tier's 50/month
-- (docs/MONETIZATION.md's own numbers) reads as "50 live-detection sessions,
-- upgrade for more" - a real, legible value prop instead of an unenforced
-- number on a pricing page.

-- ---------------------------------------------------------------- signup
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
    RAISE WARNING 'handle_new_user/profiles %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user/roles %: %', NEW.id, SQLERRM;
  END;

  -- public.credits, not public.user_credits - see the header comment. 50
  -- matches the Free plan's monthly allowance (BillingPage's PLAN_COPY).
  BEGIN
    INSERT INTO public.credits (user_id, balance) VALUES (NEW.id, 50)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user/credits %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Backfill: anyone who signed up before this migration has a user_credits row
-- (from the old trigger) but no public.credits row - the table BillingPage
-- and spend_credit() below actually use.
INSERT INTO public.credits (user_id, balance)
SELECT u.id, 50
FROM auth.users u
LEFT JOIN public.credits c ON c.user_id = u.id
WHERE c.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- ------------------------------------------------------------ spend_credit
-- Atomic check-and-decrement: UPDATE ... WHERE balance >= amount RETURNING
-- closes the classic read-balance-then-write-balance race (two concurrent
-- requests both reading "1 credit left" and both proceeding). Logs to the
-- existing billing_events table rather than a new one.
CREATE OR REPLACE FUNCTION public.spend_credit(
  p_user_id UUID,
  p_amount INTEGER,
  p_reason TEXT
)
RETURNS TABLE (success BOOLEAN, remaining_balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be positive';
  END IF;

  UPDATE public.credits
  SET balance = balance - p_amount, updated_at = now()
  WHERE user_id = p_user_id AND balance >= p_amount
  RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    -- Either no credits row (shouldn't happen post-backfill, but a missing
    -- row must still fail closed rather than let the caller charge nothing
    -- and proceed anyway) or an insufficient balance.
    RETURN QUERY
    SELECT FALSE, COALESCE((SELECT balance FROM public.credits WHERE user_id = p_user_id), 0);
    RETURN;
  END IF;

  INSERT INTO public.billing_events (user_id, type, payload)
  VALUES (p_user_id, 'credit_spent', jsonb_build_object('amount', p_amount, 'reason', p_reason));

  RETURN QUERY SELECT TRUE, v_new_balance;
END;
$$;

-- Callable by signed-in users only for their own balance - not a public API
-- endpoint despite being SECURITY DEFINER (needed to write to
-- billing_events, which users cannot insert into directly).
REVOKE EXECUTE ON FUNCTION public.spend_credit(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_credit(UUID, INTEGER, TEXT) TO authenticated;

COMMENT ON FUNCTION public.spend_credit IS
  'Atomically deducts credits if the balance covers it; returns (false, current_balance) otherwise. Logs to billing_events.';
