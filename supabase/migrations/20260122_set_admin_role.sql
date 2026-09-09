-- Set admin role for repoisrael@gmail.com
-- Created: 2026-01-22

-- Find the user ID for repoisrael@gmail.com and set as admin
DO $$
DECLARE
  admin_user_id uuid;
BEGIN
  -- Get user ID
  SELECT id INTO admin_user_id
  FROM auth.users
  WHERE email = 'repoisrael@gmail.com'
  LIMIT 1;

  -- Check if user exists
  IF admin_user_id IS NOT NULL THEN
    -- Insert or update admin role
    INSERT INTO public.user_roles (user_id, role, assigned_at, assigned_by)
    VALUES (admin_user_id, 'admin'::app_role, now(), admin_user_id)
    ON CONFLICT (user_id, role) 
    DO UPDATE SET assigned_at = now();

    RAISE NOTICE 'Admin role granted to repoisrael@gmail.com (%)' , admin_user_id;
  ELSE
    RAISE WARNING 'User repoisrael@gmail.com not found in auth.users';
  END IF;
END $$;

-- Create helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_roles.user_id = is_admin.user_id
    AND role = 'admin'::app_role
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_admin IS 'Check if a user has admin role';
