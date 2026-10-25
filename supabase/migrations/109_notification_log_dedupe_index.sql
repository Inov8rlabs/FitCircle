-- ============================================================================
-- 109: notification_log dedupe index (docs/PUSH_NOTIFICATIONS.md §3).
--
-- NotificationOrchestrator.send() suppresses a push as 'duplicate' when the
-- user already has a delivered (suppressed = false) row with the same
-- data->>'dedupeKey' in the last 24 h. This index makes that lookup cheap.
-- The code works without it (the query just scans the user's recent rows via
-- idx_notification_log_user), so it is safe to apply at any time.
--
-- Index only. No functions, no triggers. Idempotent.
-- Note: on a large table prefer running the CREATE INDEX CONCURRENTLY form
-- below by hand (CONCURRENTLY cannot run inside a migration transaction).
--   create index concurrently if not exists idx_notification_log_user_dedupe_key
--     on public.notification_log (user_id, (data ->> 'dedupeKey'), sent_at desc)
--     where (data ->> 'dedupeKey') is not null;
-- ============================================================================

create index if not exists idx_notification_log_user_dedupe_key
  on public.notification_log (user_id, (data ->> 'dedupeKey'), sent_at desc)
  where (data ->> 'dedupeKey') is not null;
