-- Nutrition model-training capture (the correction "data flywheel").
--
-- When a user reviews an AI-parsed meal on the confirm card and accepts/corrects it,
-- we capture (image, original AI draft, final confirmed labels). The diff between the
-- draft and the final is a high-value supervised signal for future food-vision
-- fine-tuning / distillation, and tells us which foods the model + DB get wrong.
--
-- INTERNAL/ADMIN ONLY: RLS denies all client access; rows are written by the service
-- role from the training-sample route. Capture is also gated by the
-- NUTRITION_TRAINING_CAPTURE env flag (off by default) so nothing is stored until the
-- team explicitly enables it AND the privacy policy covers training use of user photos.

create table if not exists public.nutrition_training_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  input_method text,                       -- 'photo' | 'voice'
  model text,                              -- model that produced the draft
  overall_confidence double precision,
  was_edited boolean not null default false,
  parsed_items jsonb not null,             -- the ORIGINAL AI draft items
  final_items jsonb not null,              -- the user-confirmed / corrected items
  image_path text                          -- path in the private nutrition-training bucket
);

create index if not exists idx_nutrition_training_samples_user_created
  on public.nutrition_training_samples (user_id, created_at desc);

-- Edited samples are the richest correction signal — index for fast export.
create index if not exists idx_nutrition_training_samples_edited
  on public.nutrition_training_samples (was_edited, created_at desc);

alter table public.nutrition_training_samples enable row level security;
-- No policies → clients get nothing; the service role bypasses RLS for writes/exports.

-- Private storage bucket for the training images (one copy, keyed by content hash).
insert into storage.buckets (id, name, public)
values ('nutrition-training', 'nutrition-training', false)
on conflict (id) do nothing;
