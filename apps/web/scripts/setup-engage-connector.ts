import { Pool } from "pg";
import { TenantSchema } from "@inov8r/engage-protocol";
import { ConnectorOutbox, EngageConnector } from "@inov8r/engage-connector";
/** Offline bootstrap before Supabase migration 120. No runtime migrations. */
async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--apply"))
    throw new Error("Use --apply to create the connector outbox");
  const tenant = TenantSchema.parse({
    app_id: "fitcircle",
    environment: process.env.ENGAGE_ENVIRONMENT,
  });
  const plan = {
    ...tenant,
    creates: "engage_connector outbox metadata only",
    next: "Apply 120_engage_standalone_connector.sql using the normal Supabase migration workflow",
    sends: false,
  };
  if (!args.includes("--apply")) {
    console.log(JSON.stringify({ ...plan, applied: false }));
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    if (
      (await pool.query("select to_regclass('engage.deployment') present"))
        .rows[0].present
    )
      throw new Error(
        "Embedded installation requires a separate reviewed migration",
      );
    const connector = new EngageConnector({
      tenant,
      origin: process.env.ENGAGE_SERVICE_ORIGIN ?? "",
      secret: process.env.ENGAGE_INTEGRATION_SECRET ?? "",
    });
    await new ConnectorOutbox(
      pool,
      connector,
      process.env.ENGAGE_CONNECTOR_ENCRYPTION_KEY ?? "",
    ).migrate();
    console.log(JSON.stringify({ ...plan, applied: true }));
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Connector setup failed. Verify identity, offline database permissions and migration checksums; secrets are withheld.",
  );
  process.exitCode = 1;
});
