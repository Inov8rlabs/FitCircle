# Security telemetry

Where security decisions are recorded, how alerts fire, and the Admin Tools API.
Server code: `apps/web/app/lib/security/`. Table: `public.security_events` (migration 132).

## security_events

One row per decision. Never stored: integrity tokens, full IP addresses (only a /24 or /48
prefix), email addresses (login failures carry `account_hash` = sha256 of the canonical,
lower-cased mailbox).

| kind | result | written when |
|---|---|---|
| `integrity` | `pass` / `block` / `log_only` / `fail_open` / `bypass` | every integrity check that verified a token (live-attestation passes are not logged) |
| `rate_limit` | `limited` | a shared rate limit refused a request; one row per (ip prefix, route, limiter, minute) with `count` |
| `signup` | `pass` | an account was created (email, Google, Apple); input for the sign-up concentration signal |
| `signup_block` | `block` | sign-up refused (`disposable_email`, `integrity_<reason>`) |
| `login_failure` | `rejected` | password login failed (`invalid_credentials`, `email_not_confirmed`) |
| `referral_rejection` | `rejected` / `log_only` | referral refused or rejected (`same_mailbox`, `device_matches_inviter`, `device_reused`, `disposable_email`); `log_only` = held for review (`device_not_attested`) |
| `free_ai_device_limit` | `block` | a free food-AI analysis refused because another account on the same attested device (`device`) or mailbox (`mailbox`) used the allowance |
| `nonce_replay` | `block` / `log_only` | an integrity nonce was reused for a different request |

Columns: `created_at, kind, route, action, result, reason, platform, app_version, app_build,
user_id, device_id, account_hash, ip_prefix, asn, country, integrity_error, verdict, count,
dedupe_key`. `asn` comes from `x-vercel-ip-as-number` when the edge sends it (else null);
`country` from `x-vercel-ip-country`.

## Sentry

| Signal | Name | Details |
|---|---|---|
| Structured log | `security.<kind>` | `warn` for block / log_only / fail_open / limited / rejected / bypass; `info` for passes (10 % sample). Attributes: `kind, route, action, platform, app_version, result, reason, asn, country, ip_prefix, integrity_error` |
| Metric (counter) | `security.event` | attributes `kind, result, reason, platform` |
| Issue | `integrity fail-open: <class>` | `captureException`, level warning, tags `security=fail_open`, `fail_open_reason=<class>`, `integrity_action`; fingerprint `['security-fail-open', <class>]`. Classes: `verifier_not_configured, token_exchange, decode_timeout, decode_http, nonce_store, attestation_lookup, unexpected` |
| Issue | `security_alert: <signal>` | `captureMessage`, level warning, tags `security_alert=<signal>`, `severity=elevated\|attack`; fingerprint `['security_alert', <signal>]` |
| Cron monitor | `security-alert-cron` | `withMonitor`, crontab `*/15 * * * *` UTC, margin 5 min, max runtime 5 min |

## Amplitude (server-side, HTTP V2)

Sent with `AMPLITUDE_SERVER_API_KEY` (`auto` = production/dev project by deployment), keyed by
user id, else the install device id, else `fitcircle-server`. Never IPs or emails.
Defined in `analytics/tracking-plan.json` (category `security`, platform `server`).

- `Integrity Checked` {action, result, reason?, platform?}: session-issuing calls only
- `Integrity Blocked` {action, reason, platform?}
- `Signup Blocked` {reason, platform?}
- `Referral Rejected` {reason}
- `Free AI Device Limit Hit` {limit, used}
- `Security Summary` (hourly, from the alert cron): window counts + `attack_status`

## Alerts

`GET /api/cron/security/alerts` every 15 minutes (CRON_SECRET bearer; `?dryRun=1` evaluates
without sending). Thresholds ("alert when value > threshold"); a signal is `under_attack`
above 3x its threshold (block rate: above 30 %; fail-open: above 50 in 15 min):

| signal | measure | threshold |
|---|---|---|
| `failed_logins` | last hour: all accounts / one account hash / one IP prefix | 50 / 10 / 20 |
| `signup_concentration` | sign-ups in the last hour from one ASN / one IP prefix | 5 / 5 |
| `integrity_block_rate` | blocks ÷ integrity attempts, last hour, with ≥ 20 attempts | 10 % |
| `fail_open` | integrity fail-opens in the last 15 minutes | 0 |
| `rate_limit_hits` | rate-limit hits in the last hour | 500 |
| `referral_rejections` | rejected referrals in the last 24 hours | 5 |

Attack status: `under_attack` if any signal is, `elevated` if any signal fires, else `normal`.
Each alert carries the 7-day average of its measure as context.

Delivery per firing signal: email to `SECURITY_ALERT_RECIPIENTS` (comma list; default the
`ADS_REPORT_RECIPIENTS` list) and the Sentry message above. Cooldown: one alert per signal per
2 hours (`security_alert_state`); an escalation from elevated to under_attack alerts again.

## Admin API

Auth: same as the other Admin Tools APIs (`Authorization: Bearer <ADMIN_API_SECRET>`, optional
`X-Admin-Actor`, or an `is_admin` session). All `GET`, `Cache-Control: no-store`, envelope
`{ success, data, error, meta }`. Shapes below are `data`. Window rows are capped at 50 000
(`truncated: true` when the cap was hit).

### `GET /api/admin/security/summary`

```ts
{
  generatedAt: string;
  windows: { '24h': Tiles; '7d': Tiles };
  status: { level: 'normal' | 'elevated' | 'under_attack'; signals: Signal[]; evaluatedAt: string };
  enforcement: { integrityEnforceAndroid: 'block' | 'log' | 'off' | null; source: 'admin' | 'code'; updatedAt: string | null; updatedBy: string | null; ruleName?: string };
  truncated: boolean;
}
Tiles = { integrityAttempts, integrityPasses, integrityPassRate /* 0..1 | null */, integrityBlocks, failOpens,
          rateLimitHits, failedLogins, signupBlocks, referralRejections, freeAiDeviceLimitHits }   // numbers
Signal = { signal: 'failed_logins' | 'signup_concentration' | 'integrity_block_rate' | 'fail_open' | 'rate_limit_hits' | 'referral_rejections';
           level: 'elevated' | 'under_attack'; value: number; threshold: number; detail: string | null }
```

`integrityBlocks` includes `log_only` failures (would have been blocked).

### `GET /api/admin/security/timeseries?days=7`

`days` 1..7 (default 7). Hours without events are omitted.

```ts
{ start: string; end: string; bucket: 'hour'; points: { hour: string; counts: { [kind]: number } }[]; truncated: boolean }
```

### `GET /api/admin/security/offenders?window=24h|7d&limit=10`

Adverse rows only (block, log_only, rejected, limited, nonce replays). `limit` 1..100.

```ts
{ window: '24h' | '7d'; asn: Row[]; ipPrefix: Row[]; country: Row[]; deviceId: Row[]; truncated: boolean }
Row = { key: string; label?: string /* asn: "AS <n>" */; count: number; lastSeen: string | null; kinds: { [kind]: number } }
```

### `GET /api/admin/security/failed-logins?window=24h|7d&limit=20`

```ts
{ window: '24h' | '7d'; rows: { accountHash: string; count: number; lastSeen: string | null; distinctIpPrefixes: number }[]; truncated: boolean }
```

### `GET /api/admin/security/events?limit=50&before=<iso>&kind=&result=&platform=`

Newest first; `limit` 1..200; page with `before = nextBefore`.

```ts
{ events: { id, createdAt, kind, route, platform, appVersion, result, reason, integrityError,
            deviceId, userId, ipPrefix, asn, country, count }[];
  nextBefore: string | null }
```

Errors: `400 VALIDATION_ERROR` (bad window / limit / before), `401`/`403` from the admin gate.
