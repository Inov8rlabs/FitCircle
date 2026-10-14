-- ============================================================================
-- 098: Generic foods layer for AI grounding (Food AI accuracy plan, Phase 1)
-- ============================================================================
-- The foods table holds 1.87M USDA rows, ~99% of them branded products. The
-- photo-parse grounding step searched all of them and accepted any row sharing
-- most name tokens, so "fresh banana" was grounded to "FRESH BANANA NUT MUFFIN"
-- (416 kcal/100 g) and cherry tomatoes to a dried snack (346 kcal/100 g). Only
-- 37–50% of grounded items landed within ±20% of the true nutrient density
-- (docs/FOOD-AI-ACCURACY-PLAN-2026-10-13.md §3a).
--
-- This migration tags the ~13.7k generic USDA foods (FNDDS survey foods,
-- SR Legacy, Foundation) so grounding can search them first/only, adds the
-- nutrients the loader never carried (sodium; Foundation energy comes from the
-- Atwater nutrients), a category label for the candidate picker, and a
-- food_portions table with USDA household-measure weights (a "cup" of cooked
-- rice is 158 g, of raw spinach 30 g) so portion units stop defaulting to
-- cup = 240 g.
--
-- Rows are populated by scripts/load-generic-foods.mjs (service role). No
-- functions/triggers; all logic stays in the service layer.
-- ============================================================================

alter table public.foods
  add column if not exists data_type       text,
  add column if not exists category        text,
  add column if not exists sodium_per_100g numeric;

comment on column public.foods.data_type is
  'USDA data type: fndds | sr_legacy | foundation | branded. NULL for OFF/custom/recipe rows and for USDA rows not yet classified (treated as branded).';
comment on column public.foods.category is
  'Reference category label (USDA food_category / WWEIA category). Shown to the grounding candidate picker.';
comment on column public.foods.sodium_per_100g is 'Sodium, milligrams per 100 g (USDA nutrient 1093).';

alter table public.foods
  add constraint foods_data_type_check
  check (data_type is null or data_type in ('fndds', 'sr_legacy', 'foundation', 'branded'))
  not valid;

-- Partial indexes over the generic slice only: grounding queries always filter on data_type,
-- so these stay tiny (~14k rows) instead of scanning the 1.9M-row global GIN indexes.
create index if not exists foods_generic_search_idx
  on public.foods using gin (search_vector)
  where data_type in ('fndds', 'sr_legacy', 'foundation');

create index if not exists foods_generic_name_trgm_idx
  on public.foods using gin (name public.gin_trgm_ops)
  where data_type in ('fndds', 'sr_legacy', 'foundation');

-- Household-measure weights (USDA food_portion.csv), keyed to our foods row.
create table if not exists public.food_portions (
  id                 bigserial primary key,
  food_id            uuid not null references public.foods(id) on delete cascade,
  source_portion_id  text,                 -- USDA food_portion.id (idempotent reload key)
  seq_num            integer,
  amount             numeric not null,     -- e.g. 1, 0.5
  unit               text not null,        -- normalised label: cup, tbsp, tsp, oz, fl oz, slice, piece, large, medium, small, serving, …
  description        text,                 -- original USDA portion text
  gram_weight        numeric not null,
  created_at         timestamptz not null default now(),
  unique (food_id, source_portion_id)
);

comment on table public.food_portions is
  'USDA household-measure weights for generic foods (one row per unit, e.g. "1 cup" = 158 g). Used as portion priors by nutrition grounding and for the client unit picker.';

create index if not exists food_portions_food_id_idx on public.food_portions (food_id);

alter table public.food_portions enable row level security;

-- Reference data: readable by any signed-in user (mirrors foods_read_global_or_own for global rows);
-- writes are service-role only (no insert/update/delete policies).
create policy "food_portions_read_all"
  on public.food_portions for select
  using (true);
