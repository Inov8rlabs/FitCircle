-- Migration 071: body composition logs + entitlement gates (BODY_COMP_BUILD_CONTRACT §1)
-- ADDITIVE ONLY. Schema, indexes, constraints, own-row RLS and the shared updated_at trigger
-- only — ALL business logic (derivation, trends, import grouping, entitlement checks) lives in
-- the TypeScript service layer per CLAUDE.md. NO stored procedures.
--
-- Two pieces:
--  1. body_composition_logs — one row per measurement event (manual entry, photo-scanned InBody
--     sheet, HealthKit / Health Connect import, DEXA, smart scale). Canonical metric units (kg,
--     kcal, percent-as-number). segmental is display-only vendor JSONB, stored as given.
--  2. Entitlements — profiles.subscription_tier + feature_gates. Everything ships FREE today;
--     flipping a feature_gates.required_tier row to 'premium' later gates it server-side with
--     zero client releases (clients read GET /api/mobile/entitlements).

-- ----------------------------------------------------------------------------
-- 1. body_composition_logs
-- ----------------------------------------------------------------------------
create table body_composition_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  measured_at timestamptz not null,
  weight_kg numeric(5,2),
  body_fat_pct numeric(4,1),
  fat_mass_kg numeric(5,2),
  skeletal_muscle_mass_kg numeric(5,2),
  lean_body_mass_kg numeric(5,2),
  body_water_kg numeric(5,2),
  bone_mass_kg numeric(4,2),
  visceral_fat_level numeric(4,1),
  bmr_kcal integer,
  segmental jsonb,
  source text not null check (source in ('manual','photo_scan','healthkit','health_connect','dexa','smart_scale')),
  source_external_id text,
  photo_urls text[],
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sanity ranges + "at least one metric" — data-integrity checks only (no logic).
alter table body_composition_logs
  add constraint body_comp_weight_range check (weight_kg is null or (weight_kg between 20 and 400)),
  add constraint body_comp_bf_range check (body_fat_pct is null or (body_fat_pct between 2 and 65)),
  add constraint body_comp_has_metric check (num_nonnulls(weight_kg, body_fat_pct, skeletal_muscle_mass_kg, fat_mass_kg) > 0);

-- Partial unique: dedup platform imports
create unique index body_comp_external_uq on body_composition_logs(user_id, source, source_external_id) where source_external_id is not null;
create unique index body_comp_measured_uq on body_composition_logs(user_id, measured_at, source);
create index body_comp_user_time_idx on body_composition_logs(user_id, measured_at desc);

alter table body_composition_logs enable row level security;

-- Own-row-only RLS (auth floor; the service layer authorizes everything else in TypeScript).
create policy body_comp_self_select on body_composition_logs
  for select using (user_id = auth.uid());
create policy body_comp_self_insert on body_composition_logs
  for insert with check (user_id = auth.uid());
create policy body_comp_self_update on body_composition_logs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy body_comp_self_delete on body_composition_logs
  for delete using (user_id = auth.uid());

create trigger trg_body_composition_logs_updated_at
  before update on body_composition_logs
  for each row execute function update_updated_at();

grant select, insert, update, delete on body_composition_logs to authenticated;

comment on table body_composition_logs is 'One row per body-composition measurement event. Canonical units: kg / kcal / percent-as-number. PRIVATE-ONLY data — never surfaced in circles, feeds, leaderboards, or share cards.';
comment on column body_composition_logs.source_external_id is 'External id from the source platform (HealthKit sample UUID / Health Connect record id) for idempotent import dedup; NULL for FitCircle-native logs.';
comment on column body_composition_logs.segmental is 'Vendor segmental lean analysis, stored as given, display-only: {"trunk":{"leanKg":31.1,"pctOfIdeal":108.7},"leftArm":{...},"rightArm":{...},"leftLeg":{...},"rightLeg":{...}}.';

-- ----------------------------------------------------------------------------
-- 2. Entitlements
-- ----------------------------------------------------------------------------
-- profiles.subscription_tier already exists from 001 (default 'free', check allows
-- 'free'/'premium'/'enterprise'); this is a no-op there and creates it on fresh DBs.
-- The entitlement service coerces any non-'free' tier to 'premium' at the API boundary.
alter table profiles add column if not exists subscription_tier text not null default 'free'
  check (subscription_tier in ('free','premium'));

create table feature_gates (
  feature_key text primary key,
  required_tier text not null default 'free' check (required_tier in ('free','premium')),
  updated_at timestamptz not null default now()
);

alter table feature_gates enable row level security;

-- Readable by every authenticated user; NO client write policies — writes are
-- service-role only (Ani flips required_tier rows to gate features later).
create policy feature_gates_authenticated_select on feature_gates
  for select to authenticated using (true);

create trigger trg_feature_gates_updated_at
  before update on feature_gates
  for each row execute function update_updated_at();

grant select on feature_gates to authenticated;

insert into feature_gates (feature_key) values
  ('body_comp_logging'),('body_comp_photo_scan'),('body_comp_trends'),
  ('body_comp_coach'),('body_comp_segmental')
on conflict (feature_key) do nothing;

comment on table feature_gates is 'Server-driven feature gating: feature_key -> required_tier. Everything defaults to free; flipping a row to premium gates the feature server-side (403 PREMIUM_REQUIRED) and client-side (via GET /api/mobile/entitlements) without a release.';
