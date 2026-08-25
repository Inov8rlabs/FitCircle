-- ============================================================================
-- 000_baseline: FitCircle production schema, captured 2026-08-04
-- ============================================================================
-- Squashed baseline. Migrations 001-076 were applied to production over time,
-- partly by hand in the Supabase SQL editor, which left the remote migration
-- history recording only 001-005 and the local files describing a schema that
-- production no longer matched. This file is a pg_dump of production as it
-- actually is, so the migration set and the database agree again.
--
-- The originals are kept verbatim in supabase/_archive/migrations_pre_baseline/
-- for historical reference. Do not re-apply them.
--
-- Everything from here forward is a normal numbered migration (078+) applied
-- with 'supabase db push'. See supabase/README.md.
-- ============================================================================

--
-- PostgreSQL database dump
--

-- \restrict GWdtNEtU1TLamuu50czsHopauMuZIGqVTtM1eFzV9NVneVjgGDPXKRspNtFmYXT

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pg_stat_statements"; Type: COMMENT; Schema: -; Owner: 
--

-- COMMENT ON EXTENSION "pg_stat_statements" IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";


--
-- Name: EXTENSION "pg_trgm"; Type: COMMENT; Schema: -; Owner: 
--

-- COMMENT ON EXTENSION "pg_trgm" IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pgcrypto"; Type: COMMENT; Schema: -; Owner: 
--

-- COMMENT ON EXTENSION "pgcrypto" IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";


--
-- Name: EXTENSION "supabase_vault"; Type: COMMENT; Schema: -; Owner: 
--

-- COMMENT ON EXTENSION "supabase_vault" IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

-- COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: achievement_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."achievement_type" AS ENUM (
    'milestone',
    'streak',
    'ranking',
    'participation',
    'special'
);


ALTER TYPE "public"."achievement_type" OWNER TO "postgres";

--
-- Name: challenge_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."challenge_status" AS ENUM (
    'draft',
    'upcoming',
    'active',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."challenge_status" OWNER TO "postgres";

--
-- Name: challenge_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."challenge_type" AS ENUM (
    'weight_loss',
    'step_count',
    'workout_minutes',
    'custom'
);


ALTER TYPE "public"."challenge_type" OWNER TO "postgres";

--
-- Name: challenge_visibility; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."challenge_visibility" AS ENUM (
    'public',
    'private',
    'invite_only'
);


ALTER TYPE "public"."challenge_visibility" OWNER TO "postgres";

--
-- Name: notification_channel; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."notification_channel" AS ENUM (
    'push',
    'email',
    'sms',
    'in_app'
);


ALTER TYPE "public"."notification_channel" OWNER TO "postgres";

--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."notification_type" AS ENUM (
    'challenge_invite',
    'team_invite',
    'check_in_reminder',
    'achievement',
    'comment',
    'reaction',
    'leaderboard_update',
    'system'
);


ALTER TYPE "public"."notification_type" OWNER TO "postgres";

--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'processing',
    'succeeded',
    'failed',
    'cancelled',
    'refunded'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";

--
-- Name: reaction_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."reaction_type" AS ENUM (
    'like',
    'love',
    'celebrate',
    'fire',
    'muscle',
    'trophy'
);


ALTER TYPE "public"."reaction_type" OWNER TO "postgres";

--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."subscription_status" AS ENUM (
    'trialing',
    'active',
    'cancelled',
    'past_due',
    'unpaid',
    'incomplete'
);


ALTER TYPE "public"."subscription_status" OWNER TO "postgres";

--
-- Name: team_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."team_role" AS ENUM (
    'captain',
    'member'
);


ALTER TYPE "public"."team_role" OWNER TO "postgres";

--
-- Name: update_circle_streak_tracking_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_circle_streak_tracking_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_circle_streak_tracking_updated_at"() OWNER TO "postgres";

--
-- Name: update_daily_tracking_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_daily_tracking_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_daily_tracking_updated_at"() OWNER TO "postgres";

--
-- Name: update_engagement_streaks_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_engagement_streaks_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_engagement_streaks_updated_at"() OWNER TO "postgres";

--
-- Name: update_metric_streaks_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_metric_streaks_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_metric_streaks_updated_at"() OWNER TO "postgres";

--
-- Name: update_onboarding_progress_timestamp(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_onboarding_progress_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_onboarding_progress_timestamp"() OWNER TO "postgres";

--
-- Name: update_streak_recoveries_timestamp(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_streak_recoveries_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_streak_recoveries_timestamp"() OWNER TO "postgres";

--
-- Name: update_streak_shields_timestamp(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_streak_shields_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_streak_shields_timestamp"() OWNER TO "postgres";

--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

--
-- Name: update_user_goals_timestamp(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."update_user_goals_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_goals_timestamp"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: achievements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."achievements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "challenge_id" "uuid",
    "type" "public"."achievement_type" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "icon_url" "text",
    "badge_url" "text",
    "points" integer DEFAULT 0,
    "level" integer DEFAULT 1,
    "unlocked_at" timestamp with time zone DEFAULT "now"(),
    "progress" numeric(5,2) DEFAULT 100,
    "criteria" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "shared" boolean DEFAULT false,
    "shared_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."achievements" OWNER TO "postgres";

--
-- Name: beverage_log_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."beverage_log_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "beverage_log_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "storage_bucket" "text" DEFAULT 'beverage-logs'::"text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_size_bytes" bigint NOT NULL,
    "mime_type" "text" NOT NULL,
    "width" integer,
    "height" integer,
    "thumbnail_path" "text",
    "display_order" integer DEFAULT 0,
    "upload_ip" "text",
    "upload_user_agent" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "bev_img_valid_file_size" CHECK ((("file_size_bytes" > 0) AND ("file_size_bytes" <= 10485760))),
    CONSTRAINT "bev_img_valid_mime_type" CHECK (("mime_type" = ANY (ARRAY['image/jpeg'::"text", 'image/png'::"text", 'image/webp'::"text", 'image/heic'::"text"])))
);


ALTER TABLE "public"."beverage_log_images" OWNER TO "postgres";

--
-- Name: TABLE "beverage_log_images"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."beverage_log_images" IS 'Photos attached to beverage_logs entries (alcohol labels, latte art, etc).';


--
-- Name: beverage_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."beverage_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "beverage_type" "text" NOT NULL,
    "customizations" "jsonb" DEFAULT '{}'::"jsonb",
    "volume_ml" integer NOT NULL,
    "calories" integer,
    "caffeine_mg" integer,
    "sugar_g" numeric(6,2),
    "notes" "text",
    "is_favorite" boolean DEFAULT false,
    "favorite_name" "text",
    "is_private" boolean DEFAULT true,
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "entry_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "source" "text" DEFAULT 'manual'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "beverage_logs_caffeine_mg_check" CHECK ((("caffeine_mg" >= 0) AND ("caffeine_mg" <= 1000))),
    CONSTRAINT "beverage_logs_calories_check" CHECK ((("calories" >= 0) AND ("calories" <= 5000))),
    CONSTRAINT "beverage_logs_category_check" CHECK (("category" = ANY (ARRAY['water'::"text", 'coffee'::"text", 'tea'::"text", 'smoothie'::"text", 'protein_shake'::"text", 'juice'::"text", 'soda'::"text", 'alcohol'::"text", 'energy_drink'::"text", 'sports_drink'::"text", 'milk'::"text", 'other'::"text"]))),
    CONSTRAINT "beverage_logs_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'import'::"text", 'api'::"text", 'ios'::"text", 'android'::"text", 'web'::"text"]))),
    CONSTRAINT "beverage_logs_sugar_g_check" CHECK ((("sugar_g" >= (0)::numeric) AND ("sugar_g" <= (500)::numeric))),
    CONSTRAINT "beverage_logs_volume_ml_check" CHECK ((("volume_ml" > 0) AND ("volume_ml" <= 10000))),
    CONSTRAINT "favorite_name_required" CHECK ((("is_favorite" = false) OR (("is_favorite" = true) AND ("favorite_name" IS NOT NULL))))
);


ALTER TABLE "public"."beverage_logs" OWNER TO "postgres";

--
-- Name: TABLE "beverage_logs"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."beverage_logs" IS 'Comprehensive beverage tracking with customizations, nutrition, and favorites';


--
-- Name: COLUMN "beverage_logs"."category"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."category" IS 'Broad beverage category for filtering and grouping';


--
-- Name: COLUMN "beverage_logs"."beverage_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."beverage_type" IS 'Specific beverage name or type';


--
-- Name: COLUMN "beverage_logs"."customizations"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."customizations" IS 'Flexible JSONB storage for size, temperature, add-ins, etc.';


--
-- Name: COLUMN "beverage_logs"."volume_ml"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."volume_ml" IS 'Volume in milliliters (1-10000)';


--
-- Name: COLUMN "beverage_logs"."calories"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."calories" IS 'Total calories (0-5000)';


--
-- Name: COLUMN "beverage_logs"."caffeine_mg"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."caffeine_mg" IS 'Caffeine content in milligrams (0-1000)';


--
-- Name: COLUMN "beverage_logs"."sugar_g"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."sugar_g" IS 'Sugar content in grams (0-500)';


--
-- Name: COLUMN "beverage_logs"."is_favorite"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."is_favorite" IS 'Whether this beverage configuration is saved as a favorite';


--
-- Name: COLUMN "beverage_logs"."favorite_name"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."favorite_name" IS 'Custom name for favorite beverages (required when is_favorite=true)';


--
-- Name: COLUMN "beverage_logs"."is_private"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."is_private" IS 'Privacy control for sharing features';


--
-- Name: COLUMN "beverage_logs"."source"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."beverage_logs"."source" IS 'Platform or method used to log the beverage';


--
-- Name: body_comp_parse_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."body_comp_parse_cache" (
    "image_hash" "text" NOT NULL,
    "result" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."body_comp_parse_cache" OWNER TO "postgres";

--
-- Name: body_comp_parse_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."body_comp_parse_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "image_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."body_comp_parse_log" OWNER TO "postgres";

--
-- Name: body_composition_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."body_composition_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "measured_at" timestamp with time zone NOT NULL,
    "weight_kg" numeric(5,2),
    "body_fat_pct" numeric(4,1),
    "fat_mass_kg" numeric(5,2),
    "skeletal_muscle_mass_kg" numeric(5,2),
    "lean_body_mass_kg" numeric(5,2),
    "body_water_kg" numeric(5,2),
    "bone_mass_kg" numeric(4,2),
    "visceral_fat_level" numeric(4,1),
    "bmr_kcal" integer,
    "segmental" "jsonb",
    "source" "text" NOT NULL,
    "source_external_id" "text",
    "photo_urls" "text"[],
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "body_comp_bf_range" CHECK ((("body_fat_pct" IS NULL) OR (("body_fat_pct" >= (2)::numeric) AND ("body_fat_pct" <= (65)::numeric)))),
    CONSTRAINT "body_comp_has_metric" CHECK (("num_nonnulls"("weight_kg", "body_fat_pct", "skeletal_muscle_mass_kg", "fat_mass_kg") > 0)),
    CONSTRAINT "body_comp_weight_range" CHECK ((("weight_kg" IS NULL) OR (("weight_kg" >= (20)::numeric) AND ("weight_kg" <= (400)::numeric)))),
    CONSTRAINT "body_composition_logs_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'photo_scan'::"text", 'healthkit'::"text", 'health_connect'::"text", 'dexa'::"text", 'smart_scale'::"text"])))
);


ALTER TABLE "public"."body_composition_logs" OWNER TO "postgres";

--
-- Name: TABLE "body_composition_logs"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."body_composition_logs" IS 'One row per body-composition measurement event. Canonical units: kg / kcal / percent-as-number. PRIVATE-ONLY data — never surfaced in circles, feeds, leaderboards, or share cards.';


--
-- Name: COLUMN "body_composition_logs"."segmental"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."body_composition_logs"."segmental" IS 'Vendor segmental lean analysis, stored as given, display-only: {"trunk":{"leanKg":31.1,"pctOfIdeal":108.7},"leftArm":{...},"rightArm":{...},"leftLeg":{...},"rightLeg":{...}}.';


--
-- Name: COLUMN "body_composition_logs"."source_external_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."body_composition_logs"."source_external_id" IS 'External id from the source platform (HealthKit sample UUID / Health Connect record id) for idempotent import dedup; NULL for FitCircle-native logs.';


--
-- Name: challenge_invitations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."challenge_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "invited_email" "text",
    "invited_user_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"(),
    "responded_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    CONSTRAINT "challenge_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."challenge_invitations" OWNER TO "postgres";

--
-- Name: challenge_invites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."challenge_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "inviter_id" "uuid" NOT NULL,
    "invitee_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "responded_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    CONSTRAINT "circle_challenge_invites_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."challenge_invites" OWNER TO "postgres";

--
-- Name: challenge_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."challenge_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "note" "text",
    "logged_at" timestamp with time zone DEFAULT "now"(),
    "log_date" "date" DEFAULT CURRENT_DATE,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "circle_challenge_logs_amount_check" CHECK ((("amount" > (0)::numeric) AND ("amount" <= (10000)::numeric))),
    CONSTRAINT "circle_challenge_logs_note_check" CHECK (("char_length"("note") <= 80))
);


ALTER TABLE "public"."challenge_logs" OWNER TO "postgres";

--
-- Name: challenge_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."challenge_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "invited_by" "uuid",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "cumulative_total" numeric(12,2) DEFAULT 0,
    "today_total" numeric(12,2) DEFAULT 0,
    "today_date" "date" DEFAULT CURRENT_DATE,
    "current_streak" integer DEFAULT 0,
    "longest_streak" integer DEFAULT 0,
    "last_logged_at" timestamp with time zone,
    "log_count" integer DEFAULT 0,
    "rank" integer,
    "goal_completion_pct" numeric(5,2) DEFAULT 0,
    "milestones_achieved" "jsonb" DEFAULT '{}'::"jsonb",
    "joined_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "circle_challenge_participants_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'active'::"text", 'withdrawn'::"text"])))
);


ALTER TABLE "public"."challenge_participants" OWNER TO "postgres";

--
-- Name: challenge_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."challenge_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text" NOT NULL,
    "challenge_category" "text" NOT NULL,
    "goal_amount" numeric(12,2) NOT NULL,
    "unit" "text" NOT NULL,
    "duration_days" integer NOT NULL,
    "logging_prompt" "text",
    "difficulty" "text",
    "icon_name" "text",
    "sort_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "completions_count" integer DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "challenge_templates_category_check" CHECK (("category" = ANY (ARRAY['daily_micro'::"text", 'weekly'::"text", 'monthly'::"text", 'epic'::"text", 'collaborative'::"text", 'onboarding'::"text"]))),
    CONSTRAINT "challenge_templates_challenge_category_check" CHECK (("challenge_category" = ANY (ARRAY['strength'::"text", 'cardio'::"text", 'flexibility'::"text", 'wellness'::"text", 'mixed'::"text"]))),
    CONSTRAINT "challenge_templates_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'medium'::"text", 'hard'::"text", 'extreme'::"text"])))
);


ALTER TABLE "public"."challenge_templates" OWNER TO "postgres";

--
-- Name: challenge_with_participants; Type: VIEW; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW "public"."challenge_with_participants" AS
SELECT
    NULL::"uuid" AS "id",
    NULL::"uuid" AS "creator_id",
    NULL::"text" AS "name",
    NULL::"text" AS "description",
    NULL::"public"."challenge_type" AS "type",
    NULL::"public"."challenge_status" AS "status",
    NULL::"public"."challenge_visibility" AS "visibility",
    NULL::"jsonb" AS "rules",
    NULL::"jsonb" AS "scoring_system",
    NULL::timestamp with time zone AS "start_date",
    NULL::timestamp with time zone AS "end_date",
    NULL::timestamp with time zone AS "registration_deadline",
    NULL::numeric(10,2) AS "entry_fee",
    NULL::numeric(10,2) AS "prize_pool",
    NULL::"jsonb" AS "prize_distribution",
    NULL::integer AS "min_participants",
    NULL::integer AS "max_participants",
    NULL::integer AS "min_team_size",
    NULL::integer AS "max_team_size",
    NULL::boolean AS "allow_late_join",
    NULL::numeric(5,2) AS "late_join_penalty",
    NULL::"text" AS "cover_image_url",
    NULL::"text" AS "badge_image_url",
    NULL::"text"[] AS "tags",
    NULL::"jsonb" AS "location",
    NULL::"text" AS "location_name",
    NULL::boolean AS "is_featured",
    NULL::"jsonb" AS "sponsor_info",
    NULL::"jsonb" AS "custom_fields",
    NULL::integer AS "participant_count",
    NULL::integer AS "team_count",
    NULL::integer AS "total_check_ins",
    NULL::numeric(5,2) AS "avg_progress",
    NULL::numeric(5,2) AS "completion_rate",
    NULL::numeric(5,2) AS "engagement_score",
    NULL::"jsonb" AS "metadata",
    NULL::timestamp with time zone AS "created_at",
    NULL::timestamp with time zone AS "updated_at",
    NULL::character varying(10) AS "invite_code",
    NULL::bigint AS "active_participants",
    NULL::bigint AS "pending_invitations";


ALTER VIEW "public"."challenge_with_participants" OWNER TO "postgres";

--
-- Name: challenges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "creator_id" "uuid" NOT NULL,
    "template_id" "text",
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text" NOT NULL,
    "goal_amount" numeric(12,2) NOT NULL,
    "unit" "text" NOT NULL,
    "logging_prompt" "text",
    "is_open" boolean DEFAULT true,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "participant_count" integer DEFAULT 0,
    "winner_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_default" boolean DEFAULT false,
    "check_in_mode" "text" DEFAULT 'multi_daily'::"text",
    "quest_type" "text" DEFAULT 'competitive'::"text",
    "collective_target" numeric(12,2),
    "collective_progress" numeric(12,2) DEFAULT 0,
    CONSTRAINT "challenges_quest_type_check" CHECK (("quest_type" = ANY (ARRAY['individual'::"text", 'collaborative'::"text", 'competitive'::"text"]))),
    CONSTRAINT "circle_challenges_category_check" CHECK (("category" = ANY (ARRAY['strength'::"text", 'cardio'::"text", 'flexibility'::"text", 'wellness'::"text", 'custom'::"text"]))),
    CONSTRAINT "circle_challenges_check_in_mode_check" CHECK (("check_in_mode" = ANY (ARRAY['single_daily'::"text", 'multi_daily'::"text", 'unlimited'::"text"]))),
    CONSTRAINT "circle_challenges_description_check" CHECK (("char_length"("description") <= 200)),
    CONSTRAINT "circle_challenges_goal_amount_check" CHECK (("goal_amount" > (0)::numeric)),
    CONSTRAINT "circle_challenges_logging_prompt_check" CHECK (("char_length"("logging_prompt") <= 60)),
    CONSTRAINT "circle_challenges_name_check" CHECK ((("char_length"("name") >= 3) AND ("char_length"("name") <= 50))),
    CONSTRAINT "circle_challenges_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'active'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "circle_challenges_unit_check" CHECK (("char_length"("unit") <= 20)),
    CONSTRAINT "valid_date_range" CHECK (("ends_at" > "starts_at"))
);


ALTER TABLE "public"."challenges" OWNER TO "postgres";

--
-- Name: check_ins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."check_ins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "team_id" "uuid",
    "check_in_date" "date" NOT NULL,
    "weight_kg" numeric(5,2),
    "body_fat_percentage" numeric(4,2),
    "muscle_mass_kg" numeric(5,2),
    "water_percentage" numeric(4,2),
    "steps" integer,
    "active_minutes" integer,
    "calories_burned" integer,
    "distance_km" numeric(6,2),
    "floors_climbed" integer,
    "sleep_hours" numeric(4,2),
    "water_intake_ml" integer,
    "mood_score" integer,
    "energy_level" integer,
    "notes" "text",
    "photo_urls" "text"[] DEFAULT '{}'::"text"[],
    "measurements" "jsonb" DEFAULT '{}'::"jsonb",
    "workouts" "jsonb" DEFAULT '[]'::"jsonb",
    "nutrition" "jsonb" DEFAULT '{}'::"jsonb",
    "custom_metrics" "jsonb" DEFAULT '{}'::"jsonb",
    "points_earned" integer DEFAULT 0,
    "verification_status" "text" DEFAULT 'pending'::"text",
    "verified_by" "uuid",
    "verified_at" timestamp with time zone,
    "verification_notes" "text",
    "is_valid" boolean DEFAULT true,
    "source" "text" DEFAULT 'manual'::"text",
    "device_data" "jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "check_ins_active_minutes_check" CHECK (("active_minutes" >= 0)),
    CONSTRAINT "check_ins_body_fat_percentage_check" CHECK ((("body_fat_percentage" >= (0)::numeric) AND ("body_fat_percentage" <= (100)::numeric))),
    CONSTRAINT "check_ins_calories_burned_check" CHECK (("calories_burned" >= 0)),
    CONSTRAINT "check_ins_distance_km_check" CHECK (("distance_km" >= (0)::numeric)),
    CONSTRAINT "check_ins_energy_level_check" CHECK ((("energy_level" >= 1) AND ("energy_level" <= 10))),
    CONSTRAINT "check_ins_floors_climbed_check" CHECK (("floors_climbed" >= 0)),
    CONSTRAINT "check_ins_mood_score_check" CHECK ((("mood_score" >= 1) AND ("mood_score" <= 10))),
    CONSTRAINT "check_ins_sleep_hours_check" CHECK ((("sleep_hours" >= (0)::numeric) AND ("sleep_hours" <= (24)::numeric))),
    CONSTRAINT "check_ins_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'apple_health'::"text", 'google_fit'::"text", 'fitbit'::"text", 'garmin'::"text", 'api'::"text"]))),
    CONSTRAINT "check_ins_steps_check" CHECK (("steps" >= 0)),
    CONSTRAINT "check_ins_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'flagged'::"text", 'rejected'::"text"]))),
    CONSTRAINT "check_ins_water_intake_ml_check" CHECK (("water_intake_ml" >= 0)),
    CONSTRAINT "check_ins_water_percentage_check" CHECK ((("water_percentage" >= (0)::numeric) AND ("water_percentage" <= (100)::numeric)))
);


ALTER TABLE "public"."check_ins" OWNER TO "postgres";

--
-- Name: circle_chat_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_chat_state" (
    "fitcircle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone,
    "muted" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."circle_chat_state" OWNER TO "postgres";

--
-- Name: circle_check_ins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_check_ins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "circle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "check_in_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "check_in_value" numeric(10,2) NOT NULL,
    "progress_percentage" numeric(5,2),
    "mood_score" integer,
    "energy_level" integer,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "circle_check_ins_energy_level_check" CHECK ((("energy_level" >= 1) AND ("energy_level" <= 10))),
    CONSTRAINT "circle_check_ins_mood_score_check" CHECK ((("mood_score" >= 1) AND ("mood_score" <= 10))),
    CONSTRAINT "circle_check_ins_note_check" CHECK (("length"("note") <= 100))
);


ALTER TABLE "public"."circle_check_ins" OWNER TO "postgres";

--
-- Name: TABLE "circle_check_ins"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."circle_check_ins" IS 'Daily check-ins for FitCircle members';


--
-- Name: circle_daily_boosts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_daily_boosts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "boost_date" "date" NOT NULL,
    "total_members" integer NOT NULL,
    "checked_in_members" integer DEFAULT 0 NOT NULL,
    "boost_multiplier" numeric(3,1) DEFAULT 1.0 NOT NULL,
    "is_perfect_day" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."circle_daily_boosts" OWNER TO "postgres";

--
-- Name: circle_encouragements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_encouragements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "circle_id" "uuid" NOT NULL,
    "from_user_id" "uuid" NOT NULL,
    "to_user_id" "uuid",
    "type" "text" NOT NULL,
    "content" "text",
    "milestone_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "circle_encouragements_content_check" CHECK (("length"("content") <= 200)),
    CONSTRAINT "circle_encouragements_milestone_type_check" CHECK (("milestone_type" = ANY (ARRAY['progress_25'::"text", 'progress_50'::"text", 'progress_75'::"text", 'progress_100'::"text", 'streak_7'::"text", 'streak_14'::"text", 'streak_30'::"text"]))),
    CONSTRAINT "circle_encouragements_type_check" CHECK (("type" = ANY (ARRAY['high_five'::"text", 'message'::"text", 'cheer'::"text", 'milestone'::"text"])))
);


ALTER TABLE "public"."circle_encouragements" OWNER TO "postgres";

--
-- Name: TABLE "circle_encouragements"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."circle_encouragements" IS 'Social interactions within FitCircles';


--
-- Name: circle_food_privacy; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_food_privacy" (
    "fitcircle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tier" "text" DEFAULT 'summary'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "circle_food_privacy_tier_check" CHECK (("tier" = ANY (ARRAY['full'::"text", 'summary'::"text", 'private'::"text"])))
);


ALTER TABLE "public"."circle_food_privacy" OWNER TO "postgres";

--
-- Name: TABLE "circle_food_privacy"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."circle_food_privacy" IS 'Per-circle per-user food privacy tier (full|summary|private), PRD §6.4. Absent row = summary (default applied in code). Enforcement is server-side in FoodPrivacyService.';


--
-- Name: COLUMN "circle_food_privacy"."tier"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."circle_food_privacy"."tier" IS 'full = sees every log incl photo/name/macros; summary = daily totals only; private = nothing food-related.';


--
-- Name: circle_invites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "circle_id" "uuid" NOT NULL,
    "inviter_id" "uuid" NOT NULL,
    "invite_code" character varying(9) NOT NULL,
    "email" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "accepted_at" timestamp with time zone,
    "accepted_by" "uuid",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '30 days'::interval),
    CONSTRAINT "circle_invites_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."circle_invites" OWNER TO "postgres";

--
-- Name: TABLE "circle_invites"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."circle_invites" IS 'Tracks invitations sent to join FitCircles';


--
-- Name: circle_member_blocks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_member_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "blocker_id" "uuid" NOT NULL,
    "blocked_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "circle_member_blocks_no_self" CHECK (("blocker_id" <> "blocked_id"))
);


ALTER TABLE "public"."circle_member_blocks" OWNER TO "postgres";

--
-- Name: circle_message_reactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_message_reactions" (
    "message_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "reaction" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "circle_message_reactions_reaction_check" CHECK (("reaction" = ANY (ARRAY['flame'::"text", 'clap'::"text", 'eyes'::"text", 'same'::"text", 'heart'::"text", 'laugh'::"text"])))
);

ALTER TABLE ONLY "public"."circle_message_reactions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."circle_message_reactions" OWNER TO "postgres";

--
-- Name: circle_message_reports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_message_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "reason" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "circle_message_reports_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'reviewed'::"text", 'actioned'::"text"])))
);


ALTER TABLE "public"."circle_message_reports" OWNER TO "postgres";

--
-- Name: circle_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "sender_id" "uuid",
    "kind" "text" NOT NULL,
    "body" "text",
    "photo_url" "text",
    "client_id" "uuid",
    "system_event_type" "text",
    "system_event_ref" "uuid",
    "system_payload" "jsonb",
    "priority" "text" DEFAULT 'p1'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "circle_messages_kind_check" CHECK (("kind" = ANY (ARRAY['user_text'::"text", 'user_photo'::"text", 'system_event'::"text"]))),
    CONSTRAINT "circle_messages_kind_shape" CHECK (((("kind" = 'system_event'::"text") AND ("system_event_type" IS NOT NULL)) OR (("kind" = ANY (ARRAY['user_text'::"text", 'user_photo'::"text"])) AND ("sender_id" IS NOT NULL)))),
    CONSTRAINT "circle_messages_priority_check" CHECK (("priority" = ANY (ARRAY['p0'::"text", 'p1'::"text", 'p2'::"text"]))),
    CONSTRAINT "circle_messages_system_event_type_check" CHECK (("system_event_type" = ANY (ARRAY['workout_done'::"text", 'notable_meal'::"text", 'streak_milestone'::"text", 'circle_streak'::"text", 'quest_done'::"text", 'challenge_milestone'::"text", 'challenge_resolved'::"text", 'daily_summary'::"text", 'member_joined'::"text", 'new_challenge'::"text"])))
);

ALTER TABLE ONLY "public"."circle_messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."circle_messages" OWNER TO "postgres";

--
-- Name: circle_quest_progress; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_quest_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quest_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "individual_progress" numeric(12,2) DEFAULT 0,
    "is_completed" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."circle_quest_progress" OWNER TO "postgres";

--
-- Name: circle_quests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_quests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "challenge_id" "uuid",
    "template_id" "uuid",
    "quest_name" "text" NOT NULL,
    "quest_description" "text",
    "quest_type" "text" NOT NULL,
    "goal_amount" numeric(12,2) NOT NULL,
    "unit" "text" NOT NULL,
    "collective_target" numeric(12,2),
    "collective_progress" numeric(12,2) DEFAULT 0,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "circle_quests_quest_type_check" CHECK (("quest_type" = ANY (ARRAY['individual'::"text", 'collaborative'::"text", 'competitive'::"text"]))),
    CONSTRAINT "circle_quests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'completed'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."circle_quests" OWNER TO "postgres";

--
-- Name: circle_streak_saves; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_streak_saves" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "saver_user_id" "uuid" NOT NULL,
    "covered_user_id" "uuid" NOT NULL,
    "save_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."circle_streak_saves" OWNER TO "postgres";

--
-- Name: circle_streak_tracking; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_streak_tracking" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "circle_id" "uuid" NOT NULL,
    "team_collective_streak" integer DEFAULT 0 NOT NULL,
    "longest_team_streak" integer DEFAULT 0 NOT NULL,
    "last_full_team_checkin_date" "date",
    "grace_days_available" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."circle_streak_tracking" OWNER TO "postgres";

--
-- Name: TABLE "circle_streak_tracking"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."circle_streak_tracking" IS 'Tracks team collective streaks for circles (Tier 3)';


--
-- Name: circle_streaks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."circle_streaks" (
    "fitcircle_id" "uuid" NOT NULL,
    "current_streak" integer DEFAULT 0 NOT NULL,
    "longest_streak" integer DEFAULT 0 NOT NULL,
    "last_active_date" "date",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."circle_streaks" OWNER TO "postgres";

--
-- Name: comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "mentions" "uuid"[] DEFAULT '{}'::"uuid"[],
    "is_edited" boolean DEFAULT false,
    "edited_at" timestamp with time zone,
    "is_deleted" boolean DEFAULT false,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "reactions_count" integer DEFAULT 0,
    "replies_count" integer DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "comments_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['check_in'::"text", 'challenge'::"text", 'team'::"text", 'achievement'::"text"])))
);


ALTER TABLE "public"."comments" OWNER TO "postgres";

--
-- Name: weekly_goals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."weekly_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week_start" "date" NOT NULL,
    "goal_type" "text" NOT NULL,
    "target_value" numeric NOT NULL,
    "actual_value" numeric DEFAULT 0,
    "daily_breakdown" "jsonb" DEFAULT '{}'::"jsonb",
    "completed" boolean DEFAULT false,
    "fitcircle_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "weekly_goals_actual_value_check" CHECK (("actual_value" >= (0)::numeric)),
    CONSTRAINT "weekly_goals_goal_type_check" CHECK (("goal_type" = ANY (ARRAY['steps'::"text", 'weight'::"text", 'streak'::"text", 'active_days'::"text"]))),
    CONSTRAINT "weekly_goals_target_value_check" CHECK (("target_value" > (0)::numeric))
);


ALTER TABLE "public"."weekly_goals" OWNER TO "postgres";

--
-- Name: TABLE "weekly_goals"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."weekly_goals" IS 'Phase 1 Engagement: Weekly milestone goals (updated_at managed by service layer)';


--
-- Name: current_weekly_goals; Type: VIEW; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW "public"."current_weekly_goals" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("user_id", "goal_type", "fitcircle_id") "id",
    "user_id",
    "week_start",
    "goal_type",
    "target_value",
    "actual_value",
    "daily_breakdown",
    "completed",
    "fitcircle_id",
    "created_at",
    "updated_at"
   FROM "public"."weekly_goals"
  ORDER BY "user_id", "goal_type", "fitcircle_id", "week_start" DESC;


ALTER VIEW "public"."current_weekly_goals" OWNER TO "postgres";

--
-- Name: daily_challenge_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."daily_challenge_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "daily_challenge_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "progress" numeric(12,2) DEFAULT 0,
    "is_completed" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "joined_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."daily_challenge_participants" OWNER TO "postgres";

--
-- Name: daily_challenges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."daily_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_date" "date" NOT NULL,
    "template_id" "uuid",
    "custom_name" "text",
    "custom_description" "text",
    "custom_goal_amount" numeric(12,2),
    "custom_unit" "text",
    "is_custom" boolean DEFAULT false,
    "participant_count" integer DEFAULT 0,
    "completion_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."daily_challenges" OWNER TO "postgres";

--
-- Name: daily_goals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."daily_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "challenge_id" "uuid",
    "goal_type" "text" NOT NULL,
    "target_value" numeric(10,2),
    "unit" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "frequency" "text" DEFAULT 'daily'::"text",
    "custom_schedule" "jsonb",
    "is_active" boolean DEFAULT true,
    "is_primary" boolean DEFAULT false,
    "auto_adjust_enabled" boolean DEFAULT false,
    "baseline_value" numeric(10,2),
    "adjustment_algorithm" "text",
    "last_adjusted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "daily_goals_frequency_check" CHECK (("frequency" = ANY (ARRAY['daily'::"text", 'weekdays'::"text", 'weekends'::"text", 'custom'::"text"]))),
    CONSTRAINT "daily_goals_goal_type_check" CHECK (("goal_type" = ANY (ARRAY['steps'::"text", 'weight_log'::"text", 'workout'::"text", 'mood'::"text", 'energy'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."daily_goals" OWNER TO "postgres";

--
-- Name: TABLE "daily_goals"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."daily_goals" IS 'User daily goal configurations, often linked to FitCircle challenges';


--
-- Name: daily_high_five_limits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."daily_high_five_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "circle_id" "uuid" NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."daily_high_five_limits" OWNER TO "postgres";

--
-- Name: TABLE "daily_high_five_limits"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."daily_high_five_limits" IS 'Tracks daily limits for high-fives per user per circle';


--
-- Name: daily_tracking; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."daily_tracking" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tracking_date" "date" NOT NULL,
    "weight_kg" numeric(5,2),
    "steps" integer,
    "mood_score" integer,
    "energy_level" integer,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "steps_source" character varying(20) DEFAULT 'manual'::character varying,
    "steps_synced_at" timestamp with time zone,
    "is_override" boolean DEFAULT false,
    "is_public" boolean DEFAULT true,
    "daily_goal_steps" integer,
    "daily_goal_weight_kg" numeric(10,2),
    "goal_completion_status" "jsonb" DEFAULT '{}'::"jsonb",
    "previous_day_sentiment" "text",
    "previous_day_steps" integer,
    "streak_day" integer DEFAULT 0,
    "submitted_to_fitcircles" boolean DEFAULT false,
    "submission_timestamp" timestamp with time zone,
    CONSTRAINT "daily_tracking_energy_level_check" CHECK ((("energy_level" >= 1) AND ("energy_level" <= 10))),
    CONSTRAINT "daily_tracking_mood_score_check" CHECK ((("mood_score" >= 1) AND ("mood_score" <= 10))),
    CONSTRAINT "daily_tracking_previous_day_sentiment_check" CHECK (("previous_day_sentiment" = ANY (ARRAY['great'::"text", 'ok'::"text", 'could_be_better'::"text"]))),
    CONSTRAINT "daily_tracking_previous_day_steps_check" CHECK (("previous_day_steps" >= 0)),
    CONSTRAINT "daily_tracking_steps_check" CHECK (("steps" >= 0)),
    CONSTRAINT "daily_tracking_steps_source_check" CHECK ((("steps_source")::"text" = ANY ((ARRAY['manual'::character varying, 'healthkit'::character varying, 'google_fit'::character varying])::"text"[]))),
    CONSTRAINT "daily_tracking_streak_day_check" CHECK (("streak_day" >= 0)),
    CONSTRAINT "daily_tracking_weight_kg_check" CHECK ((("weight_kg" > (0)::numeric) AND ("weight_kg" < (1000)::numeric)))
);


ALTER TABLE "public"."daily_tracking" OWNER TO "postgres";

--
-- Name: COLUMN "daily_tracking"."steps_source"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."daily_tracking"."steps_source" IS 'Source of step count data: manual (user entered), healthkit (iOS Health app), google_fit (Android Health Connect)';


--
-- Name: COLUMN "daily_tracking"."steps_synced_at"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."daily_tracking"."steps_synced_at" IS 'Timestamp when step count was synced from HealthKit or Google Fit. NULL for manual entries.';


--
-- Name: COLUMN "daily_tracking"."is_override"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."daily_tracking"."is_override" IS 'True if user manually overrode auto-synced HealthKit/Google Fit data. When true, auto-sync will not update this entry.';


--
-- Name: COLUMN "daily_tracking"."is_public"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."daily_tracking"."is_public" IS 'Privacy flag: true = visible to circle members, false = private (owner only)';


--
-- Name: COLUMN "daily_tracking"."goal_completion_status"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."daily_tracking"."goal_completion_status" IS 'JSONB tracking which goals were completed: {steps_goal_met: bool, weight_logged: bool, overall_completion: float}';


--
-- Name: dietary_preferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dietary_preferences" (
    "user_id" "uuid" NOT NULL,
    "diet" "text",
    "allergens" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "units" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dietary_preferences_diet_check" CHECK (("diet" = ANY (ARRAY['none'::"text", 'vegetarian'::"text", 'vegan'::"text", 'pescatarian'::"text", 'halal'::"text", 'kosher'::"text", 'gluten_free'::"text"]))),
    CONSTRAINT "dietary_preferences_units_check" CHECK (("units" = ANY (ARRAY['metric'::"text", 'imperial'::"text"])))
);


ALTER TABLE "public"."dietary_preferences" OWNER TO "postgres";

--
-- Name: TABLE "dietary_preferences"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."dietary_preferences" IS 'Per-user dietary pattern, allergens, and unit preference (PRD §6.15). Sparse: absent row = no diet/allergens; units inferred from profiles.country_code in code. Powers pref-aware search ranking + coach grounding. Units are display-only (no backend conversion).';


--
-- Name: COLUMN "dietary_preferences"."diet"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dietary_preferences"."diet" IS 'Declared dietary pattern; NULL = none. One of none|vegetarian|vegan|pescatarian|halal|kosher|gluten_free.';


--
-- Name: COLUMN "dietary_preferences"."allergens"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dietary_preferences"."allergens" IS 'Lowercase allergen tokens, e.g. {peanuts,shellfish,milk}. Used as a ranking nudge in search and grounding for the coach; never a hard filter.';


--
-- Name: COLUMN "dietary_preferences"."units"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dietary_preferences"."units" IS 'metric|imperial display preference; NULL = inferred from locale (CA metric, US imperial, else metric). Display-only — API always returns canonical grams/kcal.';


--
-- Name: engagement_activities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."engagement_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "activity_date" "date" NOT NULL,
    "activity_type" "text" NOT NULL,
    "reference_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "engagement_activities_activity_type_check" CHECK (("activity_type" = ANY (ARRAY['weight_log'::"text", 'steps_log'::"text", 'mood_log'::"text", 'circle_checkin'::"text", 'social_interaction'::"text", 'streak_checkin'::"text", 'freeze_used'::"text", 'freeze_earned'::"text", 'milestone_achieved'::"text", 'exercise_log'::"text", 'streak_freeze'::"text"])))
);


ALTER TABLE "public"."engagement_activities" OWNER TO "postgres";

--
-- Name: TABLE "engagement_activities"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."engagement_activities" IS 'Individual engagement activities for streak calculation';


--
-- Name: COLUMN "engagement_activities"."metadata"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_activities"."metadata" IS 'Additional data: xp_earned, milestone_name, freeze_reason, etc.';


--
-- Name: engagement_streaks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."engagement_streaks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "current_streak" integer DEFAULT 0 NOT NULL,
    "longest_streak" integer DEFAULT 0 NOT NULL,
    "last_engagement_date" "date",
    "streak_freezes_available" integer DEFAULT 1 NOT NULL,
    "streak_freezes_used_this_week" integer DEFAULT 0 NOT NULL,
    "auto_freeze_reset_date" "date",
    "paused" boolean DEFAULT false NOT NULL,
    "pause_start_date" "date",
    "pause_end_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "total_points" integer DEFAULT 0,
    "last_freeze_earned_at" timestamp with time zone,
    "last_claim_date" "date",
    "total_claims" integer DEFAULT 0,
    "shields_available" integer DEFAULT 1,
    "shields_used" integer DEFAULT 0,
    "last_shield_reset" timestamp with time zone,
    "best_momentum" integer DEFAULT 0 NOT NULL,
    "momentum_flame_level" integer DEFAULT 1,
    "last_decay_applied_at" timestamp with time zone,
    "grace_day_used_this_week" boolean DEFAULT false,
    "grace_day_week_start" "date",
    CONSTRAINT "engagement_streaks_shields_available_check" CHECK ((("shields_available" >= 0) AND ("shields_available" <= 5))),
    CONSTRAINT "engagement_streaks_shields_used_check" CHECK (("shields_used" >= 0)),
    CONSTRAINT "engagement_streaks_total_claims_check" CHECK (("total_claims" >= 0)),
    CONSTRAINT "engagement_streaks_total_points_check" CHECK (("total_points" >= 0))
);


ALTER TABLE "public"."engagement_streaks" OWNER TO "postgres";

--
-- Name: TABLE "engagement_streaks"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."engagement_streaks" IS 'Tracks user engagement streaks across all activities (Tier 1)';


--
-- Name: COLUMN "engagement_streaks"."streak_freezes_available"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_streaks"."streak_freezes_available" IS 'Number of grace days available (max 5)';


--
-- Name: COLUMN "engagement_streaks"."streak_freezes_used_this_week"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_streaks"."streak_freezes_used_this_week" IS 'Auto-resets weekly';


--
-- Name: COLUMN "engagement_streaks"."paused"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_streaks"."paused" IS 'True if streak is paused for life events (max 90 days)';


--
-- Name: COLUMN "engagement_streaks"."total_points"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_streaks"."total_points" IS 'Total XP earned from check-ins and milestones';


--
-- Name: COLUMN "engagement_streaks"."last_freeze_earned_at"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_streaks"."last_freeze_earned_at" IS 'Last timestamp when freeze was earned (every 7 consecutive days)';


--
-- Name: COLUMN "engagement_streaks"."last_claim_date"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_streaks"."last_claim_date" IS 'Last date user claimed a streak (explicit or implicit)';


--
-- Name: COLUMN "engagement_streaks"."total_claims"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_streaks"."total_claims" IS 'Total number of streaks claimed by user';


--
-- Name: COLUMN "engagement_streaks"."shields_available"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_streaks"."shields_available" IS 'Legacy field - migrating to streak_shields table';


--
-- Name: COLUMN "engagement_streaks"."shields_used"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_streaks"."shields_used" IS 'Total shields used throughout streak history';


--
-- Name: COLUMN "engagement_streaks"."last_shield_reset"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."engagement_streaks"."last_shield_reset" IS 'Last time shields were reset (weekly)';


--
-- Name: exercise_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."exercise_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "exercise_type" character varying(50) NOT NULL,
    "category" character varying(20) NOT NULL,
    "duration_minutes" integer NOT NULL,
    "calories_burned" numeric(8,2),
    "calories_estimated" boolean DEFAULT false NOT NULL,
    "exercise_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "started_at" timestamp with time zone,
    "source" character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    "distance_meters" numeric(10,2),
    "avg_heart_rate" integer,
    "effort_level" integer,
    "location_type" character varying(20),
    "workout_companion" character varying(20),
    "body_areas" "text"[],
    "is_indoor" boolean,
    "notes" "text",
    "healthkit_workout_id" character varying(100),
    "source_device_name" character varying(100),
    "is_public" boolean DEFAULT true NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "counts_as_checkin" boolean DEFAULT false,
    "brand" character varying(50),
    "verified_source" boolean DEFAULT false,
    CONSTRAINT "exercise_logs_avg_heart_rate_check" CHECK ((("avg_heart_rate" IS NULL) OR (("avg_heart_rate" > 0) AND ("avg_heart_rate" <= 300)))),
    CONSTRAINT "exercise_logs_category_check" CHECK ((("category")::"text" = ANY ((ARRAY['cardio'::character varying, 'strength'::character varying, 'flexibility'::character varying, 'sports'::character varying, 'outdoor'::character varying, 'other'::character varying])::"text"[]))),
    CONSTRAINT "exercise_logs_duration_minutes_check" CHECK ((("duration_minutes" > 0) AND ("duration_minutes" <= 1440))),
    CONSTRAINT "exercise_logs_effort_level_check" CHECK ((("effort_level" IS NULL) OR (("effort_level" >= 1) AND ("effort_level" <= 10)))),
    CONSTRAINT "exercise_logs_location_type_check" CHECK ((("location_type" IS NULL) OR (("location_type")::"text" = ANY ((ARRAY['home'::character varying, 'gym'::character varying, 'outdoor'::character varying, 'studio'::character varying])::"text"[])))),
    CONSTRAINT "exercise_logs_source_check" CHECK ((("source")::"text" = ANY ((ARRAY['manual'::character varying, 'healthkit'::character varying])::"text"[]))),
    CONSTRAINT "exercise_logs_workout_companion_check" CHECK ((("workout_companion" IS NULL) OR (("workout_companion")::"text" = ANY ((ARRAY['solo'::character varying, 'group'::character varying, 'trainer'::character varying, 'virtual_class'::character varying])::"text"[]))))
);


ALTER TABLE "public"."exercise_logs" OWNER TO "postgres";

--
-- Name: TABLE "exercise_logs"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."exercise_logs" IS 'User exercise/workout logs from HealthKit auto-sync and manual entry';


--
-- Name: COLUMN "exercise_logs"."exercise_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."exercise_logs"."exercise_type" IS 'Exercise type identifier matching HKWorkoutActivityType (e.g., running, yoga, strengthTraining)';


--
-- Name: COLUMN "exercise_logs"."category"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."exercise_logs"."category" IS 'Exercise category: cardio, strength, flexibility, sports, outdoor, other';


--
-- Name: COLUMN "exercise_logs"."calories_estimated"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."exercise_logs"."calories_estimated" IS 'true if calories were MET-estimated by the app, false if from HealthKit or user-entered';


--
-- Name: COLUMN "exercise_logs"."source"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."exercise_logs"."source" IS 'Data source: manual (user logged in-app) or healthkit (auto-synced from Apple Health)';


--
-- Name: COLUMN "exercise_logs"."effort_level"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."exercise_logs"."effort_level" IS 'Rate of Perceived Exertion (RPE) on a 1-10 scale';


--
-- Name: COLUMN "exercise_logs"."body_areas"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."exercise_logs"."body_areas" IS 'Targeted body areas: chest, back, shoulders, arms, core, legs, glutes, fullBody';


--
-- Name: COLUMN "exercise_logs"."healthkit_workout_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."exercise_logs"."healthkit_workout_id" IS 'HKWorkout UUID for deduplication of HealthKit imports';


--
-- Name: COLUMN "exercise_logs"."source_device_name"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."exercise_logs"."source_device_name" IS 'Originating device/app name from HealthKit sourceRevision (e.g., Apple Watch, Peloton)';


--
-- Name: COLUMN "exercise_logs"."is_deleted"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."exercise_logs"."is_deleted" IS 'Soft delete flag. Set when workout is deleted from HealthKit to preserve history.';


--
-- Name: feature_flags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_enabled" boolean DEFAULT false,
    "rollout_percentage" integer DEFAULT 0,
    "allowed_user_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "allowed_tiers" "text"[] DEFAULT '{}'::"text"[],
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "feature_flags_rollout_percentage_check" CHECK ((("rollout_percentage" >= 0) AND ("rollout_percentage" <= 100)))
);


ALTER TABLE "public"."feature_flags" OWNER TO "postgres";

--
-- Name: TABLE "feature_flags"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."feature_flags" IS 'Feature flags for remote configuration and gradual rollout';


--
-- Name: feature_gates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."feature_gates" (
    "feature_key" "text" NOT NULL,
    "required_tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "feature_gates_required_tier_check" CHECK (("required_tier" = ANY (ARRAY['free'::"text", 'premium'::"text"])))
);


ALTER TABLE "public"."feature_gates" OWNER TO "postgres";

--
-- Name: TABLE "feature_gates"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."feature_gates" IS 'Server-driven feature gating: feature_key -> required_tier. Everything defaults to free; flipping a row to premium gates the feature server-side (403 PREMIUM_REQUIRED) and client-side (via GET /api/mobile/entitlements) without a release.';


--
-- Name: fitcircle_data_submissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."fitcircle_data_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "submission_date" "date" NOT NULL,
    "steps" integer,
    "weight" numeric(5,2),
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "rank_after_submission" integer,
    "rank_change" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "fitcircle_data_submissions_steps_check" CHECK (("steps" >= 0)),
    CONSTRAINT "fitcircle_data_submissions_weight_check" CHECK ((("weight" > (0)::numeric) AND ("weight" < (1000)::numeric)))
);


ALTER TABLE "public"."fitcircle_data_submissions" OWNER TO "postgres";

--
-- Name: TABLE "fitcircle_data_submissions"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."fitcircle_data_submissions" IS 'Phase 1 Engagement: Manual FitCircle data submissions';


--
-- Name: fitcircle_leaderboard_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."fitcircle_leaderboard_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "metric_type" "text" NOT NULL,
    "metric_value" numeric DEFAULT 0,
    "rank" integer NOT NULL,
    "rank_change" integer DEFAULT 0,
    "last_updated" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "fitcircle_leaderboard_entries_metric_type_check" CHECK (("metric_type" = ANY (ARRAY['steps'::"text", 'weight_loss_pct'::"text", 'checkin_streak'::"text"]))),
    CONSTRAINT "fitcircle_leaderboard_entries_metric_value_check" CHECK (("metric_value" >= (0)::numeric)),
    CONSTRAINT "fitcircle_leaderboard_entries_period_check" CHECK (("period" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'monthly'::"text", 'all_time'::"text"]))),
    CONSTRAINT "fitcircle_leaderboard_entries_rank_check" CHECK (("rank" > 0))
);


ALTER TABLE "public"."fitcircle_leaderboard_entries" OWNER TO "postgres";

--
-- Name: TABLE "fitcircle_leaderboard_entries"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."fitcircle_leaderboard_entries" IS 'Phase 1 Engagement: FitCircle leaderboards by period';


--
-- Name: fitcircle_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."fitcircle_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "team_id" "uuid",
    "status" "text" DEFAULT 'active'::"text",
    "joined_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "dropped_at" timestamp with time zone,
    "disqualified_at" timestamp with time zone,
    "disqualification_reason" "text",
    "current_value" numeric(10,2),
    "progress_percentage" numeric(5,2) DEFAULT 0,
    "total_points" integer DEFAULT 0,
    "rank" integer,
    "check_ins_count" integer DEFAULT 0,
    "streak_days" integer DEFAULT 0,
    "missed_check_ins" integer DEFAULT 0,
    "last_check_in_at" timestamp with time zone,
    "achievements" "jsonb" DEFAULT '[]'::"jsonb",
    "stats" "jsonb" DEFAULT '{}'::"jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "goal_type" "text",
    "goal_start_value" numeric(10,2),
    "goal_target_value" numeric(10,2),
    "goal_unit" "text",
    "goal_description" "text",
    "goal_locked_at" timestamp with time zone,
    "longest_streak" integer DEFAULT 0,
    "invited_by" "uuid",
    "total_high_fives_received" integer DEFAULT 0,
    "role" "text" DEFAULT 'member'::"text",
    CONSTRAINT "challenge_participants_goal_type_check" CHECK (("goal_type" = ANY (ARRAY['weight_loss'::"text", 'step_count'::"text", 'workout_frequency'::"text", 'custom'::"text"]))),
    CONSTRAINT "challenge_participants_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'completed'::"text", 'dropped'::"text", 'disqualified'::"text"]))),
    CONSTRAINT "fitcircle_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]))),
    CONSTRAINT "goal_consistency_check" CHECK (((("goal_type" IS NULL) AND ("goal_target_value" IS NULL)) OR (("goal_type" IS NOT NULL) AND ("goal_target_value" IS NOT NULL))))
);


ALTER TABLE "public"."fitcircle_members" OWNER TO "postgres";

--
-- Name: TABLE "fitcircle_members"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."fitcircle_members" IS 'Single source of truth for all circle/challenge participants. Used by both web and mobile APIs.';


--
-- Name: COLUMN "fitcircle_members"."current_value"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."current_value" IS 'Current value updated with each check-in (same unit as goal_start_value/goal_target_value)';


--
-- Name: COLUMN "fitcircle_members"."progress_percentage"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."progress_percentage" IS 'Calculated progress toward goal (0-100%)';


--
-- Name: COLUMN "fitcircle_members"."goal_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."goal_type" IS 'Type of goal: weight_loss, step_count, workout_frequency, or custom';


--
-- Name: COLUMN "fitcircle_members"."goal_start_value"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."goal_start_value" IS 'Starting value for any goal type (e.g., starting weight in lbs/kg, starting step count average)';


--
-- Name: COLUMN "fitcircle_members"."goal_target_value"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."goal_target_value" IS 'Target value for any goal type (e.g., goal weight, target daily steps)';


--
-- Name: COLUMN "fitcircle_members"."goal_unit"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."goal_unit" IS 'Unit of measurement (e.g., lbs, kg, steps, sessions, custom unit)';


--
-- Name: COLUMN "fitcircle_members"."goal_description"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."goal_description" IS 'Custom description for custom goal types';


--
-- Name: COLUMN "fitcircle_members"."goal_locked_at"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."goal_locked_at" IS 'When the goal was locked (typically when challenge starts)';


--
-- Name: COLUMN "fitcircle_members"."longest_streak"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."longest_streak" IS 'Longest check-in streak achieved';


--
-- Name: COLUMN "fitcircle_members"."invited_by"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."invited_by" IS 'User who invited this participant';


--
-- Name: COLUMN "fitcircle_members"."total_high_fives_received"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircle_members"."total_high_fives_received" IS 'Total high-fives received from other participants';


--
-- Name: CONSTRAINT "goal_consistency_check" ON "fitcircle_members"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON CONSTRAINT "goal_consistency_check" ON "public"."fitcircle_members" IS 'Ensures that if a goal_type is set, a goal_target_value must also be set';


--
-- Name: fitcircles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."fitcircles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "creator_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "type" "public"."challenge_type" NOT NULL,
    "status" "public"."challenge_status" DEFAULT 'draft'::"public"."challenge_status",
    "visibility" "public"."challenge_visibility" DEFAULT 'public'::"public"."challenge_visibility",
    "rules" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "scoring_system" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "start_date" timestamp with time zone,
    "end_date" timestamp with time zone,
    "registration_deadline" timestamp with time zone,
    "entry_fee" numeric(10,2) DEFAULT 0,
    "prize_pool" numeric(10,2) DEFAULT 0,
    "prize_distribution" "jsonb" DEFAULT '[]'::"jsonb",
    "min_participants" integer DEFAULT 2,
    "max_participants" integer,
    "min_team_size" integer DEFAULT 1,
    "max_team_size" integer DEFAULT 1,
    "allow_late_join" boolean DEFAULT false,
    "late_join_penalty" numeric(5,2) DEFAULT 0,
    "cover_image_url" "text",
    "badge_image_url" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "location" "jsonb",
    "location_name" "text",
    "is_featured" boolean DEFAULT false,
    "sponsor_info" "jsonb",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb",
    "participant_count" integer DEFAULT 0,
    "team_count" integer DEFAULT 0,
    "total_check_ins" integer DEFAULT 0,
    "avg_progress" numeric(5,2) DEFAULT 0,
    "completion_rate" numeric(5,2) DEFAULT 0,
    "engagement_score" numeric(5,2) DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "invite_code" character varying(10),
    "privacy_mode" boolean DEFAULT true,
    "auto_accept_invites" boolean DEFAULT true,
    "late_join_deadline" integer DEFAULT 3,
    "timezone" "text" DEFAULT 'America/New_York'::"text" NOT NULL,
    "min_members" integer DEFAULT 2,
    "max_members" integer DEFAULT 12,
    "is_official" boolean DEFAULT false NOT NULL,
    CONSTRAINT "invite_code_format" CHECK ((("invite_code")::"text" ~ '^FIT-?[A-Z0-9]{6}$'::"text")),
    CONSTRAINT "valid_dates" CHECK (("end_date" > "start_date")),
    CONSTRAINT "valid_participants" CHECK ((("max_participants" IS NULL) OR ("max_participants" >= "min_participants"))),
    CONSTRAINT "valid_registration" CHECK (("registration_deadline" <= "start_date")),
    CONSTRAINT "valid_team_size" CHECK ((("max_team_size" IS NULL) OR ("max_team_size" >= "min_team_size")))
);


ALTER TABLE "public"."fitcircles" OWNER TO "postgres";

--
-- Name: COLUMN "fitcircles"."invite_code"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."fitcircles"."invite_code" IS 'Unique invite code in format FIT-XXXXXX (e.g., FIT-A2B9C7) or FITXXXXXX for backward compatibility';


--
-- Name: fitzy_message_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."fitzy_message_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fitzy_message_log" OWNER TO "postgres";

--
-- Name: TABLE "fitzy_message_log"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."fitzy_message_log" IS 'One row per Fitzy/nutrition-coach message, for tier-based daily quotas (usage-service). Service-role only.';


--
-- Name: food_log_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."food_log_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "food_log_entry_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "actor_id" "uuid",
    "ip_address" "text",
    "user_agent" "text",
    "changes" "jsonb" DEFAULT '{}'::"jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "food_log_audit_action_check" CHECK (("action" = ANY (ARRAY['create'::"text", 'update'::"text", 'delete'::"text", 'view'::"text", 'share'::"text", 'unshare'::"text", 'image_upload'::"text", 'image_delete'::"text"])))
);


ALTER TABLE "public"."food_log_audit" OWNER TO "postgres";

--
-- Name: TABLE "food_log_audit"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."food_log_audit" IS 'Audit trail for food log operations';


--
-- Name: food_log_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."food_log_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "entry_type" "text" NOT NULL,
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "entry_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "meal_type" "text",
    "title" "text",
    "description" "text",
    "notes" "text",
    "nutrition_data" "jsonb" DEFAULT '{}'::"jsonb",
    "water_ml" integer,
    "supplement_name" "text",
    "supplement_dosage" "text",
    "is_private" boolean DEFAULT true,
    "visibility" "text" DEFAULT 'private'::"text",
    "has_images" boolean DEFAULT false,
    "image_count" integer DEFAULT 0,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "location" "jsonb",
    "ai_analyzed" boolean DEFAULT false,
    "ai_analysis" "jsonb" DEFAULT '{}'::"jsonb",
    "ai_analyzed_at" timestamp with time zone,
    "source" "text" DEFAULT 'manual'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "food_id" "uuid",
    "servings" numeric,
    "calories" numeric,
    "protein_g" numeric,
    "carbs_g" numeric,
    "fat_g" numeric,
    "input_method" "text",
    "nutrition_source" "text",
    "llm_confidence" numeric,
    "source_external_id" "text",
    CONSTRAINT "food_log_entries_entry_type_check" CHECK (("entry_type" = ANY (ARRAY['food'::"text", 'water'::"text", 'supplement'::"text"]))),
    CONSTRAINT "food_log_entries_meal_type_check" CHECK (("meal_type" = ANY (ARRAY['breakfast'::"text", 'lunch'::"text", 'dinner'::"text", 'snack'::"text", 'other'::"text"]))),
    CONSTRAINT "food_log_entries_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'import'::"text", 'api'::"text"]))),
    CONSTRAINT "food_log_entries_visibility_check" CHECK (("visibility" = ANY (ARRAY['private'::"text", 'shared'::"text", 'circle'::"text"]))),
    CONSTRAINT "food_log_entries_water_ml_check" CHECK ((("water_ml" > 0) AND ("water_ml" <= 10000))),
    CONSTRAINT "valid_entry_type" CHECK (((("entry_type" = 'food'::"text") AND ("meal_type" IS NOT NULL)) OR (("entry_type" = 'water'::"text") AND ("water_ml" IS NOT NULL)) OR (("entry_type" = 'supplement'::"text") AND ("supplement_name" IS NOT NULL))))
);


ALTER TABLE "public"."food_log_entries" OWNER TO "postgres";

--
-- Name: TABLE "food_log_entries"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."food_log_entries" IS 'Main food, water, and supplement log entries';


--
-- Name: COLUMN "food_log_entries"."logged_at"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."food_log_entries"."logged_at" IS 'Timestamp when the user CONSUMED the food/drink. Used to order entries chronologically within a day. Defaults to NOW() but clients should send the user-picked meal time.';


--
-- Name: COLUMN "food_log_entries"."input_method"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."food_log_entries"."input_method" IS 'How the entry was created: photo|voice|barcode|search|recent|manual|imported';


--
-- Name: COLUMN "food_log_entries"."nutrition_source"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."food_log_entries"."nutrition_source" IS 'Where the macros came from: llm_vision|llm_voice|foods_db|user|healthkit|healthconnect|mfp';


--
-- Name: COLUMN "food_log_entries"."llm_confidence"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."food_log_entries"."llm_confidence" IS '0..1 overall model confidence when nutrition_source is an LLM; NULL otherwise';


--
-- Name: COLUMN "food_log_entries"."source_external_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."food_log_entries"."source_external_id" IS 'External id from the source platform (HealthKit UUID / Health Connect record id / MFP id) for idempotent import dedup; NULL for FitCircle-native logs.';


--
-- Name: food_log_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."food_log_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "food_log_entry_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "storage_bucket" "text" DEFAULT 'food-logs'::"text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_size_bytes" bigint NOT NULL,
    "mime_type" "text" NOT NULL,
    "width" integer,
    "height" integer,
    "thumbnail_path" "text",
    "display_order" integer DEFAULT 0,
    "ai_analyzed" boolean DEFAULT false,
    "ai_tags" "text"[] DEFAULT '{}'::"text"[],
    "ai_detected_foods" "text"[] DEFAULT '{}'::"text"[],
    "ai_analysis" "jsonb" DEFAULT '{}'::"jsonb",
    "upload_ip" "text",
    "upload_user_agent" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "valid_file_size" CHECK ((("file_size_bytes" > 0) AND ("file_size_bytes" <= 10485760))),
    CONSTRAINT "valid_mime_type" CHECK (("mime_type" = ANY (ARRAY['image/jpeg'::"text", 'image/png'::"text", 'image/webp'::"text", 'image/heic'::"text"])))
);


ALTER TABLE "public"."food_log_images" OWNER TO "postgres";

--
-- Name: TABLE "food_log_images"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."food_log_images" IS 'Images attached to food log entries';


--
-- Name: food_log_shares; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."food_log_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "food_log_entry_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "shared_with_user_id" "uuid",
    "shared_with_circle_id" "uuid",
    "can_view" boolean DEFAULT true,
    "can_comment" boolean DEFAULT false,
    "share_message" "text",
    "expires_at" timestamp with time zone,
    "viewed_at" timestamp with time zone,
    "view_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "share_target" CHECK (((("shared_with_user_id" IS NOT NULL) AND ("shared_with_circle_id" IS NULL)) OR (("shared_with_user_id" IS NULL) AND ("shared_with_circle_id" IS NOT NULL))))
);


ALTER TABLE "public"."food_log_shares" OWNER TO "postgres";

--
-- Name: TABLE "food_log_shares"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."food_log_shares" IS 'Sharing permissions for food log entries';


--
-- Name: foods; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."foods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" NOT NULL,
    "source_id" "text",
    "owner_id" "uuid",
    "name" "text" NOT NULL,
    "brand" "text",
    "barcode" "text",
    "serving_size_g" numeric,
    "serving_unit" "text",
    "calories_per_100g" numeric,
    "protein_per_100g" numeric,
    "carbs_per_100g" numeric,
    "fat_per_100g" numeric,
    "fiber_per_100g" numeric,
    "sugar_per_100g" numeric,
    "locale" "text",
    "recipe_ingredients" "jsonb",
    "recipe_servings" numeric,
    "search_vector" "tsvector" GENERATED ALWAYS AS (("setweight"("to_tsvector"('"simple"'::"regconfig", COALESCE("name", ''::"text")), 'A'::"char") || "setweight"("to_tsvector"('"simple"'::"regconfig", COALESCE("brand", ''::"text")), 'B'::"char"))) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "image_url" "text",
    CONSTRAINT "foods_owner_required_for_custom" CHECK ((("source" = ANY (ARRAY['custom'::"text", 'recipe'::"text"])) = ("owner_id" IS NOT NULL))),
    CONSTRAINT "foods_source_check" CHECK (("source" = ANY (ARRAY['off'::"text", 'usda'::"text", 'custom'::"text", 'recipe'::"text"])))
);


ALTER TABLE "public"."foods" OWNER TO "postgres";

--
-- Name: TABLE "foods"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."foods" IS 'Food reference data: Open Food Facts + USDA (global, owner_id NULL) plus user custom foods/recipes (owner_id set). Macros per 100g.';


--
-- Name: COLUMN "foods"."search_vector"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."foods"."search_vector" IS 'Generated FTS vector: name (weight A) + brand (weight B), simple config.';


--
-- Name: COLUMN "foods"."image_url"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."foods"."image_url" IS 'Front-of-pack product image URL (Open Food Facts image_url); NULL when none.';


--
-- Name: goal_completion_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."goal_completion_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "daily_goal_id" "uuid",
    "completion_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "target_value" numeric(10,2),
    "actual_value" numeric(10,2),
    "completion_percentage" numeric(5,2),
    "is_completed" boolean GENERATED ALWAYS AS (("completion_percentage" >= (100)::numeric)) STORED,
    "completed_at" timestamp with time zone,
    "logged_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."goal_completion_history" OWNER TO "postgres";

--
-- Name: TABLE "goal_completion_history"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."goal_completion_history" IS 'Historical record of daily goal completion for streak calculation and analytics';


--
-- Name: group_meal_tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."group_meal_tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_meal_id" "uuid" NOT NULL,
    "tagged_user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "accepted_food_log_entry_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_meal_tags_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."group_meal_tags" OWNER TO "postgres";

--
-- Name: TABLE "group_meal_tags"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."group_meal_tags" IS 'PRD §6.12 — circle members tagged in a group meal; accept creates their own food_log_entry.';


--
-- Name: group_meals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."group_meals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "creator_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "restaurant_name" "text",
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "meal_type" "text" NOT NULL,
    "calories" numeric,
    "protein_g" numeric,
    "carbs_g" numeric,
    "fat_g" numeric,
    "photo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_meals_meal_type_check" CHECK (("meal_type" = ANY (ARRAY['breakfast'::"text", 'lunch'::"text", 'dinner'::"text", 'snack'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."group_meals" OWNER TO "postgres";

--
-- Name: TABLE "group_meals"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."group_meals" IS 'PRD §6.12 — a shared meal one circle member logs on behalf of the table; per-person macros.';


--
-- Name: health_nutrition_sync; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."health_nutrition_sync" (
    "user_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "last_sync_at" timestamp with time zone,
    "last_cursor" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "health_nutrition_sync_platform_check" CHECK (("platform" = ANY (ARRAY['healthkit'::"text", 'healthconnect'::"text", 'mfp'::"text"])))
);


ALTER TABLE "public"."health_nutrition_sync" OWNER TO "postgres";

--
-- Name: TABLE "health_nutrition_sync"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."health_nutrition_sync" IS 'Per-user per-platform nutrition sync cursor (PRD §6.2). enabled + last_sync_at + last_cursor.';


--
-- Name: leaderboard; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."leaderboard" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "rank" integer NOT NULL,
    "previous_rank" integer,
    "points" integer DEFAULT 0 NOT NULL,
    "progress_percentage" numeric(5,2) DEFAULT 0,
    "weight_lost_kg" numeric(5,2),
    "weight_lost_percentage" numeric(5,2),
    "total_steps" integer DEFAULT 0,
    "total_minutes" integer DEFAULT 0,
    "check_ins_count" integer DEFAULT 0,
    "streak_days" integer DEFAULT 0,
    "last_check_in_at" timestamp with time zone,
    "trend" "text",
    "stats" "jsonb" DEFAULT '{}'::"jsonb",
    "calculated_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "leaderboard_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['individual'::"text", 'team'::"text"]))),
    CONSTRAINT "leaderboard_trend_check" CHECK (("trend" = ANY (ARRAY['up'::"text", 'down'::"text", 'stable'::"text"])))
);


ALTER TABLE "public"."leaderboard" OWNER TO "postgres";

--
-- Name: log_reactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."log_reactions" (
    "food_log_entry_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "reaction" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "log_reactions_reaction_check" CHECK (("reaction" = ANY (ARRAY['flame'::"text", 'clap'::"text", 'eyes'::"text", 'same'::"text", 'heart'::"text", 'laugh'::"text"])))
);

ALTER TABLE ONLY "public"."log_reactions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."log_reactions" OWNER TO "postgres";

--
-- Name: metric_streaks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."metric_streaks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "metric_type" "text" NOT NULL,
    "current_streak" integer DEFAULT 0 NOT NULL,
    "longest_streak" integer DEFAULT 0 NOT NULL,
    "last_log_date" "date",
    "grace_days_available" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "metric_streaks_metric_type_check" CHECK (("metric_type" = ANY (ARRAY['weight'::"text", 'steps'::"text", 'mood'::"text", 'measurements'::"text", 'photos'::"text"])))
);


ALTER TABLE "public"."metric_streaks" OWNER TO "postgres";

--
-- Name: TABLE "metric_streaks"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."metric_streaks" IS 'Tracks streaks for specific metrics like weight, steps, mood (Tier 2)';


--
-- Name: COLUMN "metric_streaks"."grace_days_available"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."metric_streaks"."grace_days_available" IS 'Varies by metric: weight=1, steps=1, mood=2, measurements=0, photos=0';


--
-- Name: notification_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."notification_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "notification_type" "text" NOT NULL,
    "notification_category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "delivered_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "suppressed" boolean DEFAULT false,
    "suppression_reason" "text"
);


ALTER TABLE "public"."notification_log" OWNER TO "postgres";

--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "journey_enabled" boolean DEFAULT true,
    "momentum_enabled" boolean DEFAULT true,
    "circle_enabled" boolean DEFAULT true,
    "challenge_enabled" boolean DEFAULT true,
    "social_enabled" boolean DEFAULT true,
    "celebration_enabled" boolean DEFAULT true,
    "quiet_hours_start" time without time zone,
    "quiet_hours_end" time without time zone,
    "quiet_hours_timezone" "text" DEFAULT 'America/New_York'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "public"."notification_type" NOT NULL,
    "channel" "public"."notification_channel" DEFAULT 'in_app'::"public"."notification_channel",
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "action_url" "text",
    "action_data" "jsonb",
    "priority" "text" DEFAULT 'normal'::"text",
    "sender_id" "uuid",
    "related_challenge_id" "uuid",
    "related_team_id" "uuid",
    "related_user_id" "uuid",
    "is_read" boolean DEFAULT false,
    "read_at" timestamp with time zone,
    "is_archived" boolean DEFAULT false,
    "archived_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "error_message" "text",
    "retry_count" integer DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "notifications_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";

--
-- Name: nutrition_challenge_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."nutrition_challenge_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fitcircle_id" "uuid" NOT NULL,
    "metric_type" "text" NOT NULL,
    "target_value" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "nutrition_challenge_config_metric_type_check" CHECK (("metric_type" = ANY (ARRAY['calorie_target'::"text", 'protein_target'::"text", 'carb_target'::"text", 'veg_days'::"text", 'sober_days'::"text", 'standard'::"text"]))),
    CONSTRAINT "nutrition_challenge_config_target_value_check" CHECK ((("target_value" IS NULL) OR ("target_value" >= (0)::numeric)))
);


ALTER TABLE "public"."nutrition_challenge_config" OWNER TO "postgres";

--
-- Name: TABLE "nutrition_challenge_config"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."nutrition_challenge_config" IS 'PRD §6.5 nutrition-driven challenge metrics: links a challenge (fitcircle) to one nutrition metric. Active members read; creator writes. Progress computed in NutritionChallengeService (TS); ranking is adherence/consistency only (§6.7), never restriction.';


--
-- Name: COLUMN "nutrition_challenge_config"."target_value"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."nutrition_challenge_config"."target_value" IS 'Goal to HIT/adhere to (e.g. kcal or grams per day). Never a less-is-better target (§6.7). NULL for veg_days/sober_days/standard.';


--
-- Name: nutrition_parse_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."nutrition_parse_cache" (
    "image_hash" "text" NOT NULL,
    "result" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."nutrition_parse_cache" OWNER TO "postgres";

--
-- Name: nutrition_parse_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."nutrition_parse_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "image_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."nutrition_parse_log" OWNER TO "postgres";

--
-- Name: onboarding_progress; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."onboarding_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "current_step" integer DEFAULT 0 NOT NULL,
    "completed_steps" "jsonb" DEFAULT '[]'::"jsonb",
    "is_complete" boolean DEFAULT false,
    "questionnaire_answers" "jsonb" DEFAULT '{}'::"jsonb",
    "persona_scores" "jsonb" DEFAULT '{}'::"jsonb",
    "detected_persona" "text",
    "detected_persona_secondary" "text",
    "goals_data" "jsonb" DEFAULT '{}'::"jsonb",
    "first_checkin_data" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."onboarding_progress" OWNER TO "postgres";

--
-- Name: onboarding_responses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."onboarding_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"(),
    "user_id" "uuid" NOT NULL,
    "question_key" "text" NOT NULL,
    "response_value" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."onboarding_responses" OWNER TO "postgres";

--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "challenge_id" "uuid",
    "amount" numeric(10,2) NOT NULL,
    "currency" character(3) DEFAULT 'USD'::"bpchar",
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status" NOT NULL,
    "type" "text" NOT NULL,
    "stripe_payment_intent_id" "text",
    "stripe_charge_id" "text",
    "stripe_refund_id" "text",
    "payment_method" "text",
    "payment_method_details" "jsonb",
    "description" "text",
    "receipt_url" "text",
    "failure_reason" "text",
    "refunded_amount" numeric(10,2) DEFAULT 0,
    "fee_amount" numeric(10,2) DEFAULT 0,
    "net_amount" numeric(10,2),
    "tax_amount" numeric(10,2) DEFAULT 0,
    "processed_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "refunded_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "payments_type_check" CHECK (("type" = ANY (ARRAY['entry_fee'::"text", 'subscription'::"text", 'donation'::"text", 'prize'::"text", 'refund'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";

--
-- Name: plate_scores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."plate_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "score_date" "date" NOT NULL,
    "score" integer NOT NULL,
    "adherence_component" numeric DEFAULT 0 NOT NULL,
    "balance_component" numeric DEFAULT 0 NOT NULL,
    "goalfit_component" numeric DEFAULT 0 NOT NULL,
    "breakdown" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "plate_scores_adherence_component_check" CHECK ((("adherence_component" >= (0)::numeric) AND ("adherence_component" <= (100)::numeric))),
    CONSTRAINT "plate_scores_balance_component_check" CHECK ((("balance_component" >= (0)::numeric) AND ("balance_component" <= (100)::numeric))),
    CONSTRAINT "plate_scores_goalfit_component_check" CHECK ((("goalfit_component" >= (0)::numeric) AND ("goalfit_component" <= (100)::numeric))),
    CONSTRAINT "plate_scores_score_check" CHECK ((("score" >= 0) AND ("score" <= 100)))
);


ALTER TABLE "public"."plate_scores" OWNER TO "postgres";

--
-- Name: TABLE "plate_scores"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."plate_scores" IS 'PRD §6.8 Plate Score: cached per-user-per-day 0–100 nutrition score. Rewards logging + macro balance + hitting goals; never rewards restriction (§6.7). Logic in PlateScoreService (TS), this is a cache.';


--
-- Name: COLUMN "plate_scores"."breakdown"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."plate_scores"."breakdown" IS 'Transparency payload: weights, raw macro totals, and friendly non-shaming notes shown to the user.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "avatar_url" "text",
    "bio" "text",
    "date_of_birth" "date",
    "height_cm" integer,
    "weight_kg" numeric(5,2),
    "timezone" "text" DEFAULT 'UTC'::"text",
    "country_code" character(2),
    "phone_number" "text",
    "phone_verified" boolean DEFAULT false,
    "onboarding_completed" boolean DEFAULT false,
    "fitness_level" "text",
    "goals" "jsonb" DEFAULT '[]'::"jsonb",
    "preferences" "jsonb" DEFAULT '{}'::"jsonb",
    "health_data_sync" "jsonb" DEFAULT '{}'::"jsonb",
    "stripe_customer_id" "text",
    "subscription_tier" "text" DEFAULT 'free'::"text",
    "subscription_status" "public"."subscription_status",
    "subscription_expires_at" timestamp with time zone,
    "total_points" integer DEFAULT 0,
    "current_streak" integer DEFAULT 0,
    "longest_streak" integer DEFAULT 0,
    "challenges_completed" integer DEFAULT 0,
    "challenges_won" integer DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "last_active_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "persona" "text",
    "persona_secondary" "text",
    "time_commitment" "text",
    "onboarding_completed_at" timestamp with time zone,
    "onboarding_current_step" integer DEFAULT 0,
    "total_xp" integer DEFAULT 0,
    "current_level" integer DEFAULT 1,
    "preferred_workout_types" "text"[] DEFAULT ARRAY[]::"text"[],
    "has_completed_assessment" boolean DEFAULT false,
    "subscription_platform" "text",
    "subscription_product_id" "text",
    "subscription_will_renew" boolean DEFAULT false NOT NULL,
    "subscription_synced_at" timestamp with time zone,
    CONSTRAINT "profiles_fitness_level_check" CHECK (("fitness_level" = ANY (ARRAY['beginner'::"text", 'intermediate'::"text", 'advanced'::"text", 'expert'::"text", 'athlete'::"text"]))),
    CONSTRAINT "profiles_height_cm_check" CHECK ((("height_cm" > 0) AND ("height_cm" < 300))),
    CONSTRAINT "profiles_persona_check" CHECK (("persona" = ANY (ARRAY['casey'::"text", 'sarah'::"text", 'mike'::"text", 'fiona'::"text"]))),
    CONSTRAINT "profiles_subscription_platform_check" CHECK (("subscription_platform" = ANY (ARRAY['app_store'::"text", 'play_store'::"text", 'stripe'::"text", 'promotional'::"text"]))),
    CONSTRAINT "profiles_subscription_tier_check" CHECK (("subscription_tier" = ANY (ARRAY['free'::"text", 'premium'::"text", 'enterprise'::"text"]))),
    CONSTRAINT "profiles_time_commitment_check" CHECK (("time_commitment" = ANY (ARRAY['15-30'::"text", '30-60'::"text", '60+'::"text", 'flexible'::"text", 'light'::"text", 'moderate'::"text", 'intense'::"text", 'extreme'::"text"]))),
    CONSTRAINT "profiles_weight_kg_check" CHECK ((("weight_kg" > (0)::numeric) AND ("weight_kg" < (1000)::numeric)))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";

--
-- Name: COLUMN "profiles"."subscription_platform"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."profiles"."subscription_platform" IS 'Store the active subscription was purchased on (app_store/play_store/stripe/promotional). Written only by the RevenueCat webhook handler.';


--
-- Name: COLUMN "profiles"."subscription_synced_at"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."profiles"."subscription_synced_at" IS 'event_timestamp of the last RevenueCat event applied — out-of-order webhook guard.';


--
-- Name: progress_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."progress_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "value" numeric(10,2) NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "is_public" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "progress_entries_value_check" CHECK (("value" >= (0)::numeric))
);


ALTER TABLE "public"."progress_entries" OWNER TO "postgres";

--
-- Name: TABLE "progress_entries"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."progress_entries" IS 'Stores user progress entries for FitCircle challenges';


--
-- Name: public_profiles; Type: VIEW; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW "public"."public_profiles" WITH ("security_invoker"='false') AS
 SELECT "id",
    "username",
    "display_name",
    "avatar_url"
   FROM "public"."profiles";


ALTER VIEW "public"."public_profiles" OWNER TO "postgres";

--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."push_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "device_name" "text",
    "is_active" boolean DEFAULT true,
    "last_used_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "push_tokens_platform_check" CHECK (("platform" = ANY (ARRAY['ios'::"text", 'android'::"text", 'web'::"text"])))
);


ALTER TABLE "public"."push_tokens" OWNER TO "postgres";

--
-- Name: reactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."reactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "type" "public"."reaction_type" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reactions_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['check_in'::"text", 'comment'::"text", 'achievement'::"text"])))
);


ALTER TABLE "public"."reactions" OWNER TO "postgres";

--
-- Name: share_cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."share_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "card_type" "text" NOT NULL,
    "template_name" "text" NOT NULL,
    "card_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "image_url" "text",
    "shared_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone DEFAULT ("now"() + '30 days'::interval),
    CONSTRAINT "share_cards_card_type_check" CHECK (("card_type" = ANY (ARRAY['milestone'::"text", 'challenge_complete'::"text", 'perfect_week'::"text", 'momentum_flame'::"text", 'circle_boost'::"text"])))
);


ALTER TABLE "public"."share_cards" OWNER TO "postgres";

--
-- Name: streak_claims; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."streak_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "claim_date" "date" NOT NULL,
    "claimed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "claim_method" character varying(50) NOT NULL,
    "timezone" character varying(100) NOT NULL,
    "health_data_synced" boolean DEFAULT false,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "streak_claims_claim_method_check" CHECK ((("claim_method")::"text" = ANY ((ARRAY['explicit'::character varying, 'manual_entry'::character varying, 'retroactive'::character varying, 'freeze'::character varying])::"text"[])))
);


ALTER TABLE "public"."streak_claims" OWNER TO "postgres";

--
-- Name: TABLE "streak_claims"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."streak_claims" IS 'Tracks explicit and implicit streak claims by users';


--
-- Name: COLUMN "streak_claims"."claim_method"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."streak_claims"."claim_method" IS 'How the streak was claimed: explicit (button press), manual_entry (via data submission), retroactive (past 7 days), freeze (shield protection for missed day)';


--
-- Name: COLUMN "streak_claims"."timezone"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."streak_claims"."timezone" IS 'User timezone at time of claim for grace period handling';


--
-- Name: COLUMN "streak_claims"."health_data_synced"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."streak_claims"."health_data_synced" IS 'Whether health data existed when claim was made';


--
-- Name: streak_recoveries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."streak_recoveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "broken_date" "date" NOT NULL,
    "recovery_type" character varying(50) NOT NULL,
    "recovery_status" character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    "actions_required" integer,
    "actions_completed" integer DEFAULT 0,
    "expires_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "streak_recoveries_actions_completed_check" CHECK (("actions_completed" >= 0)),
    CONSTRAINT "streak_recoveries_actions_required_check" CHECK (("actions_required" > 0)),
    CONSTRAINT "streak_recoveries_recovery_status_check" CHECK ((("recovery_status")::"text" = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'failed'::character varying, 'expired'::character varying])::"text"[]))),
    CONSTRAINT "streak_recoveries_recovery_type_check" CHECK ((("recovery_type")::"text" = ANY ((ARRAY['weekend_warrior'::character varying, 'shield_auto'::character varying, 'purchased'::character varying])::"text"[])))
);


ALTER TABLE "public"."streak_recoveries" OWNER TO "postgres";

--
-- Name: TABLE "streak_recoveries"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."streak_recoveries" IS 'Tracks streak recovery attempts (Weekend Warrior Pass, purchased resurrection)';


--
-- Name: COLUMN "streak_recoveries"."recovery_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."streak_recoveries"."recovery_type" IS 'weekend_warrior (2x actions next day), shield_auto (milestone shield), purchased ($2.99 resurrection)';


--
-- Name: COLUMN "streak_recoveries"."recovery_status"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."streak_recoveries"."recovery_status" IS 'pending (in progress), completed (success), failed (did not complete), expired (time ran out)';


--
-- Name: COLUMN "streak_recoveries"."actions_required"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."streak_recoveries"."actions_required" IS 'Number of actions needed to recover (e.g., 2 for weekend warrior)';


--
-- Name: streak_shields; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."streak_shields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "shield_type" character varying(50) NOT NULL,
    "available_count" integer DEFAULT 0 NOT NULL,
    "last_reset_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "streak_shields_available_count_check" CHECK (("available_count" >= 0)),
    CONSTRAINT "streak_shields_shield_type_check" CHECK ((("shield_type")::"text" = ANY ((ARRAY['freeze'::character varying, 'milestone_shield'::character varying, 'purchased'::character varying])::"text"[])))
);


ALTER TABLE "public"."streak_shields" OWNER TO "postgres";

--
-- Name: TABLE "streak_shields"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."streak_shields" IS 'Tracks available streak protection shields by type';


--
-- Name: COLUMN "streak_shields"."shield_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."streak_shields"."shield_type" IS 'freeze (weekly auto-reset), milestone_shield (earned at milestones), purchased (one-time buy)';


--
-- Name: COLUMN "streak_shields"."available_count"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."streak_shields"."available_count" IS 'Number of shields available to use';


--
-- Name: COLUMN "streak_shields"."last_reset_at"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."streak_shields"."last_reset_at" IS 'Last time weekly freeze was reset (Mondays)';


--
-- Name: subscription_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."subscription_events" (
    "id" "text" NOT NULL,
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "store" "text",
    "environment" "text",
    "event_timestamp" timestamp with time zone,
    "raw" "jsonb" NOT NULL,
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscription_events" OWNER TO "postgres";

--
-- Name: TABLE "subscription_events"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."subscription_events" IS 'Billing webhook idempotency + audit. One row per processed RevenueCat/Stripe event; PK conflict = duplicate delivery = no-op. Service-role only.';


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."team_role" DEFAULT 'member'::"public"."team_role",
    "joined_at" timestamp with time zone DEFAULT "now"(),
    "points_contributed" integer DEFAULT 0,
    "check_ins_count" integer DEFAULT 0,
    "last_check_in_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "removed_at" timestamp with time zone,
    "removed_by" "uuid",
    "removal_reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";

--
-- Name: teams; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "motto" "text",
    "avatar_url" "text",
    "is_public" boolean DEFAULT true,
    "max_members" integer DEFAULT 10,
    "member_count" integer DEFAULT 0,
    "total_points" integer DEFAULT 0,
    "rank" integer,
    "invite_code" "text" DEFAULT "substring"("replace"(("gen_random_uuid"())::"text", '-'::"text", ''::"text"), 1, 12),
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "stats" "jsonb" DEFAULT '{}'::"jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."teams" OWNER TO "postgres";

--
-- Name: token_blacklist; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."token_blacklist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "blacklisted_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "token_blacklist_reason_check" CHECK (("reason" = ANY (ARRAY['logout'::"text", 'security'::"text", 'account_deleted'::"text"])))
);


ALTER TABLE "public"."token_blacklist" OWNER TO "postgres";

--
-- Name: user_achievements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_achievements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "achievement_type" "public"."achievement_type" NOT NULL,
    "achievement_name" "text" NOT NULL,
    "achievement_description" "text",
    "achievement_icon" "text",
    "xp_awarded" integer DEFAULT 0,
    "badge_url" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "earned_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_achievements" OWNER TO "postgres";

--
-- Name: user_goals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "goal_type" "text" NOT NULL,
    "goal_name" "text" NOT NULL,
    "goal_description" "text",
    "current_value" numeric(10,2),
    "target_value" numeric(10,2) NOT NULL,
    "start_value" numeric(10,2),
    "target_date" "date",
    "created_date" "date" DEFAULT CURRENT_DATE,
    "status" "text" DEFAULT 'active'::"text",
    "progress_percentage" numeric(5,2) DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    CONSTRAINT "user_goals_goal_type_check" CHECK (("goal_type" = ANY (ARRAY['weight'::"text", 'steps'::"text", 'workout_frequency'::"text", 'habit'::"text", 'custom'::"text"]))),
    CONSTRAINT "user_goals_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'abandoned'::"text", 'paused'::"text"]))),
    CONSTRAINT "valid_progress" CHECK ((("progress_percentage" >= (0)::numeric) AND ("progress_percentage" <= (100)::numeric)))
);


ALTER TABLE "public"."user_goals" OWNER TO "postgres";

--
-- Name: achievements achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."achievements"
    ADD CONSTRAINT "achievements_pkey" PRIMARY KEY ("id");


--
-- Name: beverage_log_images beverage_log_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."beverage_log_images"
    ADD CONSTRAINT "beverage_log_images_pkey" PRIMARY KEY ("id");


--
-- Name: beverage_logs beverage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."beverage_logs"
    ADD CONSTRAINT "beverage_logs_pkey" PRIMARY KEY ("id");


--
-- Name: body_comp_parse_cache body_comp_parse_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."body_comp_parse_cache"
    ADD CONSTRAINT "body_comp_parse_cache_pkey" PRIMARY KEY ("image_hash");


--
-- Name: body_comp_parse_log body_comp_parse_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."body_comp_parse_log"
    ADD CONSTRAINT "body_comp_parse_log_pkey" PRIMARY KEY ("id");


--
-- Name: body_composition_logs body_composition_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."body_composition_logs"
    ADD CONSTRAINT "body_composition_logs_pkey" PRIMARY KEY ("id");


--
-- Name: challenge_invitations challenge_invitations_challenge_id_invited_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invitations"
    ADD CONSTRAINT "challenge_invitations_challenge_id_invited_email_key" UNIQUE ("challenge_id", "invited_email");


--
-- Name: challenge_invitations challenge_invitations_challenge_id_invited_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invitations"
    ADD CONSTRAINT "challenge_invitations_challenge_id_invited_user_id_key" UNIQUE ("challenge_id", "invited_user_id");


--
-- Name: challenge_invitations challenge_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invitations"
    ADD CONSTRAINT "challenge_invitations_pkey" PRIMARY KEY ("id");


--
-- Name: fitcircle_members challenge_participants_challenge_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_members"
    ADD CONSTRAINT "challenge_participants_challenge_id_user_id_key" UNIQUE ("fitcircle_id", "user_id");


--
-- Name: fitcircle_members challenge_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_members"
    ADD CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("id");


--
-- Name: challenge_templates challenge_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_templates"
    ADD CONSTRAINT "challenge_templates_pkey" PRIMARY KEY ("id");


--
-- Name: fitcircles challenges_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircles"
    ADD CONSTRAINT "challenges_invite_code_key" UNIQUE ("invite_code");


--
-- Name: fitcircles challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircles"
    ADD CONSTRAINT "challenges_pkey" PRIMARY KEY ("id");


--
-- Name: check_ins check_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."check_ins"
    ADD CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id");


--
-- Name: check_ins check_ins_user_id_challenge_id_check_in_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."check_ins"
    ADD CONSTRAINT "check_ins_user_id_challenge_id_check_in_date_key" UNIQUE ("user_id", "challenge_id", "check_in_date");


--
-- Name: challenge_invites circle_challenge_invites_challenge_id_invitee_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invites"
    ADD CONSTRAINT "circle_challenge_invites_challenge_id_invitee_id_key" UNIQUE ("challenge_id", "invitee_id");


--
-- Name: challenge_invites circle_challenge_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invites"
    ADD CONSTRAINT "circle_challenge_invites_pkey" PRIMARY KEY ("id");


--
-- Name: challenge_logs circle_challenge_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_logs"
    ADD CONSTRAINT "circle_challenge_logs_pkey" PRIMARY KEY ("id");


--
-- Name: challenge_participants circle_challenge_participants_challenge_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "circle_challenge_participants_challenge_id_user_id_key" UNIQUE ("challenge_id", "user_id");


--
-- Name: challenge_participants circle_challenge_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "circle_challenge_participants_pkey" PRIMARY KEY ("id");


--
-- Name: challenges circle_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "circle_challenges_pkey" PRIMARY KEY ("id");


--
-- Name: circle_chat_state circle_chat_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_chat_state"
    ADD CONSTRAINT "circle_chat_state_pkey" PRIMARY KEY ("fitcircle_id", "user_id");


--
-- Name: circle_check_ins circle_check_ins_member_id_check_in_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_check_ins"
    ADD CONSTRAINT "circle_check_ins_member_id_check_in_date_key" UNIQUE ("member_id", "check_in_date");


--
-- Name: circle_check_ins circle_check_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_check_ins"
    ADD CONSTRAINT "circle_check_ins_pkey" PRIMARY KEY ("id");


--
-- Name: circle_daily_boosts circle_daily_boosts_fitcircle_id_boost_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_daily_boosts"
    ADD CONSTRAINT "circle_daily_boosts_fitcircle_id_boost_date_key" UNIQUE ("fitcircle_id", "boost_date");


--
-- Name: circle_daily_boosts circle_daily_boosts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_daily_boosts"
    ADD CONSTRAINT "circle_daily_boosts_pkey" PRIMARY KEY ("id");


--
-- Name: circle_encouragements circle_encouragements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_encouragements"
    ADD CONSTRAINT "circle_encouragements_pkey" PRIMARY KEY ("id");


--
-- Name: circle_food_privacy circle_food_privacy_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_food_privacy"
    ADD CONSTRAINT "circle_food_privacy_pkey" PRIMARY KEY ("fitcircle_id", "user_id");


--
-- Name: circle_invites circle_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_invites"
    ADD CONSTRAINT "circle_invites_pkey" PRIMARY KEY ("id");


--
-- Name: circle_member_blocks circle_member_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_member_blocks"
    ADD CONSTRAINT "circle_member_blocks_pkey" PRIMARY KEY ("id");


--
-- Name: circle_member_blocks circle_member_blocks_uniq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_member_blocks"
    ADD CONSTRAINT "circle_member_blocks_uniq" UNIQUE ("blocker_id", "blocked_id");


--
-- Name: circle_message_reactions circle_message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_message_reactions"
    ADD CONSTRAINT "circle_message_reactions_pkey" PRIMARY KEY ("message_id", "user_id", "reaction");


--
-- Name: circle_message_reports circle_message_reports_one_per_reporter; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_message_reports"
    ADD CONSTRAINT "circle_message_reports_one_per_reporter" UNIQUE ("message_id", "reporter_id");


--
-- Name: circle_message_reports circle_message_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_message_reports"
    ADD CONSTRAINT "circle_message_reports_pkey" PRIMARY KEY ("id");


--
-- Name: circle_messages circle_messages_client_id_uniq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_messages"
    ADD CONSTRAINT "circle_messages_client_id_uniq" UNIQUE ("sender_id", "client_id");


--
-- Name: circle_messages circle_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_messages"
    ADD CONSTRAINT "circle_messages_pkey" PRIMARY KEY ("id");


--
-- Name: circle_quest_progress circle_quest_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_quest_progress"
    ADD CONSTRAINT "circle_quest_progress_pkey" PRIMARY KEY ("id");


--
-- Name: circle_quest_progress circle_quest_progress_quest_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_quest_progress"
    ADD CONSTRAINT "circle_quest_progress_quest_id_user_id_key" UNIQUE ("quest_id", "user_id");


--
-- Name: circle_quests circle_quests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_quests"
    ADD CONSTRAINT "circle_quests_pkey" PRIMARY KEY ("id");


--
-- Name: circle_streak_saves circle_streak_saves_fitcircle_id_covered_user_id_save_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_streak_saves"
    ADD CONSTRAINT "circle_streak_saves_fitcircle_id_covered_user_id_save_date_key" UNIQUE ("fitcircle_id", "covered_user_id", "save_date");


--
-- Name: circle_streak_saves circle_streak_saves_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_streak_saves"
    ADD CONSTRAINT "circle_streak_saves_pkey" PRIMARY KEY ("id");


--
-- Name: circle_streak_tracking circle_streak_tracking_circle_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_streak_tracking"
    ADD CONSTRAINT "circle_streak_tracking_circle_id_key" UNIQUE ("circle_id");


--
-- Name: circle_streak_tracking circle_streak_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_streak_tracking"
    ADD CONSTRAINT "circle_streak_tracking_pkey" PRIMARY KEY ("id");


--
-- Name: circle_streaks circle_streaks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_streaks"
    ADD CONSTRAINT "circle_streaks_pkey" PRIMARY KEY ("fitcircle_id");


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_pkey" PRIMARY KEY ("id");


--
-- Name: daily_challenge_participants daily_challenge_participants_daily_challenge_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_challenge_participants"
    ADD CONSTRAINT "daily_challenge_participants_daily_challenge_id_user_id_key" UNIQUE ("daily_challenge_id", "user_id");


--
-- Name: daily_challenge_participants daily_challenge_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_challenge_participants"
    ADD CONSTRAINT "daily_challenge_participants_pkey" PRIMARY KEY ("id");


--
-- Name: daily_challenges daily_challenges_challenge_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_challenges"
    ADD CONSTRAINT "daily_challenges_challenge_date_key" UNIQUE ("challenge_date");


--
-- Name: daily_challenges daily_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_challenges"
    ADD CONSTRAINT "daily_challenges_pkey" PRIMARY KEY ("id");


--
-- Name: daily_goals daily_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_goals"
    ADD CONSTRAINT "daily_goals_pkey" PRIMARY KEY ("id");


--
-- Name: daily_goals daily_goals_user_id_challenge_id_goal_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_goals"
    ADD CONSTRAINT "daily_goals_user_id_challenge_id_goal_type_key" UNIQUE ("user_id", "challenge_id", "goal_type");


--
-- Name: daily_high_five_limits daily_high_five_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_high_five_limits"
    ADD CONSTRAINT "daily_high_five_limits_pkey" PRIMARY KEY ("id");


--
-- Name: daily_high_five_limits daily_high_five_limits_user_id_circle_id_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_high_five_limits"
    ADD CONSTRAINT "daily_high_five_limits_user_id_circle_id_date_key" UNIQUE ("user_id", "circle_id", "date");


--
-- Name: daily_tracking daily_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_tracking"
    ADD CONSTRAINT "daily_tracking_pkey" PRIMARY KEY ("id");


--
-- Name: daily_tracking daily_tracking_user_id_tracking_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_tracking"
    ADD CONSTRAINT "daily_tracking_user_id_tracking_date_key" UNIQUE ("user_id", "tracking_date");


--
-- Name: dietary_preferences dietary_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dietary_preferences"
    ADD CONSTRAINT "dietary_preferences_pkey" PRIMARY KEY ("user_id");


--
-- Name: engagement_activities engagement_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."engagement_activities"
    ADD CONSTRAINT "engagement_activities_pkey" PRIMARY KEY ("id");


--
-- Name: engagement_streaks engagement_streaks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."engagement_streaks"
    ADD CONSTRAINT "engagement_streaks_pkey" PRIMARY KEY ("id");


--
-- Name: engagement_streaks engagement_streaks_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."engagement_streaks"
    ADD CONSTRAINT "engagement_streaks_user_id_key" UNIQUE ("user_id");


--
-- Name: exercise_logs exercise_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "exercise_logs_pkey" PRIMARY KEY ("id");


--
-- Name: feature_flags feature_flags_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_name_key" UNIQUE ("name");


--
-- Name: feature_flags feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id");


--
-- Name: feature_gates feature_gates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feature_gates"
    ADD CONSTRAINT "feature_gates_pkey" PRIMARY KEY ("feature_key");


--
-- Name: fitcircle_data_submissions fitcircle_data_submissions_fitcircle_id_user_id_submission__key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_data_submissions"
    ADD CONSTRAINT "fitcircle_data_submissions_fitcircle_id_user_id_submission__key" UNIQUE ("fitcircle_id", "user_id", "submission_date");


--
-- Name: fitcircle_data_submissions fitcircle_data_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_data_submissions"
    ADD CONSTRAINT "fitcircle_data_submissions_pkey" PRIMARY KEY ("id");


--
-- Name: fitcircle_leaderboard_entries fitcircle_leaderboard_entries_fitcircle_id_user_id_period_p_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_leaderboard_entries"
    ADD CONSTRAINT "fitcircle_leaderboard_entries_fitcircle_id_user_id_period_p_key" UNIQUE ("fitcircle_id", "user_id", "period", "period_start");


--
-- Name: fitcircle_leaderboard_entries fitcircle_leaderboard_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_leaderboard_entries"
    ADD CONSTRAINT "fitcircle_leaderboard_entries_pkey" PRIMARY KEY ("id");


--
-- Name: fitzy_message_log fitzy_message_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitzy_message_log"
    ADD CONSTRAINT "fitzy_message_log_pkey" PRIMARY KEY ("id");


--
-- Name: food_log_audit food_log_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_audit"
    ADD CONSTRAINT "food_log_audit_pkey" PRIMARY KEY ("id");


--
-- Name: food_log_entries food_log_entries_input_method_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE "public"."food_log_entries"
    ADD CONSTRAINT "food_log_entries_input_method_chk" CHECK ((("input_method" IS NULL) OR ("input_method" = ANY (ARRAY['photo'::"text", 'voice'::"text", 'barcode'::"text", 'search'::"text", 'recent'::"text", 'manual'::"text", 'imported'::"text", 'group_meal'::"text"])))) NOT VALID;


--
-- Name: food_log_entries food_log_entries_llm_confidence_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE "public"."food_log_entries"
    ADD CONSTRAINT "food_log_entries_llm_confidence_chk" CHECK ((("llm_confidence" IS NULL) OR (("llm_confidence" >= (0)::numeric) AND ("llm_confidence" <= (1)::numeric)))) NOT VALID;


--
-- Name: food_log_entries food_log_entries_nutrition_source_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE "public"."food_log_entries"
    ADD CONSTRAINT "food_log_entries_nutrition_source_chk" CHECK ((("nutrition_source" IS NULL) OR ("nutrition_source" = ANY (ARRAY['llm_vision'::"text", 'llm_voice'::"text", 'foods_db'::"text", 'user'::"text", 'healthkit'::"text", 'healthconnect'::"text", 'mfp'::"text"])))) NOT VALID;


--
-- Name: food_log_entries food_log_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_entries"
    ADD CONSTRAINT "food_log_entries_pkey" PRIMARY KEY ("id");


--
-- Name: food_log_images food_log_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_images"
    ADD CONSTRAINT "food_log_images_pkey" PRIMARY KEY ("id");


--
-- Name: food_log_shares food_log_shares_food_log_entry_id_shared_with_user_id_share_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_shares"
    ADD CONSTRAINT "food_log_shares_food_log_entry_id_shared_with_user_id_share_key" UNIQUE NULLS NOT DISTINCT ("food_log_entry_id", "shared_with_user_id", "shared_with_circle_id");


--
-- Name: food_log_shares food_log_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_shares"
    ADD CONSTRAINT "food_log_shares_pkey" PRIMARY KEY ("id");


--
-- Name: foods foods_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."foods"
    ADD CONSTRAINT "foods_pkey" PRIMARY KEY ("id");


--
-- Name: foods foods_source_uniq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."foods"
    ADD CONSTRAINT "foods_source_uniq" UNIQUE ("source", "source_id");


--
-- Name: goal_completion_history goal_completion_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."goal_completion_history"
    ADD CONSTRAINT "goal_completion_history_pkey" PRIMARY KEY ("id");


--
-- Name: goal_completion_history goal_completion_history_user_id_daily_goal_id_completion_da_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."goal_completion_history"
    ADD CONSTRAINT "goal_completion_history_user_id_daily_goal_id_completion_da_key" UNIQUE ("user_id", "daily_goal_id", "completion_date");


--
-- Name: group_meal_tags group_meal_tags_group_meal_id_tagged_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."group_meal_tags"
    ADD CONSTRAINT "group_meal_tags_group_meal_id_tagged_user_id_key" UNIQUE ("group_meal_id", "tagged_user_id");


--
-- Name: group_meal_tags group_meal_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."group_meal_tags"
    ADD CONSTRAINT "group_meal_tags_pkey" PRIMARY KEY ("id");


--
-- Name: group_meals group_meals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."group_meals"
    ADD CONSTRAINT "group_meals_pkey" PRIMARY KEY ("id");


--
-- Name: health_nutrition_sync health_nutrition_sync_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."health_nutrition_sync"
    ADD CONSTRAINT "health_nutrition_sync_pkey" PRIMARY KEY ("user_id", "platform");


--
-- Name: leaderboard leaderboard_challenge_id_entity_id_entity_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."leaderboard"
    ADD CONSTRAINT "leaderboard_challenge_id_entity_id_entity_type_key" UNIQUE ("challenge_id", "entity_id", "entity_type");


--
-- Name: leaderboard leaderboard_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."leaderboard"
    ADD CONSTRAINT "leaderboard_pkey" PRIMARY KEY ("id");


--
-- Name: log_reactions log_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."log_reactions"
    ADD CONSTRAINT "log_reactions_pkey" PRIMARY KEY ("food_log_entry_id", "user_id", "reaction");


--
-- Name: metric_streaks metric_streaks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."metric_streaks"
    ADD CONSTRAINT "metric_streaks_pkey" PRIMARY KEY ("id");


--
-- Name: notification_log notification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id");


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id");


--
-- Name: notification_preferences notification_preferences_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_key" UNIQUE ("user_id");


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");


--
-- Name: nutrition_challenge_config nutrition_challenge_config_fitcircle_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."nutrition_challenge_config"
    ADD CONSTRAINT "nutrition_challenge_config_fitcircle_id_key" UNIQUE ("fitcircle_id");


--
-- Name: nutrition_challenge_config nutrition_challenge_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."nutrition_challenge_config"
    ADD CONSTRAINT "nutrition_challenge_config_pkey" PRIMARY KEY ("id");


--
-- Name: nutrition_parse_cache nutrition_parse_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."nutrition_parse_cache"
    ADD CONSTRAINT "nutrition_parse_cache_pkey" PRIMARY KEY ("image_hash");


--
-- Name: nutrition_parse_log nutrition_parse_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."nutrition_parse_log"
    ADD CONSTRAINT "nutrition_parse_log_pkey" PRIMARY KEY ("id");


--
-- Name: onboarding_progress onboarding_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."onboarding_progress"
    ADD CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("id");


--
-- Name: onboarding_progress onboarding_progress_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."onboarding_progress"
    ADD CONSTRAINT "onboarding_progress_user_id_key" UNIQUE ("user_id");


--
-- Name: onboarding_responses onboarding_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."onboarding_responses"
    ADD CONSTRAINT "onboarding_responses_pkey" PRIMARY KEY ("user_id", "question_key");


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");


--
-- Name: payments payments_stripe_payment_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_stripe_payment_intent_id_key" UNIQUE ("stripe_payment_intent_id");


--
-- Name: plate_scores plate_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."plate_scores"
    ADD CONSTRAINT "plate_scores_pkey" PRIMARY KEY ("id");


--
-- Name: plate_scores plate_scores_user_id_score_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."plate_scores"
    ADD CONSTRAINT "plate_scores_user_id_score_date_key" UNIQUE ("user_id", "score_date");


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");


--
-- Name: profiles profiles_stripe_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_stripe_customer_id_key" UNIQUE ("stripe_customer_id");


--
-- Name: profiles profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");


--
-- Name: progress_entries progress_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."progress_entries"
    ADD CONSTRAINT "progress_entries_pkey" PRIMARY KEY ("id");


--
-- Name: progress_entries progress_entries_user_id_challenge_id_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."progress_entries"
    ADD CONSTRAINT "progress_entries_user_id_challenge_id_date_key" UNIQUE ("user_id", "challenge_id", "date");


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: push_tokens push_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_token_key" UNIQUE ("token");


--
-- Name: reactions reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."reactions"
    ADD CONSTRAINT "reactions_pkey" PRIMARY KEY ("id");


--
-- Name: reactions reactions_user_id_entity_type_entity_id_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."reactions"
    ADD CONSTRAINT "reactions_user_id_entity_type_entity_id_type_key" UNIQUE ("user_id", "entity_type", "entity_id", "type");


--
-- Name: share_cards share_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."share_cards"
    ADD CONSTRAINT "share_cards_pkey" PRIMARY KEY ("id");


--
-- Name: streak_claims streak_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."streak_claims"
    ADD CONSTRAINT "streak_claims_pkey" PRIMARY KEY ("id");


--
-- Name: streak_recoveries streak_recoveries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."streak_recoveries"
    ADD CONSTRAINT "streak_recoveries_pkey" PRIMARY KEY ("id");


--
-- Name: streak_shields streak_shields_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."streak_shields"
    ADD CONSTRAINT "streak_shields_pkey" PRIMARY KEY ("id");


--
-- Name: subscription_events subscription_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."subscription_events"
    ADD CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id");


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");


--
-- Name: team_members team_members_team_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_user_id_key" UNIQUE ("team_id", "user_id");


--
-- Name: teams teams_challenge_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_challenge_id_name_key" UNIQUE ("challenge_id", "name");


--
-- Name: teams teams_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_invite_code_key" UNIQUE ("invite_code");


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");


--
-- Name: token_blacklist token_blacklist_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."token_blacklist"
    ADD CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id");


--
-- Name: token_blacklist token_blacklist_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."token_blacklist"
    ADD CONSTRAINT "token_blacklist_token_hash_key" UNIQUE ("token_hash");


--
-- Name: engagement_activities unique_engagement_activity; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."engagement_activities"
    ADD CONSTRAINT "unique_engagement_activity" UNIQUE ("user_id", "activity_date", "activity_type", "reference_id");


--
-- Name: exercise_logs unique_healthkit_workout; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "unique_healthkit_workout" UNIQUE ("user_id", "healthkit_workout_id");


--
-- Name: metric_streaks unique_metric_streak; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."metric_streaks"
    ADD CONSTRAINT "unique_metric_streak" UNIQUE ("user_id", "metric_type");


--
-- Name: streak_claims unique_streak_claim; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."streak_claims"
    ADD CONSTRAINT "unique_streak_claim" UNIQUE ("user_id", "claim_date");


--
-- Name: streak_recoveries unique_user_recovery; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."streak_recoveries"
    ADD CONSTRAINT "unique_user_recovery" UNIQUE ("user_id", "broken_date");


--
-- Name: streak_shields unique_user_shield_type; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."streak_shields"
    ADD CONSTRAINT "unique_user_shield_type" UNIQUE ("user_id", "shield_type");


--
-- Name: user_achievements user_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_achievements"
    ADD CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id");


--
-- Name: user_achievements user_achievements_user_id_achievement_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_achievements"
    ADD CONSTRAINT "user_achievements_user_id_achievement_name_key" UNIQUE ("user_id", "achievement_name");


--
-- Name: user_goals user_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_goals"
    ADD CONSTRAINT "user_goals_pkey" PRIMARY KEY ("id");


--
-- Name: weekly_goals weekly_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."weekly_goals"
    ADD CONSTRAINT "weekly_goals_pkey" PRIMARY KEY ("id");


--
-- Name: weekly_goals weekly_goals_user_id_week_start_goal_type_fitcircle_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."weekly_goals"
    ADD CONSTRAINT "weekly_goals_user_id_week_start_goal_type_fitcircle_id_key" UNIQUE ("user_id", "week_start", "goal_type", "fitcircle_id");


--
-- Name: body_comp_external_uq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "body_comp_external_uq" ON "public"."body_composition_logs" USING "btree" ("user_id", "source", "source_external_id") WHERE ("source_external_id" IS NOT NULL);


--
-- Name: body_comp_measured_uq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "body_comp_measured_uq" ON "public"."body_composition_logs" USING "btree" ("user_id", "measured_at", "source");


--
-- Name: body_comp_user_time_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "body_comp_user_time_idx" ON "public"."body_composition_logs" USING "btree" ("user_id", "measured_at" DESC);


--
-- Name: food_log_entries_external_uniq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "food_log_entries_external_uniq" ON "public"."food_log_entries" USING "btree" ("user_id", "nutrition_source", "source_external_id") WHERE ("source_external_id" IS NOT NULL);


--
-- Name: foods_barcode_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "foods_barcode_idx" ON "public"."foods" USING "btree" ("barcode") WHERE ("barcode" IS NOT NULL);


--
-- Name: foods_name_trgm_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "foods_name_trgm_idx" ON "public"."foods" USING "gin" ("name" "public"."gin_trgm_ops");


--
-- Name: foods_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "foods_owner_idx" ON "public"."foods" USING "btree" ("owner_id") WHERE ("owner_id" IS NOT NULL);


--
-- Name: foods_search_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "foods_search_idx" ON "public"."foods" USING "gin" ("search_vector");


--
-- Name: idx_beverage_log_images_entry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_beverage_log_images_entry" ON "public"."beverage_log_images" USING "btree" ("beverage_log_id", "display_order") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_beverage_log_images_entry_order_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_beverage_log_images_entry_order_unique" ON "public"."beverage_log_images" USING "btree" ("beverage_log_id", "display_order") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_beverage_log_images_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_beverage_log_images_user" ON "public"."beverage_log_images" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_beverage_logs_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_beverage_logs_category" ON "public"."beverage_logs" USING "btree" ("category") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_beverage_logs_customizations; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_beverage_logs_customizations" ON "public"."beverage_logs" USING "gin" ("customizations") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_beverage_logs_date_range; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_beverage_logs_date_range" ON "public"."beverage_logs" USING "btree" ("entry_date") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_beverage_logs_favorites; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_beverage_logs_favorites" ON "public"."beverage_logs" USING "btree" ("user_id", "is_favorite") WHERE (("deleted_at" IS NULL) AND ("is_favorite" = true));


--
-- Name: idx_beverage_logs_logged_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_beverage_logs_logged_at" ON "public"."beverage_logs" USING "btree" ("logged_at" DESC) WHERE ("deleted_at" IS NULL);


--
-- Name: idx_beverage_logs_user_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_beverage_logs_user_category" ON "public"."beverage_logs" USING "btree" ("user_id", "category") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_beverage_logs_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_beverage_logs_user_date" ON "public"."beverage_logs" USING "btree" ("user_id", "entry_date" DESC) WHERE ("deleted_at" IS NULL);


--
-- Name: idx_body_comp_parse_log_user_day; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_body_comp_parse_log_user_day" ON "public"."body_comp_parse_log" USING "btree" ("user_id", "created_at" DESC);


--
-- Name: idx_cc_logs_challenge_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_cc_logs_challenge_id" ON "public"."challenge_logs" USING "btree" ("challenge_id", "logged_at" DESC);


--
-- Name: idx_cc_logs_participant_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_cc_logs_participant_id" ON "public"."challenge_logs" USING "btree" ("participant_id", "log_date" DESC);


--
-- Name: idx_cc_logs_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_cc_logs_user_date" ON "public"."challenge_logs" USING "btree" ("user_id", "challenge_id", "log_date" DESC);


--
-- Name: idx_cc_participants_challenge_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_cc_participants_challenge_id" ON "public"."challenge_participants" USING "btree" ("challenge_id");


--
-- Name: idx_cc_participants_leaderboard; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_cc_participants_leaderboard" ON "public"."challenge_participants" USING "btree" ("challenge_id", "cumulative_total" DESC, "today_total" DESC, "current_streak" DESC) WHERE ("status" = 'active'::"text");


--
-- Name: idx_cc_participants_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_cc_participants_user_id" ON "public"."challenge_participants" USING "btree" ("user_id");


--
-- Name: idx_challenge_participants_challenge_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_challenge_participants_challenge_status" ON "public"."fitcircle_members" USING "btree" ("fitcircle_id", "status");


--
-- Name: idx_challenge_participants_user_challenge; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_challenge_participants_user_challenge" ON "public"."fitcircle_members" USING "btree" ("user_id", "fitcircle_id");


--
-- Name: idx_challenges_creator; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_challenges_creator" ON "public"."fitcircles" USING "btree" ("creator_id");


--
-- Name: idx_challenges_invite_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_challenges_invite_code" ON "public"."fitcircles" USING "btree" ("invite_code");


--
-- Name: idx_challenges_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_challenges_status" ON "public"."fitcircles" USING "btree" ("status");


--
-- Name: idx_circle_boosts_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_boosts_date" ON "public"."circle_daily_boosts" USING "btree" ("boost_date");


--
-- Name: idx_circle_boosts_fitcircle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_boosts_fitcircle" ON "public"."circle_daily_boosts" USING "btree" ("fitcircle_id");


--
-- Name: idx_circle_challenges_circle_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_challenges_circle_active" ON "public"."challenges" USING "btree" ("fitcircle_id", "status") WHERE ("status" = ANY (ARRAY['scheduled'::"text", 'active'::"text"]));


--
-- Name: idx_circle_challenges_circle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_challenges_circle_id" ON "public"."challenges" USING "btree" ("fitcircle_id");


--
-- Name: idx_circle_challenges_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_challenges_status" ON "public"."challenges" USING "btree" ("status", "starts_at");


--
-- Name: idx_circle_check_ins_circle_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_check_ins_circle_date" ON "public"."circle_check_ins" USING "btree" ("circle_id", "check_in_date" DESC);


--
-- Name: idx_circle_check_ins_circle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_check_ins_circle_id" ON "public"."circle_check_ins" USING "btree" ("circle_id");


--
-- Name: idx_circle_check_ins_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_check_ins_date" ON "public"."circle_check_ins" USING "btree" ("check_in_date" DESC);


--
-- Name: idx_circle_check_ins_member_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_check_ins_member_id" ON "public"."circle_check_ins" USING "btree" ("member_id");


--
-- Name: idx_circle_check_ins_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_check_ins_user_id" ON "public"."circle_check_ins" USING "btree" ("user_id");


--
-- Name: idx_circle_encouragements_circle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_encouragements_circle_id" ON "public"."circle_encouragements" USING "btree" ("circle_id");


--
-- Name: idx_circle_encouragements_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_encouragements_created" ON "public"."circle_encouragements" USING "btree" ("circle_id", "created_at" DESC);


--
-- Name: idx_circle_encouragements_from_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_encouragements_from_user" ON "public"."circle_encouragements" USING "btree" ("from_user_id");


--
-- Name: idx_circle_encouragements_to_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_encouragements_to_user" ON "public"."circle_encouragements" USING "btree" ("to_user_id") WHERE ("to_user_id" IS NOT NULL);


--
-- Name: idx_circle_encouragements_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_encouragements_type" ON "public"."circle_encouragements" USING "btree" ("type");


--
-- Name: idx_circle_food_privacy_circle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_food_privacy_circle" ON "public"."circle_food_privacy" USING "btree" ("fitcircle_id");


--
-- Name: idx_circle_invites_circle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_invites_circle_id" ON "public"."circle_invites" USING "btree" ("circle_id");


--
-- Name: idx_circle_invites_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_invites_email" ON "public"."circle_invites" USING "btree" ("email") WHERE ("email" IS NOT NULL);


--
-- Name: idx_circle_invites_invite_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_invites_invite_code" ON "public"."circle_invites" USING "btree" ("invite_code");


--
-- Name: idx_circle_invites_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_invites_status" ON "public"."circle_invites" USING "btree" ("status");


--
-- Name: idx_circle_member_blocks_blocker; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_member_blocks_blocker" ON "public"."circle_member_blocks" USING "btree" ("blocker_id");


--
-- Name: idx_circle_message_reactions_message; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_message_reactions_message" ON "public"."circle_message_reactions" USING "btree" ("message_id");


--
-- Name: idx_circle_message_reports_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_message_reports_open" ON "public"."circle_message_reports" USING "btree" ("status", "created_at") WHERE ("status" = 'open'::"text");


--
-- Name: idx_circle_messages_circle_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_messages_circle_time" ON "public"."circle_messages" USING "btree" ("fitcircle_id", "created_at" DESC);


--
-- Name: idx_circle_messages_sender; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_messages_sender" ON "public"."circle_messages" USING "btree" ("sender_id") WHERE ("sender_id" IS NOT NULL);


--
-- Name: idx_circle_streak_saves_circle_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_streak_saves_circle_date" ON "public"."circle_streak_saves" USING "btree" ("fitcircle_id", "save_date");


--
-- Name: idx_circle_streak_tracking_circle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_circle_streak_tracking_circle_id" ON "public"."circle_streak_tracking" USING "btree" ("circle_id");


--
-- Name: idx_daily_challenges_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_challenges_date" ON "public"."daily_challenges" USING "btree" ("challenge_date");


--
-- Name: idx_daily_goals_active_dates; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_goals_active_dates" ON "public"."daily_goals" USING "btree" ("user_id", "start_date", "end_date") WHERE ("is_active" = true);


--
-- Name: idx_daily_goals_challenge; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_goals_challenge" ON "public"."daily_goals" USING "btree" ("challenge_id");


--
-- Name: idx_daily_goals_primary; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_goals_primary" ON "public"."daily_goals" USING "btree" ("user_id", "is_primary") WHERE ("is_active" = true);


--
-- Name: idx_daily_goals_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_goals_user" ON "public"."daily_goals" USING "btree" ("user_id") WHERE ("is_active" = true);


--
-- Name: idx_daily_high_five_limits_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_high_five_limits_lookup" ON "public"."daily_high_five_limits" USING "btree" ("user_id", "circle_id", "date");


--
-- Name: idx_daily_participants_challenge; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_participants_challenge" ON "public"."daily_challenge_participants" USING "btree" ("daily_challenge_id", "is_completed");


--
-- Name: idx_daily_participants_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_participants_user" ON "public"."daily_challenge_participants" USING "btree" ("user_id", "joined_at" DESC);


--
-- Name: idx_daily_tracking_public; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_tracking_public" ON "public"."daily_tracking" USING "btree" ("is_public") WHERE ("is_public" = true);


--
-- Name: idx_daily_tracking_steps_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_tracking_steps_source" ON "public"."daily_tracking" USING "btree" ("user_id", "steps_source");


--
-- Name: idx_daily_tracking_submitted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_tracking_submitted" ON "public"."daily_tracking" USING "btree" ("user_id", "submitted_to_fitcircles", "tracking_date" DESC);


--
-- Name: idx_daily_tracking_synced_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_tracking_synced_at" ON "public"."daily_tracking" USING "btree" ("user_id", "steps_synced_at" DESC) WHERE ("steps_synced_at" IS NOT NULL);


--
-- Name: idx_daily_tracking_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_tracking_user_date" ON "public"."daily_tracking" USING "btree" ("user_id", "tracking_date" DESC);


--
-- Name: idx_daily_tracking_user_public; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_daily_tracking_user_public" ON "public"."daily_tracking" USING "btree" ("user_id", "tracking_date" DESC, "is_public");


--
-- Name: idx_engagement_activities_today_checkin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_engagement_activities_today_checkin" ON "public"."engagement_activities" USING "btree" ("user_id", "activity_date", "activity_type") WHERE ("activity_type" = 'streak_checkin'::"text");


--
-- Name: idx_engagement_activities_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_engagement_activities_type" ON "public"."engagement_activities" USING "btree" ("activity_type");


--
-- Name: idx_engagement_activities_type_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_engagement_activities_type_date" ON "public"."engagement_activities" USING "btree" ("user_id", "activity_type", "activity_date" DESC);


--
-- Name: idx_engagement_activities_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_engagement_activities_user_date" ON "public"."engagement_activities" USING "btree" ("user_id", "activity_date" DESC);


--
-- Name: idx_engagement_streaks_grace_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_engagement_streaks_grace_week" ON "public"."engagement_streaks" USING "btree" ("grace_day_week_start");


--
-- Name: idx_engagement_streaks_last_claim; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_engagement_streaks_last_claim" ON "public"."engagement_streaks" USING "btree" ("user_id", "last_claim_date");


--
-- Name: idx_engagement_streaks_last_decay; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_engagement_streaks_last_decay" ON "public"."engagement_streaks" USING "btree" ("last_decay_applied_at");


--
-- Name: idx_engagement_streaks_last_engagement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_engagement_streaks_last_engagement" ON "public"."engagement_streaks" USING "btree" ("last_engagement_date");


--
-- Name: idx_engagement_streaks_points; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_engagement_streaks_points" ON "public"."engagement_streaks" USING "btree" ("user_id", "total_points" DESC);


--
-- Name: idx_engagement_streaks_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_engagement_streaks_user_id" ON "public"."engagement_streaks" USING "btree" ("user_id");


--
-- Name: idx_exercise_logs_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_exercise_logs_category" ON "public"."exercise_logs" USING "btree" ("user_id", "category", "exercise_date" DESC) WHERE ("is_deleted" = false);


--
-- Name: idx_exercise_logs_checkin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_exercise_logs_checkin" ON "public"."exercise_logs" USING "btree" ("user_id", "created_at") WHERE ("counts_as_checkin" = true);


--
-- Name: idx_exercise_logs_healthkit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_exercise_logs_healthkit" ON "public"."exercise_logs" USING "btree" ("healthkit_workout_id") WHERE ("healthkit_workout_id" IS NOT NULL);


--
-- Name: idx_exercise_logs_public; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_exercise_logs_public" ON "public"."exercise_logs" USING "btree" ("user_id", "is_public", "exercise_date" DESC) WHERE ("is_deleted" = false);


--
-- Name: idx_exercise_logs_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_exercise_logs_user_date" ON "public"."exercise_logs" USING "btree" ("user_id", "exercise_date" DESC) WHERE ("is_deleted" = false);


--
-- Name: idx_exercise_logs_user_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_exercise_logs_user_type" ON "public"."exercise_logs" USING "btree" ("user_id", "exercise_type") WHERE ("is_deleted" = false);


--
-- Name: idx_feature_flags_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_feature_flags_name" ON "public"."feature_flags" USING "btree" ("name") WHERE ("is_enabled" = true);


--
-- Name: idx_fitcircles_official_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_fitcircles_official_active" ON "public"."fitcircles" USING "btree" ("created_at" DESC) WHERE (("is_official" = true) AND ("visibility" = 'public'::"public"."challenge_visibility") AND ("status" = ANY (ARRAY['upcoming'::"public"."challenge_status", 'active'::"public"."challenge_status"])));


--
-- Name: idx_fitzy_message_log_user_day; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_fitzy_message_log_user_day" ON "public"."fitzy_message_log" USING "btree" ("user_id", "created_at");


--
-- Name: idx_food_log_audit_action; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_audit_action" ON "public"."food_log_audit" USING "btree" ("action");


--
-- Name: idx_food_log_audit_entry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_audit_entry" ON "public"."food_log_audit" USING "btree" ("food_log_entry_id", "created_at" DESC);


--
-- Name: idx_food_log_audit_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_audit_user" ON "public"."food_log_audit" USING "btree" ("user_id", "created_at" DESC);


--
-- Name: idx_food_log_entries_logged_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_entries_logged_at" ON "public"."food_log_entries" USING "btree" ("logged_at" DESC) WHERE ("deleted_at" IS NULL);


--
-- Name: idx_food_log_entries_tags; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_entries_tags" ON "public"."food_log_entries" USING "gin" ("tags") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_food_log_entries_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_entries_user_date" ON "public"."food_log_entries" USING "btree" ("user_id", "entry_date" DESC) WHERE ("deleted_at" IS NULL);


--
-- Name: idx_food_log_entries_user_day_calories; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_entries_user_day_calories" ON "public"."food_log_entries" USING "btree" ("user_id", "entry_date") WHERE (("calories" IS NOT NULL) AND ("deleted_at" IS NULL));


--
-- Name: idx_food_log_entries_user_day_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_entries_user_day_time" ON "public"."food_log_entries" USING "btree" ("user_id", "entry_date" DESC, "logged_at") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_food_log_entries_user_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_entries_user_type" ON "public"."food_log_entries" USING "btree" ("user_id", "entry_type") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_food_log_entries_visibility; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_entries_visibility" ON "public"."food_log_entries" USING "btree" ("visibility") WHERE (("deleted_at" IS NULL) AND ("is_private" = false));


--
-- Name: idx_food_log_images_entry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_images_entry" ON "public"."food_log_images" USING "btree" ("food_log_entry_id", "display_order");


--
-- Name: idx_food_log_images_entry_order_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_food_log_images_entry_order_unique" ON "public"."food_log_images" USING "btree" ("food_log_entry_id", "display_order") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_food_log_images_storage_path; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_images_storage_path" ON "public"."food_log_images" USING "btree" ("storage_path") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_food_log_images_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_images_user" ON "public"."food_log_images" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_food_log_shares_circle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_shares_circle" ON "public"."food_log_shares" USING "btree" ("shared_with_circle_id") WHERE ("shared_with_circle_id" IS NOT NULL);


--
-- Name: idx_food_log_shares_entry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_shares_entry" ON "public"."food_log_shares" USING "btree" ("food_log_entry_id");


--
-- Name: idx_food_log_shares_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_shares_owner" ON "public"."food_log_shares" USING "btree" ("owner_id");


--
-- Name: idx_food_log_shares_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_food_log_shares_user" ON "public"."food_log_shares" USING "btree" ("shared_with_user_id") WHERE ("shared_with_user_id" IS NOT NULL);


--
-- Name: idx_goal_completion_goal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_goal_completion_goal" ON "public"."goal_completion_history" USING "btree" ("daily_goal_id", "completion_date" DESC);


--
-- Name: idx_goal_completion_streak; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_goal_completion_streak" ON "public"."goal_completion_history" USING "btree" ("user_id", "is_completed", "completion_date" DESC) WHERE ("is_completed" = true);


--
-- Name: idx_goal_completion_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_goal_completion_user_date" ON "public"."goal_completion_history" USING "btree" ("user_id", "completion_date" DESC);


--
-- Name: idx_group_meal_tags_meal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_group_meal_tags_meal" ON "public"."group_meal_tags" USING "btree" ("group_meal_id");


--
-- Name: idx_group_meal_tags_user_pending; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_group_meal_tags_user_pending" ON "public"."group_meal_tags" USING "btree" ("tagged_user_id", "status");


--
-- Name: idx_group_meals_creator; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_group_meals_creator" ON "public"."group_meals" USING "btree" ("creator_id");


--
-- Name: idx_group_meals_fitcircle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_group_meals_fitcircle" ON "public"."group_meals" USING "btree" ("fitcircle_id", "logged_at" DESC);


--
-- Name: idx_leaderboard_fitcircle_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_leaderboard_fitcircle_period" ON "public"."fitcircle_leaderboard_entries" USING "btree" ("fitcircle_id", "period", "period_start", "rank");


--
-- Name: idx_leaderboard_ranking; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_leaderboard_ranking" ON "public"."fitcircle_leaderboard_entries" USING "btree" ("fitcircle_id", "period", "period_start", "metric_value" DESC);


--
-- Name: idx_leaderboard_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_leaderboard_user" ON "public"."fitcircle_leaderboard_entries" USING "btree" ("user_id", "fitcircle_id", "period");


--
-- Name: idx_log_reactions_entry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_log_reactions_entry" ON "public"."log_reactions" USING "btree" ("food_log_entry_id");


--
-- Name: idx_metric_streaks_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_metric_streaks_type" ON "public"."metric_streaks" USING "btree" ("metric_type");


--
-- Name: idx_metric_streaks_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_metric_streaks_user_id" ON "public"."metric_streaks" USING "btree" ("user_id");


--
-- Name: idx_notification_log_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_notification_log_type" ON "public"."notification_log" USING "btree" ("notification_type", "sent_at");


--
-- Name: idx_notification_log_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_notification_log_user" ON "public"."notification_log" USING "btree" ("user_id", "sent_at" DESC);


--
-- Name: idx_notification_preferences_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_notification_preferences_user" ON "public"."notification_preferences" USING "btree" ("user_id");


--
-- Name: idx_nutrition_challenge_config_fitcircle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_nutrition_challenge_config_fitcircle" ON "public"."nutrition_challenge_config" USING "btree" ("fitcircle_id");


--
-- Name: idx_nutrition_parse_log_user_day; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_nutrition_parse_log_user_day" ON "public"."nutrition_parse_log" USING "btree" ("user_id", "created_at" DESC);


--
-- Name: idx_onboarding_progress_incomplete; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_onboarding_progress_incomplete" ON "public"."onboarding_progress" USING "btree" ("is_complete") WHERE ("is_complete" = false);


--
-- Name: idx_onboarding_progress_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_onboarding_progress_user_id" ON "public"."onboarding_progress" USING "btree" ("user_id");


--
-- Name: idx_onboarding_responses_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_onboarding_responses_user" ON "public"."onboarding_responses" USING "btree" ("user_id");


--
-- Name: idx_participants_challenge; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_participants_challenge" ON "public"."fitcircle_members" USING "btree" ("fitcircle_id");


--
-- Name: idx_participants_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_participants_user" ON "public"."fitcircle_members" USING "btree" ("user_id");


--
-- Name: idx_plate_scores_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_plate_scores_user_date" ON "public"."plate_scores" USING "btree" ("user_id", "score_date" DESC);


--
-- Name: idx_profiles_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_profiles_email" ON "public"."profiles" USING "btree" ("email");


--
-- Name: idx_profiles_persona; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_profiles_persona" ON "public"."profiles" USING "btree" ("persona") WHERE ("persona" IS NOT NULL);


--
-- Name: idx_profiles_xp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_profiles_xp" ON "public"."profiles" USING "btree" ("total_xp" DESC) WHERE ("is_active" = true);


--
-- Name: idx_push_tokens_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_push_tokens_token" ON "public"."push_tokens" USING "btree" ("token");


--
-- Name: idx_push_tokens_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_push_tokens_user" ON "public"."push_tokens" USING "btree" ("user_id", "is_active");


--
-- Name: idx_quest_progress; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_quest_progress" ON "public"."circle_quest_progress" USING "btree" ("quest_id", "is_completed");


--
-- Name: idx_quests_circle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_quests_circle" ON "public"."circle_quests" USING "btree" ("fitcircle_id", "status");


--
-- Name: idx_share_cards_expiry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_share_cards_expiry" ON "public"."share_cards" USING "btree" ("expires_at");


--
-- Name: idx_share_cards_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_share_cards_user" ON "public"."share_cards" USING "btree" ("user_id", "created_at" DESC);


--
-- Name: idx_streak_claims_claimed_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_streak_claims_claimed_at" ON "public"."streak_claims" USING "btree" ("claimed_at");


--
-- Name: idx_streak_claims_method; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_streak_claims_method" ON "public"."streak_claims" USING "btree" ("claim_method");


--
-- Name: idx_streak_claims_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_streak_claims_user_date" ON "public"."streak_claims" USING "btree" ("user_id", "claim_date" DESC);


--
-- Name: idx_streak_recoveries_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_streak_recoveries_date" ON "public"."streak_recoveries" USING "btree" ("broken_date");


--
-- Name: idx_streak_recoveries_expires; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_streak_recoveries_expires" ON "public"."streak_recoveries" USING "btree" ("expires_at") WHERE (("recovery_status")::"text" = 'pending'::"text");


--
-- Name: idx_streak_recoveries_user_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_streak_recoveries_user_status" ON "public"."streak_recoveries" USING "btree" ("user_id", "recovery_status");


--
-- Name: idx_streak_shields_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_streak_shields_type" ON "public"."streak_shields" USING "btree" ("shield_type");


--
-- Name: idx_streak_shields_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_streak_shields_user" ON "public"."streak_shields" USING "btree" ("user_id");


--
-- Name: idx_submissions_fitcircle_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_submissions_fitcircle_date" ON "public"."fitcircle_data_submissions" USING "btree" ("fitcircle_id", "submission_date" DESC);


--
-- Name: idx_submissions_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_submissions_timestamp" ON "public"."fitcircle_data_submissions" USING "btree" ("fitcircle_id", "submission_date", "submitted_at");


--
-- Name: idx_submissions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_submissions_user" ON "public"."fitcircle_data_submissions" USING "btree" ("user_id", "submission_date" DESC);


--
-- Name: idx_subscription_events_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_subscription_events_user" ON "public"."subscription_events" USING "btree" ("user_id", "processed_at" DESC);


--
-- Name: idx_templates_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_templates_category" ON "public"."challenge_templates" USING "btree" ("category", "is_active");


--
-- Name: idx_templates_difficulty; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_templates_difficulty" ON "public"."challenge_templates" USING "btree" ("difficulty", "is_active");


--
-- Name: idx_token_blacklist_cleanup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_token_blacklist_cleanup" ON "public"."token_blacklist" USING "btree" ("expires_at", "blacklisted_at");


--
-- Name: idx_token_blacklist_expires; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_token_blacklist_expires" ON "public"."token_blacklist" USING "btree" ("expires_at");


--
-- Name: idx_token_blacklist_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_token_blacklist_hash" ON "public"."token_blacklist" USING "btree" ("token_hash");


--
-- Name: idx_token_blacklist_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_token_blacklist_user" ON "public"."token_blacklist" USING "btree" ("user_id");


--
-- Name: idx_user_achievements_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_user_achievements_type" ON "public"."user_achievements" USING "btree" ("achievement_type");


--
-- Name: idx_user_achievements_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_user_achievements_user_id" ON "public"."user_achievements" USING "btree" ("user_id");


--
-- Name: idx_user_goals_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_user_goals_status" ON "public"."user_goals" USING "btree" ("status");


--
-- Name: idx_user_goals_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_user_goals_type" ON "public"."user_goals" USING "btree" ("goal_type");


--
-- Name: idx_user_goals_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_user_goals_user_id" ON "public"."user_goals" USING "btree" ("user_id");


--
-- Name: idx_user_goals_user_type_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_user_goals_user_type_status" ON "public"."user_goals" USING "btree" ("user_id", "goal_type", "status");


--
-- Name: idx_weekly_goals_completed; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_weekly_goals_completed" ON "public"."weekly_goals" USING "btree" ("user_id", "completed", "week_start" DESC);


--
-- Name: idx_weekly_goals_fitcircle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_weekly_goals_fitcircle" ON "public"."weekly_goals" USING "btree" ("fitcircle_id", "week_start" DESC);


--
-- Name: idx_weekly_goals_user_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_weekly_goals_user_week" ON "public"."weekly_goals" USING "btree" ("user_id", "week_start" DESC);


--
-- Name: challenge_with_participants _RETURN; Type: RULE; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW "public"."challenge_with_participants" WITH ("security_invoker"='true') AS
 SELECT "c"."id",
    "c"."creator_id",
    "c"."name",
    "c"."description",
    "c"."type",
    "c"."status",
    "c"."visibility",
    "c"."rules",
    "c"."scoring_system",
    "c"."start_date",
    "c"."end_date",
    "c"."registration_deadline",
    "c"."entry_fee",
    "c"."prize_pool",
    "c"."prize_distribution",
    "c"."min_participants",
    "c"."max_participants",
    "c"."min_team_size",
    "c"."max_team_size",
    "c"."allow_late_join",
    "c"."late_join_penalty",
    "c"."cover_image_url",
    "c"."badge_image_url",
    "c"."tags",
    "c"."location",
    "c"."location_name",
    "c"."is_featured",
    "c"."sponsor_info",
    "c"."custom_fields",
    "c"."participant_count",
    "c"."team_count",
    "c"."total_check_ins",
    "c"."avg_progress",
    "c"."completion_rate",
    "c"."engagement_score",
    "c"."metadata",
    "c"."created_at",
    "c"."updated_at",
    "c"."invite_code",
    "count"(DISTINCT "cp"."user_id") FILTER (WHERE ("cp"."status" = 'active'::"text")) AS "active_participants",
    "count"(DISTINCT "ci"."id") FILTER (WHERE ("ci"."status" = 'pending'::"text")) AS "pending_invitations"
   FROM (("public"."fitcircles" "c"
     LEFT JOIN "public"."fitcircle_members" "cp" ON (("c"."id" = "cp"."fitcircle_id")))
     LEFT JOIN "public"."challenge_invitations" "ci" ON (("c"."id" = "ci"."challenge_id")))
  GROUP BY "c"."id";


--
-- Name: circle_streak_tracking circle_streak_tracking_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "circle_streak_tracking_updated_at" BEFORE UPDATE ON "public"."circle_streak_tracking" FOR EACH ROW EXECUTE FUNCTION "public"."update_circle_streak_tracking_updated_at"();


--
-- Name: daily_tracking daily_tracking_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "daily_tracking_updated_at" BEFORE UPDATE ON "public"."daily_tracking" FOR EACH ROW EXECUTE FUNCTION "public"."update_daily_tracking_updated_at"();


--
-- Name: engagement_streaks engagement_streaks_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "engagement_streaks_updated_at" BEFORE UPDATE ON "public"."engagement_streaks" FOR EACH ROW EXECUTE FUNCTION "public"."update_engagement_streaks_updated_at"();


--
-- Name: metric_streaks metric_streaks_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "metric_streaks_updated_at" BEFORE UPDATE ON "public"."metric_streaks" FOR EACH ROW EXECUTE FUNCTION "public"."update_metric_streaks_updated_at"();


--
-- Name: onboarding_progress set_onboarding_progress_timestamp; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "set_onboarding_progress_timestamp" BEFORE UPDATE ON "public"."onboarding_progress" FOR EACH ROW EXECUTE FUNCTION "public"."update_onboarding_progress_timestamp"();


--
-- Name: user_goals set_user_goals_timestamp; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "set_user_goals_timestamp" BEFORE UPDATE ON "public"."user_goals" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_goals_timestamp"();


--
-- Name: streak_recoveries streak_recoveries_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "streak_recoveries_updated_at" BEFORE UPDATE ON "public"."streak_recoveries" FOR EACH ROW EXECUTE FUNCTION "public"."update_streak_recoveries_timestamp"();


--
-- Name: streak_shields streak_shields_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "streak_shields_updated_at" BEFORE UPDATE ON "public"."streak_shields" FOR EACH ROW EXECUTE FUNCTION "public"."update_streak_shields_timestamp"();


--
-- Name: body_composition_logs trg_body_composition_logs_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_body_composition_logs_updated_at" BEFORE UPDATE ON "public"."body_composition_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: circle_chat_state trg_circle_chat_state_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_circle_chat_state_updated_at" BEFORE UPDATE ON "public"."circle_chat_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: circle_food_privacy trg_circle_food_privacy_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_circle_food_privacy_updated_at" BEFORE UPDATE ON "public"."circle_food_privacy" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: circle_messages trg_circle_messages_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_circle_messages_updated_at" BEFORE UPDATE ON "public"."circle_messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: circle_streaks trg_circle_streaks_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_circle_streaks_updated_at" BEFORE UPDATE ON "public"."circle_streaks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: dietary_preferences trg_dietary_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_dietary_preferences_updated_at" BEFORE UPDATE ON "public"."dietary_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: feature_gates trg_feature_gates_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_feature_gates_updated_at" BEFORE UPDATE ON "public"."feature_gates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: foods trg_foods_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_foods_updated_at" BEFORE UPDATE ON "public"."foods" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: group_meal_tags trg_group_meal_tags_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_group_meal_tags_updated_at" BEFORE UPDATE ON "public"."group_meal_tags" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: group_meals trg_group_meals_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_group_meals_updated_at" BEFORE UPDATE ON "public"."group_meals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: health_nutrition_sync trg_health_nutrition_sync_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_health_nutrition_sync_updated_at" BEFORE UPDATE ON "public"."health_nutrition_sync" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: beverage_log_images update_beverage_log_images_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_beverage_log_images_updated_at" BEFORE UPDATE ON "public"."beverage_log_images" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: beverage_logs update_beverage_logs_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_beverage_logs_updated_at" BEFORE UPDATE ON "public"."beverage_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: fitcircles update_challenges_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_challenges_updated_at" BEFORE UPDATE ON "public"."fitcircles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: daily_goals update_daily_goals_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_daily_goals_updated_at" BEFORE UPDATE ON "public"."daily_goals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: exercise_logs update_exercise_logs_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_exercise_logs_updated_at" BEFORE UPDATE ON "public"."exercise_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: feature_flags update_feature_flags_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_feature_flags_updated_at" BEFORE UPDATE ON "public"."feature_flags" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: food_log_entries update_food_log_entries_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_food_log_entries_updated_at" BEFORE UPDATE ON "public"."food_log_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: food_log_images update_food_log_images_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_food_log_images_updated_at" BEFORE UPDATE ON "public"."food_log_images" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: food_log_shares update_food_log_shares_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_food_log_shares_updated_at" BEFORE UPDATE ON "public"."food_log_shares" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: nutrition_challenge_config update_nutrition_challenge_config_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_nutrition_challenge_config_updated_at" BEFORE UPDATE ON "public"."nutrition_challenge_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: fitcircle_members update_participants_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_participants_updated_at" BEFORE UPDATE ON "public"."fitcircle_members" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: plate_scores update_plate_scores_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_plate_scores_updated_at" BEFORE UPDATE ON "public"."plate_scores" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: achievements achievements_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."achievements"
    ADD CONSTRAINT "achievements_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: achievements achievements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."achievements"
    ADD CONSTRAINT "achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: beverage_log_images beverage_log_images_beverage_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."beverage_log_images"
    ADD CONSTRAINT "beverage_log_images_beverage_log_id_fkey" FOREIGN KEY ("beverage_log_id") REFERENCES "public"."beverage_logs"("id") ON DELETE CASCADE;


--
-- Name: beverage_log_images beverage_log_images_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."beverage_log_images"
    ADD CONSTRAINT "beverage_log_images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: beverage_logs beverage_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."beverage_logs"
    ADD CONSTRAINT "beverage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: body_comp_parse_log body_comp_parse_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."body_comp_parse_log"
    ADD CONSTRAINT "body_comp_parse_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: body_composition_logs body_composition_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."body_composition_logs"
    ADD CONSTRAINT "body_composition_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: challenge_invitations challenge_invitations_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invitations"
    ADD CONSTRAINT "challenge_invitations_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: challenge_invitations challenge_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invitations"
    ADD CONSTRAINT "challenge_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: challenge_invitations challenge_invitations_invited_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invitations"
    ADD CONSTRAINT "challenge_invitations_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: fitcircle_members challenge_participants_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_members"
    ADD CONSTRAINT "challenge_participants_challenge_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: fitcircle_members challenge_participants_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_members"
    ADD CONSTRAINT "challenge_participants_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id");


--
-- Name: fitcircle_members challenge_participants_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_members"
    ADD CONSTRAINT "challenge_participants_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;


--
-- Name: fitcircle_members challenge_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_members"
    ADD CONSTRAINT "challenge_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: fitcircles challenges_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircles"
    ADD CONSTRAINT "challenges_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: check_ins check_ins_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."check_ins"
    ADD CONSTRAINT "check_ins_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: check_ins check_ins_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."check_ins"
    ADD CONSTRAINT "check_ins_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."fitcircle_members"("id") ON DELETE CASCADE;


--
-- Name: check_ins check_ins_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."check_ins"
    ADD CONSTRAINT "check_ins_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;


--
-- Name: check_ins check_ins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."check_ins"
    ADD CONSTRAINT "check_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: check_ins check_ins_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."check_ins"
    ADD CONSTRAINT "check_ins_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("id");


--
-- Name: challenge_invites circle_challenge_invites_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invites"
    ADD CONSTRAINT "circle_challenge_invites_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE;


--
-- Name: challenge_invites circle_challenge_invites_invitee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invites"
    ADD CONSTRAINT "circle_challenge_invites_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "public"."profiles"("id");


--
-- Name: challenge_invites circle_challenge_invites_inviter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_invites"
    ADD CONSTRAINT "circle_challenge_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "public"."profiles"("id");


--
-- Name: challenge_logs circle_challenge_logs_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_logs"
    ADD CONSTRAINT "circle_challenge_logs_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE;


--
-- Name: challenge_logs circle_challenge_logs_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_logs"
    ADD CONSTRAINT "circle_challenge_logs_circle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id");


--
-- Name: challenge_logs circle_challenge_logs_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_logs"
    ADD CONSTRAINT "circle_challenge_logs_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."challenge_participants"("id") ON DELETE CASCADE;


--
-- Name: challenge_logs circle_challenge_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_logs"
    ADD CONSTRAINT "circle_challenge_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");


--
-- Name: challenge_participants circle_challenge_participants_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "circle_challenge_participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE;


--
-- Name: challenge_participants circle_challenge_participants_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "circle_challenge_participants_circle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id");


--
-- Name: challenge_participants circle_challenge_participants_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "circle_challenge_participants_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id");


--
-- Name: challenge_participants circle_challenge_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "circle_challenge_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: challenges circle_challenges_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "circle_challenges_circle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: challenges circle_challenges_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "circle_challenges_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id");


--
-- Name: challenges circle_challenges_winner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "circle_challenges_winner_user_id_fkey" FOREIGN KEY ("winner_user_id") REFERENCES "public"."profiles"("id");


--
-- Name: circle_chat_state circle_chat_state_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_chat_state"
    ADD CONSTRAINT "circle_chat_state_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: circle_chat_state circle_chat_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_chat_state"
    ADD CONSTRAINT "circle_chat_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_check_ins circle_check_ins_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_check_ins"
    ADD CONSTRAINT "circle_check_ins_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: circle_check_ins circle_check_ins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_check_ins"
    ADD CONSTRAINT "circle_check_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_daily_boosts circle_daily_boosts_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_daily_boosts"
    ADD CONSTRAINT "circle_daily_boosts_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: circle_encouragements circle_encouragements_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_encouragements"
    ADD CONSTRAINT "circle_encouragements_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: circle_encouragements circle_encouragements_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_encouragements"
    ADD CONSTRAINT "circle_encouragements_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_encouragements circle_encouragements_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_encouragements"
    ADD CONSTRAINT "circle_encouragements_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_food_privacy circle_food_privacy_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_food_privacy"
    ADD CONSTRAINT "circle_food_privacy_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: circle_food_privacy circle_food_privacy_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_food_privacy"
    ADD CONSTRAINT "circle_food_privacy_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_invites circle_invites_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_invites"
    ADD CONSTRAINT "circle_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "public"."profiles"("id");


--
-- Name: circle_invites circle_invites_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_invites"
    ADD CONSTRAINT "circle_invites_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: circle_invites circle_invites_inviter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_invites"
    ADD CONSTRAINT "circle_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_member_blocks circle_member_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_member_blocks"
    ADD CONSTRAINT "circle_member_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_member_blocks circle_member_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_member_blocks"
    ADD CONSTRAINT "circle_member_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_message_reactions circle_message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_message_reactions"
    ADD CONSTRAINT "circle_message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."circle_messages"("id") ON DELETE CASCADE;


--
-- Name: circle_message_reactions circle_message_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_message_reactions"
    ADD CONSTRAINT "circle_message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_message_reports circle_message_reports_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_message_reports"
    ADD CONSTRAINT "circle_message_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."circle_messages"("id") ON DELETE CASCADE;


--
-- Name: circle_message_reports circle_message_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_message_reports"
    ADD CONSTRAINT "circle_message_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_messages circle_messages_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_messages"
    ADD CONSTRAINT "circle_messages_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: circle_messages circle_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_messages"
    ADD CONSTRAINT "circle_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: circle_quest_progress circle_quest_progress_quest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_quest_progress"
    ADD CONSTRAINT "circle_quest_progress_quest_id_fkey" FOREIGN KEY ("quest_id") REFERENCES "public"."circle_quests"("id") ON DELETE CASCADE;


--
-- Name: circle_quest_progress circle_quest_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_quest_progress"
    ADD CONSTRAINT "circle_quest_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_quests circle_quests_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_quests"
    ADD CONSTRAINT "circle_quests_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id");


--
-- Name: circle_quests circle_quests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_quests"
    ADD CONSTRAINT "circle_quests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: circle_quests circle_quests_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_quests"
    ADD CONSTRAINT "circle_quests_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: circle_quests circle_quests_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_quests"
    ADD CONSTRAINT "circle_quests_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."challenge_templates"("id");


--
-- Name: circle_streak_saves circle_streak_saves_covered_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_streak_saves"
    ADD CONSTRAINT "circle_streak_saves_covered_user_id_fkey" FOREIGN KEY ("covered_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_streak_saves circle_streak_saves_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_streak_saves"
    ADD CONSTRAINT "circle_streak_saves_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: circle_streak_saves circle_streak_saves_saver_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_streak_saves"
    ADD CONSTRAINT "circle_streak_saves_saver_user_id_fkey" FOREIGN KEY ("saver_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: circle_streak_tracking circle_streak_tracking_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_streak_tracking"
    ADD CONSTRAINT "circle_streak_tracking_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: circle_streaks circle_streaks_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."circle_streaks"
    ADD CONSTRAINT "circle_streaks_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: comments comments_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id");


--
-- Name: comments comments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE CASCADE;


--
-- Name: comments comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: daily_challenge_participants daily_challenge_participants_daily_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_challenge_participants"
    ADD CONSTRAINT "daily_challenge_participants_daily_challenge_id_fkey" FOREIGN KEY ("daily_challenge_id") REFERENCES "public"."daily_challenges"("id") ON DELETE CASCADE;


--
-- Name: daily_challenge_participants daily_challenge_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_challenge_participants"
    ADD CONSTRAINT "daily_challenge_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: daily_challenges daily_challenges_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_challenges"
    ADD CONSTRAINT "daily_challenges_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."challenge_templates"("id");


--
-- Name: daily_goals daily_goals_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_goals"
    ADD CONSTRAINT "daily_goals_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: daily_goals daily_goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_goals"
    ADD CONSTRAINT "daily_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: daily_high_five_limits daily_high_five_limits_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_high_five_limits"
    ADD CONSTRAINT "daily_high_five_limits_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: daily_high_five_limits daily_high_five_limits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_high_five_limits"
    ADD CONSTRAINT "daily_high_five_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: daily_tracking daily_tracking_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_tracking"
    ADD CONSTRAINT "daily_tracking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: dietary_preferences dietary_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dietary_preferences"
    ADD CONSTRAINT "dietary_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: engagement_activities engagement_activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."engagement_activities"
    ADD CONSTRAINT "engagement_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: engagement_streaks engagement_streaks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."engagement_streaks"
    ADD CONSTRAINT "engagement_streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: exercise_logs exercise_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "exercise_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: fitcircle_data_submissions fitcircle_data_submissions_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_data_submissions"
    ADD CONSTRAINT "fitcircle_data_submissions_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: fitcircle_data_submissions fitcircle_data_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_data_submissions"
    ADD CONSTRAINT "fitcircle_data_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: fitcircle_leaderboard_entries fitcircle_leaderboard_entries_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_leaderboard_entries"
    ADD CONSTRAINT "fitcircle_leaderboard_entries_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: fitcircle_leaderboard_entries fitcircle_leaderboard_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitcircle_leaderboard_entries"
    ADD CONSTRAINT "fitcircle_leaderboard_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: fitzy_message_log fitzy_message_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."fitzy_message_log"
    ADD CONSTRAINT "fitzy_message_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: food_log_audit food_log_audit_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_audit"
    ADD CONSTRAINT "food_log_audit_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: food_log_audit food_log_audit_food_log_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_audit"
    ADD CONSTRAINT "food_log_audit_food_log_entry_id_fkey" FOREIGN KEY ("food_log_entry_id") REFERENCES "public"."food_log_entries"("id") ON DELETE SET NULL;


--
-- Name: food_log_audit food_log_audit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_audit"
    ADD CONSTRAINT "food_log_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: food_log_entries food_log_entries_food_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_entries"
    ADD CONSTRAINT "food_log_entries_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE SET NULL NOT VALID;


--
-- Name: food_log_entries food_log_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_entries"
    ADD CONSTRAINT "food_log_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: food_log_images food_log_images_food_log_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_images"
    ADD CONSTRAINT "food_log_images_food_log_entry_id_fkey" FOREIGN KEY ("food_log_entry_id") REFERENCES "public"."food_log_entries"("id") ON DELETE CASCADE;


--
-- Name: food_log_images food_log_images_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_images"
    ADD CONSTRAINT "food_log_images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: food_log_shares food_log_shares_food_log_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_shares"
    ADD CONSTRAINT "food_log_shares_food_log_entry_id_fkey" FOREIGN KEY ("food_log_entry_id") REFERENCES "public"."food_log_entries"("id") ON DELETE CASCADE;


--
-- Name: food_log_shares food_log_shares_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_shares"
    ADD CONSTRAINT "food_log_shares_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: food_log_shares food_log_shares_shared_with_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_shares"
    ADD CONSTRAINT "food_log_shares_shared_with_circle_id_fkey" FOREIGN KEY ("shared_with_circle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: food_log_shares food_log_shares_shared_with_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."food_log_shares"
    ADD CONSTRAINT "food_log_shares_shared_with_user_id_fkey" FOREIGN KEY ("shared_with_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: foods foods_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."foods"
    ADD CONSTRAINT "foods_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: goal_completion_history goal_completion_history_daily_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."goal_completion_history"
    ADD CONSTRAINT "goal_completion_history_daily_goal_id_fkey" FOREIGN KEY ("daily_goal_id") REFERENCES "public"."daily_goals"("id") ON DELETE CASCADE;


--
-- Name: goal_completion_history goal_completion_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."goal_completion_history"
    ADD CONSTRAINT "goal_completion_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: group_meal_tags group_meal_tags_accepted_food_log_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."group_meal_tags"
    ADD CONSTRAINT "group_meal_tags_accepted_food_log_entry_id_fkey" FOREIGN KEY ("accepted_food_log_entry_id") REFERENCES "public"."food_log_entries"("id") ON DELETE SET NULL;


--
-- Name: group_meal_tags group_meal_tags_group_meal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."group_meal_tags"
    ADD CONSTRAINT "group_meal_tags_group_meal_id_fkey" FOREIGN KEY ("group_meal_id") REFERENCES "public"."group_meals"("id") ON DELETE CASCADE;


--
-- Name: group_meal_tags group_meal_tags_tagged_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."group_meal_tags"
    ADD CONSTRAINT "group_meal_tags_tagged_user_id_fkey" FOREIGN KEY ("tagged_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: group_meals group_meals_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."group_meals"
    ADD CONSTRAINT "group_meals_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: group_meals group_meals_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."group_meals"
    ADD CONSTRAINT "group_meals_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: health_nutrition_sync health_nutrition_sync_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."health_nutrition_sync"
    ADD CONSTRAINT "health_nutrition_sync_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: leaderboard leaderboard_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."leaderboard"
    ADD CONSTRAINT "leaderboard_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: log_reactions log_reactions_food_log_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."log_reactions"
    ADD CONSTRAINT "log_reactions_food_log_entry_id_fkey" FOREIGN KEY ("food_log_entry_id") REFERENCES "public"."food_log_entries"("id") ON DELETE CASCADE;


--
-- Name: log_reactions log_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."log_reactions"
    ADD CONSTRAINT "log_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: metric_streaks metric_streaks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."metric_streaks"
    ADD CONSTRAINT "metric_streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: notification_log notification_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: notifications notifications_related_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_related_challenge_id_fkey" FOREIGN KEY ("related_challenge_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: notifications notifications_related_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_related_team_id_fkey" FOREIGN KEY ("related_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;


--
-- Name: notifications notifications_related_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_related_user_id_fkey" FOREIGN KEY ("related_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: notifications notifications_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id");


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: nutrition_challenge_config nutrition_challenge_config_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."nutrition_challenge_config"
    ADD CONSTRAINT "nutrition_challenge_config_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: nutrition_parse_log nutrition_parse_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."nutrition_parse_log"
    ADD CONSTRAINT "nutrition_parse_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: onboarding_progress onboarding_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."onboarding_progress"
    ADD CONSTRAINT "onboarding_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: onboarding_responses onboarding_responses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."onboarding_responses"
    ADD CONSTRAINT "onboarding_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: payments payments_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."fitcircles"("id") ON DELETE SET NULL;


--
-- Name: payments payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: plate_scores plate_scores_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."plate_scores"
    ADD CONSTRAINT "plate_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: progress_entries progress_entries_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."progress_entries"
    ADD CONSTRAINT "progress_entries_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: progress_entries progress_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."progress_entries"
    ADD CONSTRAINT "progress_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: push_tokens push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: reactions reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."reactions"
    ADD CONSTRAINT "reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: share_cards share_cards_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."share_cards"
    ADD CONSTRAINT "share_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: streak_claims streak_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."streak_claims"
    ADD CONSTRAINT "streak_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: streak_recoveries streak_recoveries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."streak_recoveries"
    ADD CONSTRAINT "streak_recoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: streak_shields streak_shields_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."streak_shields"
    ADD CONSTRAINT "streak_shields_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: subscription_events subscription_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."subscription_events"
    ADD CONSTRAINT "subscription_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: team_members team_members_removed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "public"."profiles"("id");


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: teams teams_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."fitcircles"("id") ON DELETE CASCADE;


--
-- Name: token_blacklist token_blacklist_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."token_blacklist"
    ADD CONSTRAINT "token_blacklist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: user_achievements user_achievements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_achievements"
    ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: user_goals user_goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_goals"
    ADD CONSTRAINT "user_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: weekly_goals weekly_goals_fitcircle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."weekly_goals"
    ADD CONSTRAINT "weekly_goals_fitcircle_id_fkey" FOREIGN KEY ("fitcircle_id") REFERENCES "public"."fitcircles"("id") ON DELETE SET NULL;


--
-- Name: weekly_goals weekly_goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."weekly_goals"
    ADD CONSTRAINT "weekly_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: leaderboard Anyone can view leaderboard; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can view leaderboard" ON "public"."leaderboard" FOR SELECT USING (true);


--
-- Name: teams Anyone can view teams in public challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can view teams in public challenges" ON "public"."teams" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircles" "c"
  WHERE (("c"."id" = "teams"."challenge_id") AND (("c"."visibility" = 'public'::"public"."challenge_visibility") OR ("c"."creator_id" = "auth"."uid"()))))));


--
-- Name: challenge_templates Authenticated users can read templates; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated users can read templates" ON "public"."challenge_templates" FOR SELECT USING (("auth"."uid"() IS NOT NULL));


--
-- Name: daily_tracking Authenticated users can select daily_tracking; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated users can select daily_tracking" ON "public"."daily_tracking" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: daily_challenges Authenticated users can view daily challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated users can view daily challenges" ON "public"."daily_challenges" FOR SELECT TO "authenticated" USING (true);


--
-- Name: daily_challenge_participants Authenticated users can view participants; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated users can view participants" ON "public"."daily_challenge_participants" FOR SELECT TO "authenticated" USING (true);


--
-- Name: challenge_invitations Challenge creators can send invitations; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Challenge creators can send invitations" ON "public"."challenge_invitations" FOR INSERT TO "authenticated" WITH CHECK ((("invited_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."fitcircles" "c"
  WHERE (("c"."id" = "challenge_invitations"."challenge_id") AND (("c"."creator_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."fitcircle_members" "cp"
          WHERE (("cp"."fitcircle_id" = "c"."id") AND ("cp"."user_id" = "auth"."uid"()) AND ("cp"."status" = 'active'::"text"))))))))));


--
-- Name: progress_entries Challenge creators can view all progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Challenge creators can view all progress" ON "public"."progress_entries" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircles" "c"
  WHERE (("c"."id" = "progress_entries"."challenge_id") AND ("c"."creator_id" = "auth"."uid"())))));


--
-- Name: circle_quests Circle members can create quests; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Circle members can create quests" ON "public"."circle_quests" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members"
  WHERE (("fitcircle_members"."fitcircle_id" = "circle_quests"."fitcircle_id") AND ("fitcircle_members"."user_id" = "auth"."uid"()) AND ("fitcircle_members"."status" = 'active'::"text")))));


--
-- Name: circle_quest_progress Circle members can read quest progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Circle members can read quest progress" ON "public"."circle_quest_progress" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."circle_quests"
     JOIN "public"."fitcircle_members" ON (("fitcircle_members"."fitcircle_id" = "circle_quests"."fitcircle_id")))
  WHERE (("circle_quests"."id" = "circle_quest_progress"."quest_id") AND ("fitcircle_members"."user_id" = "auth"."uid"()) AND ("fitcircle_members"."status" = 'active'::"text")))));


--
-- Name: circle_quests Circle members can read quests; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Circle members can read quests" ON "public"."circle_quests" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members"
  WHERE (("fitcircle_members"."fitcircle_id" = "circle_quests"."fitcircle_id") AND ("fitcircle_members"."user_id" = "auth"."uid"()) AND ("fitcircle_members"."status" = 'active'::"text")))));


--
-- Name: circle_daily_boosts Circle members can view boosts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Circle members can view boosts" ON "public"."circle_daily_boosts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members"
  WHERE (("fitcircle_members"."fitcircle_id" = "circle_daily_boosts"."fitcircle_id") AND ("fitcircle_members"."user_id" = "auth"."uid"()) AND ("fitcircle_members"."status" = 'active'::"text")))));


--
-- Name: circle_streak_tracking Circle members can view circle streak; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Circle members can view circle streak" ON "public"."circle_streak_tracking" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members"
  WHERE (("fitcircle_members"."fitcircle_id" = "circle_streak_tracking"."circle_id") AND ("fitcircle_members"."user_id" = "auth"."uid"()) AND ("fitcircle_members"."status" = 'active'::"text")))));


--
-- Name: fitcircle_leaderboard_entries Circle members can view leaderboard entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Circle members can view leaderboard entries" ON "public"."fitcircle_leaderboard_entries" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members"
  WHERE (("fitcircle_members"."fitcircle_id" = "fitcircle_leaderboard_entries"."fitcircle_id") AND ("fitcircle_members"."user_id" = "auth"."uid"()) AND ("fitcircle_members"."status" = 'active'::"text")))));


--
-- Name: fitcircle_data_submissions Circle members can view submissions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Circle members can view submissions" ON "public"."fitcircle_data_submissions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members"
  WHERE (("fitcircle_members"."fitcircle_id" = "fitcircle_data_submissions"."fitcircle_id") AND ("fitcircle_members"."user_id" = "auth"."uid"()) AND ("fitcircle_members"."status" = 'active'::"text")))));


--
-- Name: feature_flags Feature flags viewable by authenticated users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Feature flags viewable by authenticated users" ON "public"."feature_flags" FOR SELECT USING (true);


--
-- Name: exercise_logs Service role full access on exercise_logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role full access on exercise_logs" ON "public"."exercise_logs" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: circle_daily_boosts Service role full access to boosts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role full access to boosts" ON "public"."circle_daily_boosts" USING (("auth"."role"() = 'service_role'::"text"));


--
-- Name: engagement_activities Service role has full access to engagement activities; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role has full access to engagement activities" ON "public"."engagement_activities" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: engagement_streaks Service role has full access to engagement streaks; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role has full access to engagement streaks" ON "public"."engagement_streaks" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: metric_streaks Service role has full access to metric streaks; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role has full access to metric streaks" ON "public"."metric_streaks" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: teams Team captains can delete their teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Team captains can delete their teams" ON "public"."teams" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."team_id" = "teams"."id") AND ("tm"."user_id" = "auth"."uid"()) AND ("tm"."role" = 'captain'::"public"."team_role")))));


--
-- Name: teams Team captains can update their teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Team captains can update their teams" ON "public"."teams" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."team_id" = "teams"."id") AND ("tm"."user_id" = "auth"."uid"()) AND ("tm"."role" = 'captain'::"public"."team_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."team_id" = "teams"."id") AND ("tm"."user_id" = "auth"."uid"()) AND ("tm"."role" = 'captain'::"public"."team_role")))));


--
-- Name: teams Team members can create teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Team members can create teams" ON "public"."teams" FOR INSERT WITH CHECK (true);


--
-- Name: check_ins Users can create check-ins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create check-ins" ON "public"."check_ins" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: comments Users can create comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create comments" ON "public"."comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: beverage_logs Users can create own beverage logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create own beverage logs" ON "public"."beverage_logs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: food_log_entries Users can create own food log entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create own food log entries" ON "public"."food_log_entries" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: reactions Users can create reactions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create reactions" ON "public"."reactions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: food_log_shares Users can create shares for own entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create shares for own entries" ON "public"."food_log_shares" FOR INSERT WITH CHECK ((("auth"."uid"() = "owner_id") AND (EXISTS ( SELECT 1
   FROM "public"."food_log_entries"
  WHERE (("food_log_entries"."id" = "food_log_shares"."food_log_entry_id") AND ("food_log_entries"."user_id" = "auth"."uid"()) AND ("food_log_entries"."deleted_at" IS NULL))))));


--
-- Name: circle_check_ins Users can create their own check-ins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create their own check-ins" ON "public"."circle_check_ins" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: daily_high_five_limits Users can create their own limit records; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create their own limit records" ON "public"."daily_high_five_limits" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: beverage_log_images Users can delete own beverage log images; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own beverage log images" ON "public"."beverage_log_images" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: daily_goals Users can delete own daily goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own daily goals" ON "public"."daily_goals" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: exercise_logs Users can delete own exercises; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own exercises" ON "public"."exercise_logs" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));


--
-- Name: user_goals Users can delete own goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own goals" ON "public"."user_goals" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: food_log_images Users can delete own images; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own images" ON "public"."food_log_images" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: onboarding_responses Users can delete own onboarding responses; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own onboarding responses" ON "public"."onboarding_responses" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: progress_entries Users can delete own progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own progress" ON "public"."progress_entries" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));


--
-- Name: push_tokens Users can delete own push tokens; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own push tokens" ON "public"."push_tokens" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: share_cards Users can delete own share cards; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own share cards" ON "public"."share_cards" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: food_log_shares Users can delete own shares; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own shares" ON "public"."food_log_shares" FOR DELETE USING (("auth"."uid"() = "owner_id"));


--
-- Name: daily_tracking Users can delete own tracking; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own tracking" ON "public"."daily_tracking" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: weekly_goals Users can delete own weekly goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own weekly goals" ON "public"."weekly_goals" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: comments Users can delete their own comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete their own comments" ON "public"."comments" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: notifications Users can delete their own notifications; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete their own notifications" ON "public"."notifications" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: reactions Users can delete their own reactions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete their own reactions" ON "public"."reactions" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: check_ins Users can delete their own recent check-ins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete their own recent check-ins" ON "public"."check_ins" FOR DELETE USING ((("auth"."uid"() = "user_id") AND ("created_at" > ("now"() - '01:00:00'::interval))));


--
-- Name: daily_goals Users can insert own daily goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own daily goals" ON "public"."daily_goals" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: engagement_activities Users can insert own engagement activities; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own engagement activities" ON "public"."engagement_activities" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: engagement_streaks Users can insert own engagement streak; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own engagement streak" ON "public"."engagement_streaks" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: exercise_logs Users can insert own exercises; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own exercises" ON "public"."exercise_logs" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: goal_completion_history Users can insert own goal completion history; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own goal completion history" ON "public"."goal_completion_history" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: user_goals Users can insert own goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own goals" ON "public"."user_goals" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: metric_streaks Users can insert own metric streaks; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own metric streaks" ON "public"."metric_streaks" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: notification_preferences Users can insert own notification preferences; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own notification preferences" ON "public"."notification_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: onboarding_progress Users can insert own onboarding progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own onboarding progress" ON "public"."onboarding_progress" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: onboarding_responses Users can insert own onboarding responses; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own onboarding responses" ON "public"."onboarding_responses" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));


--
-- Name: progress_entries Users can insert own progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own progress" ON "public"."progress_entries" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: push_tokens Users can insert own push tokens; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own push tokens" ON "public"."push_tokens" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: circle_quest_progress Users can insert own quest progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own quest progress" ON "public"."circle_quest_progress" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: share_cards Users can insert own share cards; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own share cards" ON "public"."share_cards" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: streak_claims Users can insert own streak claims; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own streak claims" ON "public"."streak_claims" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: streak_recoveries Users can insert own streak recoveries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own streak recoveries" ON "public"."streak_recoveries" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: streak_shields Users can insert own streak shields; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own streak shields" ON "public"."streak_shields" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: fitcircle_data_submissions Users can insert own submissions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own submissions" ON "public"."fitcircle_data_submissions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: daily_tracking Users can insert own tracking; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own tracking" ON "public"."daily_tracking" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: weekly_goals Users can insert own weekly goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own weekly goals" ON "public"."weekly_goals" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: daily_challenge_participants Users can join daily challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can join daily challenges" ON "public"."daily_challenge_participants" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: team_members Users can join teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can join teams" ON "public"."team_members" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: daily_challenge_participants Users can leave daily challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can leave daily challenges" ON "public"."daily_challenge_participants" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: team_members Users can leave teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can leave teams" ON "public"."team_members" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK ((("auth"."uid"() = "user_id") AND ("is_active" = false)));


--
-- Name: team_members Users can leave teams or captains can remove members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can leave teams or captains can remove members" ON "public"."team_members" FOR DELETE USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."team_id" = "team_members"."team_id") AND ("tm"."user_id" = "auth"."uid"()) AND ("tm"."role" = 'captain'::"public"."team_role"))))));


--
-- Name: beverage_logs Users can soft delete own beverage logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can soft delete own beverage logs" ON "public"."beverage_logs" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK ((("auth"."uid"() = "user_id") AND ("deleted_at" IS NOT NULL)));


--
-- Name: food_log_entries Users can soft delete own food log entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can soft delete own food log entries" ON "public"."food_log_entries" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK ((("auth"."uid"() = "user_id") AND ("deleted_at" IS NOT NULL)));


--
-- Name: comments Users can soft delete their own comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can soft delete their own comments" ON "public"."comments" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK ((("auth"."uid"() = "user_id") AND ("is_deleted" = true)));


--
-- Name: challenge_invitations Users can update invitation status; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update invitation status" ON "public"."challenge_invitations" FOR UPDATE TO "authenticated" USING ((("invited_user_id" = "auth"."uid"()) OR ("invited_by" = "auth"."uid"()))) WITH CHECK ((("invited_user_id" = "auth"."uid"()) OR ("invited_by" = "auth"."uid"())));


--
-- Name: beverage_logs Users can update own beverage logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own beverage logs" ON "public"."beverage_logs" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND ("deleted_at" IS NULL))) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: daily_goals Users can update own daily goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own daily goals" ON "public"."daily_goals" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: engagement_streaks Users can update own engagement streak; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own engagement streak" ON "public"."engagement_streaks" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: exercise_logs Users can update own exercises; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own exercises" ON "public"."exercise_logs" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: food_log_entries Users can update own food log entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own food log entries" ON "public"."food_log_entries" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND ("deleted_at" IS NULL))) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: goal_completion_history Users can update own goal completion history; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own goal completion history" ON "public"."goal_completion_history" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: user_goals Users can update own goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own goals" ON "public"."user_goals" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: metric_streaks Users can update own metric streaks; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own metric streaks" ON "public"."metric_streaks" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: notification_preferences Users can update own notification preferences; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own notification preferences" ON "public"."notification_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: onboarding_progress Users can update own onboarding progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own onboarding progress" ON "public"."onboarding_progress" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: onboarding_responses Users can update own onboarding responses; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own onboarding responses" ON "public"."onboarding_responses" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));


--
-- Name: daily_challenge_participants Users can update own progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own progress" ON "public"."daily_challenge_participants" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: progress_entries Users can update own progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own progress" ON "public"."progress_entries" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: push_tokens Users can update own push tokens; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own push tokens" ON "public"."push_tokens" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: circle_quest_progress Users can update own quest progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own quest progress" ON "public"."circle_quest_progress" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: share_cards Users can update own share cards; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own share cards" ON "public"."share_cards" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: streak_claims Users can update own streak claims; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own streak claims" ON "public"."streak_claims" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: streak_recoveries Users can update own streak recoveries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own streak recoveries" ON "public"."streak_recoveries" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: streak_shields Users can update own streak shields; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own streak shields" ON "public"."streak_shields" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: daily_tracking Users can update own tracking; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own tracking" ON "public"."daily_tracking" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: weekly_goals Users can update own weekly goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own weekly goals" ON "public"."weekly_goals" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: achievements Users can update sharing status of their achievements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update sharing status of their achievements" ON "public"."achievements" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK ((("auth"."uid"() = "user_id") AND ("shared" = ANY (ARRAY[true, false]))));


--
-- Name: check_ins Users can update their check-ins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their check-ins" ON "public"."check_ins" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: check_ins Users can update their own check-ins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own check-ins" ON "public"."check_ins" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND ("created_at" > ("now"() - '24:00:00'::interval)))) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: circle_check_ins Users can update their own check-ins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own check-ins" ON "public"."circle_check_ins" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND ("check_in_date" = CURRENT_DATE))) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: comments Users can update their own comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own comments" ON "public"."comments" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: circle_invites Users can update their own invites; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own invites" ON "public"."circle_invites" FOR UPDATE USING ((("auth"."uid"() = "inviter_id") OR ("email" = ("auth"."jwt"() ->> 'email'::"text")))) WITH CHECK ((("auth"."uid"() = "inviter_id") OR ("email" = ("auth"."jwt"() ->> 'email'::"text"))));


--
-- Name: daily_high_five_limits Users can update their own limits; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own limits" ON "public"."daily_high_five_limits" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: team_members Users can update their own membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own membership" ON "public"."team_members" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: notifications Users can update their own notifications; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own notifications" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: beverage_log_images Users can upload images to own beverage logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can upload images to own beverage logs" ON "public"."beverage_log_images" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."beverage_logs"
  WHERE (("beverage_logs"."id" = "beverage_log_images"."beverage_log_id") AND ("beverage_logs"."user_id" = "auth"."uid"()) AND ("beverage_logs"."deleted_at" IS NULL))))));


--
-- Name: food_log_images Users can upload images to own entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can upload images to own entries" ON "public"."food_log_images" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."food_log_entries"
  WHERE (("food_log_entries"."id" = "food_log_images"."food_log_entry_id") AND ("food_log_entries"."user_id" = "auth"."uid"()) AND ("food_log_entries"."deleted_at" IS NULL))))));


--
-- Name: comments Users can view comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view comments" ON "public"."comments" FOR SELECT USING (true);


--
-- Name: challenge_invitations Users can view invitations for their challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view invitations for their challenges" ON "public"."challenge_invitations" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."fitcircles" "c"
  WHERE (("c"."id" = "challenge_invitations"."challenge_id") AND ("c"."creator_id" = "auth"."uid"())))) OR ("invited_user_id" = "auth"."uid"()) OR ("invited_by" = "auth"."uid"())));


--
-- Name: circle_invites Users can view invites for their circles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view invites for their circles" ON "public"."circle_invites" FOR SELECT USING ((("auth"."uid"() = "inviter_id") OR ("email" = ("auth"."jwt"() ->> 'email'::"text"))));


--
-- Name: user_achievements Users can view others' achievements in same circles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view others' achievements in same circles" ON "public"."user_achievements" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "cp1"
  WHERE (("cp1"."user_id" = "user_achievements"."user_id") AND ("cp1"."status" = 'active'::"text") AND (EXISTS ( SELECT 1
           FROM "public"."fitcircle_members" "cp2"
          WHERE (("cp2"."fitcircle_id" = "cp1"."fitcircle_id") AND ("cp2"."user_id" = "auth"."uid"()) AND ("cp2"."status" = 'active'::"text"))))))));


--
-- Name: user_achievements Users can view own achievements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own achievements" ON "public"."user_achievements" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: food_log_audit Users can view own audit logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own audit logs" ON "public"."food_log_audit" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: beverage_log_images Users can view own beverage log images; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own beverage log images" ON "public"."beverage_log_images" FOR SELECT USING ((("auth"."uid"() = "user_id") AND ("deleted_at" IS NULL)));


--
-- Name: beverage_logs Users can view own beverage logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own beverage logs" ON "public"."beverage_logs" FOR SELECT USING ((("auth"."uid"() = "user_id") AND ("deleted_at" IS NULL)));


--
-- Name: token_blacklist Users can view own blacklisted tokens; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own blacklisted tokens" ON "public"."token_blacklist" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: daily_goals Users can view own daily goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own daily goals" ON "public"."daily_goals" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: engagement_activities Users can view own engagement activities; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own engagement activities" ON "public"."engagement_activities" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));


--
-- Name: engagement_streaks Users can view own engagement streak; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own engagement streak" ON "public"."engagement_streaks" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));


--
-- Name: exercise_logs Users can view own exercises; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own exercises" ON "public"."exercise_logs" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));


--
-- Name: food_log_entries Users can view own food log entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own food log entries" ON "public"."food_log_entries" FOR SELECT USING ((("auth"."uid"() = "user_id") AND ("deleted_at" IS NULL)));


--
-- Name: food_log_images Users can view own food log images; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own food log images" ON "public"."food_log_images" FOR SELECT USING ((("auth"."uid"() = "user_id") AND ("deleted_at" IS NULL)));


--
-- Name: goal_completion_history Users can view own goal completion history; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own goal completion history" ON "public"."goal_completion_history" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: user_goals Users can view own goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own goals" ON "public"."user_goals" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: metric_streaks Users can view own metric streaks; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own metric streaks" ON "public"."metric_streaks" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));


--
-- Name: notification_log Users can view own notification log; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own notification log" ON "public"."notification_log" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: notification_preferences Users can view own notification preferences; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own notification preferences" ON "public"."notification_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: onboarding_progress Users can view own onboarding progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own onboarding progress" ON "public"."onboarding_progress" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: onboarding_responses Users can view own onboarding responses; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own onboarding responses" ON "public"."onboarding_responses" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));


--
-- Name: progress_entries Users can view own progress; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own progress" ON "public"."progress_entries" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));


--
-- Name: push_tokens Users can view own push tokens; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own push tokens" ON "public"."push_tokens" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: share_cards Users can view own share cards; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own share cards" ON "public"."share_cards" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: streak_claims Users can view own streak claims; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own streak claims" ON "public"."streak_claims" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: streak_recoveries Users can view own streak recoveries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own streak recoveries" ON "public"."streak_recoveries" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: streak_shields Users can view own streak shields; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own streak shields" ON "public"."streak_shields" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: weekly_goals Users can view own weekly goals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own weekly goals" ON "public"."weekly_goals" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: progress_entries Users can view public progress in their challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view public progress in their challenges" ON "public"."progress_entries" FOR SELECT TO "authenticated" USING ((("is_public" = true) AND (EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "cp"
  WHERE (("cp"."fitcircle_id" = "progress_entries"."challenge_id") AND ("cp"."user_id" = "auth"."uid"()) AND ("cp"."status" = 'active'::"text"))))));


--
-- Name: reactions Users can view reactions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view reactions" ON "public"."reactions" FOR SELECT USING (true);


--
-- Name: food_log_entries Users can view shared food log entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view shared food log entries" ON "public"."food_log_entries" FOR SELECT USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."food_log_shares"
  WHERE (("food_log_shares"."food_log_entry_id" = "food_log_entries"."id") AND ("food_log_shares"."shared_with_user_id" = "auth"."uid"()) AND (("food_log_shares"."expires_at" IS NULL) OR ("food_log_shares"."expires_at" > "now"())))))));


--
-- Name: food_log_images Users can view shared food log images; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view shared food log images" ON "public"."food_log_images" FOR SELECT USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."food_log_entries" "fle"
  WHERE (("fle"."id" = "food_log_images"."food_log_entry_id") AND ("fle"."deleted_at" IS NULL) AND (EXISTS ( SELECT 1
           FROM "public"."food_log_shares"
          WHERE (("food_log_shares"."food_log_entry_id" = "fle"."id") AND ("food_log_shares"."shared_with_user_id" = "auth"."uid"()) AND (("food_log_shares"."expires_at" IS NULL) OR ("food_log_shares"."expires_at" > "now"()))))))))));


--
-- Name: food_log_shares Users can view shares targeting them; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view shares targeting them" ON "public"."food_log_shares" FOR SELECT USING (("auth"."uid"() = "shared_with_user_id"));


--
-- Name: food_log_shares Users can view shares they created; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view shares they created" ON "public"."food_log_shares" FOR SELECT USING (("auth"."uid"() = "owner_id"));


--
-- Name: team_members Users can view team members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view team members" ON "public"."team_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."team_id" = "team_members"."team_id") AND ("tm"."user_id" = "auth"."uid"()) AND ("tm"."role" = 'captain'::"public"."team_role"))))));


--
-- Name: achievements Users can view their own achievements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view their own achievements" ON "public"."achievements" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: check_ins Users can view their own check-ins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view their own check-ins" ON "public"."check_ins" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: circle_check_ins Users can view their own check-ins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view their own check-ins" ON "public"."circle_check_ins" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: daily_high_five_limits Users can view their own limits; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view their own limits" ON "public"."daily_high_five_limits" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: notifications Users can view their own notifications; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: payments Users can view their own payments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view their own payments" ON "public"."payments" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: achievements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."achievements" ENABLE ROW LEVEL SECURITY;

--
-- Name: beverage_log_images; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."beverage_log_images" ENABLE ROW LEVEL SECURITY;

--
-- Name: beverage_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."beverage_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: body_comp_parse_cache; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."body_comp_parse_cache" ENABLE ROW LEVEL SECURITY;

--
-- Name: body_comp_parse_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."body_comp_parse_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: body_composition_logs body_comp_self_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "body_comp_self_delete" ON "public"."body_composition_logs" FOR DELETE USING (("user_id" = "auth"."uid"()));


--
-- Name: body_composition_logs body_comp_self_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "body_comp_self_insert" ON "public"."body_composition_logs" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: body_composition_logs body_comp_self_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "body_comp_self_select" ON "public"."body_composition_logs" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: body_composition_logs body_comp_self_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "body_comp_self_update" ON "public"."body_composition_logs" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: body_composition_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."body_composition_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_invitations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."challenge_invitations" ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_invites; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."challenge_invites" ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_invites challenge_invites_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenge_invites_insert" ON "public"."challenge_invites" FOR INSERT WITH CHECK (("auth"."uid"() = "inviter_id"));


--
-- Name: challenge_invites challenge_invites_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenge_invites_select" ON "public"."challenge_invites" FOR SELECT USING ((("auth"."uid"() = "inviter_id") OR ("auth"."uid"() = "invitee_id")));


--
-- Name: challenge_invites challenge_invites_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenge_invites_update" ON "public"."challenge_invites" FOR UPDATE USING (("auth"."uid"() = "invitee_id"));


--
-- Name: challenge_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."challenge_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_logs challenge_logs_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenge_logs_delete" ON "public"."challenge_logs" FOR DELETE USING ((("auth"."uid"() = "user_id") AND ("log_date" = CURRENT_DATE)));


--
-- Name: challenge_logs challenge_logs_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenge_logs_insert" ON "public"."challenge_logs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: challenge_logs challenge_logs_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenge_logs_select" ON "public"."challenge_logs" FOR SELECT USING (("auth"."uid"() IN ( SELECT "challenge_participants"."user_id"
   FROM "public"."challenge_participants"
  WHERE (("challenge_participants"."challenge_id" = "challenge_logs"."challenge_id") AND ("challenge_participants"."status" = 'active'::"text")))));


--
-- Name: challenge_participants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."challenge_participants" ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_participants challenge_participants_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenge_participants_insert" ON "public"."challenge_participants" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: challenge_participants challenge_participants_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenge_participants_select" ON "public"."challenge_participants" FOR SELECT USING (("auth"."uid"() IN ( SELECT "fitcircle_members"."user_id"
   FROM "public"."fitcircle_members"
  WHERE (("fitcircle_members"."fitcircle_id" = "challenge_participants"."fitcircle_id") AND ("fitcircle_members"."status" = 'active'::"text")))));


--
-- Name: challenge_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."challenge_templates" ENABLE ROW LEVEL SECURITY;

--
-- Name: challenges; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."challenges" ENABLE ROW LEVEL SECURITY;

--
-- Name: challenges challenges_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenges_insert" ON "public"."challenges" FOR INSERT WITH CHECK (("auth"."uid"() = "creator_id"));


--
-- Name: challenges challenges_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenges_select" ON "public"."challenges" FOR SELECT USING (("auth"."uid"() IN ( SELECT "fitcircle_members"."user_id"
   FROM "public"."fitcircle_members"
  WHERE (("fitcircle_members"."fitcircle_id" = "challenges"."fitcircle_id") AND ("fitcircle_members"."status" = 'active'::"text")))));


--
-- Name: challenges challenges_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "challenges_update" ON "public"."challenges" FOR UPDATE USING (("auth"."uid"() = "creator_id"));


--
-- Name: check_ins; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."check_ins" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_chat_state; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_chat_state" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_chat_state circle_chat_state_self_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_chat_state_self_insert" ON "public"."circle_chat_state" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: circle_chat_state circle_chat_state_self_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_chat_state_self_select" ON "public"."circle_chat_state" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: circle_chat_state circle_chat_state_self_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_chat_state_self_update" ON "public"."circle_chat_state" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: circle_check_ins; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_check_ins" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_daily_boosts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_daily_boosts" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_encouragements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_encouragements" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_food_privacy; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_food_privacy" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_food_privacy circle_food_privacy_delete_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_food_privacy_delete_own" ON "public"."circle_food_privacy" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: circle_food_privacy circle_food_privacy_insert_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_food_privacy_insert_own" ON "public"."circle_food_privacy" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: circle_food_privacy circle_food_privacy_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_food_privacy_select_own" ON "public"."circle_food_privacy" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: circle_food_privacy circle_food_privacy_update_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_food_privacy_update_own" ON "public"."circle_food_privacy" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: circle_invites; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_invites" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_member_blocks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_member_blocks" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_member_blocks circle_member_blocks_self_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_member_blocks_self_delete" ON "public"."circle_member_blocks" FOR DELETE USING (("blocker_id" = "auth"."uid"()));


--
-- Name: circle_member_blocks circle_member_blocks_self_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_member_blocks_self_insert" ON "public"."circle_member_blocks" FOR INSERT WITH CHECK (("blocker_id" = "auth"."uid"()));


--
-- Name: circle_member_blocks circle_member_blocks_self_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_member_blocks_self_select" ON "public"."circle_member_blocks" FOR SELECT USING (("blocker_id" = "auth"."uid"()));


--
-- Name: circle_message_reactions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_message_reactions" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_message_reactions circle_message_reactions_member_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_message_reactions_member_insert" ON "public"."circle_message_reactions" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."circle_messages" "cm"
     JOIN "public"."fitcircle_members" "m" ON (("m"."fitcircle_id" = "cm"."fitcircle_id")))
  WHERE (("cm"."id" = "circle_message_reactions"."message_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text"))))));


--
-- Name: circle_message_reactions circle_message_reactions_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_message_reactions_member_select" ON "public"."circle_message_reactions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."circle_messages" "cm"
     JOIN "public"."fitcircle_members" "m" ON (("m"."fitcircle_id" = "cm"."fitcircle_id")))
  WHERE (("cm"."id" = "circle_message_reactions"."message_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text")))));


--
-- Name: circle_message_reactions circle_message_reactions_owner_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_message_reactions_owner_delete" ON "public"."circle_message_reactions" FOR DELETE USING (("user_id" = "auth"."uid"()));


--
-- Name: circle_message_reports; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_message_reports" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_message_reports circle_message_reports_reporter_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_message_reports_reporter_insert" ON "public"."circle_message_reports" FOR INSERT WITH CHECK (("reporter_id" = "auth"."uid"()));


--
-- Name: circle_message_reports circle_message_reports_reporter_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_message_reports_reporter_select" ON "public"."circle_message_reports" FOR SELECT USING (("reporter_id" = "auth"."uid"()));


--
-- Name: circle_messages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_messages" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_messages circle_messages_member_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_messages_member_insert" ON "public"."circle_messages" FOR INSERT WITH CHECK ((("sender_id" = "auth"."uid"()) AND ("kind" = ANY (ARRAY['user_text'::"text", 'user_photo'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "m"
  WHERE (("m"."fitcircle_id" = "circle_messages"."fitcircle_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text"))))));


--
-- Name: circle_messages circle_messages_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_messages_member_select" ON "public"."circle_messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "m"
  WHERE (("m"."fitcircle_id" = "circle_messages"."fitcircle_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text")))));


--
-- Name: circle_messages circle_messages_owner_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_messages_owner_update" ON "public"."circle_messages" FOR UPDATE USING (("sender_id" = "auth"."uid"())) WITH CHECK (("sender_id" = "auth"."uid"()));


--
-- Name: circle_quest_progress; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_quest_progress" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_quests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_quests" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_streak_saves; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_streak_saves" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_streak_saves circle_streak_saves_member_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_streak_saves_member_insert" ON "public"."circle_streak_saves" FOR INSERT WITH CHECK ((("saver_user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "saver_m"
  WHERE (("saver_m"."fitcircle_id" = "circle_streak_saves"."fitcircle_id") AND ("saver_m"."user_id" = "auth"."uid"()) AND ("saver_m"."status" = 'active'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "covered_m"
  WHERE (("covered_m"."fitcircle_id" = "circle_streak_saves"."fitcircle_id") AND ("covered_m"."user_id" = "circle_streak_saves"."covered_user_id") AND ("covered_m"."status" = 'active'::"text"))))));


--
-- Name: circle_streak_saves circle_streak_saves_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_streak_saves_member_select" ON "public"."circle_streak_saves" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "m"
  WHERE (("m"."fitcircle_id" = "circle_streak_saves"."fitcircle_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text")))));


--
-- Name: circle_streak_tracking; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_streak_tracking" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_streaks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."circle_streaks" ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_streaks circle_streaks_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "circle_streaks_member_select" ON "public"."circle_streaks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "m"
  WHERE (("m"."fitcircle_id" = "circle_streaks"."fitcircle_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text")))));


--
-- Name: comments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."comments" ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_challenge_participants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."daily_challenge_participants" ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_challenges; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."daily_challenges" ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_goals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."daily_goals" ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_high_five_limits; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."daily_high_five_limits" ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_tracking; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."daily_tracking" ENABLE ROW LEVEL SECURITY;

--
-- Name: dietary_preferences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dietary_preferences" ENABLE ROW LEVEL SECURITY;

--
-- Name: dietary_preferences dietary_preferences_delete_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dietary_preferences_delete_own" ON "public"."dietary_preferences" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: dietary_preferences dietary_preferences_insert_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dietary_preferences_insert_own" ON "public"."dietary_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: dietary_preferences dietary_preferences_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dietary_preferences_select_own" ON "public"."dietary_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: dietary_preferences dietary_preferences_update_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dietary_preferences_update_own" ON "public"."dietary_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: engagement_activities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."engagement_activities" ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_streaks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."engagement_streaks" ENABLE ROW LEVEL SECURITY;

--
-- Name: exercise_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."exercise_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_flags; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."feature_flags" ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_gates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."feature_gates" ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_gates feature_gates_authenticated_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "feature_gates_authenticated_select" ON "public"."feature_gates" FOR SELECT TO "authenticated" USING (true);


--
-- Name: fitcircle_data_submissions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."fitcircle_data_submissions" ENABLE ROW LEVEL SECURITY;

--
-- Name: fitcircle_leaderboard_entries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."fitcircle_leaderboard_entries" ENABLE ROW LEVEL SECURITY;

--
-- Name: fitcircle_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."fitcircle_members" ENABLE ROW LEVEL SECURITY;

--
-- Name: fitcircle_members fitcircle_members_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "fitcircle_members_insert" ON "public"."fitcircle_members" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: fitcircle_members fitcircle_members_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "fitcircle_members_select" ON "public"."fitcircle_members" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: fitcircle_members fitcircle_members_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "fitcircle_members_update" ON "public"."fitcircle_members" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: fitcircles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."fitcircles" ENABLE ROW LEVEL SECURITY;

--
-- Name: fitcircles fitcircles_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "fitcircles_delete" ON "public"."fitcircles" FOR DELETE USING (("auth"."uid"() = "creator_id"));


--
-- Name: fitcircles fitcircles_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "fitcircles_insert" ON "public"."fitcircles" FOR INSERT WITH CHECK (("auth"."uid"() = "creator_id"));


--
-- Name: fitcircles fitcircles_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "fitcircles_select" ON "public"."fitcircles" FOR SELECT USING ((("visibility" = 'public'::"public"."challenge_visibility") OR ("creator_id" = "auth"."uid"())));


--
-- Name: fitcircles fitcircles_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "fitcircles_update" ON "public"."fitcircles" FOR UPDATE USING (("auth"."uid"() = "creator_id"));


--
-- Name: fitzy_message_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."fitzy_message_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: food_log_audit; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."food_log_audit" ENABLE ROW LEVEL SECURITY;

--
-- Name: food_log_entries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."food_log_entries" ENABLE ROW LEVEL SECURITY;

--
-- Name: food_log_images; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."food_log_images" ENABLE ROW LEVEL SECURITY;

--
-- Name: food_log_shares; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."food_log_shares" ENABLE ROW LEVEL SECURITY;

--
-- Name: foods; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."foods" ENABLE ROW LEVEL SECURITY;

--
-- Name: foods foods_delete_own_custom; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "foods_delete_own_custom" ON "public"."foods" FOR DELETE USING (("owner_id" = "auth"."uid"()));


--
-- Name: foods foods_insert_own_custom; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "foods_insert_own_custom" ON "public"."foods" FOR INSERT WITH CHECK ((("owner_id" = "auth"."uid"()) AND ("source" = ANY (ARRAY['custom'::"text", 'recipe'::"text"]))));


--
-- Name: foods foods_read_global_or_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "foods_read_global_or_own" ON "public"."foods" FOR SELECT USING ((("owner_id" IS NULL) OR ("owner_id" = "auth"."uid"())));


--
-- Name: foods foods_update_own_custom; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "foods_update_own_custom" ON "public"."foods" FOR UPDATE USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));


--
-- Name: goal_completion_history; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."goal_completion_history" ENABLE ROW LEVEL SECURITY;

--
-- Name: group_meal_tags; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."group_meal_tags" ENABLE ROW LEVEL SECURITY;

--
-- Name: group_meal_tags group_meal_tags_creator_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "group_meal_tags_creator_insert" ON "public"."group_meal_tags" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."group_meals" "gm"
  WHERE (("gm"."id" = "group_meal_tags"."group_meal_id") AND ("gm"."creator_id" = "auth"."uid"())))));


--
-- Name: group_meal_tags group_meal_tags_owner_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "group_meal_tags_owner_update" ON "public"."group_meal_tags" FOR UPDATE USING (("tagged_user_id" = "auth"."uid"())) WITH CHECK (("tagged_user_id" = "auth"."uid"()));


--
-- Name: group_meal_tags group_meal_tags_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "group_meal_tags_select" ON "public"."group_meal_tags" FOR SELECT USING ((("tagged_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."group_meals" "gm"
  WHERE (("gm"."id" = "group_meal_tags"."group_meal_id") AND ("gm"."creator_id" = "auth"."uid"()))))));


--
-- Name: group_meals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."group_meals" ENABLE ROW LEVEL SECURITY;

--
-- Name: group_meals group_meals_creator_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "group_meals_creator_insert" ON "public"."group_meals" FOR INSERT WITH CHECK ((("creator_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "m"
  WHERE (("m"."fitcircle_id" = "group_meals"."fitcircle_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text"))))));


--
-- Name: group_meals group_meals_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "group_meals_member_select" ON "public"."group_meals" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "m"
  WHERE (("m"."fitcircle_id" = "group_meals"."fitcircle_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text")))));


--
-- Name: health_nutrition_sync; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."health_nutrition_sync" ENABLE ROW LEVEL SECURITY;

--
-- Name: health_nutrition_sync health_nutrition_sync_self_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "health_nutrition_sync_self_insert" ON "public"."health_nutrition_sync" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: health_nutrition_sync health_nutrition_sync_self_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "health_nutrition_sync_self_select" ON "public"."health_nutrition_sync" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: health_nutrition_sync health_nutrition_sync_self_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "health_nutrition_sync_self_update" ON "public"."health_nutrition_sync" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: leaderboard; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."leaderboard" ENABLE ROW LEVEL SECURITY;

--
-- Name: log_reactions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."log_reactions" ENABLE ROW LEVEL SECURITY;

--
-- Name: log_reactions log_reactions_member_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "log_reactions_member_insert" ON "public"."log_reactions" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM (("public"."food_log_entries" "fle"
     JOIN "public"."fitcircle_members" "owner_m" ON ((("owner_m"."user_id" = "fle"."user_id") AND ("owner_m"."status" = 'active'::"text"))))
     JOIN "public"."fitcircle_members" "viewer_m" ON ((("viewer_m"."fitcircle_id" = "owner_m"."fitcircle_id") AND ("viewer_m"."user_id" = "auth"."uid"()) AND ("viewer_m"."status" = 'active'::"text"))))
  WHERE ("fle"."id" = "log_reactions"."food_log_entry_id")))));


--
-- Name: log_reactions log_reactions_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "log_reactions_member_select" ON "public"."log_reactions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."food_log_entries" "fle"
     JOIN "public"."fitcircle_members" "owner_m" ON ((("owner_m"."user_id" = "fle"."user_id") AND ("owner_m"."status" = 'active'::"text"))))
     JOIN "public"."fitcircle_members" "viewer_m" ON ((("viewer_m"."fitcircle_id" = "owner_m"."fitcircle_id") AND ("viewer_m"."user_id" = "auth"."uid"()) AND ("viewer_m"."status" = 'active'::"text"))))
  WHERE ("fle"."id" = "log_reactions"."food_log_entry_id"))));


--
-- Name: log_reactions log_reactions_owner_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "log_reactions_owner_delete" ON "public"."log_reactions" FOR DELETE USING (("user_id" = "auth"."uid"()));


--
-- Name: metric_streaks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."metric_streaks" ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."notification_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;

--
-- Name: nutrition_challenge_config; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."nutrition_challenge_config" ENABLE ROW LEVEL SECURITY;

--
-- Name: nutrition_challenge_config nutrition_challenge_config_creator_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "nutrition_challenge_config_creator_delete" ON "public"."nutrition_challenge_config" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircles" "f"
  WHERE (("f"."id" = "nutrition_challenge_config"."fitcircle_id") AND ("f"."creator_id" = "auth"."uid"())))));


--
-- Name: nutrition_challenge_config nutrition_challenge_config_creator_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "nutrition_challenge_config_creator_insert" ON "public"."nutrition_challenge_config" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."fitcircles" "f"
  WHERE (("f"."id" = "nutrition_challenge_config"."fitcircle_id") AND ("f"."creator_id" = "auth"."uid"())))));


--
-- Name: nutrition_challenge_config nutrition_challenge_config_creator_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "nutrition_challenge_config_creator_update" ON "public"."nutrition_challenge_config" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircles" "f"
  WHERE (("f"."id" = "nutrition_challenge_config"."fitcircle_id") AND ("f"."creator_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."fitcircles" "f"
  WHERE (("f"."id" = "nutrition_challenge_config"."fitcircle_id") AND ("f"."creator_id" = "auth"."uid"())))));


--
-- Name: nutrition_challenge_config nutrition_challenge_config_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "nutrition_challenge_config_member_select" ON "public"."nutrition_challenge_config" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fitcircle_members" "m"
  WHERE (("m"."fitcircle_id" = "nutrition_challenge_config"."fitcircle_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text")))));


--
-- Name: nutrition_parse_cache; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."nutrition_parse_cache" ENABLE ROW LEVEL SECURITY;

--
-- Name: nutrition_parse_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."nutrition_parse_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_progress; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."onboarding_progress" ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_responses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."onboarding_responses" ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;

--
-- Name: plate_scores; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."plate_scores" ENABLE ROW LEVEL SECURITY;

--
-- Name: plate_scores plate_scores_delete_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "plate_scores_delete_own" ON "public"."plate_scores" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: plate_scores plate_scores_insert_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "plate_scores_insert_own" ON "public"."plate_scores" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: plate_scores plate_scores_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "plate_scores_select_own" ON "public"."plate_scores" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: plate_scores plate_scores_update_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "plate_scores_update_own" ON "public"."plate_scores" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: progress_entries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."progress_entries" ENABLE ROW LEVEL SECURITY;

--
-- Name: push_tokens; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."push_tokens" ENABLE ROW LEVEL SECURITY;

--
-- Name: reactions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."reactions" ENABLE ROW LEVEL SECURITY;

--
-- Name: share_cards; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."share_cards" ENABLE ROW LEVEL SECURITY;

--
-- Name: streak_claims; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."streak_claims" ENABLE ROW LEVEL SECURITY;

--
-- Name: streak_recoveries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."streak_recoveries" ENABLE ROW LEVEL SECURITY;

--
-- Name: streak_shields; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."streak_shields" ENABLE ROW LEVEL SECURITY;

--
-- Name: subscription_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."subscription_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: team_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;

--
-- Name: token_blacklist; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."token_blacklist" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_achievements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_achievements" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_goals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_goals" ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_goals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."weekly_goals" ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: postgres
--

-- CREATE PUBLICATION "supabase_realtime" WITH (publish = 'insert, update, delete, truncate');


ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";

--
-- Name: supabase_realtime_messages_publication; Type: PUBLICATION; Schema: -; Owner: supabase_admin
--

-- CREATE PUBLICATION "supabase_realtime_messages_publication" WITH (publish = 'insert, update, delete, truncate');


-- ALTER PUBLICATION "supabase_realtime_messages_publication" OWNER TO "supabase_admin";

--
-- Name: supabase_realtime circle_message_reactions; Type: PUBLICATION TABLE; Schema: public; Owner: postgres
--

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."circle_message_reactions";


--
-- Name: supabase_realtime circle_messages; Type: PUBLICATION TABLE; Schema: public; Owner: postgres
--

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."circle_messages";


--
-- Name: supabase_realtime log_reactions; Type: PUBLICATION TABLE; Schema: public; Owner: postgres
--

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."log_reactions";


--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "gtrgm_in"("cstring"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";


--
-- Name: FUNCTION "gtrgm_out"("public"."gtrgm"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";


--
-- Name: FUNCTION "armor"("bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."armor"("bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."armor"("bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."armor"("bytea") TO "dashboard_user";


--
-- Name: FUNCTION "armor"("bytea", "text"[], "text"[]); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."armor"("bytea", "text"[], "text"[]) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."armor"("bytea", "text"[], "text"[]) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."armor"("bytea", "text"[], "text"[]) TO "dashboard_user";


--
-- Name: FUNCTION "crypt"("text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."crypt"("text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."crypt"("text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."crypt"("text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "dearmor"("text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."dearmor"("text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."dearmor"("text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."dearmor"("text") TO "dashboard_user";


--
-- Name: FUNCTION "decrypt"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."decrypt"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."decrypt"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."decrypt"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "decrypt_iv"("bytea", "bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."decrypt_iv"("bytea", "bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."decrypt_iv"("bytea", "bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."decrypt_iv"("bytea", "bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "digest"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."digest"("bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."digest"("bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."digest"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "digest"("text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."digest"("text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."digest"("text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."digest"("text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "encrypt"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."encrypt"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."encrypt"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."encrypt"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "encrypt_iv"("bytea", "bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."encrypt_iv"("bytea", "bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."encrypt_iv"("bytea", "bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."encrypt_iv"("bytea", "bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "gen_random_bytes"(integer); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."gen_random_bytes"(integer) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."gen_random_bytes"(integer) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."gen_random_bytes"(integer) TO "dashboard_user";


--
-- Name: FUNCTION "gen_random_uuid"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."gen_random_uuid"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."gen_random_uuid"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."gen_random_uuid"() TO "dashboard_user";


--
-- Name: FUNCTION "gen_salt"("text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."gen_salt"("text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."gen_salt"("text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."gen_salt"("text") TO "dashboard_user";


--
-- Name: FUNCTION "gen_salt"("text", integer); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."gen_salt"("text", integer) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."gen_salt"("text", integer) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."gen_salt"("text", integer) TO "dashboard_user";


--
-- Name: FUNCTION "hmac"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."hmac"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."hmac"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."hmac"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "hmac"("text", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."hmac"("text", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."hmac"("text", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."hmac"("text", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone) TO "dashboard_user";


--
-- Name: FUNCTION "pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone) TO "dashboard_user";


--
-- Name: FUNCTION "pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean) TO "dashboard_user";


--
-- Name: FUNCTION "pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_key_id"("bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_key_id"("bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_key_id"("bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_key_id"("bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt"("bytea", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt"("bytea", "bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt_bytea"("bytea", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt_bytea"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt"("text", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt"("text", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt_bytea"("bytea", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt_bytea"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt"("bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt_bytea"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt_bytea"("bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt"("text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt"("text", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt_bytea"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt_bytea"("bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v1"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v1"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v1mc"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v1mc"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1mc"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1mc"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v3"("namespace" "uuid", "name" "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v3"("namespace" "uuid", "name" "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v3"("namespace" "uuid", "name" "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v3"("namespace" "uuid", "name" "text") TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v4"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v4"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v4"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v4"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v5"("namespace" "uuid", "name" "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v5"("namespace" "uuid", "name" "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v5"("namespace" "uuid", "name" "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v5"("namespace" "uuid", "name" "text") TO "dashboard_user";


--
-- Name: FUNCTION "uuid_nil"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_nil"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_nil"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_nil"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_dns"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_ns_dns"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_dns"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_dns"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_oid"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_ns_oid"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_oid"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_oid"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_url"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_ns_url"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_url"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_url"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_x500"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_ns_x500"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_x500"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_x500"() TO "dashboard_user";


--
-- Name: FUNCTION "gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";


--
-- Name: FUNCTION "gin_extract_value_trgm"("text", "internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";


--
-- Name: FUNCTION "gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";


--
-- Name: FUNCTION "gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";


--
-- Name: FUNCTION "gtrgm_compress"("internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";


--
-- Name: FUNCTION "gtrgm_consistent"("internal", "text", smallint, "oid", "internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";


--
-- Name: FUNCTION "gtrgm_decompress"("internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";


--
-- Name: FUNCTION "gtrgm_distance"("internal", "text", smallint, "oid", "internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";


--
-- Name: FUNCTION "gtrgm_options"("internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";


--
-- Name: FUNCTION "gtrgm_penalty"("internal", "internal", "internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";


--
-- Name: FUNCTION "gtrgm_picksplit"("internal", "internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";


--
-- Name: FUNCTION "gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";


--
-- Name: FUNCTION "gtrgm_union"("internal", "internal"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";


--
-- Name: FUNCTION "set_limit"(real); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";


--
-- Name: FUNCTION "show_limit"(); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";


--
-- Name: FUNCTION "show_trgm"("text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";


--
-- Name: FUNCTION "similarity"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";


--
-- Name: FUNCTION "similarity_dist"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";


--
-- Name: FUNCTION "similarity_op"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";


--
-- Name: FUNCTION "strict_word_similarity"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";


--
-- Name: FUNCTION "strict_word_similarity_commutator_op"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";


--
-- Name: FUNCTION "strict_word_similarity_dist_commutator_op"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";


--
-- Name: FUNCTION "strict_word_similarity_dist_op"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";


--
-- Name: FUNCTION "strict_word_similarity_op"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";


--
-- Name: FUNCTION "update_circle_streak_tracking_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_circle_streak_tracking_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_circle_streak_tracking_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_circle_streak_tracking_updated_at"() TO "service_role";


--
-- Name: FUNCTION "update_daily_tracking_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_daily_tracking_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_daily_tracking_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_daily_tracking_updated_at"() TO "service_role";


--
-- Name: FUNCTION "update_engagement_streaks_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_engagement_streaks_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_engagement_streaks_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_engagement_streaks_updated_at"() TO "service_role";


--
-- Name: FUNCTION "update_metric_streaks_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_metric_streaks_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_metric_streaks_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_metric_streaks_updated_at"() TO "service_role";


--
-- Name: FUNCTION "update_onboarding_progress_timestamp"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_onboarding_progress_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_onboarding_progress_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_onboarding_progress_timestamp"() TO "service_role";


--
-- Name: FUNCTION "update_streak_recoveries_timestamp"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_streak_recoveries_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_streak_recoveries_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_streak_recoveries_timestamp"() TO "service_role";


--
-- Name: FUNCTION "update_streak_shields_timestamp"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_streak_shields_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_streak_shields_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_streak_shields_timestamp"() TO "service_role";


--
-- Name: FUNCTION "update_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";


--
-- Name: FUNCTION "update_updated_at_column"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


--
-- Name: FUNCTION "update_user_goals_timestamp"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_user_goals_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_goals_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_goals_timestamp"() TO "service_role";


--
-- Name: FUNCTION "word_similarity"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";


--
-- Name: FUNCTION "word_similarity_commutator_op"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";


--
-- Name: FUNCTION "word_similarity_dist_commutator_op"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";


--
-- Name: FUNCTION "word_similarity_dist_op"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";


--
-- Name: FUNCTION "word_similarity_op"("text", "text"); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";


--
-- Name: FUNCTION "_crypto_aead_det_decrypt"("message" "bytea", "additional" "bytea", "key_id" bigint, "context" "bytea", "nonce" "bytea"); Type: ACL; Schema: vault; Owner: supabase_admin
--

-- GRANT ALL ON FUNCTION "vault"."_crypto_aead_det_decrypt"("message" "bytea", "additional" "bytea", "key_id" bigint, "context" "bytea", "nonce" "bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "vault"."_crypto_aead_det_decrypt"("message" "bytea", "additional" "bytea", "key_id" bigint, "context" "bytea", "nonce" "bytea") TO "service_role";


--
-- Name: FUNCTION "create_secret"("new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid"); Type: ACL; Schema: vault; Owner: supabase_admin
--

-- GRANT ALL ON FUNCTION "vault"."create_secret"("new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "vault"."create_secret"("new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "update_secret"("secret_id" "uuid", "new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid"); Type: ACL; Schema: vault; Owner: supabase_admin
--

-- GRANT ALL ON FUNCTION "vault"."update_secret"("secret_id" "uuid", "new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "vault"."update_secret"("secret_id" "uuid", "new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "service_role";


--
-- Name: TABLE "pg_stat_statements"; Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON TABLE "extensions"."pg_stat_statements" FROM "postgres";
-- GRANT ALL ON TABLE "extensions"."pg_stat_statements" TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON TABLE "extensions"."pg_stat_statements" TO "dashboard_user";


--
-- Name: TABLE "pg_stat_statements_info"; Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON TABLE "extensions"."pg_stat_statements_info" FROM "postgres";
-- GRANT ALL ON TABLE "extensions"."pg_stat_statements_info" TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON TABLE "extensions"."pg_stat_statements_info" TO "dashboard_user";


--
-- Name: TABLE "achievements"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."achievements" TO "anon";
GRANT SELECT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."achievements" TO "service_role";


--
-- Name: TABLE "beverage_log_images"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."beverage_log_images" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."beverage_log_images" TO "authenticated";
GRANT ALL ON TABLE "public"."beverage_log_images" TO "service_role";


--
-- Name: TABLE "beverage_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."beverage_logs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."beverage_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."beverage_logs" TO "service_role";


--
-- Name: TABLE "body_comp_parse_cache"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."body_comp_parse_cache" TO "anon";
GRANT ALL ON TABLE "public"."body_comp_parse_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."body_comp_parse_cache" TO "service_role";


--
-- Name: TABLE "body_comp_parse_log"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."body_comp_parse_log" TO "anon";
GRANT ALL ON TABLE "public"."body_comp_parse_log" TO "authenticated";
GRANT ALL ON TABLE "public"."body_comp_parse_log" TO "service_role";


--
-- Name: TABLE "body_composition_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."body_composition_logs" TO "anon";
GRANT ALL ON TABLE "public"."body_composition_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."body_composition_logs" TO "service_role";


--
-- Name: TABLE "challenge_invitations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."challenge_invitations" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."challenge_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_invitations" TO "service_role";


--
-- Name: TABLE "challenge_invites"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."challenge_invites" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."challenge_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_invites" TO "service_role";


--
-- Name: TABLE "challenge_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."challenge_logs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."challenge_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_logs" TO "service_role";


--
-- Name: TABLE "challenge_participants"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."challenge_participants" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."challenge_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_participants" TO "service_role";


--
-- Name: TABLE "challenge_templates"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."challenge_templates" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."challenge_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_templates" TO "service_role";


--
-- Name: TABLE "challenge_with_participants"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."challenge_with_participants" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."challenge_with_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_with_participants" TO "service_role";


--
-- Name: TABLE "challenges"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."challenges" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."challenges" TO "service_role";


--
-- Name: TABLE "check_ins"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."check_ins" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."check_ins" TO "authenticated";
GRANT ALL ON TABLE "public"."check_ins" TO "service_role";


--
-- Name: TABLE "circle_chat_state"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_chat_state" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_chat_state" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_chat_state" TO "service_role";


--
-- Name: TABLE "circle_check_ins"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_check_ins" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_check_ins" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_check_ins" TO "service_role";


--
-- Name: TABLE "circle_daily_boosts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_daily_boosts" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_daily_boosts" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_daily_boosts" TO "service_role";


--
-- Name: TABLE "circle_encouragements"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_encouragements" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_encouragements" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_encouragements" TO "service_role";


--
-- Name: TABLE "circle_food_privacy"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_food_privacy" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_food_privacy" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_food_privacy" TO "service_role";


--
-- Name: TABLE "circle_invites"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_invites" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_invites" TO "service_role";


--
-- Name: TABLE "circle_member_blocks"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_member_blocks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_member_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_member_blocks" TO "service_role";


--
-- Name: TABLE "circle_message_reactions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_message_reactions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_message_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_message_reactions" TO "service_role";


--
-- Name: TABLE "circle_message_reports"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_message_reports" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_message_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_message_reports" TO "service_role";


--
-- Name: TABLE "circle_messages"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_messages" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_messages" TO "service_role";


--
-- Name: TABLE "circle_quest_progress"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_quest_progress" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_quest_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_quest_progress" TO "service_role";


--
-- Name: TABLE "circle_quests"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_quests" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_quests" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_quests" TO "service_role";


--
-- Name: TABLE "circle_streak_saves"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_streak_saves" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_streak_saves" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_streak_saves" TO "service_role";


--
-- Name: TABLE "circle_streak_tracking"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_streak_tracking" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_streak_tracking" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_streak_tracking" TO "service_role";


--
-- Name: TABLE "circle_streaks"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."circle_streaks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circle_streaks" TO "authenticated";
GRANT ALL ON TABLE "public"."circle_streaks" TO "service_role";


--
-- Name: TABLE "comments"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."comments" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."comments" TO "authenticated";
GRANT ALL ON TABLE "public"."comments" TO "service_role";


--
-- Name: TABLE "weekly_goals"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."weekly_goals" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."weekly_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_goals" TO "service_role";


--
-- Name: TABLE "current_weekly_goals"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."current_weekly_goals" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."current_weekly_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."current_weekly_goals" TO "service_role";


--
-- Name: TABLE "daily_challenge_participants"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."daily_challenge_participants" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."daily_challenge_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_challenge_participants" TO "service_role";


--
-- Name: TABLE "daily_challenges"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."daily_challenges" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."daily_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_challenges" TO "service_role";


--
-- Name: TABLE "daily_goals"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."daily_goals" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."daily_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_goals" TO "service_role";


--
-- Name: TABLE "daily_high_five_limits"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."daily_high_five_limits" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."daily_high_five_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_high_five_limits" TO "service_role";


--
-- Name: TABLE "daily_tracking"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."daily_tracking" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."daily_tracking" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_tracking" TO "service_role";


--
-- Name: TABLE "dietary_preferences"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dietary_preferences" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."dietary_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."dietary_preferences" TO "service_role";


--
-- Name: TABLE "engagement_activities"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."engagement_activities" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."engagement_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."engagement_activities" TO "service_role";


--
-- Name: TABLE "engagement_streaks"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."engagement_streaks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."engagement_streaks" TO "authenticated";
GRANT ALL ON TABLE "public"."engagement_streaks" TO "service_role";


--
-- Name: TABLE "exercise_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."exercise_logs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."exercise_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_logs" TO "service_role";


--
-- Name: TABLE "feature_flags"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."feature_flags" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_flags" TO "service_role";


--
-- Name: TABLE "feature_gates"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."feature_gates" TO "anon";
GRANT ALL ON TABLE "public"."feature_gates" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_gates" TO "service_role";


--
-- Name: TABLE "fitcircle_data_submissions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."fitcircle_data_submissions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fitcircle_data_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."fitcircle_data_submissions" TO "service_role";


--
-- Name: TABLE "fitcircle_leaderboard_entries"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."fitcircle_leaderboard_entries" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fitcircle_leaderboard_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."fitcircle_leaderboard_entries" TO "service_role";


--
-- Name: TABLE "fitcircle_members"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."fitcircle_members" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."fitcircle_members" TO "authenticated";
GRANT ALL ON TABLE "public"."fitcircle_members" TO "service_role";


--
-- Name: TABLE "fitcircles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."fitcircles" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."fitcircles" TO "authenticated";
GRANT ALL ON TABLE "public"."fitcircles" TO "service_role";


--
-- Name: TABLE "fitzy_message_log"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."fitzy_message_log" TO "service_role";


--
-- Name: TABLE "food_log_audit"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."food_log_audit" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."food_log_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."food_log_audit" TO "service_role";


--
-- Name: TABLE "food_log_entries"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."food_log_entries" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."food_log_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."food_log_entries" TO "service_role";


--
-- Name: TABLE "food_log_images"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."food_log_images" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."food_log_images" TO "authenticated";
GRANT ALL ON TABLE "public"."food_log_images" TO "service_role";


--
-- Name: TABLE "food_log_shares"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."food_log_shares" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."food_log_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."food_log_shares" TO "service_role";


--
-- Name: TABLE "foods"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."foods" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."foods" TO "authenticated";
GRANT ALL ON TABLE "public"."foods" TO "service_role";


--
-- Name: TABLE "goal_completion_history"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."goal_completion_history" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."goal_completion_history" TO "authenticated";
GRANT ALL ON TABLE "public"."goal_completion_history" TO "service_role";


--
-- Name: TABLE "group_meal_tags"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."group_meal_tags" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."group_meal_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."group_meal_tags" TO "service_role";


--
-- Name: TABLE "group_meals"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."group_meals" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."group_meals" TO "authenticated";
GRANT ALL ON TABLE "public"."group_meals" TO "service_role";


--
-- Name: TABLE "health_nutrition_sync"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."health_nutrition_sync" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."health_nutrition_sync" TO "authenticated";
GRANT ALL ON TABLE "public"."health_nutrition_sync" TO "service_role";


--
-- Name: TABLE "leaderboard"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."leaderboard" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."leaderboard" TO "authenticated";
GRANT ALL ON TABLE "public"."leaderboard" TO "service_role";


--
-- Name: TABLE "log_reactions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."log_reactions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."log_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."log_reactions" TO "service_role";


--
-- Name: TABLE "metric_streaks"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."metric_streaks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."metric_streaks" TO "authenticated";
GRANT ALL ON TABLE "public"."metric_streaks" TO "service_role";


--
-- Name: TABLE "notification_log"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."notification_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notification_log" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_log" TO "service_role";


--
-- Name: TABLE "notification_preferences"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";


--
-- Name: TABLE "notifications"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT SELECT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";


--
-- Name: TABLE "nutrition_challenge_config"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."nutrition_challenge_config" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."nutrition_challenge_config" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_challenge_config" TO "service_role";


--
-- Name: TABLE "nutrition_parse_cache"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."nutrition_parse_cache" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."nutrition_parse_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_parse_cache" TO "service_role";


--
-- Name: TABLE "nutrition_parse_log"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."nutrition_parse_log" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."nutrition_parse_log" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_parse_log" TO "service_role";


--
-- Name: TABLE "onboarding_progress"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."onboarding_progress" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."onboarding_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_progress" TO "service_role";


--
-- Name: TABLE "onboarding_responses"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."onboarding_responses" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."onboarding_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_responses" TO "service_role";


--
-- Name: TABLE "payments"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";


--
-- Name: TABLE "plate_scores"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."plate_scores" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."plate_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."plate_scores" TO "service_role";


--
-- Name: TABLE "profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


--
-- Name: TABLE "progress_entries"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."progress_entries" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."progress_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."progress_entries" TO "service_role";


--
-- Name: TABLE "public_profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."public_profiles" TO "anon";
GRANT ALL ON TABLE "public"."public_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."public_profiles" TO "service_role";


--
-- Name: TABLE "push_tokens"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."push_tokens" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."push_tokens" TO "service_role";


--
-- Name: TABLE "reactions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."reactions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."reactions" TO "service_role";


--
-- Name: TABLE "share_cards"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."share_cards" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."share_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."share_cards" TO "service_role";


--
-- Name: TABLE "streak_claims"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."streak_claims" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."streak_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."streak_claims" TO "service_role";


--
-- Name: TABLE "streak_recoveries"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."streak_recoveries" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."streak_recoveries" TO "authenticated";
GRANT ALL ON TABLE "public"."streak_recoveries" TO "service_role";


--
-- Name: TABLE "streak_shields"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."streak_shields" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."streak_shields" TO "authenticated";
GRANT ALL ON TABLE "public"."streak_shields" TO "service_role";


--
-- Name: TABLE "subscription_events"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."subscription_events" TO "service_role";


--
-- Name: TABLE "team_members"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";


--
-- Name: TABLE "teams"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";


--
-- Name: TABLE "token_blacklist"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."token_blacklist" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."token_blacklist" TO "authenticated";
GRANT ALL ON TABLE "public"."token_blacklist" TO "service_role";


--
-- Name: TABLE "user_achievements"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_achievements" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."user_achievements" TO "service_role";


--
-- Name: TABLE "user_goals"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_goals" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."user_goals" TO "service_role";


--
-- Name: TABLE "secrets"; Type: ACL; Schema: vault; Owner: supabase_admin
--

-- GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE "vault"."secrets" TO "postgres" WITH GRANT OPTION;
-- GRANT SELECT,DELETE ON TABLE "vault"."secrets" TO "service_role";


--
-- Name: TABLE "decrypted_secrets"; Type: ACL; Schema: vault; Owner: supabase_admin
--

-- GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE "vault"."decrypted_secrets" TO "postgres" WITH GRANT OPTION;
-- GRANT SELECT,DELETE ON TABLE "vault"."decrypted_secrets" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "issue_graphql_placeholder" ON "sql_drop"
--          WHEN TAG IN ('DROP EXTENSION')
--    EXECUTE FUNCTION "extensions"."set_graphql_placeholder"();


-- ALTER EVENT TRIGGER "issue_graphql_placeholder" OWNER TO "supabase_admin";

--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "issue_pg_cron_access" ON "ddl_command_end"
--          WHEN TAG IN ('CREATE EXTENSION')
--    EXECUTE FUNCTION "extensions"."grant_pg_cron_access"();


-- ALTER EVENT TRIGGER "issue_pg_cron_access" OWNER TO "supabase_admin";

--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "issue_pg_graphql_access" ON "ddl_command_end"
--          WHEN TAG IN ('CREATE FUNCTION')
--    EXECUTE FUNCTION "extensions"."grant_pg_graphql_access"();


-- ALTER EVENT TRIGGER "issue_pg_graphql_access" OWNER TO "supabase_admin";

--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "issue_pg_net_access" ON "ddl_command_end"
--          WHEN TAG IN ('CREATE EXTENSION')
--    EXECUTE FUNCTION "extensions"."grant_pg_net_access"();


-- ALTER EVENT TRIGGER "issue_pg_net_access" OWNER TO "supabase_admin";

--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "pgrst_ddl_watch" ON "ddl_command_end"
--    EXECUTE FUNCTION "extensions"."pgrst_ddl_watch"();


-- ALTER EVENT TRIGGER "pgrst_ddl_watch" OWNER TO "supabase_admin";

--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "pgrst_drop_watch" ON "sql_drop"
--    EXECUTE FUNCTION "extensions"."pgrst_drop_watch"();


-- ALTER EVENT TRIGGER "pgrst_drop_watch" OWNER TO "supabase_admin";

--
-- PostgreSQL database dump complete
--

-- \unrestrict GWdtNEtU1TLamuu50czsHopauMuZIGqVTtM1eFzV9NVneVjgGDPXKRspNtFmYXT

