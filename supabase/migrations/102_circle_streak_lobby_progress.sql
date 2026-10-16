-- ============================================================================
-- 102: referral v3 — 3-day qualification progress, circle streak save pool,
-- lobby kickoff chat posts (docs/REFERRALS_SPEC.md §10). Schema only; logic in
-- referral-service.ts, circle-streak-service.ts, circle-lobby-service.ts.
-- Lobby state itself lives in fitcircles.metadata.lobby (no column needed).
-- ============================================================================

-- "Sam · 2/3 check-ins": distinct activity days so far, and the one-time
-- "one more check-in" push bookkeeping.
alter table public.referrals
  add column if not exists progress_days          integer not null default 0,
  add column if not exists progress_notified_days integer not null default 0;

-- Weekly save budget lookups: a saver's saves in a circle since Monday.
create index if not exists circle_streak_saves_saver_week_idx
  on public.circle_streak_saves (fitcircle_id, saver_user_id, save_date);

-- Circle streak recompute reads a day's claims for a set of members.
create index if not exists streak_claims_date_user_idx
  on public.streak_claims (claim_date, user_id);

-- New system chat posts: "Sam covered Jo — the circle streak lives 🛡️" and
-- "We're 3! … starts now 🎉".
alter table public.circle_messages drop constraint if exists circle_messages_system_event_type_check;
alter table public.circle_messages add constraint circle_messages_system_event_type_check check (
  system_event_type = any (array[
    'workout_done', 'notable_meal', 'streak_milestone', 'circle_streak', 'quest_done',
    'challenge_milestone', 'challenge_resolved', 'daily_summary', 'member_joined',
    'new_challenge', 'meal_logged', 'circle_streak_saved', 'circle_kickoff'
  ]::text[])
);
