-- Migration 064: remove provably-dead stored procedures (tech-debt cleanup)
-- Honors the project rule (CLAUDE.md): business logic in TS, not the DB.
--
-- Each function below was verified DEAD before removal (audited 2026-06-04):
--   • 0 trigger references (pg_trigger)        — not backing any trigger
--   • 0 calls from app code (.rpc / name refs) — across BE, iOS, Android (excl. build/migrations)
--   • 0 references inside other function bodies (pg_get_functiondef)
--   • 0 references in views or column defaults
-- These are leftovers from the original DB-centric design (migrations 003/004) that the app
-- never adopted (zero .rpc() callers anywhere). The equivalent behavior, where still needed,
-- lives in the TypeScript service layer.
--
-- NOT touched (deliberately): the update_*_updated_at timestamp-trigger functions (live, allowed
-- per CLAUDE.md as simple timestamp triggers) and all pg_trgm extension functions (gtrgm_*,
-- *_similarity*, gin_trgm_*, set_limit/show_trgm — owned by the pg_trgm extension that powers
-- foods search; removing them would break the extension).

DROP FUNCTION IF EXISTS public.calculate_progress_percentage(p_goal_type text, p_start_value numeric, p_current_value numeric, p_target_value numeric);
DROP FUNCTION IF EXISTS public.decrement_image_count(entry_id uuid);
DROP FUNCTION IF EXISTS public.decrement_shield_count(p_user_id uuid, p_shield_type character varying);
DROP FUNCTION IF EXISTS public.generate_unique_invite_code();
DROP FUNCTION IF EXISTS public.get_total_shields(p_user_id uuid);
DROP FUNCTION IF EXISTS public.increment_image_count(entry_id uuid);
DROP FUNCTION IF EXISTS public.initialize_circle_streak(p_circle_id uuid);
DROP FUNCTION IF EXISTS public.initialize_engagement_streak(p_user_id uuid);
DROP FUNCTION IF EXISTS public.initialize_metric_streak(p_user_id uuid, p_metric_type text, p_grace_days integer);
DROP FUNCTION IF EXISTS public.initialize_streak_shields(p_user_id uuid);
