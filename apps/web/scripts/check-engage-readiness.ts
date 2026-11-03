import { Pool } from "pg";
import { TenantSchema } from "@inov8r/engage-protocol";
import { EngageConnector } from "@inov8r/engage-connector";

/** Read-only diagnostics. No provider calls or personal/credential values. */
async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((a) => !["--config-only", "--database", "--service"].includes(a))
  )
    throw new Error("Use --config-only, --database and/or --service");
  const checks: Array<{ check: string; passed: boolean; reason?: string }> = [];
  const tenant = TenantSchema.safeParse({
    app_id: "fitcircle",
    environment: process.env.ENGAGE_ENVIRONMENT,
  });
  checks.push({ check: "fixed_identity", passed: tenant.success });
  const names = [
    "ENGAGE_INTEGRATION_SECRET",
    "ENGAGE_AUTHORIZATION_SECRET",
    "ENGAGE_CONNECTOR_ENCRYPTION_KEY",
    "ENGAGE_CONNECTOR_CRON_SECRET",
  ];
  const values = names.map((n) => process.env[n] ?? "");
  checks.push({
    check: "separate_connector_credentials",
    passed:
      values.every((v) => Buffer.byteLength(v) >= 32) &&
      new Set(values).size === values.length,
  });
  checks.push({
    check: "outbox_encryption_key",
    passed: /^[a-f0-9]{64}$/.test(
      process.env.ENGAGE_CONNECTOR_ENCRYPTION_KEY ?? "",
    ),
  });
  checks.push({
    check: "connector_enabled",
    passed: process.env.ENGAGE_ENABLED === "true",
  });
  let connector: EngageConnector | undefined;
  if (tenant.success)
    try {
      connector = new EngageConnector({
        tenant: tenant.data,
        origin: process.env.ENGAGE_SERVICE_ORIGIN ?? "",
        secret: values[0],
      });
      checks.push({ check: "service_origin", passed: true });
    } catch {
      checks.push({ check: "service_origin", passed: false });
    }
  if (args.includes("--database")) {
    if (!process.env.DATABASE_URL)
      checks.push({ check: "host_database", passed: false });
    else {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
        connectionTimeoutMillis: 5000,
        query_timeout: 15000,
      });
      try {
        const tx = await pool.connect();
        try {
          await tx.query("begin read only");
          const identity = (
            await tx.query(
              "select app_id,environment from engage_connector.identity where singleton",
            )
          ).rows[0];
          checks.push({
            check: "connector_database_identity",
            passed:
              tenant.success &&
              identity?.app_id === tenant.data.app_id &&
              identity?.environment === tenant.data.environment,
          });
          checks.push({
            check: "no_embedded_core",
            passed: !(
              await tx.query("select to_regclass('engage.deployment') present")
            ).rows[0].present,
          });
          const exposed = (
            await tx.query(
              "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='engage_connector' and c.relkind='r' and exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_roles r on r.oid=a.grantee where a.grantee=0 or r.rolname in ('anon','authenticated','service_role'))",
            )
          ).rows;
          checks.push({
            check: "private_connector_tables",
            passed: exposed.length === 0,
          });
          const triggers = [
            "engage_connector_profile_insert",
            "engage_connector_profile_update",
            "engage_connector_preference_update",
            "engage_connector_auth_insert",
            "engage_connector_auth_update",
            "engage_guard_preferences",
            "engage_guard_campaign_delivery",
            "engage_guard_guest_invite",
            "engage_lock_guest_optout",
          ];
          const rows = (
            await tx.query(
              "select tgname from pg_trigger where tgname=any($1) and not tgisinternal and tgenabled<>'D'",
              [triggers],
            )
          ).rows;
          checks.push({
            check: "standalone_cutover_guards",
            passed: triggers.every((t) => rows.some((r) => r.tgname === t)),
          });
          const control = (
            await tx.query(
              "select bridge_required from engage_connector.fitcircle_control where singleton",
            )
          ).rows[0];
          checks.push({
            check: "sticky_bridge_activated",
            passed:
              control?.bridge_required === true &&
              process.env.ENGAGE_LEGACY_BRIDGE_ENABLED === "true",
            reason:
              "Activate only after the documented native worker drain and history import",
          });
          const parked = (
            await tx.query(
              "select count(*)::int n from engage_connector.outbox where state='parked'",
            )
          ).rows[0].n;
          checks.push({ check: "no_parked_operations", passed: parked === 0 });
          await tx.query("commit");
        } catch (error) {
          await tx.query("rollback").catch(() => {});
          throw error;
        } finally {
          tx.release();
        }
      } catch {
        checks.push({
          check: "host_database_readiness",
          passed: false,
          reason: "Connection, connector schema or guard verification failed",
        });
      } finally {
        await pool.end();
      }
    }
  }
  if (args.includes("--service"))
    try {
      const identity = await connector?.json(
        "/api/engage/integration/identity",
        "GET",
      );
      checks.push({
        check: "authenticated_service_identity",
        passed:
          tenant.success &&
          identity?.app_id === tenant.data.app_id &&
          identity?.environment === tenant.data.environment &&
          identity?.architecture === "standalone",
      });
      checks.push({
        check: "central_native_bridge",
        passed: identity?.native_bridge_enabled === true,
      });
    } catch {
      checks.push({ check: "authenticated_service_identity", passed: false });
    }
  console.log(
    JSON.stringify(
      {
        architecture: "standalone_connector",
        app_id: "fitcircle",
        environment: tenant.success
          ? tenant.data.environment
          : "invalid_or_unset",
        checks,
        live_delivery_qualified: false,
      },
      null,
      2,
    ),
  );
  if (checks.some((c) => !c.passed)) process.exitCode = 1;
}
main().catch(() => {
  console.error("Readiness failed; configuration values are withheld.");
  process.exitCode = 1;
});
