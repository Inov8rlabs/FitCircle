-- ============================================================================
-- 076: Subscriptions master feature flag — OFF by default
-- ============================================================================
-- Gates the entire subscriptions surface (paywalls, upgrade CTAs, checkout)
-- on ALL platforms via the existing feature_flags table. Clients receive it as
-- `subscriptionsEnabled` in the entitlements payload and hide every
-- subscription UI element when false; /api/billing/checkout also refuses.
--
-- This is a separate switch from migration 077 (which flips the free-tier
-- QUOTA gates). Launch order: enable this flag first (people can buy Pro,
-- nothing is taken away from free), then apply 077 (free-tier limits begin).
--
-- HOW TO OPERATE (service-role SQL; takes effect within the clients' ~5-min
-- entitlements cache, no deploy or app release):
--   Enable for specific test accounts only:
--     UPDATE feature_flags SET is_enabled = true, allowed_user_ids = ARRAY['<profile-uuid>']::uuid[]
--       WHERE name = 'subscriptions';
--   Staged rollout (e.g. 10% of users):
--     UPDATE feature_flags SET is_enabled = true, rollout_percentage = 10 WHERE name = 'subscriptions';
--   Fully ON:
--     UPDATE feature_flags SET is_enabled = true, rollout_percentage = 100 WHERE name = 'subscriptions';
--   Kill switch:
--     UPDATE feature_flags SET is_enabled = false WHERE name = 'subscriptions';
-- ============================================================================

insert into feature_flags (name, description, is_enabled, rollout_percentage, allowed_tiers)
values (
  'subscriptions',
  'Master switch for the FitCircle Pro subscription surface (paywalls, upgrade CTAs, web checkout) on iOS/Android/Web. OFF = feature invisible everywhere.',
  false,
  0,
  '{}'
)
on conflict (name) do nothing;
