-- ============================================================================
-- 077: LAUNCH SWITCH — flip Pro feature gates to premium
-- ============================================================================
-- ⚠️  DO NOT APPLY until the full trial→paid loop is verified end-to-end on all
-- three platforms (see docs plan "Verification §5 cross-platform acceptance").
-- Until this runs, all gates seeded by 075 are dark (required_tier='free') and
-- behavior is byte-identical to pre-subscription FitCircle.
--
-- Applying this migration is the moment free-tier limits take effect:
--   AI food parses 5/day, Fitzy 5 msgs/day, 14-day history, 2 created circles,
--   ads for free users, premium share themes/exports/bonus shields.
-- Rollback = UPDATE the same rows back to 'free'.
-- ============================================================================

update feature_gates
set required_tier = 'premium'
where feature_key in (
  'food_ai_unlimited',
  'fitzy_unlimited',
  'history_extended',
  'circles_unlimited',
  'ads_removed',
  'data_export',
  'share_themes_custom',
  'streak_shields_bonus',
  -- body-comp premium surfaces gated at the same moment (seeded dark in 071)
  'body_comp_photo_scan',
  'body_comp_trends',
  'body_comp_coach',
  'body_comp_segmental'
);
