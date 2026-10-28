-- ============================================================================
-- 113: experiment layers — mutual exclusion groups
-- (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.2–§6.3, §6.8).
--
-- A layer owns a salt. Each experiment in a layer reserves a bucket slice
-- [layer_start, layer_end) of experimentBucket(user, layer.salt) ∈ [0, 10000);
-- slices of draft/running/paused experiments in one layer never overlap, so a
-- user can be randomised into at most one of them. Overlap validation,
-- assignment and the layer_conflict backstop live in
-- apps/web/app/lib/experiments/* (no functions, no triggers).
--
-- Requires 112. Apply ALONE after 112 (db query + schema_migrations insert);
-- never `db push --include-all` (104 is still unapplied). Idempotent.
-- ============================================================================

create table if not exists public.experiment_layers (
  key          text primary key check (key ~ '^[a-z0-9][a-z0-9_]{0,63}$'),
  name         text not null,
  description  text,
  -- Random at creation, immutable (changing it would reshuffle every slice).
  salt         text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.experiment_layers enable row level security;
-- Intentionally no policies: service role only.

alter table public.experiments add column if not exists layer_key   text references public.experiment_layers(key);
alter table public.experiments add column if not exists layer_start int;
alter table public.experiments add column if not exists layer_end   int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'experiments_layer_slice_check') then
    alter table public.experiments
      add constraint experiments_layer_slice_check check (
        (layer_key is null and layer_start is null and layer_end is null)
        or (layer_key is not null and layer_start is not null and layer_end is not null
            and layer_start >= 0 and layer_start < layer_end and layer_end <= 10000)
      );
  end if;
end $$;

create index if not exists experiments_layer_key_idx on public.experiments (layer_key) where layer_key is not null;

-- Two new assignment reasons: 'layer' (outside the slice) and 'layer_conflict'
-- (already randomised into a running/paused sibling of the same layer).
alter table public.experiment_assignments drop constraint if exists experiment_assignments_reason_check;
alter table public.experiment_assignments
  add constraint experiment_assignments_reason_check
  check (reason in ('bucket', 'override', 'fallback', 'winner', 'layer', 'layer_conflict'));
