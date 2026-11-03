import { resendHostEmail } from "@inov8r/engage-adapters";
import { IdSchema, TenantSchema } from "@inov8r/engage-protocol";
import { getPgPool } from "../db";
import { createAdminSupabase } from "../supabase-admin";
import { MobileAPIService } from "../services/mobile-api-service";
import { createFitCircleUserAuth } from "./user-auth";
import {
  createStandaloneFitCircle,
  type StandaloneFitCircle,
} from "./standalone";
let host: StandaloneFitCircle | undefined;
/** Lazy, server-only connector. DATABASE_URL is used only for FitCircle's
 * business data and durable connector outbox, never for Engage core storage. */
export function getFitCircleEngage(): StandaloneFitCircle | null {
  if (process.env.ENGAGE_ENABLED !== "true") return null;
  if (host) return host;
  const tenant = TenantSchema.parse({
    app_id: "fitcircle",
    environment: process.env.ENGAGE_ENVIRONMENT,
  });
  const pool = getPgPool();
  if (!pool)
    throw new Error("FitCircle connector outbox requires DATABASE_URL");
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing connector setting: ${name}`);
    return value;
  };
  const auth = createFitCircleUserAuth(tenant, {
    web: async (token) => {
      const { data, error } = await createAdminSupabase().auth.getUser(token);
      return error ? null : (data.user?.id ?? null);
    },
    mobile: async (token) =>
      (await MobileAPIService.authenticateWithToken(token))?.id ?? null,
  });
  host = createStandaloneFitCircle({
    pool,
    environment: tenant.environment,
    origin: required("ENGAGE_SERVICE_ORIGIN"),
    integration_secret: required("ENGAGE_INTEGRATION_SECRET"),
    authorization_secret: required("ENGAGE_AUTHORIZATION_SECRET"),
    outbox_key: required("ENGAGE_CONNECTOR_ENCRYPTION_KEY"),
    cron_secret: required("ENGAGE_CONNECTOR_CRON_SECRET"),
    legacy_bridge_enabled: process.env.ENGAGE_LEGACY_BRIDGE_ENABLED === "true",
    test_user_ids: IdSchema.array()
      .max(100)
      .parse(JSON.parse(process.env.ENGAGE_TEST_USER_IDS ?? "[]")),
    auth,
  });
  return host;
}
export function getFitCircleLegacyEmail() {
  const configured = getFitCircleEngage();
  if (!configured)
    throw new Error("Legacy bridge requires Engage connector configuration");
  const from = process.env.ENGAGE_EMAIL_FROM ?? "FitCircle <team@fitcircle.ai>",
    api_key = process.env.RESEND_API_KEY;
  if (
    !api_key ||
    from.includes("\r") ||
    from.includes("\n") ||
    !from.endsWith("@fitcircle.ai>")
  )
    throw new Error("Native email requires a verified FitCircle sender");
  return {
    host: configured,
    transport: resendHostEmail({
      tenant: configured.tenant,
      api_key,
      from,
      reply_to: "team@fitcircle.ai",
    }),
  };
}
/** Once coexistence is activated in the host database, configuration rollback
 * cannot silently re-enable uncoordinated native sends. */
export async function nativeBridgeActive(): Promise<boolean> {
  const enabled = process.env.ENGAGE_LEGACY_BRIDGE_ENABLED === "true",
    pool = getPgPool();
  if (pool) {
    const present = (
      await pool.query(
        "select to_regclass('engage_connector.fitcircle_control') present",
      )
    ).rows[0]?.present;
    if (present) {
      const required = (
        await pool.query(
          "select bridge_required from engage_connector.fitcircle_control where singleton",
        )
      ).rows[0]?.bridge_required;
      if (required && (!enabled || process.env.ENGAGE_ENABLED !== "true"))
        throw new Error(
          "Standalone coexistence requires the native connector; rollback must pause and reconcile campaigns first",
        );
    }
  }
  return enabled;
}
