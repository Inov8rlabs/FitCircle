-- 088: profiles.gender — "Sex / Gender" from onboarding and Edit Profile.
--
-- iOS (UpdateProfileRequest.gender) and Android (OnboardingProfileRequest.gender)
-- already send `gender` on PUT /api/mobile/profile; until now the value was
-- dropped because there was no column.
--
-- The allowed values are EXACTLY the wire values both clients send and decode:
--   iOS     Core/Models/User.swift            enum UserGender (String raw values)
--   Android features/onboarding/models/...    enum UserGender (@SerialName)
-- iOS decodes `gender` as a closed enum with no fallback, so a value outside
-- this list in a profile response would fail the whole User decode. Do not
-- widen this list without shipping a tolerant iOS decoder first.
--
-- Nullable, no default: existing rows stay NULL ("not provided").
-- Schema only: validation and persistence live in apps/web
-- (lib/validation/profile-validation.ts, MobileAPIService.updateUserProfile).
-- The API keeps working before this migration is applied: the profile update
-- retries without `gender` when the column does not exist yet.

ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "gender" "text";

ALTER TABLE "public"."profiles"
  DROP CONSTRAINT IF EXISTS "profiles_gender_check";
ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_gender_check"
  CHECK (("gender" IS NULL) OR ("gender" = ANY (ARRAY[
    'female'::"text", 'male'::"text", 'non_binary'::"text", 'prefer_not_to_say'::"text"
  ])));

COMMENT ON COLUMN "public"."profiles"."gender" IS
  'Self-reported sex/gender: female | male | non_binary | prefer_not_to_say. NULL = not provided.';
