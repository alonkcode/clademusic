-- Grant 2500 credits to every newly registered user.
--
-- Updates the signup trigger so NEW users get 2500 credits at creation
-- instead of 50. Existing users are NOT modified.
--
-- Safe to re-run: CREATE OR REPLACE + ON CONFLICT DO NOTHING.

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
    INSERT INTO public.credits (user_id, balance) VALUES (NEW.id, 2500)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user/credits %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMIT;
