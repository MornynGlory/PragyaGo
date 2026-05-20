-- Run this in the Supabase SQL Editor once.
-- It creates a SECURITY DEFINER function that lets the client
-- retrieve a user's email from auth.users by their UUID.

CREATE OR REPLACE FUNCTION get_user_email(user_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM auth.users WHERE id = user_id;
$$;

-- Grant execute permission to authenticated and anon roles
GRANT EXECUTE ON FUNCTION get_user_email(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_email(UUID) TO anon;
