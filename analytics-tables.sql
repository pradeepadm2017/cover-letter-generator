-- Analytics Database Tables for Cover Letter Generator
-- Run this SQL in your Supabase SQL Editor

-- Table 1: Scraping Analytics
-- Tracks each scraping attempt with method used and success/failure
CREATE TABLE IF NOT EXISTS scraping_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    job_url TEXT NOT NULL,
    scraping_method TEXT NOT NULL,  -- e.g., 'apify', 'scraperapi', 'linkedin-guest-api', 'indeed-embedded', etc.
    is_free_method BOOLEAN NOT NULL DEFAULT true,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table 2: Cover Letter Generation Analytics
-- Tracks each cover letter generation attempt
CREATE TABLE IF NOT EXISTS generation_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    job_url TEXT,
    is_manual_paste BOOLEAN NOT NULL DEFAULT false,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    generation_time_ms INTEGER,  -- Time taken to generate cover letter
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_scraping_analytics_user_id ON scraping_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_scraping_analytics_created_at ON scraping_analytics(created_at);
CREATE INDEX IF NOT EXISTS idx_scraping_analytics_method ON scraping_analytics(scraping_method);

CREATE INDEX IF NOT EXISTS idx_generation_analytics_user_id ON generation_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_analytics_created_at ON generation_analytics(created_at);
CREATE INDEX IF NOT EXISTS idx_generation_analytics_success ON generation_analytics(success);

-- Enable Row Level Security (RLS)
ALTER TABLE scraping_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only see their own analytics (optional - remove if you want admin-only access)
CREATE POLICY "Users can view own scraping analytics"
    ON scraping_analytics FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own generation analytics"
    ON generation_analytics FOR SELECT
    USING (auth.uid() = user_id);

-- Service role can insert (for server-side tracking)
CREATE POLICY "Service role can insert scraping analytics"
    ON scraping_analytics FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Service role can insert generation analytics"
    ON generation_analytics FOR INSERT
    WITH CHECK (true);

-- Optional: Admin view policy (create if you want admin-only dashboard)
-- Uncomment these if you want to restrict analytics viewing to admins only
-- DROP POLICY IF EXISTS "Users can view own scraping analytics" ON scraping_analytics;
-- DROP POLICY IF EXISTS "Users can view own generation analytics" ON generation_analytics;
--
-- CREATE POLICY "Only admins can view scraping analytics"
--     ON scraping_analytics FOR SELECT
--     USING (
--         EXISTS (
--             SELECT 1 FROM users
--             WHERE users.id = auth.uid()
--             AND users.email = 'pradeepadm2017@gmail.com'  -- Replace with your admin email
--         )
--     );
--
-- CREATE POLICY "Only admins can view generation analytics"
--     ON generation_analytics FOR SELECT
--     USING (
--         EXISTS (
--             SELECT 1 FROM users
--             WHERE users.id = auth.uid()
--             AND users.email = 'pradeepadm2017@gmail.com'  -- Replace with your admin email
--         )
--     );
