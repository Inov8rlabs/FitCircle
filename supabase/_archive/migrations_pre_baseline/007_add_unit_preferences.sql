-- Migration to ensure profiles.preferences has unit system support
-- This migration safely updates the preferences JSONB field to include unit system defaults

-- Update existing profiles to have default unit preferences if not set
UPDATE profiles
SET preferences = jsonb_set(
  COALESCE(preferences, '{}'::jsonb),
  '{unitSystem}',
  '"metric"'::jsonb,
  false
)
WHERE preferences IS NULL
   OR NOT (preferences ? 'unitSystem');

-- Also ensure units sub-object exists with defaults
UPDATE profiles
SET preferences = jsonb_set(
  preferences,
  '{units}',
  '{"weight": "kg", "height": "cm"}'::jsonb,
  false
)
WHERE preferences IS NULL
   OR NOT (preferences ? 'units');

-- Add comment to document the expected structure
COMMENT ON COLUMN profiles.preferences IS
'User preferences stored as JSONB. Expected structure:
{
  "unitSystem": "metric" | "imperial",
  "units": {
    "weight": "kg" | "lbs",
    "height": "cm" | "inches"
  },
  "privacy": {
    "profileVisibility": "public" | "friends" | "private"
  }
}';