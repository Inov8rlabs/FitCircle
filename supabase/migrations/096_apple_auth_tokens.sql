-- ============================================================================
-- 096: apple_auth_tokens — the Sign in with Apple refresh token of each user,
-- kept only so it can be revoked when the account is deleted
-- (App Store Review Guideline 5.1.1(v): apps that offer Sign in with Apple must
-- revoke the user's tokens on account deletion).
--
-- Written at sign-in by AppleTokenService.exchangeAndStoreRefreshToken
-- (authorization_code -> https://appleid.apple.com/auth/token), read by
-- AccountDeletionService just before the profile is deleted
-- (-> https://appleid.apple.com/auth/revoke). All logic lives in
-- apps/web/app/lib/services/apple-token-service.ts. No trigger, no function.
--
-- Additive and idempotent. The API works without this migration: the token is
-- then not stored and revocation is skipped (both paths tolerate the missing
-- table).
--
-- The token is a credential: RLS is enabled with NO policies and the client
-- roles have no privileges, so only the service role can read or write it.
-- ============================================================================

create table if not exists public.apple_auth_tokens (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  refresh_token  text not null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table public.apple_auth_tokens enable row level security;
-- Service role only; no client policies.

revoke all on table public.apple_auth_tokens from anon, authenticated;

comment on table public.apple_auth_tokens is
  'Sign in with Apple refresh token per user, stored only to revoke it on account deletion. Service role only.';
