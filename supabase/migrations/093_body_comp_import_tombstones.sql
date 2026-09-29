-- 093: body_comp_import_tombstones — deletions of platform-imported body-composition
-- entries, so a reinstall or a second device does not import them again.
--
-- The import (POST /api/mobile/body-comp/import) dedups against EXISTING rows by
-- (user_id, source, source_external_id). Once the user deletes an imported entry
-- that key is gone, and only a device-local cursor kept the sample from coming
-- back. This table keeps the key (and the measurement time, because a log row
-- stores only the first external id of its 10-minute cluster; sibling samples
-- are matched by time).
--
-- Written by BodyCompositionService.deleteLog, read by importBatch. No trigger,
-- no function. Additive and idempotent. The API works without this migration
-- (tombstones are then simply not recorded / not consulted).

CREATE TABLE IF NOT EXISTS "public"."body_comp_import_tombstones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "source_external_id" "text" NOT NULL,
    "measured_at" timestamp with time zone NOT NULL,
    "deleted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "body_comp_import_tombstones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "body_comp_import_tombstones_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE,
    CONSTRAINT "body_comp_import_tombstones_source_check"
      CHECK (("source" = ANY (ARRAY['healthkit'::"text", 'health_connect'::"text"]))),
    CONSTRAINT "body_comp_import_tombstones_key_uq"
      UNIQUE ("user_id", "source", "source_external_id")
);

CREATE INDEX IF NOT EXISTS "body_comp_import_tombstones_user_time_idx"
  ON "public"."body_comp_import_tombstones" USING "btree" ("user_id", "source", "measured_at");

COMMENT ON TABLE "public"."body_comp_import_tombstones" IS
  'Imported body-composition entries the user deleted. Keyed by the import dedupe key (user, source, external sample id); importBatch skips matching samples and samples within 10 minutes of measured_at. PRIVATE-ONLY data.';

-- RLS: owner-only, same shape as body_composition_logs. The API uses the service
-- role (after verifying the bearer token), which bypasses RLS.
ALTER TABLE "public"."body_comp_import_tombstones" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "body_comp_tombstones_self_select" ON "public"."body_comp_import_tombstones";
CREATE POLICY "body_comp_tombstones_self_select" ON "public"."body_comp_import_tombstones"
  FOR SELECT USING (("user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "body_comp_tombstones_self_insert" ON "public"."body_comp_import_tombstones";
CREATE POLICY "body_comp_tombstones_self_insert" ON "public"."body_comp_import_tombstones"
  FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "body_comp_tombstones_self_delete" ON "public"."body_comp_import_tombstones";
CREATE POLICY "body_comp_tombstones_self_delete" ON "public"."body_comp_import_tombstones"
  FOR DELETE USING (("user_id" = "auth"."uid"()));

GRANT ALL ON TABLE "public"."body_comp_import_tombstones" TO "service_role";
GRANT SELECT, INSERT, DELETE ON TABLE "public"."body_comp_import_tombstones" TO "authenticated";
