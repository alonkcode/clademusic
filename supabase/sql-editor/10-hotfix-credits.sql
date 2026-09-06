-- HOTFIX: wire the credit system to an actual feature, and fix the table it
-- grants into being the one BillingPage/the app actually reads.
--
-- Safe to run on an already-provisioned project; it only replaces the
-- signup trigger function, backfills missing public.credits rows, and adds
-- one new function (spend_credit). No data is deleted.
--
-- Same content as
-- supabase/migrations/20260901120000_wire_credits_to_live_detection.sql

BEGIN;

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

  BEGIN
    INSERT INTO public.credits (user_id, balance) VALUES (NEW.id, 50)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user/credits %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

INSERT INTO public.credits (user_id, balance)
SELECT u.id, 50
FROM auth.users u
LEFT JOIN public.credits c ON c.user_id = u.id
WHERE c.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

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
    RETURN QUERY
    SELECT FALSE, COALESCE((SELECT balance FROM public.credits WHERE user_id = p_user_id), 0);
    RETURN;
  END IF;

  INSERT INTO public.billing_events (user_id, type, payload)
  VALUES (p_user_id, 'credit_spent', jsonb_build_object('amount', p_amount, 'reason', p_reason));

  RETURN QUERY SELECT TRUE, v_new_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.spend_credit(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_credit(UUID, INTEGER, TEXT) TO authenticated;

COMMIT;

-- Expect: every auth user has a public.credits row, balance 50 for anyone
-- who never had one before.
SELECT count(*) AS users, count(c.user_id) AS with_credits_row
FROM auth.users u
LEFT JOIN public.credits c ON c.user_id = u.id;
