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

## Server switches (remote config, Admin Tools)

| Key | Values | Default |
|---|---|---|
| `integrity_enforce_android` | `block` (403 on failure), `log` (verify, record, allow), `off` (no checks) | `block` |
| `integrity_bypass_user_ids` | user ids allowed to sign in and stay signed in (login + refresh only) from builds that fail the check | `[]` |

## Related server rules

- Shared rate limits (IP, account, device) on auth and AI endpoints: `429 RATE_LIMIT_EXCEEDED`.
- Free food-AI lifetime allowance counts per account mailbox and per attested device.
- Referrals: inviter and invitee may not share a mailbox (canonical email) or a device. An
  invitee who claims from an `integrity_v1` client without a live attestation is held for
  review; legacy clients are not held (the mailbox, device-id and rate-limit checks apply).
