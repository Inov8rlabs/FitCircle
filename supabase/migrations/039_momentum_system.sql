-- Migration 039: Momentum System Enhancements
-- Adds momentum tracking columns to engagement_streaks table.
-- Momentum replaces the "streak" concept with decay-based progression.

-- Add momentum columns to engagement_streaks
ALTER TABLE engagement_streaks
  ADD COLUMN IF NOT EXISTS best_momentum INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS momentum_flame_level INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_decay_applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_day_used_this_week BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS grace_day_week_start DATE;

-- Backfill best_momentum from longest_streak for existing users
UPDATE engagement_streaks
SET best_momentum = longest_streak
WHERE longest_streak > 0;

-- Index for cron decay queries (find users who need decay applied)
CREATE INDEX IF NOT EXISTS idx_engagement_streaks_last_decay
  ON engagement_streaks (last_decay_applied_at);

-- Index for grace day weekly reset
CREATE INDEX IF NOT EXISTS idx_engagement_streaks_grace_week
  ON engagement_streaks (grace_day_week_start);
