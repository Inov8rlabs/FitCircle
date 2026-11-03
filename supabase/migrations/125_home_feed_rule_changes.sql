-- 125: durable audit log for the home feed editor (Admin Tools "Home feed" module).
--
-- One row per publish / revert attempt made through
--   POST /api/admin/home-feed/publish  and  POST /api/admin/home-feed/revert
-- (docs/HOME_FEED_SPEC.md §9 "Editor"). Written only by the backend with the
-- service role (HomeFeedAdminService); read by GET /api/admin/home-feed/changes
-- and Admin Tools' /audit page.
--
-- `seq` is the ruleset revision: UNIQUE, so two publishes racing for the same
-- revision can't both succeed (the loser gets 409). A publish inserts its row
-- as `pending`, writes the rules, then marks it `applied` (or `rolled_back` /
-- `failed`) — no stored procedures, functions or triggers; the sequencing and
-- compensation live in TypeScript.
--
-- Tables + indexes + RLS only. Apply ALONE (do not `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/125_home_feed_rule_changes.sql
-- then record it in supabase_migrations.schema_migrations like the other
-- single-applied migrations.

create table if not exists public.home_feed_rule_changes (
  id                 uuid primary key default gen_random_uuid(),
  -- Ruleset revision number (1, 2, 3 …); UNIQUE = the publish lock.
  seq                bigint not null,
  created_at         timestamptz not null default now(),
  applied_at         timestamptz,
  -- X-Admin-Actor from Admin Tools (server-to-server), or the signed-in admin's email.
  actor_email        text,
  actor_user_id      uuid references public.profiles(id) on delete set null,
  action             text not null check (action in ('publish', 'revert')),
  status             text not null default 'pending' check (status in ('pending', 'applied', 'rolled_back', 'failed')),
  -- Plain-English description shown in history (written by the editor).
  summary            text not null,
  note               text,
  -- Ruleset content versions (r1-<sha256 prefix>) before and after.
  base_version       text not null,
  version_after      text,
  -- Full rulesets in the flat admin form ({ key, enabled, priority, ...definition }).
  rules_before       jsonb not null default '[]'::jsonb,
  rules_after        jsonb,
  -- { changes: [{ op: create|update|enable|disable|delete, … }], descriptions: [text] }
  diff               jsonb,
  -- Typical-user layouts (card ids) for iOS + Android at publish time.
  layout_before      jsonb,
  layout_after       jsonb,
  -- For action = 'revert': the change whose rules_before was re-published.
  reverts_change_id  uuid references public.home_feed_rule_changes(id) on delete set null,
  request_id         text,
  error              text
);

create unique index if not exists home_feed_rule_changes_seq_key on public.home_feed_rule_changes (seq);
create index if not exists home_feed_rule_changes_created_idx on public.home_feed_rule_changes (created_at desc);
create index if not exists home_feed_rule_changes_actor_idx on public.home_feed_rule_changes (actor_email, created_at desc);

-- Service role only: RLS on with no policies, and no grants to the API roles.
alter table public.home_feed_rule_changes enable row level security;
revoke all on public.home_feed_rule_changes from anon, authenticated;

comment on table public.home_feed_rule_changes is
  'Home feed editor audit log: every publish/revert of home_feed_rules (who, what, before/after rules + layouts). Written by HomeFeedAdminService only.';
