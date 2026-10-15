-- Migration: 0010_add_avatar_url_to_profiles.sql
-- Description: Adds avatar_url and business_logo_url columns to profiles table

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS business_logo_url text;

-- Notify postgrest schema reload
NOTIFY pgrst, 'reload schema';
