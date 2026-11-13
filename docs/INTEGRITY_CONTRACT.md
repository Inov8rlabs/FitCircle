# App integrity contract (Android, `integrity_v1`)

How an integrity-capable client proves a request comes from the genuine app on a
genuine device, and how the server answers. Server code: `apps/web/app/lib/integrity/`.
Pinned by `apps/web/app/lib/integrity/__tests__/contract.test.ts` (golden vectors shared
with the Android test suite).

## Who is checked

A request is checked when **both**:

- `X-App-Platform: android`, and
- `X-Client-Features` contains `integrity_v1` (comma-separated list, case-insensitive).

Every other client is "legacy": not checked here (the shared rate limits still apply).

Checked endpoints (all `POST`):

| Path | Kind |
|---|---|
| `/api/mobile/auth/register` | session-issuing |
| `/api/mobile/auth/login` | session-issuing |
| `/api/mobile/auth/google` | session-issuing |
| `/api/mobile/auth/refresh` | session-issuing |
| `/api/mobile/food/photo-parse` | protected |
| `/api/mobile/food/voice-parse` | protected |
| `/api/mobile/fitzy/chat` | protected |
| `/api/mobile/fitzy/chat/stream` | protected |
| `/api/mobile/referrals/claim` | protected |
| `/api/mobile/subscriptions/sync` | protected |

## Headers

| Header | Value |
|---|---|
| `X-Device-Id` | App-generated install id, `[A-Za-z0-9._:-]{4,128}` (a UUID). Sent on every API request. |
| `X-Integrity-Nonce` | Nonce from `GET /api/mobile/integrity/nonce`. |
| `X-Integrity-Token` | Play Integrity standard-request token whose `requestHash` is computed below. |
| `X-Integrity-Error` | Optional. Why the client has no token (e.g. `token_-6`, `nonce_unavailable`). Logged only. |

There is no `X-Integrity-Hash` header: the server recomputes the hash.

## Nonce

`GET /api/mobile/integrity/nonce` (unauthenticated; requires `X-Device-Id`).

```json
{ "success": true,
  "data": { "nonce": "…54 chars…", "expiresAt": "2026-11-07T12:02:00.000Z", "expires_at": "…", "ttl_seconds": 120 },
  "nonce": "…", "expiresAt": "…", "error": null, "meta": null }
```

- Valid for 2 minutes, bound to the `X-Device-Id` it was issued for.
- Use it for one request. Re-sending the **same** request (same device, path and body)
  with the same nonce within its lifetime is accepted, so a transport-level retry works.
  Using it for a different request is a replay.
- `400 MISSING_DEVICE_ID`, `429 RATE_LIMIT_EXCEEDED`.

## Request hash

```
canonical   = METHOD + "\n" + PATH + "\n" + BODY_SHA256 + "\n" + NONCE + "\n" + DEVICE_ID
requestHash = lowercase hex SHA-256 of the UTF-8 bytes of canonical
```

- `METHOD` upper-case.
- `PATH` the URL path only, percent-encoded exactly as sent; no scheme, host or query string.
- `BODY_SHA256` lowercase hex SHA-256 of the raw body bytes as sent (multipart included).
  No body: SHA-256 of zero bytes, `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Joined with `\n`, no trailing newline.

Golden vectors:

| Request | Nonce | Device | requestHash |
|---|---|---|---|
| `POST /api/mobile/auth/login`, body `{"email":"a@b.co","password":"x"}` (body SHA-256 `38565dbbaf56e57905d37e570b7ba60734777056b170fc82929b62a0680153ca`) | `n-123` | `00000000-0000-4000-8000-000000000001` | `c6c10179f22e1dda3fa94fa693d712486c7d3117d5bf1aee55a20da8c7ccd590` |
| `POST /api/mobile/subscriptions/sync`, no body | `n-456` | `dev-1` | `509e9da311b54760152912a187f295459949bf0282ea19bb6ef2976852dc1a66` |

## Server verification

The token is decoded with `playintegrity.googleapis.com/v1/{package}:decodeIntegrityToken`.
A pass requires all of: `requestDetails.requestHash` equals the recomputed hash, the token is
at most 2 minutes old, the request and app package are `com.inov8rlabs.apps.fitcircle`,
a signing-certificate digest matches, `appRecognitionVerdict == PLAY_RECOGNIZED`,
`deviceRecognitionVerdict` contains `MEETS_DEVICE_INTEGRITY`, and
`appLicensingVerdict == LICENSED`.

## Sessions

Mobile access tokens carry a session id (`sid`). A pass on a session-issuing call binds the
device to the new session for 24 hours (`device_attestations`). Protected calls on that
session from the same `X-Device-Id` are accepted without a new token; a client may still
send one. Session-issuing calls always need a fresh token (refresh re-attests).

## Failure response

`403`, on every checked endpoint:

```json
{ "success": false, "data": null,
  "code": "INTEGRITY_FAILED", "reason": "device_integrity",
  "message": "This device can't run FitCircle. …",
  "error": { "code": "INTEGRITY_FAILED", "message": "…", "details": { "reason": "device_integrity" }, "timestamp": "…" },
  "meta": null }
```

| reason | Meaning | Client |
|---|---|---|
| `missing_device_id` | No / malformed `X-Device-Id` | bug |
| `missing_token` | No token (also with `X-Integrity-Error`), and no live session attestation | block screen |
| `nonce_invalid` | Nonce malformed or not issued for this device | retry once with a new nonce |
| `nonce_expired` | Nonce older than 2 minutes | retry once with a new nonce |
| `nonce_replayed` | Nonce already used for a different request | retry once with a new nonce |
| `token_invalid` | Google rejected the token | block screen |
| `request_hash_mismatch` | Token not bound to this request | block screen |
| `stale_token` | Token older than 2 minutes | retry once |
| `package_mismatch`, `cert_mismatch`, `app_not_recognized` | Not the Play-distributed app | block screen |
| `device_integrity` | Emulator, rooted, or no Play services | block screen |
| `unlicensed` | Not installed from Google Play | block screen |

When verification itself is unavailable (verifier not configured, Google auth/quota/5xx,
timeout, our storage down) the request is **allowed** and the event is logged; a token that
decodes but fails any check is always refused.

### Our own bug: `503 INTEGRITY_UNAVAILABLE`

When the check breaks because of a bug in OUR code (a route read the request body before the
check, any unexpected exception inside the check), the request is refused with a retryable
503, not allowed and not a device block:

```json
{ "success": false, "data": null,
  "code": "INTEGRITY_UNAVAILABLE", "reason": "integrity_internal_error",
  "message": "We couldn't check your device just now. Please try again in a minute.",
  "error": { "code": "INTEGRITY_UNAVAILABLE", "message": "…", "details": { "reason": "integrity_internal_error", "retryable": true }, "timestamp": "…" },
  "meta": null }
```

Headers `Retry-After: 30`, `Cache-Control: no-store`. The code is deliberately not
`INTEGRITY_FAILED`, so the Android block screen is not shown. Android today: login / sign-up
show the message inline with their normal retry; a refresh 503 keeps the session (tokens
are cleared only on 401 / 403); protected calls show their generic error. The reviewer /
bypass lists still apply on login, google and refresh. Sentry: issue
`integrity internal error: <class>` (level error, tag `security=integrity_internal_error`).
Event: `block` (or `fail_open` under the emergency policy) with reason
`integrity_internal_error:<class>`.

| Cause class (`failOpenClass`) | Kind | Outcome |
|---|---|---|
| `token_exchange`, `decode_timeout`, `decode_http`, `decode_error`, `nonce_store`, `attestation_lookup` | Google / network / our DB | fail open (allow, Sentry warning) |
| `verifier_not_configured` (PLAY_INTEGRITY_SA_JSON or nonce secret missing) | deployment config | fail open, Sentry **error**. Not fail-closed on purpose: one missing env var would otherwise refuse every Android sign-in and refresh. The `integrity_broken` alert and the release check catch it. |
| `body_consumed`, `unexpected` | our code | **503**, Sentry error (`integrity_internal_error_policy`) |

## Server switches (remote config, Admin Tools)

| Key | Values | Default |
|---|---|---|
| `integrity_enforce_android` | `block` (403 on failure), `log` (verify, record, allow), `off` (no checks) | `block` |
| `integrity_bypass_user_ids` | user ids allowed to sign in and stay signed in (login + refresh only) from builds that fail the check | `[]` |
| `integrity_internal_error_policy` | `block` (our bug → 503 INTEGRITY_UNAVAILABLE), `fail_open` (allow + record, the pre-2026-11-13 behaviour). Emergency switch only; unreadable → `block` | `block` |
| `integrity_device_error_fail_open` | `true` (no token because of the phone's environment → allow + record), `false` (block) | `true` |

## Invariants (every change to an enforced route)

1. **Never consume the request body before `checkIntegrity`.** The check hashes the raw bytes
   (`request.clone().arrayBuffer()`); a body the route already read cannot be hashed. Read a
   clone (`await request.clone().json()`) if the route needs the body first, or read it after
   the check. Enforced by the static test in `lib/integrity/__tests__/enforcement.test.ts`.
2. **Programming errors fail closed.** Only genuine external / infrastructure outages fail
   open (table above). A new failure path in the check must pick its class explicitly;
   anything thrown and unclassified is `unexpected` → 503.
3. **Every enforced route has a real end-to-end verified test**:
   `<route>/__tests__/integrity-e2e.test.ts` runs the REAL `checkIntegrity` (only Google, the
   nonce store and the DB stubbed: `lib/integrity/__tests__/e2e-harness.ts`), sends a signed
   `integrity_v1` request and asserts `expectVerified` (security event `pass`, not fail_open).
   A meta-test fails when a route calls `checkIntegrity` without one. Mocking
   `checkIntegrity` in a route test is fine for route logic, never as the only coverage.

## Detection

- **Alert** `integrity_broken` (security alert cron, docs/SECURITY_TELEMETRY.md): per action
  over 24 h, ≥ 3 attempts that carried a token and 0 passes, or infrastructure fail-opens
  ≥ 50 % of attempts. Email (subject `ACTION NEEDED: app integrity verification is broken`)
  at most every 6 h, Sentry `security_alert: integrity_broken` at level error.
- **Release check** "integrity health" in `scripts/smoke/prod-smoke.mjs` (so in
  `scripts/release-preflight.sh`): each auth action (register, login, google, refresh) with
  ≥ 3 token attempts in the last 24 h has passes > 0 and infra fail-open share < 20 %;
  SKIP/WARN without data. The 24 h window means the check keeps failing for up to a day
  after a fix while the bad rows age out; read the per-action numbers in its message.

"Attempts with a token" excludes reasons `missing_token`, `missing_device_id` (also behind
`bypass:` / `reviewer:`), `device_error:*`, `attestation lookup failed` and
`nonce issuance not configured`.

## Incident 2026-11-11: auth calls silently failed open for two days

- **What**: from the 8003ed3 deploy (11 Nov) every token-bearing register / login / google /
  refresh call failed open (34 `security_events` rows `integrity / fail_open / unusable`); no
  auth call was actually verified. Protected calls (food AI, Fitzy) kept passing.
- **Why**: (1) the auth routes ran `await request.json()` before `checkIntegrity` (added after
  the existing parse); hashing then threw undici's "unusable" and (3) the catch-all treated
  that bug like a Google outage and failed open. (2) The route tests mocked `checkIntegrity`
  entirely, so the real interaction never ran. (4) The 15-minute `fail_open` alert and the
  Sentry issues fired (value 1, "elevated", every 2 h) but read like noise and nobody acted.
  (5) Nothing checked after the release that verifications actually passed.
- **Fixes**: a63d92e routes read a clone, `bodySha256` refuses a used body (`body_consumed`),
  static ordering test. 2026-11-13: programming errors fail closed (503 above,
  `integrity_internal_error_policy`), real end-to-end route tests (invariant 3), the
  `integrity_broken` alert with an explicit subject and a 6 h cooldown, the alert cooldown is
  saved only after the email was accepted (a failed send retries and is a Sentry error), and
  the release integrity-health check.
- **Runbook** when `integrity_broken` fires: check Sentry `integrity fail-open` /
  `integrity internal error` for the class, the action's `security_events.reason`, and the
  last deploy; `integrity_internal_error_policy = fail_open` only if the 503s are locking
  real users out and a fix is not minutes away.

## Related server rules

- Shared rate limits (IP, account, device) on auth and AI endpoints: `429 RATE_LIMIT_EXCEEDED`.
- Free food-AI lifetime allowance counts per account mailbox and per attested device.
- Referrals: inviter and invitee may not share a mailbox (canonical email) or a device. An
  invitee who claims from an `integrity_v1` client without a live attestation is held for
  review; legacy clients are not held (the mailbox, device-id and rate-limit checks apply).
