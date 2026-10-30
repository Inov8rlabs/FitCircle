-- 116: remote switch for iOS GA4 conversions without the ATT requirement.
--
-- Read by the iOS app via GET /api/mobile/feature-flags/ga4_conversions_without_att.
-- Seeded OFF: iOS only sends GA4 conversions after ATT "Allow" (1.1.0 decision).
--
-- To turn it on (compliance decision: revisit the App Store privacy label first):
--   update feature_flags set is_enabled = true, rollout_percentage = 100, updated_at = now()
--    where name = 'ga4_conversions_without_att';
-- is_enabled alone is not enough: FeatureFlagService also needs a rollout
-- percentage, an allowed tier or an allowed user id.

insert into public.feature_flags (name, description, is_enabled, rollout_percentage)
values (
  'ga4_conversions_without_att',
  'iOS: send GA4 conversion events without requiring ATT Allow (consent rules still apply). Off = ATT required.',
  false,
  0
)
on conflict (name) do nothing;
