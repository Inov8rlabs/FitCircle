-- Migration 073: Structured Exercise Log (Workout Exercise Log feature)
-- Adds a normalized exercise catalog and structured sets on top of exercise_logs.
--
-- See docs/WORKOUT-EXERCISE-LOG-SPEC.md §6 (data model) and §8 (privacy).
--
-- ADDITIVE ONLY. Introduces three new tables:
--   exercises          - normalized movement catalog (global library + per-user custom)
--   workout_exercises  - a movement performed within a workout (exercise_logs row)
--   exercise_sets      - one performance (reps/weight/rpe/...) of a movement
-- Plus denormalized rollup columns on exercise_logs and a weight-unit preference on profiles.
--
-- PRIVACY (spec §8): exercise/set detail is ALWAYS private to the owner and must NEVER be
-- exposed to circles/leaderboards even when the parent workout is_public. Ownership is enforced
-- in the TypeScript service layer via the service-role client (the repo's dominant pattern);
-- the owner-only RLS below is a backstop.

-- ============================================================
-- 1. profiles.weight_unit_preference (kg | lb)
-- ============================================================
-- Canonical storage is kilograms; this is a per-user DISPLAY preference only.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS weight_unit_preference VARCHAR(2) NOT NULL DEFAULT 'kg'
    CHECK (weight_unit_preference IN ('kg', 'lb'));

COMMENT ON COLUMN profiles.weight_unit_preference IS
  'Preferred display unit for weights (kg|lb). Storage is always canonical kilograms; conversion is a display concern.';

-- ============================================================
-- 2. exercises — normalized catalog
-- ============================================================

-- pg_trgm powers the fuzzy/prefix name search index below (already enabled in 055; idempotent).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE exercises (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(120) NOT NULL,
  slug              VARCHAR(140),                 -- normalized for dedup/search
  aliases           TEXT[] NOT NULL DEFAULT '{}', -- search synonyms
  primary_muscle    VARCHAR(40),                  -- chest, back, quads, hamstrings, glutes, shoulders, biceps, triceps, core, calves, forearms, fullBody
  secondary_muscles TEXT[] NOT NULL DEFAULT '{}',
  equipment         VARCHAR(30),                  -- barbell, dumbbell, machine, cable, bodyweight, kettlebell, band, other
  movement          VARCHAR(30),                  -- push, pull, squat, hinge, carry, core, isolation (optional)
  tracking_type     VARCHAR(20) NOT NULL DEFAULT 'weight_reps'
                      CHECK (tracking_type IN ('weight_reps', 'reps_only', 'duration', 'distance_duration')),
  is_custom         BOOLEAN NOT NULL DEFAULT false,
  created_by        UUID REFERENCES profiles(id) ON DELETE CASCADE,  -- null = global library
  is_public         BOOLEAN NOT NULL DEFAULT true,                    -- global = true; custom = false
  is_deleted        BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-text search over name. NOTE: array_to_string() is STABLE (not IMMUTABLE) so it cannot
-- appear in an index expression; aliases are searched via ILIKE + the trigram index below, and
-- the current catalog search uses ILIKE on name, so a name-only tsvector index is sufficient.
CREATE INDEX idx_exercises_search
  ON exercises USING gin (to_tsvector('english', name));

-- Trigram index for fast fuzzy / prefix "instant search" over name (pg_trgm enabled in 055).
CREATE INDEX idx_exercises_name_trgm ON exercises USING gin (name gin_trgm_ops);

-- Fetch a user's custom exercises quickly.
CREATE INDEX idx_exercises_custom ON exercises(created_by) WHERE is_custom = true;

CREATE TRIGGER update_exercises_updated_at
  BEFORE UPDATE ON exercises
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 3. workout_exercises — a movement within a workout
-- ============================================================

CREATE TABLE workout_exercises (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_log_id  UUID NOT NULL REFERENCES exercise_logs(id) ON DELETE CASCADE,
  exercise_id      UUID NOT NULL REFERENCES exercises(id),
  position         INTEGER NOT NULL DEFAULT 0,      -- order within the workout
  superset_group   INTEGER,                          -- null = not a superset (v2)
  notes            TEXT,                             -- per-exercise note (form cue, tempo)
  rest_seconds     INTEGER,                          -- default rest timer for this exercise
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workout_exercises_log ON workout_exercises(exercise_log_id, position);
CREATE INDEX idx_workout_exercises_exercise ON workout_exercises(exercise_id);

-- ============================================================
-- 4. exercise_sets — one performance
-- ============================================================

CREATE TABLE exercise_sets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_exercise_id  UUID NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_number           INTEGER NOT NULL,
  set_type             VARCHAR(12) NOT NULL DEFAULT 'normal'
                        CHECK (set_type IN ('normal', 'warmup', 'drop', 'failure', 'amrap')),
  reps                 INTEGER CHECK (reps IS NULL OR (reps >= 0 AND reps <= 1000)),
  weight_kg            DECIMAL(7,2) CHECK (weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg <= 2000)),
  duration_seconds     INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),  -- duration / distance_duration exercises
  distance_meters      DECIMAL(10,2) CHECK (distance_meters IS NULL OR distance_meters >= 0), -- distance_duration exercises
  rpe                  DECIMAL(3,1) CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),          -- 1-10 RPE
  is_completed         BOOLEAN NOT NULL DEFAULT true,  -- false only in live mode pre-completion
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exercise_sets_we ON exercise_sets(workout_exercise_id, set_number);

-- ============================================================
-- 5. Denormalized rollups on exercise_logs
-- ============================================================
-- Recomputed by the service layer on any write to a workout's exercises (single transaction).
-- Avoids N joins to render list rows / streaks.

ALTER TABLE exercise_logs
  ADD COLUMN IF NOT EXISTS exercise_count   INTEGER,
  ADD COLUMN IF NOT EXISTS total_sets       INTEGER,
  ADD COLUMN IF NOT EXISTS total_volume_kg  DECIMAL(12,2),   -- Σ(reps × weight_kg) over completed working sets
  ADD COLUMN IF NOT EXISTS has_exercise_log BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN exercise_logs.total_volume_kg IS
  'Sum of reps × weight_kg over completed working sets (warmups excluded). Recomputed on write.';

-- ============================================================
-- 6. Row Level Security (owner-only backstop; TS is the real gate)
-- ============================================================

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_sets ENABLE ROW LEVEL SECURITY;

-- exercises: readable if public (global library) OR owned by the requester.
CREATE POLICY "exercises_select_public_or_own"
  ON exercises FOR SELECT
  TO authenticated
  USING (is_public = true OR created_by = auth.uid());

CREATE POLICY "exercises_insert_own_custom"
  ON exercises FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid() AND is_custom = true);

CREATE POLICY "exercises_update_own"
  ON exercises FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "exercises_delete_own"
  ON exercises FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Service role full access on exercises"
  ON exercises FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- workout_exercises: owner via join to exercise_logs.user_id (private even when workout is_public).
CREATE POLICY "workout_exercises_owner_all"
  ON workout_exercises FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM exercise_logs el
    WHERE el.id = workout_exercises.exercise_log_id
      AND el.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM exercise_logs el
    WHERE el.id = workout_exercises.exercise_log_id
      AND el.user_id = auth.uid()
  ));

CREATE POLICY "Service role full access on workout_exercises"
  ON workout_exercises FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- exercise_sets: owner via join workout_exercises -> exercise_logs.
CREATE POLICY "exercise_sets_owner_all"
  ON exercise_sets FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM workout_exercises we
    JOIN exercise_logs el ON el.id = we.exercise_log_id
    WHERE we.id = exercise_sets.workout_exercise_id
      AND el.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM workout_exercises we
    JOIN exercise_logs el ON el.id = we.exercise_log_id
    WHERE we.id = exercise_sets.workout_exercise_id
      AND el.user_id = auth.uid()
  ));

CREATE POLICY "Service role full access on exercise_sets"
  ON exercise_sets FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 7. Grants
-- ============================================================

GRANT ALL ON exercises TO authenticated;
GRANT ALL ON exercises TO service_role;
GRANT ALL ON workout_exercises TO authenticated;
GRANT ALL ON workout_exercises TO service_role;
GRANT ALL ON exercise_sets TO authenticated;
GRANT ALL ON exercise_sets TO service_role;

-- ============================================================
-- 8. Comments
-- ============================================================

COMMENT ON TABLE exercises IS 'Normalized exercise/movement catalog: global library (is_public=true, created_by NULL) + per-user custom (is_custom=true, is_public=false).';
COMMENT ON TABLE workout_exercises IS 'A movement performed within a workout (exercise_logs row). Ordered by position. Private to the owner (never shared to circles).';
COMMENT ON TABLE exercise_sets IS 'One performance of a movement: reps/weight_kg/duration/distance/rpe. Warmups excluded from volume/PR math. Private to the owner.';
COMMENT ON COLUMN exercises.tracking_type IS 'Drives which fields the client shows: weight_reps | reps_only | duration | distance_duration.';
COMMENT ON COLUMN exercise_sets.set_type IS 'normal | warmup | drop | failure | amrap. Warmups are excluded from volume and PR calculations.';
COMMENT ON COLUMN exercise_sets.rpe IS 'Rate of Perceived Exertion, 1-10 scale (app-wide).';
