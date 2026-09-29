-- 092: exercise_logs.source_platform — the true origin of a synced workout.
--
-- exercise_logs.source stays 'manual' | 'healthkit' (CHECK unchanged). Released
-- iOS and Android builds both test `source == "healthkit"` to show the synced
-- badge and to lock platform-owned fields, so a Health Connect import keeps
-- being stored as source = 'healthkit'. This nullable column records the origin
-- the client declared ('health_connect' | 'google_fit'); NULL = not declared
-- (every row written before this migration, and every plain 'healthkit' sync).
--
-- Additive and idempotent. No backfill, no trigger, no function. The API works
-- without this migration (ExerciseService retries the insert without the column).

ALTER TABLE "public"."exercise_logs"
  ADD COLUMN IF NOT EXISTS "source_platform" character varying(20);

ALTER TABLE "public"."exercise_logs"
  DROP CONSTRAINT IF EXISTS "exercise_logs_source_platform_check";
ALTER TABLE "public"."exercise_logs"
  ADD CONSTRAINT "exercise_logs_source_platform_check"
  CHECK ((
    "source_platform" IS NULL
    OR ("source_platform")::"text" = ANY (ARRAY[
      'healthkit'::"text", 'health_connect'::"text", 'google_fit'::"text"
    ])
  ));

COMMENT ON COLUMN "public"."exercise_logs"."source_platform" IS
  'Declared origin of a synced workout: health_connect | google_fit (healthkit reserved). NULL = not declared. exercise_logs.source stays manual|healthkit for client compatibility.';
