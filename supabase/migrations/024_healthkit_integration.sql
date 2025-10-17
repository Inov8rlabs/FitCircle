-- Migration: Add HealthKit integration fields to daily_tracking table
-- This migration adds support for tracking the source of step data (manual, HealthKit, Google Fit)
-- and enables conflict resolution between manual entries and auto-synced data.

-- Add new columns to daily_tracking table
ALTER TABLE daily_tracking
ADD COLUMN IF NOT EXISTS steps_source VARCHAR(20) DEFAULT 'manual'
    CHECK (steps_source IN ('manual', 'healthkit', 'google_fit'));

ALTER TABLE daily_tracking
ADD COLUMN IF NOT EXISTS steps_synced_at TIMESTAMPTZ;

ALTER TABLE daily_tracking
ADD COLUMN IF NOT EXISTS is_override BOOLEAN DEFAULT false;

-- Create index for querying HealthKit-synced data efficiently
CREATE INDEX IF NOT EXISTS idx_daily_tracking_steps_source
    ON daily_tracking(user_id, steps_source);

CREATE INDEX IF NOT EXISTS idx_daily_tracking_synced_at
    ON daily_tracking(user_id, steps_synced_at DESC)
    WHERE steps_synced_at IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN daily_tracking.steps_source IS
    'Source of step count data: manual (user entered), healthkit (iOS Health app), google_fit (Android Health Connect)';

COMMENT ON COLUMN daily_tracking.steps_synced_at IS
    'Timestamp when step count was synced from HealthKit or Google Fit. NULL for manual entries.';

COMMENT ON COLUMN daily_tracking.is_override IS
    'True if user manually overrode auto-synced HealthKit/Google Fit data. When true, auto-sync will not update this entry.';

-- Backfill existing data: set steps_source to 'manual' and is_override to false
-- (These are already the defaults, but this ensures consistency)
UPDATE daily_tracking
SET steps_source = 'manual',
    is_override = false
WHERE steps_source IS NULL OR is_override IS NULL;
