-- Add email column to profiles table so phone-based login can retrieve it.
-- Run this in the Supabase SQL Editor if the column does not already exist.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill email from auth.users for any existing rows that are missing it.
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS NULL;
