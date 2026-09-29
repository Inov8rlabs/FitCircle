-- ============================================================================
-- 095: XP SPENT LEDGER FOR STREAK SHIELD PURCHASES
-- ============================================================================
-- POST /api/mobile/streaks/engagement/purchase-freeze used to grant a shield
-- without charging anything. The purchase now costs XP.
--
-- engagement_streaks.total_points stays what it has always been: the XP a user
-- has EARNED (check-ins and milestones). It is shown by the mobile apps as
-- `totalPoints` and is written by the daily check-in with a read-modify-write,
-- so it must never be decremented: a concurrent check-in would silently undo
-- the charge.
--
-- Spending is recorded separately:
--     spendable XP = total_points - points_spent
--
-- The service (StreakShieldService.purchaseWithXp) charges with a conditional
-- UPDATE ... WHERE points_spent = <value it read> and checks the affected row
-- count, so a double tap cannot buy two shields for one payment. No stored
-- procedure, function or trigger is involved.
--
-- Until this migration is applied the purchase route answers
-- 503 XP_LEDGER_UNAVAILABLE and grants nothing. Every other route is unaffected.
-- ============================================================================

ALTER TABLE public.engagement_streaks
  ADD COLUMN IF NOT EXISTS points_spent integer NOT NULL DEFAULT 0;

-- Idempotent without a DO block: drop-if-exists, then add.
ALTER TABLE public.engagement_streaks
  DROP CONSTRAINT IF EXISTS engagement_streaks_points_spent_check;
ALTER TABLE public.engagement_streaks
  ADD CONSTRAINT engagement_streaks_points_spent_check CHECK (points_spent >= 0);

COMMENT ON COLUMN public.engagement_streaks.points_spent IS
  'XP spent (shield purchases). Spendable XP = total_points - points_spent. Written only by StreakShieldService.';
