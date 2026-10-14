-- ============================================================================
-- 099: Nutrition draft feedback + refinement provenance
-- ============================================================================
-- The confirm card gains a one-tap rating (thumbs up/down) and a free-text
-- "tell me what's wrong" correction that re-runs the vision model. Both are
-- recorded on the draft row in nutrition_training_samples (097) so the
-- production accuracy signal distinguishes "accepted", "edited" and "rated
-- wrong", and so a refined draft can be traced to the draft it corrected.
--
-- Service-role only, no policies (as in 080/097). Logic in
-- NutritionTrainingService — no functions/triggers.
-- ============================================================================

alter table public.nutrition_training_samples
  add column if not exists user_rating       text,          -- 'up' | 'down'
  add column if not exists user_comment      text,
  add column if not exists rated_at          timestamptz,
  add column if not exists refined_from_hash text,          -- parse_hash of the draft this one corrected
  add column if not exists correction        text;          -- the user's free-text correction, when this draft is a refinement

alter table public.nutrition_training_samples
  add constraint nutrition_training_samples_user_rating_check
  check (user_rating is null or user_rating in ('up', 'down'))
  not valid;

comment on column public.nutrition_training_samples.user_rating is 'Thumbs up/down the user gave the draft on the confirm card.';
comment on column public.nutrition_training_samples.refined_from_hash is 'When this draft came from a "fix" correction: the parse_hash of the draft the user corrected.';
comment on column public.nutrition_training_samples.correction is 'The free-text correction the user typed/spoke that produced this draft.';
