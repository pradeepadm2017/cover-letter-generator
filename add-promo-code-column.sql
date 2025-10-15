-- Add promo_codes_used column to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS promo_codes_used TEXT[] DEFAULT '{}';

-- Add custom_monthly_limit column to allow promo code to set custom limits
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS custom_monthly_limit INTEGER DEFAULT NULL;
