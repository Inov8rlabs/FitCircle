-- Migration 035: Add 'freeze' to streak_claims claim_method constraint
--
-- When a shield/freeze protects a missed day, we need to record it as a streak_claims
-- record so the claim-based streak calculation counts shield-protected days.
-- This requires adding 'freeze' as an allowed claim_method value.

-- Drop the existing constraint
ALTER TABLE streak_claims
DROP CONSTRAINT IF EXISTS streak_claims_claim_method_check;

-- Add updated constraint with 'freeze' included
ALTER TABLE streak_claims
ADD CONSTRAINT streak_claims_claim_method_check
CHECK (claim_method IN ('explicit', 'manual_entry', 'retroactive', 'freeze'));

-- Update the column comment
COMMENT ON COLUMN streak_claims.claim_method IS 'How the streak was claimed: explicit (button press), manual_entry (via data submission), retroactive (past 7 days), freeze (shield protection for missed day)';
