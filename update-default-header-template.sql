-- Update default header template from 'none' to 'center'
-- Run this in Supabase SQL Editor

-- First, update the column default
ALTER TABLE profiles
ALTER COLUMN header_template SET DEFAULT 'center';

-- Update existing users who have 'none' to 'center' (optional - only if you want to update existing users)
-- Comment out the next line if you don't want to update existing profiles
UPDATE profiles SET header_template = 'center' WHERE header_template = 'none' OR header_template IS NULL;

-- Verify the change
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'profiles'
AND column_name = 'header_template';
