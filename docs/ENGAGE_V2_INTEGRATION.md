# FitCircle → standalone Engage

Updated **2026-11-01**. The owner-authorized architecture now runs Engage in its own service and Supabase projects. FitCircle retains its business/auth database and private connector metadata only. The [earlier embedded integration guide](archive/2026-11-01-engage-embedded.md) is preserved for history. Canonical spec, dated decisions, setup, coexistence and release evidence live in `~/Code/Engage/docs/`.

## Runtime

`app/lib/engage/server.ts` creates `createStandaloneFitCircle`, not an embedded campaign engine. `/api/engage/client/*` verifies this app's web/native identity and signs requests to central Engage. `/api/engage/authorize` verifies a dedicated callback signature and checks the current auth account, consent/category/quiet-hours and exact destination. Banned, deleted or missing auth accounts cannot receive even while profile cleanup/outbox replay is pending. `/api/engage/cron/connector` is the authenticated POST synchronization worker; old embedded dispatch/stats jobs do not run in FitCircle.

The connector owns encrypted transactional outbox rows, dirty source signals, exact host token bindings, projection fingerprints and minimal tombstones. Profiles, verified email, auth-account deletion and preference changes generate source signals. Failed capture backs off per identity without starving unrelated users; correction creates a new immediately eligible revision. Explicit withdrawals supersede older pending grants; consent grants retain central revision preconditions and never rebase automatically. Pull sync/display permits refresh current policy before forwarding.

## Setup

Read `Engage/docs/ENGAGE_STANDALONE_GUIDE.md` and `ENGAGE_COEXISTENCE.md` before activation. Provision the central service and its per-app database login there; **never** put that central database URL in FitCircle. Use this app's own `DATABASE_URL` here.

1. Install the checksum-pinned connector/protocol snapshot with `scripts/update-engage-packages.mjs`.
2. Run `bun run engage:setup` from `apps/web` to print the plan; `--apply` bootstraps the private connector outbox offline.
3. Apply `supabase/migrations/120_engage_standalone_connector.sql` through the normal migration workflow. Unshipped embedded Engage migrations 116–119 were archived in `supabase/_archive/engage_embedded_2026-11-01/`; do not install them. Existing embedded deployments require an explicit reviewed conversion, not a URL change.
4. Deploy all bridge-aware native account senders. Drain old workers, reconcile/import the seven-day cap window with `engage:history --through=<UTC cutoff>` (report first, then `--apply`), and activate `engage_connector.fitcircle_control.bridge_required=true` only at the coordinated cutover.
5. Schedule `POST /api/engage/cron/connector` with `Bearer ENGAGE_CONNECTOR_CRON_SECRET`. Capture is time-bounded, delivery replay is lease-fenced, heartbeat includes queued/parked/uncaptured work, and completed outbox metadata is pruned after 30 days.
6. Run `bun run engage:readiness --config-only` and `bun run engage:readiness --database --service`. These send no messages. Verify live providers/devices and full release gates separately.

| Setting | Meaning |
|---|---|
| `ENGAGE_ENABLED` | Enable the thin connector; defaults off |
| `ENGAGE_ENVIRONMENT` | Explicit fixed environment |
| `DATABASE_URL` | FitCircle business/outbox database only |
| `ENGAGE_SERVICE_ORIGIN` | Exact central HTTPS API origin |
| `ENGAGE_INTEGRATION_SECRET` | App-specific signing secret matching central integration key `primary` |
| `ENGAGE_AUTHORIZATION_SECRET` | Different secret matching central current-recipient callback key |
| `ENGAGE_CONNECTOR_ENCRYPTION_KEY` | Dedicated 32-byte lowercase hexadecimal outbox key |
| `ENGAGE_CONNECTOR_CRON_SECRET` | Separate secret for the app synchronization worker |
| `ENGAGE_LEGACY_BRIDGE_ENABLED` | Native senders use central shared policy; required after sticky activation |
| `ENGAGE_TEST_USER_IDS` | Server-only JSON array of approved QA UUIDs |
| `NEXT_PUBLIC_ENGAGE_ENABLED` / `NEXT_PUBLIC_ENGAGE_ENVIRONMENT` | Existing web SDK flags; environment must match |
| `NEXT_PUBLIC_ENGAGE_WEB_PUSH_ENABLED` | Existing explicit browser subscription/worker opt-in |

All four connector secrets must be distinct and at least 32 bytes. Old FitCircle `ENGAGE_ADMIN_SECRET`, `ENGAGE_CRON_SECRET` and `ENGAGE_SENDS_ENABLED` do not configure the central engine. Central providers, admin assertions, device encryption, assets and campaign flags belong in service config. Native FitCircle account-email transports retain their own verified Resend sender; central email uses its own configured transport and the shared consent/cap ledger.

## Coexistence, privacy and release

Native push/account email calls central reserve → one-time target authorization → completion → close, then uses current local recipient checks. No failure falls back to an uncoordinated native send. Native and Engage campaigns can run concurrently; link/pause/drain/transfer one campaign at a time. Keep existing native editors/campaigns until explicitly migrated. The sticky guard prevents rollback by merely disabling environment flags.

Deleting an account durably queues erasure and establishes a local barrier even if central Engage is unavailable. Auth soft/hard deletion is captured too. Account exports must assemble this app's business data, connector metadata and paginated central self-export. Keep independent post-backup deletion/withdrawal evidence for recovery. Guests/internal reports remain separate recipient workflows.

Local tests include the actual connector against a separate FitCircle database and two central app tenants. Production migrations, live activation, real provider/device qualification, full-scale/PITR qualification and trusted business-event producer coverage are not implied. Existing FitCircle dependency advisories remain explicit release work. Use the canonical Engage execution ledger for current evidence.
