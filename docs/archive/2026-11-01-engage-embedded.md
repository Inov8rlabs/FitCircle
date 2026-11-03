# Engage v2 integration worktree

Status: local integration under test; concurrent native and Engage outbound is implemented behind flags, with campaign-by-campaign handover; no production activation has occurred. Canonical product requirements live in `~/Code/Engage/docs/`, not the older `feat/engage` snapshot.

## Included

- `/api/engage/[...path]` mounts the shared Node engine with fixed `fitcircle` ownership and an explicit environment. Invalid/disabled configuration fails closed without leaking database or credential details.
- Web authentication verifies bearer tokens through this host's Supabase Auth server. Native apps select `X-Engage-Auth: fitcircle-mobile`, which verifies FitCircle access JWTs using `MobileAPIService` (signature, expiration, access type, revocation and existing profile). Failure never falls back to another verifier. The selector cannot choose a tenant; this adapter refuses any app other than `fitcircle`. Admin requests use body/path/method-bound assertions with a dedicated secret; browser role headers grant no access.
- Session creation imports host profile facts and missing consent defaults. Missing marketing consent remains unknown. A refresh cannot overwrite an Engage opt-out.
- Live delivery authorization reads the current host push master, purpose opt-outs, category preference and quiet hours. Consent changes update purpose preferences transactionally.
- Push registration accepts optional `install_id` and binds only a token owned by that authenticated account. The resolver checks the current token owner, device, active state and environment. Changing accounts requires unbinding the prior active installation.
- Account deletion tombstones/purges Engage before deleting host identity. Token deletion now also requires the authenticated owner, fixing an existing token-only deletion check.
- A root-level Engage session survives route navigation, retries initial connection failures when online, and clears old content before an account change. Permanent provider token rejection deactivates the exact host row and cannot be undone by session refresh.
- The web dashboard renders Engage cards/placements and in-app messages behind an explicit public flag. SDK logout runs before Supabase sign-out; browser navigation is restricted to the host screen/URL allowlists. Fitzy falls back to the dashboard until a web chat route exists.

## Provisioning

Generate and review the core SQL using the canonical Engage migration CLI for the exact app/environment. Apply it before `supabase/migrations/116_engage_v2_host.sql`. The latter adds private token bindings with RLS and owner/deployment references. No migration is applied automatically by requests or builds.

Server configuration:

| Variable | Requirement |
|---|---|
| `ENGAGE_ENABLED` | `true` to mount a provisioned host; absent/false disables it |
| `ENGAGE_ENVIRONMENT` | Explicit `development`, `test`, `staging` or `production`; no fallback |
| `DATABASE_URL` | This FitCircle environment's existing server-side PostgreSQL pool |
| `ENGAGE_ADMIN_SECRET` | Dedicated random secret, at least 32 bytes; pair with this environment's admin registry entry |
| `ENGAGE_CRON_SECRET` | Separate random secret, at least 32 bytes |
| `ENGAGE_SENDS_ENABLED` | Enables Engage campaign outbound; requires ENGAGE_LEGACY_BRIDGE_ENABLED=true so native senders share consent/caps |
| `NEXT_PUBLIC_ENGAGE_ENABLED` | Build-time web feature flag; defaults off |
| `NEXT_PUBLIC_ENGAGE_ENVIRONMENT` | Must match the backend environment exactly |
| `ENGAGE_TEST_USER_IDS` | Server-only JSON array of at most 100 QA user UUIDs; defaults to none; QA accounts are excluded from production audiences |
| `ENGAGE_WEB_PUSH_PUBLIC_KEY` | Server VAPID public key; paired with this environment's private signing key when provider cutover is qualified |
| `ENGAGE_WEB_PUSH_ENCRYPTION_KEY` | Dedicated server-only 32-byte encryption secret, encoded as 64 lowercase hex characters |
| `NEXT_PUBLIC_ENGAGE_WEB_PUSH_ENABLED` | Build-time browser enrollment/worker switch; defaults off; requires an explicit matching public environment |
| `NEXT_PUBLIC_ENGAGE_QA_ENABLED` | Optional build-time switch showing the recipient enrollment/refresh/withdrawal screen; never authorizes QA access by itself |

Use authenticated POST requests to `/api/engage/cron/dispatch` and `/api/engage/cron/maintenance` from an appropriately configured scheduler. Outbound QA grants use a separate authenticated POST `/api/engage/cron/previews`, with the same worker credential. Existing Vercel GET cron entries have not been changed to call these POST routes.

## QA preview flow

Allowlist a dedicated test account on the server and enable the optional QA screen in a staging build. Sign in and register a session so the host imports its QA designation. In the admin campaign editor, create an enrollment code. The recipient enters it in “Test messages on this device” and explicitly acknowledges test delivery. Refresh the admin's device list, select that browser installation and a web-compatible message, and request a test. Use “Refresh previews” to fetch it. “Stop test messages” withdraws enrollment without signing out; logout also ends enrollment.

The server does not allow ordinary accounts to claim codes, even if the QA UI flag is enabled. Removing an account from the server allowlist blocks preview delivery through the live host policy; the next session import also clears its QA designation. Outbound previews require the shared bridge and qualified providers. Automated tests inject fake providers in disposable databases; no real recipient has been contacted.

## Browser push

The optional browser-notification panel fetches only the server's public key, then asks for permission after an explicit user action. Enrollment does not change marketing preferences. The backend stores subscriptions encrypted and binds them to this app/environment/account/installation. “Stop browser notifications” removes the server subscription and durable worker binding. A subsequent explicit enrollment creates a new nonce.

`bun run dev` and `bun run build` generate `public/engage-worker.js` from `scripts/engage-worker-entry.js` with the exact public environment. The generated bundle is ignored in Git. The existing `sw.js` imports it with browser update caching disabled and routes Engage envelopes exclusively through the verified handler; rejected/foreign envelopes cannot reach legacy text rendering. Existing legacy notifications retain their route. The page acknowledges click receipts only from its controlling worker and rechecks the current binding before queuing an open event.

Use HTTPS for browser push testing. Keep the SDK at the app root: ordinary navigation must not remove subscription ownership. Same-account page reload preserves enrollment; sign-out/account changes clear its binding and close matching displayed notifications. This does not recall a notification already handed to an OS/provider. Chrome, Firefox, Safari and an installed iOS web app still need real permission/device/provider qualification. Production outbound flags remain unchanged. The current host tests use injected providers and never send to a real browser endpoint.

## Native app integration

The isolated iOS and Android `feat/engage-v2` worktrees contain a shared-SDK snapshot plus the actual host lifecycle, dashboard, QA and notification-tap integration. They use the same `/api/engage` backend and the explicit mobile bearer verifier above. See each native worktree's `docs/ENGAGE_V2_INTEGRATION.md` for opt-in flags and validation steps.

Push registration includes the environment's stable installation UUID. Push envelopes contain app/environment, installation, expiry and a recipient digest, not the raw account ID. Foreground display and notification taps verify that binding; foreign envelopes never fall through to legacy notification routing. SDK opens are queued only after an explicit tap. Server-accepted delivery and OS display remain separate from an open receipt. An OS notification already handed off cannot be recalled reliably; logout clears local Engage state and best-effort removes delivered alerts.

## Local package snapshots

`vendor/engage/manifest.json` records the current content-addressed package tarballs. Root overrides and `bun.lock` pin those artifacts; `apps/web` declares the matching package versions. `bun install --frozen-lockfile` can install them without a private registry. No public/private package publication has occurred. Before release, publish reviewed versions and replace the snapshot dependencies with exact registry pins.

To refresh a development snapshot, build the canonical Engage repo and run its `tools/conformance/scripts/export-host-packages.mjs` with this worktree's `vendor/engage` as output. Then run `node scripts/update-engage-packages.mjs` here with Bun on PATH. The script verifies archive checksums, updates the four dependencies/overrides, discards only stale Engage lock entries, installs and removes superseded generated archives. Every unrelated package pin is preserved.

The host and engine both use Sharp 0.35.5 through a root override. This avoids loading two incompatible native libvips libraries in the same Node process. The existing food-log image contract and account-deletion suites passed (111 tests) after this alignment.

## Checks

Run from `apps/web`:

```sh
bun run type-check
bun x vitest run --config engage.vitest.config.ts
bun run build
```

Tests create/drop their own `engage_host_*` PostgreSQL databases. `ENGAGE_TEST_DATABASE_URL` points to a local PostgreSQL role permitted to create disposable databases; default is the shared Engage loopback development fixture on port 55432. Never point it at a production database role.

The host suite covers test/staging collisions, exact installation targeting, late preference changes, token ownership, account switching, consent rollback, deletion, forged admin roles, wrong-app assertions and disabled/missing configuration. Provider calls in these tests are fake.

## Outbound and release gates still open

Wire every legacy notification path through the shared durable cap authority, include pre-cutover history and complete the preference-store inventory. Wire actual domain event producers and privacy export orchestration. Configure/qualify the FCM adapter with real app credentials and devices; email, owned image storage and public unsubscribe links also need host configuration. Native real-device qualification, a second real host, browser/device acceptance, analytics retention, release versions and monitored rollout remain required. A successful host build is not authorization to enable production sends.

## Concurrent native and Engage campaigns

FitCircle continues its own emails, pushes and campaigns while Engage delivers independent campaigns. Deploy current core migrations through 008, then `119_engage_campaign_coexistence.sql`, after the earlier 116–118 host migrations. Enable `ENGAGE_LEGACY_BRIDGE_ENABLED=true` across all native workers first, import/reconcile cap history and qualify approved staging providers/devices. `ENGAGE_SENDS_ENABLED=true` can then enable Engage alongside native sending. Configuration with Engage sends enabled and the bridge disabled is rejected.

In Engage Controls, link the canonical lowercase native campaign UUID to an unpublished Engage draft. Pause this pair, drain/reconcile live native sends, then hand ownership to Engage and use its normal dry-run/launch. The database trigger rejects subsequent native claims for this linked campaign; native cron summaries count these as `skippedOwnership`. Other campaigns remain independent. Shared app/platform/channel pauses affect both bridged systems. Imported unknown history still charges caps but is not live work to drain.

All workers must have the new bridge-aware code before handover; drain older workers. Linking does not copy native content or replay historical occurrences. Return to native ownership is supported only before Engage publication. Later reverse migration requires delivery-history reconciliation; pause/resume remains available. The canonical operational guide is `~/Code/Engage/docs/ENGAGE_COEXISTENCE.md`. Nothing in this local implementation enables production delivery automatically.
