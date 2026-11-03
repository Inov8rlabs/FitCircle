# Embedded Engage baseline, preserved 2026-11-01

These locally authored, unshipped migrations depended on an Engage core schema in FitCircle. They are archived unchanged for historical qualification tests. New standalone deployments run the connector outbox migration followed by `120_engage_standalone_connector.sql`; the Engage service database is provisioned separately. Never run the archived files on a new deployment. If an environment already applied them, follow the freeze/export/reconciliation runbook rather than rewriting its migration ledger.
