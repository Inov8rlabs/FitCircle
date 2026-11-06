-- 128: profiles — signed-in users can no longer edit privileged columns.
--
-- Before: anon + authenticated held table-wide INSERT/UPDATE on public.profiles, and the
-- RLS policies only check auth.uid() = id. Any signed-in user could PATCH their own row via
-- PostgREST and set is_admin, subscription_tier ('premium' = free Pro), trial dates,
-- streak/points counters, etc. (security review 2026-11-02 + compliance audit 2026-11-06).
--
-- After: column-level grants. authenticated may INSERT/UPDATE every column EXCEPT the
-- privileged ones below; those are written only by the server with the service role
-- (which bypasses these grants). Verified 2026-11-06: every app write of a privileged
-- column uses createAdminSupabase(); the iOS/Android apps never write profiles directly.
--
-- Privileged (server-only) columns:
--   challenges_completed, challenges_won, current_level, current_streak, is_active, is_admin, longest_streak, onboarding_gate, phone_verified, stripe_customer_id, subscription_expires_at, subscription_platform, subscription_product_id, subscription_status, subscription_synced_at, subscription_tier, subscription_will_renew, total_points, total_xp, trial_converted_at, trial_ends_at, trial_reminder_sent_at, trial_started_at
--
-- RLS policies are unchanged. No functions or triggers. Apply alone.

revoke insert, update, delete, truncate, trigger, references on public.profiles from anon;
revoke insert, update on public.profiles from authenticated;

grant insert (
  id,
  username,
  display_name,
  email,
  avatar_url,
  bio,
  date_of_birth,
  height_cm,
  weight_kg,
  timezone,
  country_code,
  phone_number,
  onboarding_completed,
  fitness_level,
  goals,
  preferences,
  health_data_sync,
  metadata,
  last_active_at,
  created_at,
  updated_at,
  persona,
  persona_secondary,
  time_commitment,
  onboarding_completed_at,
  onboarding_current_step,
  preferred_workout_types,
  has_completed_assessment,
  weight_unit_preference,
  gender,
  fitzy_opened_at,
  fitzy_intro_seen_at,
  paywall_auto_last_at,
  paywall_aha_shown_at,
  onboarding_flow,
  onboarding_paywall_at,
  paywall_last_opened_at
) on public.profiles to authenticated;

grant update (
  username,
  display_name,
  email,
  avatar_url,
  bio,
  date_of_birth,
  height_cm,
  weight_kg,
  timezone,
  country_code,
  phone_number,
  onboarding_completed,
  fitness_level,
  goals,
  preferences,
  health_data_sync,
  metadata,
  last_active_at,
  updated_at,
  persona,
  persona_secondary,
  time_commitment,
  onboarding_completed_at,
  onboarding_current_step,
  preferred_workout_types,
  has_completed_assessment,
  weight_unit_preference,
  gender,
  fitzy_opened_at,
  fitzy_intro_seen_at,
  paywall_auto_last_at,
  paywall_aha_shown_at,
  onboarding_flow,
  onboarding_paywall_at,
  paywall_last_opened_at
) on public.profiles to authenticated;
