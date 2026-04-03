-- Migration 042: Workout Logging Enhancements
-- Adds brand tracking and check-in eligibility to exercise_logs

ALTER TABLE exercise_logs
  ADD COLUMN IF NOT EXISTS counts_as_checkin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS brand VARCHAR(50),
  ADD COLUMN IF NOT EXISTS verified_source BOOLEAN DEFAULT false;

-- Index for finding check-in eligible exercises efficiently
CREATE INDEX IF NOT EXISTS idx_exercise_logs_checkin
  ON exercise_logs(user_id, created_at)
  WHERE counts_as_checkin = true;
