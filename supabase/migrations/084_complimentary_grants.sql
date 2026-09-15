-- ============================================================================
-- 084: complimentary Pro grants — upgrade friends/testers to premium without a
-- purchase, from the backend. Audit table only; all logic lives in
-- apps/web/app/lib/services/complimentary-grant-service.ts (no stored procs).
--
-- A row with revoked_at IS NULL and (expires_at IS NULL OR expires_at > now())
-- is an ACTIVE grant. While a grant is active the profile is held at
-- subscription_tier='premium' / platform='promotional', and RevenueCat
-- reconciliation / webhooks never downgrade the profile below it.
-- ============================================================================

create table if not exists public.complimentary_grants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  granted_by   text not null,                       -- who issued it (email / "admin-api")
  note         text,                                -- why (e.g. "beta tester", "friend")
  expires_at   timestamptz,                         -- NULL = until revoked
  revoked_at   timestamptz,
  revoked_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists complimentary_grants_user_active_idx
  on public.complimentary_grants (user_id)
  where revoked_at is null;

alter table public.complimentary_grants enable row level security;
-- Service role only (admin API + subscription service); no client policies.

comment on table public.complimentary_grants is
  'Backend-issued free Pro access. Active = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()).';
