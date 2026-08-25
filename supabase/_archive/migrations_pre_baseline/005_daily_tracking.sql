-- Create a simplified daily_tracking table for general check-ins (not tied to challenges)
CREATE TABLE IF NOT EXISTS daily_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    tracking_date DATE NOT NULL,
    weight_kg DECIMAL(5,2) CHECK (weight_kg > 0 AND weight_kg < 1000),
    steps INTEGER CHECK (steps >= 0),
    mood_score INTEGER CHECK (mood_score >= 1 AND mood_score <= 10),
    energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 10),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, tracking_date)
);

-- Create index for faster queries (only if it doesn't exist)
CREATE INDEX IF NOT EXISTS idx_daily_tracking_user_date ON daily_tracking(user_id, tracking_date DESC);

-- Enable RLS
ALTER TABLE daily_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_tracking (only if they don't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_tracking' AND policyname = 'Users can view own tracking') THEN
        CREATE POLICY "Users can view own tracking"
          ON daily_tracking FOR SELECT
          USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_tracking' AND policyname = 'Users can insert own tracking') THEN
        CREATE POLICY "Users can insert own tracking"
          ON daily_tracking FOR INSERT
          WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- More RLS Policies for daily_tracking (only if they don't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_tracking' AND policyname = 'Users can update own tracking') THEN
        CREATE POLICY "Users can update own tracking"
          ON daily_tracking FOR UPDATE
          USING (auth.uid() = user_id)
          WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_tracking' AND policyname = 'Users can delete own tracking') THEN
        CREATE POLICY "Users can delete own tracking"
          ON daily_tracking FOR DELETE
          USING (auth.uid() = user_id);
    END IF;
END $$;

-- Function to update updated_at timestamp (only if it doesn't exist)
CREATE OR REPLACE FUNCTION update_daily_tracking_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS daily_tracking_updated_at ON daily_tracking;
CREATE TRIGGER daily_tracking_updated_at
    BEFORE UPDATE ON daily_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_daily_tracking_updated_at();
