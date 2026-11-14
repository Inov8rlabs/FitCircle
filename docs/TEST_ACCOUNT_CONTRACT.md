# Test account contract (`test_account`)

The server tells the apps that the signed-in account is not a real customer, so
the app can mute its own telemetry (crash reporting, product analytics, ad
attribution, push registration). Server code:
`apps/web/app/lib/services/mobile-profile-response.ts` (`testAccountFields`).
Pinned by `app/lib/services/__tests__/mobile-user.test.ts`,
`app/api/mobile/auth/__tests__/test-account-flag.test.ts` and
`app/api/mobile/profile/__tests__/route.test.ts`.

## Why

Google Play pre-launch / review robots (OnePlus 8 Pro, Android 11, Google IPs,
generated `firstnamelastname.12345@gmail.com` accounts) no longer always set the
`firebase.test.lab` system setting, so the Android device check misses them and
they pollute Sentry, Amplitude, ad attribution and push. The backend already
classifies these accounts reliably (the Ads Console / PMF / push-audience rules),
so it now hands that verdict to the client.

## Payload

Two additive keys on every mobile **user object** (snake_case, like every other
`User` key; iOS `User` has explicit `CodingKeys` and Android `User` is decoded
with `ignoreUnknownKeys = true`, so shipped clients ignore them):

| Key | Type | Meaning |
|---|---|---|
| `test_account` | boolean, always present | `true` when the account is not a real customer |
| `test_account_kind` | string or null | why; `null` exactly when `test_account` is `false` |

Carried by:

| Endpoint | Where |
|---|---|
| `POST /api/mobile/auth/login` | `data.user` |
| `POST /api/mobile/auth/register` | `data.user` |
| `POST /api/mobile/auth/google` | `data.user` |
| `POST /api/mobile/auth/apple` | `data.user` |
| `GET /api/mobile/auth/session` | `data` |
| `GET /api/mobile/profile` | `data.user` |
| `PUT /api/mobile/profile` | `data.user` |
| everything built with `toMobileProfile` (onboarding complete, preferences) | the user object |

`POST /api/mobile/auth/refresh` returns only `{ session }` (no user) and carries
no flag: clients keep the last value they stored, and re-read it from
`/auth/session` or `/profile`.

Responses whose user is a test account also carry the header
`X-Test-Account: 1` (informational; **the payload is the contract**).

## Kinds

Same rules, in the same order, as `lib/ads/test-users.ts` `classifyTestUser`
plus `profiles.metadata.test_device` (`lib/notifications/audience.ts`
`testAccountReason`); first match wins:

| Kind | Rule | Suggested client behaviour |
|---|---|---|
| `internal` | `profiles.is_admin`, our domains (fitcircle.ai, inov8rlabs.com, …), `ADS_TEST_EMAILS` / `ADS_TEST_EMAIL_DOMAINS` | mute analytics + ad attribution only |
| `review` | App Store / Play review demo account (`fitcircle.user@gmail.com`) | mute analytics + ad attribution only |
| `test_lab` | `@cloudtestlabaccounts.com` | full mute (robot) |
| `qa` | example.com / example.org / example.net / test.com | full mute |
| `play_testers` | `^[a-z]{4,}\.\d{5}@gmail\.com$` (Play pre-launch robot accounts) | full mute (robot) |
| `mock_attribution` | Apple's mock AdServices payload (TestFlight / dev). Accepted by the serializer (`context.mockAttribution`) but **not looked up by the auth routes** (it needs a `user_attribution` query and only exists after `POST /attribution`), so in practice not sent today | full mute |
| `test_device` | `profiles.metadata.test_device` (set from a past `X-Test-Device: 1` request) or `X-Test-Device: 1` on this request | full mute (robot) |

"Full mute" = what the Android app already does on a Test Lab device: Sentry
drops events / transactions / sessions, analytics and ad attribution send
nothing, the FCM token is not registered (and is unregistered), every request
sends `X-Test-Device: 1`.

Internal and review accounts are muted for **analytics** because every analytics
cohort (Ads Console, PMF, finance) excludes them anyway. They are deliberately
**not** cut off from Sentry or push: the team tests chat / transactional push on
those accounts, and a crash during App Review must still reach Sentry. The
server already suppresses non-transactional push to every kind
(`docs/PUSH_NOTIFICATIONS.md` §8.8).

Unknown future kinds: clients treat any non-null kind other than `internal` /
`review` as a robot.

## Client rules

- Missing keys (older backend) mean `false`.
- Persist the flag per user; clear it on sign-out.
- The flag is known only after sign-in, so the pre-sign-in window relies on the
  device signal (`firebase.test.lab`).
