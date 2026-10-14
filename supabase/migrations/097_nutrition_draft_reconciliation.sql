-- ============================================================================
-- 097: Nutrition draft ↔ saved-entry reconciliation (production accuracy signal)
-- ============================================================================
-- Until now nutrition_training_samples (080) was only written by the mobile
-- training-sample route, which every shipped client has switched off, so there
-- is no production measure of how often the AI draft is accepted or corrected.
--
-- From this migration on the backend writes the row itself:
--   1. the photo/voice parse route inserts a DRAFT row (parsed_items, model,
--      confidence, latency) right after responding;
--   2. the food-log create route links the entry the user then saves to that
--      draft (final_items, totals, per-item edit counts, kcal delta).
-- No client change is required. Everything stays service-role only (RLS from
-- 080: no policies). No images are stored by this path (there is no server-side
-- AI data-sharing consent flag yet).
--
-- Business logic lives in NutritionTrainingService — no functions/triggers.
-- ============================================================================

alter table public.nutrition_training_samples
  alter column final_items drop not null;

alter table public.nutrition_training_samples
  add column if not exists parse_hash      text,
  add column if not exists entry_id        uuid references public.food_log_entries(id) on delete set null,
  add column if not exists reconciled_at   timestamptz,
  add column if not exists link_basis      text,        -- 'items' | 'totals' (how the entry was linked)
  add column if not exists draft_totals    jsonb,       -- {calories, protein_g, carbs_g, fat_g}
  add column if not exists final_totals    jsonb,
  add column if not exists items_added     integer,
  add column if not exists items_removed   integer,
  add column if not exists items_renamed   integer,
  add column if not exists items_matched   integer,
  add column if not exists kcal_delta_pct  numeric,     -- (final − draft) / draft × 100
  add column if not exists grams_delta_pct numeric,     -- mean |final − draft| / draft × 100 over matched items
  add column if not exists latency_ms      integer,
  add column if not exists cached          boolean,
  add column if not exists image_count     integer;

-- The reconciler looks up "this user's newest unreconciled draft".
create index if not exists idx_nutrition_training_samples_unreconciled
  on public.nutrition_training_samples (user_id, created_at desc)
  where reconciled_at is null;

create index if not exists idx_nutrition_training_samples_entry
  on public.nutrition_training_samples (entry_id)
  where entry_id is not null;
