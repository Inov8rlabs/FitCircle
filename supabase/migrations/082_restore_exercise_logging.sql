-- ============================================================================
-- 082: Restore exercise logging catalog
-- ============================================================================
-- RESTORE. This was written as 073_exercise_logging.sql 074_exercise_catalog_seed.sql but never reached production — it was
-- missed in the era when migrations were applied by hand in the SQL editor,
-- and the 000_baseline squash captured production without it. The backend
-- has been querying these objects against a database that does not have
-- them. Body is the original, verbatim.
-- ============================================================================

-- ---- from 073_exercise_logging.sql ----
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

-- ---- from 074_exercise_catalog_seed.sql ----
-- Migration 074: Exercise catalog seed (global library)
-- Companion to 073_exercise_logging.sql. Seeds a curated static list of ~180 common
-- movements into the `exercises` catalog as GLOBAL library rows
-- (is_custom = false, is_public = true, created_by = NULL).
--
-- Coverage: chest / back / legs (quads, hamstrings, glutes, calves) / shoulders /
-- biceps / triceps / forearms / core / full-body & olympic, across barbell, dumbbell,
-- machine, cable, bodyweight, kettlebell, band and "other" equipment, plus a few
-- cardio-machine entries (distance_duration / duration tracking).
--
-- Idempotent: guarded so re-running does not duplicate the global seed.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM exercises WHERE is_custom = false AND name = 'Barbell Bench Press'
  ) THEN

INSERT INTO exercises (name, primary_muscle, secondary_muscles, equipment, movement, tracking_type) VALUES
  ('Barbell Bench Press', 'chest', '{"triceps","shoulders"}', 'barbell', 'push', 'weight_reps'),
  ('Incline Barbell Bench Press', 'chest', '{"shoulders","triceps"}', 'barbell', 'push', 'weight_reps'),
  ('Decline Barbell Bench Press', 'chest', '{"triceps"}', 'barbell', 'push', 'weight_reps'),
  ('Dumbbell Bench Press', 'chest', '{"triceps","shoulders"}', 'dumbbell', 'push', 'weight_reps'),
  ('Incline Dumbbell Press', 'chest', '{"shoulders","triceps"}', 'dumbbell', 'push', 'weight_reps'),
  ('Decline Dumbbell Press', 'chest', '{"triceps"}', 'dumbbell', 'push', 'weight_reps'),
  ('Dumbbell Fly', 'chest', '{"shoulders"}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Incline Dumbbell Fly', 'chest', '{"shoulders"}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Cable Fly', 'chest', '{"shoulders"}', 'cable', 'isolation', 'weight_reps'),
  ('Low Cable Fly', 'chest', '{"shoulders"}', 'cable', 'isolation', 'weight_reps'),
  ('High Cable Fly', 'chest', '{"shoulders"}', 'cable', 'isolation', 'weight_reps'),
  ('Machine Chest Press', 'chest', '{"triceps","shoulders"}', 'machine', 'push', 'weight_reps'),
  ('Incline Machine Chest Press', 'chest', '{"shoulders","triceps"}', 'machine', 'push', 'weight_reps'),
  ('Pec Deck Machine', 'chest', '{"shoulders"}', 'machine', 'isolation', 'weight_reps'),
  ('Smith Machine Bench Press', 'chest', '{"triceps","shoulders"}', 'machine', 'push', 'weight_reps'),
  ('Push-Up', 'chest', '{"triceps","shoulders","core"}', 'bodyweight', 'push', 'reps_only'),
  ('Incline Push-Up', 'chest', '{"triceps","shoulders"}', 'bodyweight', 'push', 'reps_only'),
  ('Decline Push-Up', 'chest', '{"shoulders","triceps"}', 'bodyweight', 'push', 'reps_only'),
  ('Chest Dip', 'chest', '{"triceps","shoulders"}', 'bodyweight', 'push', 'reps_only'),
  ('Deadlift', 'back', '{"glutes","hamstrings","core"}', 'barbell', 'hinge', 'weight_reps'),
  ('Conventional Deadlift', 'back', '{"glutes","hamstrings","core"}', 'barbell', 'hinge', 'weight_reps'),
  ('Sumo Deadlift', 'back', '{"glutes","hamstrings","quads"}', 'barbell', 'hinge', 'weight_reps'),
  ('Romanian Deadlift', 'hamstrings', '{"glutes","back"}', 'barbell', 'hinge', 'weight_reps'),
  ('Barbell Row', 'back', '{"biceps","shoulders"}', 'barbell', 'pull', 'weight_reps'),
  ('Bent-Over Barbell Row', 'back', '{"biceps","shoulders"}', 'barbell', 'pull', 'weight_reps'),
  ('Pendlay Row', 'back', '{"biceps","shoulders"}', 'barbell', 'pull', 'weight_reps'),
  ('T-Bar Row', 'back', '{"biceps","shoulders"}', 'barbell', 'pull', 'weight_reps'),
  ('Dumbbell Row', 'back', '{"biceps","shoulders"}', 'dumbbell', 'pull', 'weight_reps'),
  ('Single-Arm Dumbbell Row', 'back', '{"biceps","shoulders"}', 'dumbbell', 'pull', 'weight_reps'),
  ('Chest-Supported Dumbbell Row', 'back', '{"biceps","shoulders"}', 'dumbbell', 'pull', 'weight_reps'),
  ('Seated Cable Row', 'back', '{"biceps","shoulders"}', 'cable', 'pull', 'weight_reps'),
  ('Wide-Grip Seated Cable Row', 'back', '{"biceps","shoulders"}', 'cable', 'pull', 'weight_reps'),
  ('Lat Pulldown', 'back', '{"biceps"}', 'cable', 'pull', 'weight_reps'),
  ('Wide-Grip Lat Pulldown', 'back', '{"biceps"}', 'cable', 'pull', 'weight_reps'),
  ('Close-Grip Lat Pulldown', 'back', '{"biceps"}', 'cable', 'pull', 'weight_reps'),
  ('Straight-Arm Pulldown', 'back', '{"triceps"}', 'cable', 'isolation', 'weight_reps'),
  ('Pull-Up', 'back', '{"biceps","shoulders"}', 'bodyweight', 'pull', 'reps_only'),
  ('Chin-Up', 'back', '{"biceps"}', 'bodyweight', 'pull', 'reps_only'),
  ('Neutral-Grip Pull-Up', 'back', '{"biceps"}', 'bodyweight', 'pull', 'reps_only'),
  ('Machine Row', 'back', '{"biceps","shoulders"}', 'machine', 'pull', 'weight_reps'),
  ('Machine Lat Pulldown', 'back', '{"biceps"}', 'machine', 'pull', 'weight_reps'),
  ('Inverted Row', 'back', '{"biceps","shoulders"}', 'bodyweight', 'pull', 'reps_only'),
  ('Face Pull', 'shoulders', '{"back"}', 'cable', 'pull', 'weight_reps'),
  ('Back Extension', 'back', '{"glutes","hamstrings"}', 'bodyweight', 'hinge', 'reps_only'),
  ('Rack Pull', 'back', '{"glutes","hamstrings"}', 'barbell', 'hinge', 'weight_reps'),
  ('Barbell Shrug', 'back', '{"shoulders"}', 'barbell', 'isolation', 'weight_reps'),
  ('Dumbbell Shrug', 'back', '{"shoulders"}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Barbell Back Squat', 'quads', '{"glutes","hamstrings","core"}', 'barbell', 'squat', 'weight_reps'),
  ('Barbell Front Squat', 'quads', '{"glutes","core"}', 'barbell', 'squat', 'weight_reps'),
  ('High-Bar Back Squat', 'quads', '{"glutes","hamstrings"}', 'barbell', 'squat', 'weight_reps'),
  ('Low-Bar Back Squat', 'quads', '{"glutes","hamstrings"}', 'barbell', 'squat', 'weight_reps'),
  ('Goblet Squat', 'quads', '{"glutes","core"}', 'dumbbell', 'squat', 'weight_reps'),
  ('Hack Squat', 'quads', '{"glutes"}', 'machine', 'squat', 'weight_reps'),
  ('Leg Press', 'quads', '{"glutes","hamstrings"}', 'machine', 'squat', 'weight_reps'),
  ('Bulgarian Split Squat', 'quads', '{"glutes","hamstrings"}', 'dumbbell', 'squat', 'weight_reps'),
  ('Walking Lunge', 'quads', '{"glutes","hamstrings"}', 'dumbbell', 'squat', 'weight_reps'),
  ('Dumbbell Lunge', 'quads', '{"glutes","hamstrings"}', 'dumbbell', 'squat', 'weight_reps'),
  ('Barbell Lunge', 'quads', '{"glutes","hamstrings"}', 'barbell', 'squat', 'weight_reps'),
  ('Reverse Lunge', 'quads', '{"glutes","hamstrings"}', 'dumbbell', 'squat', 'weight_reps'),
  ('Step-Up', 'quads', '{"glutes"}', 'dumbbell', 'squat', 'weight_reps'),
  ('Leg Extension', 'quads', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Leg Curl', 'hamstrings', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Seated Leg Curl', 'hamstrings', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Lying Leg Curl', 'hamstrings', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Stiff-Leg Deadlift', 'hamstrings', '{"glutes","back"}', 'barbell', 'hinge', 'weight_reps'),
  ('Good Morning', 'hamstrings', '{"glutes","back"}', 'barbell', 'hinge', 'weight_reps'),
  ('Hip Thrust', 'glutes', '{"hamstrings"}', 'barbell', 'hinge', 'weight_reps'),
  ('Barbell Hip Thrust', 'glutes', '{"hamstrings"}', 'barbell', 'hinge', 'weight_reps'),
  ('Glute Bridge', 'glutes', '{"hamstrings"}', 'bodyweight', 'hinge', 'reps_only'),
  ('Cable Pull-Through', 'glutes', '{"hamstrings"}', 'cable', 'hinge', 'weight_reps'),
  ('Standing Calf Raise', 'calves', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Seated Calf Raise', 'calves', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Dumbbell Calf Raise', 'calves', '{}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Smith Machine Calf Raise', 'calves', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Pistol Squat', 'quads', '{"glutes","core"}', 'bodyweight', 'squat', 'reps_only'),
  ('Bodyweight Squat', 'quads', '{"glutes"}', 'bodyweight', 'squat', 'reps_only'),
  ('Sissy Squat', 'quads', '{}', 'bodyweight', 'squat', 'reps_only'),
  ('Hip Adduction Machine', 'quads', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Hip Abduction Machine', 'glutes', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Nordic Hamstring Curl', 'hamstrings', '{}', 'bodyweight', 'isolation', 'reps_only'),
  ('Overhead Press', 'shoulders', '{"triceps","core"}', 'barbell', 'push', 'weight_reps'),
  ('Standing Barbell Overhead Press', 'shoulders', '{"triceps","core"}', 'barbell', 'push', 'weight_reps'),
  ('Seated Barbell Overhead Press', 'shoulders', '{"triceps"}', 'barbell', 'push', 'weight_reps'),
  ('Dumbbell Shoulder Press', 'shoulders', '{"triceps"}', 'dumbbell', 'push', 'weight_reps'),
  ('Seated Dumbbell Shoulder Press', 'shoulders', '{"triceps"}', 'dumbbell', 'push', 'weight_reps'),
  ('Arnold Press', 'shoulders', '{"triceps"}', 'dumbbell', 'push', 'weight_reps'),
  ('Machine Shoulder Press', 'shoulders', '{"triceps"}', 'machine', 'push', 'weight_reps'),
  ('Push Press', 'shoulders', '{"triceps","legs"}', 'barbell', 'push', 'weight_reps'),
  ('Dumbbell Lateral Raise', 'shoulders', '{}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Cable Lateral Raise', 'shoulders', '{}', 'cable', 'isolation', 'weight_reps'),
  ('Machine Lateral Raise', 'shoulders', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Dumbbell Front Raise', 'shoulders', '{}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Cable Front Raise', 'shoulders', '{}', 'cable', 'isolation', 'weight_reps'),
  ('Dumbbell Rear Delt Fly', 'shoulders', '{"back"}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Reverse Pec Deck', 'shoulders', '{"back"}', 'machine', 'isolation', 'weight_reps'),
  ('Upright Row', 'shoulders', '{"back"}', 'barbell', 'pull', 'weight_reps'),
  ('Cable Upright Row', 'shoulders', '{"back"}', 'cable', 'pull', 'weight_reps'),
  ('Landmine Press', 'shoulders', '{"triceps","chest"}', 'barbell', 'push', 'weight_reps'),
  ('Pike Push-Up', 'shoulders', '{"triceps"}', 'bodyweight', 'push', 'reps_only'),
  ('Handstand Push-Up', 'shoulders', '{"triceps"}', 'bodyweight', 'push', 'reps_only'),
  ('Barbell Curl', 'biceps', '{"forearms"}', 'barbell', 'isolation', 'weight_reps'),
  ('EZ-Bar Curl', 'biceps', '{"forearms"}', 'barbell', 'isolation', 'weight_reps'),
  ('Dumbbell Curl', 'biceps', '{"forearms"}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Alternating Dumbbell Curl', 'biceps', '{"forearms"}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Hammer Curl', 'biceps', '{"forearms"}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Incline Dumbbell Curl', 'biceps', '{"forearms"}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Concentration Curl', 'biceps', '{}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Preacher Curl', 'biceps', '{}', 'barbell', 'isolation', 'weight_reps'),
  ('Machine Preacher Curl', 'biceps', '{}', 'machine', 'isolation', 'weight_reps'),
  ('Cable Curl', 'biceps', '{"forearms"}', 'cable', 'isolation', 'weight_reps'),
  ('Cable Rope Hammer Curl', 'biceps', '{"forearms"}', 'cable', 'isolation', 'weight_reps'),
  ('Spider Curl', 'biceps', '{}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Chin-Up (Biceps Focus)', 'biceps', '{"back"}', 'bodyweight', 'pull', 'reps_only'),
  ('Close-Grip Bench Press', 'triceps', '{"chest","shoulders"}', 'barbell', 'push', 'weight_reps'),
  ('Triceps Pushdown', 'triceps', '{}', 'cable', 'isolation', 'weight_reps'),
  ('Rope Triceps Pushdown', 'triceps', '{}', 'cable', 'isolation', 'weight_reps'),
  ('Overhead Cable Triceps Extension', 'triceps', '{}', 'cable', 'isolation', 'weight_reps'),
  ('Overhead Dumbbell Triceps Extension', 'triceps', '{}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Skull Crusher', 'triceps', '{}', 'barbell', 'isolation', 'weight_reps'),
  ('Dumbbell Skull Crusher', 'triceps', '{}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Triceps Kickback', 'triceps', '{}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Bench Dip', 'triceps', '{"chest","shoulders"}', 'bodyweight', 'push', 'reps_only'),
  ('Triceps Dip', 'triceps', '{"chest","shoulders"}', 'bodyweight', 'push', 'reps_only'),
  ('Diamond Push-Up', 'triceps', '{"chest"}', 'bodyweight', 'push', 'reps_only'),
  ('JM Press', 'triceps', '{"chest"}', 'barbell', 'push', 'weight_reps'),
  ('Barbell Wrist Curl', 'forearms', '{}', 'barbell', 'isolation', 'weight_reps'),
  ('Dumbbell Wrist Curl', 'forearms', '{}', 'dumbbell', 'isolation', 'weight_reps'),
  ('Reverse Wrist Curl', 'forearms', '{}', 'barbell', 'isolation', 'weight_reps'),
  ('Reverse Barbell Curl', 'forearms', '{"biceps"}', 'barbell', 'isolation', 'weight_reps'),
  ('Farmer''s Carry', 'forearms', '{"core","back"}', 'dumbbell', 'carry', 'weight_reps'),
  ('Dead Hang', 'forearms', '{"back"}', 'bodyweight', 'carry', 'duration'),
  ('Plank', 'core', '{"shoulders"}', 'bodyweight', 'core', 'duration'),
  ('Side Plank', 'core', '{}', 'bodyweight', 'core', 'duration'),
  ('Hanging Leg Raise', 'core', '{"forearms"}', 'bodyweight', 'core', 'reps_only'),
  ('Hanging Knee Raise', 'core', '{}', 'bodyweight', 'core', 'reps_only'),
  ('Captain''s Chair Leg Raise', 'core', '{}', 'machine', 'core', 'reps_only'),
  ('Crunch', 'core', '{}', 'bodyweight', 'core', 'reps_only'),
  ('Cable Crunch', 'core', '{}', 'cable', 'core', 'weight_reps'),
  ('Bicycle Crunch', 'core', '{}', 'bodyweight', 'core', 'reps_only'),
  ('Sit-Up', 'core', '{}', 'bodyweight', 'core', 'reps_only'),
  ('Russian Twist', 'core', '{}', 'bodyweight', 'core', 'reps_only'),
  ('Ab Wheel Rollout', 'core', '{"shoulders"}', 'other', 'core', 'reps_only'),
  ('Mountain Climber', 'core', '{"shoulders"}', 'bodyweight', 'core', 'reps_only'),
  ('Dead Bug', 'core', '{}', 'bodyweight', 'core', 'reps_only'),
  ('Hollow Body Hold', 'core', '{}', 'bodyweight', 'core', 'duration'),
  ('Leg Raise', 'core', '{}', 'bodyweight', 'core', 'reps_only'),
  ('Decline Sit-Up', 'core', '{}', 'bodyweight', 'core', 'reps_only'),
  ('Machine Ab Crunch', 'core', '{}', 'machine', 'core', 'weight_reps'),
  ('Pallof Press', 'core', '{}', 'cable', 'core', 'weight_reps'),
  ('Wood Chop', 'core', '{"shoulders"}', 'cable', 'core', 'weight_reps'),
  ('Power Clean', 'fullBody', '{"back","legs","shoulders"}', 'barbell', 'pull', 'weight_reps'),
  ('Hang Clean', 'fullBody', '{"back","legs","shoulders"}', 'barbell', 'pull', 'weight_reps'),
  ('Clean and Jerk', 'fullBody', '{"legs","shoulders","back"}', 'barbell', 'pull', 'weight_reps'),
  ('Snatch', 'fullBody', '{"legs","shoulders","back"}', 'barbell', 'pull', 'weight_reps'),
  ('Clean and Press', 'fullBody', '{"shoulders","legs","back"}', 'barbell', 'push', 'weight_reps'),
  ('Thruster', 'fullBody', '{"quads","shoulders"}', 'barbell', 'squat', 'weight_reps'),
  ('Dumbbell Thruster', 'fullBody', '{"quads","shoulders"}', 'dumbbell', 'squat', 'weight_reps'),
  ('Kettlebell Swing', 'glutes', '{"hamstrings","core","shoulders"}', 'kettlebell', 'hinge', 'weight_reps'),
  ('Kettlebell Goblet Squat', 'quads', '{"glutes","core"}', 'kettlebell', 'squat', 'weight_reps'),
  ('Kettlebell Clean', 'fullBody', '{"legs","shoulders"}', 'kettlebell', 'pull', 'weight_reps'),
  ('Kettlebell Snatch', 'fullBody', '{"legs","shoulders"}', 'kettlebell', 'pull', 'weight_reps'),
  ('Turkish Get-Up', 'fullBody', '{"core","shoulders"}', 'kettlebell', 'carry', 'weight_reps'),
  ('Burpee', 'fullBody', '{"chest","legs","core"}', 'bodyweight', 'squat', 'reps_only'),
  ('Box Jump', 'quads', '{"glutes","calves"}', 'bodyweight', 'squat', 'reps_only'),
  ('Wall Ball', 'fullBody', '{"quads","shoulders"}', 'other', 'squat', 'reps_only'),
  ('Battle Ropes', 'fullBody', '{"shoulders","core"}', 'other', 'core', 'duration'),
  ('Sled Push', 'quads', '{"glutes","core"}', 'machine', 'carry', 'distance_duration'),
  ('Sled Pull', 'quads', '{"back","core"}', 'machine', 'carry', 'distance_duration'),
  ('Medicine Ball Slam', 'core', '{"shoulders"}', 'other', 'core', 'reps_only'),
  ('Muscle-Up', 'back', '{"chest","triceps","shoulders"}', 'bodyweight', 'pull', 'reps_only'),
  ('Band Pull-Apart', 'shoulders', '{"back"}', 'band', 'pull', 'reps_only'),
  ('Band Bicep Curl', 'biceps', '{}', 'band', 'isolation', 'reps_only'),
  ('Band Lateral Raise', 'shoulders', '{}', 'band', 'isolation', 'reps_only'),
  ('Band Face Pull', 'shoulders', '{"back"}', 'band', 'pull', 'reps_only'),
  ('Band Squat', 'quads', '{"glutes"}', 'band', 'squat', 'reps_only'),
  ('Treadmill Run', 'fullBody', '{"legs"}', 'machine', 'carry', 'distance_duration'),
  ('Rowing Machine', 'back', '{"legs","arms","core"}', 'machine', 'pull', 'distance_duration'),
  ('Stationary Bike', 'quads', '{"hamstrings"}', 'machine', 'squat', 'distance_duration'),
  ('Elliptical', 'fullBody', '{"legs","arms"}', 'machine', 'carry', 'distance_duration'),
  ('Stair Climber', 'quads', '{"glutes","calves"}', 'machine', 'carry', 'duration'),
  ('Assault Bike', 'fullBody', '{"legs","arms"}', 'machine', 'carry', 'duration'),
  ('Jump Rope', 'calves', '{"shoulders"}', 'other', 'carry', 'duration')
;
    -- Backfill slug from name for the rows just inserted (normalized, lowercase, dash-joined).
    UPDATE exercises
    SET slug = trim(both '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
    WHERE is_custom = false AND slug IS NULL;

  END IF;
END $$;

