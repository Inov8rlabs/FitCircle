# Privacy compliance: backend contract

Status: implemented on branch `release/backend-trialfirst-compliance`, 2026-11-06. Not deployed. Migrations 130 and 131 are written, not applied.
Source: the compliance audit of 2026-11-06 (findings F3, F4, F5, F6, F8, F9, F10, F11, F15, F17, F25, section 7).
Clients: iOS and Android build against §3–§5. The website already uses this contract.

Everything here is **additive** for shipped clients, with one deliberate exception: under-18 dates of birth are now refused (§5).

## 1. Summary

| Area | What the server does now |
|---|---|
| Consent records | Append-only `user_consents` rows for `health_data`, `ai_processing` and `marketing_email`. `GET`/`POST /api/mobile/consents` (apps) and `/api/consents` (web). |
| AI gating | Every AI path checks `ai_processing` on the server. Missing consent returns 403 `AI_CONSENT_REQUIRED`. Shipped apps keep working through a compatibility rule (§4). |
| Health data | Record only. Exposed in `GET` so clients can gate onboarding. |
| Age | 18+ wherever a date of birth, birth year or age is accepted. Otherwise 400 `AGE_REQUIREMENT`. |
| Export | Includes all of the user's data (102 tables, signed photo links). Free for everyone. |
| Deletion | Also deletes the user at Amplitude, RevenueCat and Stripe. Resend and Sentry are covered as described in §9. Fail-soft with retries. |
| Email | Marketing and lifecycle email needs `EMAIL_POSTAL_ADDRESS` plus an unsubscribe, or it is not sent. |
| Web | Consent UI and an 18+ sign-up gate. |
| EU/EEA | No new accounts (web, mobile register, first Google/Apple sign-in) and no checkout from EU/EEA IPs: `WEB_EU_SIGNUP_BLOCK`, **default on** (§7). |
| AI providers | Zero data retention on every AI Gateway call (`AI_GATEWAY_ZDR`, default on); live-probed on every model in use (§4.5). |

## 2. Storage: migration `130_user_consents.sql` (written, NOT applied)

`user_consents` has these columns:
- `id` uuid pk
- `user_id` → `profiles` (on delete cascade)
- `consent_type` (`health_data` | `ai_processing` | `marketing_email`)
- `granted` bool
- `policy_version` text (1–40)
- `source` (`ios` | `android` | `web` | `server`)
- `app_version` text, nullable
- `granted_at` timestamptz
- `created_at` timestamptz

**Access:** RLS is on with no policies, and anon/authenticated are revoked, so only the service role can read or write. There are no functions or triggers.

**Append-only:** a withdrawal is a new row with `granted=false`. The current state per type is the newest row by (`granted_at`, `created_at`).

**Apply order:** apply 130 **before** deploying this release. Until 130 exists:
- `GET` returns all nulls.
- `POST` returns 503 `CONSENT_STORE_UNAVAILABLE`.
- Clients that declare `consents_v1` (the website) get 403 on AI.
- Server-initiated AI falls back to the hotfix evidence rule.

## 3. Consents API

Both `/api/mobile/consents` (Bearer) and `/api/consents` (web session cookie or Bearer) use the standard envelope and `Cache-Control: no-store`.

### `GET`
```json
{ "success": true, "error": null, "meta": null,
  "data": {
    "consents": {
      "health_data":     null,
      "ai_processing":   { "granted": true, "policyVersion": "2026-11", "grantedAt": "2026-06-01T10:00:00.000Z",
                           "recordedAt": "2026-11-06T18:00:00.000Z", "source": "ios", "appVersion": "1.1.3" },
      "marketing_email": null },
    "effective": { "marketingEmail": true },
    "currentPolicyVersion": "2026-11" } }
```
- **`null`:** never recorded.
- **`effective.marketingEmail`:** what the user actually gets today when there is no record. Marketing email is opt-out today: it follows `profiles.preferences.marketingEmails`, and absent means on.

### `POST`
```json
{ "consents": [ { "type": "ai_processing", "granted": true, "policyVersion": "ios-ai-1", "grantedAt": "2026-06-01T10:00:00Z" } ] }
```

**Body rules:**
- 1 to 10 items.
- `type` must be one of the three types.
- `granted` is a boolean.
- `policyVersion` is the version of the consent copy the user saw (1–40 characters).
- `grantedAt` is optional, ISO-8601 with an offset.

**`grantedAt`:** use it **only** to migrate an existing on-device consent with its original time. The server clamps it to [max(2025-01-01, account creation), now]. Without it, the decision time is now.

**Recorded with each row:**
- `source` comes from `X-App-Platform` (or `X-Platform`): `ios` or `android`; anything else is `web`.
- `app_version` comes from `X-App-Version`.

**Response:** the same shape as `GET`.

**Errors:**
- 401 `UNAUTHORIZED`
- 400 `VALIDATION_ERROR` (with `error.details.issues`)
- 503 `CONSENT_STORE_UNAVAILABLE`

**Side effects:**
- `marketing_email` is mirrored into `profiles.preferences.marketingEmails`, which every marketing sender honours.
- Withdrawing `ai_processing` deletes the user's cached AI daily-focus rows (`fitzy_daily`).

### Client flow (iOS and Android)

1. **On launch, after sign-in:**
   - `GET /api/mobile/consents`.
   - If the device holds an AI consent but `ai_processing` is null, `POST` it once with `grantedAt` set to the on-device timestamp (migration).
2. **Every request:** send `X-Client-Features: …,consents_v1` once the build handles 403 `AI_CONSENT_REQUIRED` and syncs consents.
3. **AI consent sheet:**
   - "Allow" → POST `{type:'ai_processing', granted:true}`.
   - Withdrawing in Settings → POST `granted:false`.
4. **Health-data screen:** shown before the first health question in onboarding. On accept, POST `{type:'health_data', granted:true}`. Existing users see a one-time re-consent sheet when `health_data` is null.
5. **Marketing toggle (optional):** POST `marketing_email`. Show `effective.marketingEmail` when there is no record.

## 4. AI consent gating

### 4.1 The rule (`ConsentService.decideAi`, `lib/services/consent-service.ts`)

1. **A server record decides when one exists.** `granted` → allowed. **Withdrawn → refused**, whatever the client or chat history.
2. **No record, user-initiated request:**
   - The client declares `X-Client-Features: consents_v1` → **403 `AI_CONSENT_REQUIRED`**.
   - The client does not declare it (shipped apps) → allowed, because those apps gate AI on their on-device consent. Logged as `[ai-consent] legacy_client {userId, feature, platform, appVersion}`.
   - Exception: **Pro "Plan my week"** (`POST /fitzy/plan`). Shipped apps never prompted for consent there, so old clients get rule 3 instead of a pass.
3. **No record, server-initiated** (daily focus, free plan teaser, plan warm-up, Fitzy push copy) → allowed only with the hotfix evidence (dd7badf, `lib/fitzy/ai-consent.ts`): the user has a `fitzy_conversations` row.
   - **Fails closed:** if the consent store can't be read (any error other than a missing table), no server-initiated AI runs.

`lib/fitzy/ai-consent.ts` (`hasAiConsentEvidence`, `usersWithAiConsentEvidence`) is the single entry point for server-initiated checks. It now delegates to this rule: a record OR the evidence, and a withdrawal wins.

**Web:** the website sends `consents_v1`, so web chat never creates conversation rows without a record. Once a record exists, conversation evidence is ignored.

### 4.2 Where it is enforced

| Path | Initiator | Without consent |
|---|---|---|
| `POST /api/mobile/fitzy/chat` | user | 403 (checked after the trial-first quota gate, before anything is recorded) |
| `POST /api/mobile/fitzy/chat/stream` | user | single `event: error` frame `{code:'AI_CONSENT_REQUIRED', message, details}` (HTTP 200, as for every stream error) |
| `POST /api/mobile/fitzy/plan` | user | 403; old clients use the evidence rule |
| `GET /api/mobile/fitzy/plan` (free teaser) | server | static default commitments, no model call (hotfix) |
| `GET /api/mobile/fitzy/today` | server | static welcome focus, not cached, no model call (hotfix) |
| Fitzy memory extraction | runs inside the chat turn | covered by chat |
| `POST /api/mobile/nutrition-coach` | user | 403 (after the quota gate) |
| `POST /api/mobile/food/photo-parse` (includes Fix / re-analyze) | user | 403. The photo is still saved (Option B) unless `skip_fallback_save`: `details.savedEntryId` |
| `POST /api/mobile/food/voice-parse` (voice and `source:'text'` describe) | user | 403. The note is still saved (Option B): `details.savedEntryId` |
| `POST /api/mobile/food/estimate-item` | user | 403 |
| `POST /api/mobile/body-comp/photo-parse` | user | 403 (after the Pro gate) |
| `POST /api/mobile/food/training-sample` | user | 204 no-op (the same "stop sending" signal) |
| Training draft capture (`captureDraft` / `reconcileEntry`) | after a parse | only after a parse that passed the gate |
| Plan warm-up after onboarding / feed | server | skipped |
| Fitzy push AI copy (cron) | server | template copy |

### 4.3 Error envelope

HTTP 403:
```json
{ "success": false, "data": null, "meta": null,
  "error": { "code": "AI_CONSENT_REQUIRED",
    "message": "To use AI features, allow FitCircle to send your data to our AI providers. You can turn this on in Settings > Privacy.",
    "details": { "consentType": "ai_processing", "feature": "food_photo", "policyVersion": "2026-11",
                 "savedEntryId": "…(photo/voice parse only, when the meal was saved)" },
    "timestamp": "…" } }
```

`feature` is one of `food_photo`, `food_voice`, `food_text`, `food_estimate`, `fitzy_chat`, `fitzy_plan`, `nutrition_coach`, `body_comp_scan`.

**Client handling:** show the AI consent sheet. On Allow, POST the consent and retry.

### 4.4 Client feature flag

`X-Client-Features: consents_v1` is a comma list. It joins the existing tokens (`icon_keys`, `promo_style@1`, `reactions_v2`, …).

Send it only from builds that:
- sync consents (§3), and
- handle `AI_CONSENT_REQUIRED` everywhere AI is called, including `fitzy/plan` (Plan my week) and body-comp scan.

### 4.5 Zero data retention at AI providers

**What:** every AI Gateway call sends `providerOptions.gateway.zeroDataRetention: true`. The gateway then routes only to provider endpoints with a zero-data-retention agreement, and fails rather than falling back to one without. The helper is `lib/ai/gateway-options.ts`.

**Covered calls:**
- food photo / voice / text / estimate-item, including the grounding picker,
- Fitzy chat, stream, plan, focus, memory and META recovery,
- the nutrition coach,
- body-comp scan,
- embeddings.

**Switch:** `AI_GATEWAY_ZDR`, default on. Only an explicit `false` / `0` / `off` / `no` disables it, as an emergency switch.

**Live probe** (`apps/web/scripts/ai-zdr-probe.ts`, 2026-11-06): all models in use passed with ZDR on.

| Model | Calls passed | Routed via |
|---|---|---|
| `google/gemini-3.8-flash` | text, vision, structured | Vertex |
| `anthropic/claude-haiku-5.5` | text, vision, structured | Anthropic |
| `anthropic/claude-sonnet-5.5` | text | Anthropic |
| `anthropic/claude-sonnet-4.6` | text, vision | Anthropic |
| `anthropic/claude-haiku-4.5` | text, vision | Anthropic |
| `google/gemini-3-flash` | text | Vertex |
| `openai/text-embedding-3-small` | embed | — |

The probe also exercised the real Fitzy `generateWithFallback` call builder (thinking off + ZDR).

## 5. Age: 18+

**Message** (neutral, gives no hint about the cut-off): `FitCircle is only available to people aged 18 and over.`

**Response:** HTTP 400.
```json
{ "success": false, "data": null, "meta": null,
  "error": { "code": "AGE_REQUIREMENT", "message": "FitCircle is only available to people aged 18 and over.",
             "details": { "field": "birthYear", "minimumAge": 18 }, "timestamp": "…" } }
```

**Enforced on:**
- `PATCH /api/mobile/onboarding/progress` (`birthYear`, `dateOfBirth`)
- `POST /api/mobile/onboarding/plan` (`age`, `birthYear`, `dateOfBirth`)
- `POST /api/mobile/onboarding/complete` (an under-18 date is refused; a malformed one is still ignored)
- `POST /api/mobile/profile/completion` (`birth_year`)
- `PUT /api/mobile/profile` (`dateOfBirth`)
- `PUT /api/mobile/profile/settings` (`date_of_birth`)
- `POST /api/auth/register` (optional `birthYear`)

**How age is computed:**
- A birth year alone uses this calendar year's age. 18 this year passes.
- Under 13 gets the same `AGE_REQUIREMENT` answer, never a "13–100" range message.

**Existing accounts:** in profile updates, an **unchanged echo** of the stored date is not re-checked, so an account created before the gate can still edit other fields. (The under-18 accounts found by the audit were deleted on 2026-11-06.)

**Web:**
- The sign-up form has a neutral "Year of birth" picker (no hint), stored in auth metadata as `birth_year`.
- Web onboarding saves the date of birth through `PUT /api/mobile/profile`, not directly.

**Migration `131_profiles_dob_server_only.sql`** (written, NOT applied) revokes `authenticated` INSERT/UPDATE on `profiles.date_of_birth`, so PostgREST can't bypass the check. Apply it **after** this web release is live.

**Clients:** set `MIN_AGE = 18` in onboarding pickers. Treat `AGE_REQUIREMENT` as final and show the message.

## 6. Email compliance

`lib/email/compliance.ts`, enforced in `sendEmail`. Marketing and lifecycle categories are `welcome`, `campaign`, `onboarding_nudge`, `referral_invite` and `referral_reminder`. Each must have:
1. `EMAIL_POSTAL_ADDRESS` set, with the address present in the HTML. The shared brand shell renders it automatically, and plain-text parts include it.
2. A `List-Unsubscribe: <https://…>` header (every sender also puts an unsubscribe link in the footer).

**If either is missing:**
- The email is **not sent**: `errorName: 'compliance_blocked'`, logged as `[email-compliance] <category>: not sent (<reason>)`.
- Onboarding nudges retry on a later run.
- The welcome email for that sign-up is skipped.

**Exempt:** transactional streams (Supabase auth, `notification`, `referral_reward`, `circle_invite`, `ads_report`). The footer now reads "FitCircle by Inov8r Labs Inc." plus the address when it is set.

**Set `EMAIL_POSTAL_ADDRESS` in Vercel production before deploying**, or welcome, campaign and nudge emails stop.

## 7. Website

- **Consent UI:**
  - Settings → Privacy → "Consents": Health data, AI features, and Tips and updates by email.
  - The AI consent dialog appears before the first web Fitzy send, photo log, voice log or body-comp scan, and again after any 403.
  - Web onboarding has an unticked health-data checkbox before the health questions, recorded as `health_data`.
- **18+ gate:** see §5.
- **EU/EEA restriction:** `WEB_EU_SIGNUP_BLOCK`, **default ON** (owner decision 2026-11-06). Only an explicit `false` / `0` / `off` / `no` reopens it.
  - Countries: EU-27, IS, LI, NO and CH, by `x-vercel-ip-country`. Unknown country (no header) is not restricted.
  - `/register` and `/upgrade` redirect to `/not-available?reason=signup|checkout`.
  - These answer 403 `REGION_NOT_AVAILABLE`:
    - `POST /api/billing/checkout`
    - `POST /api/auth/register`
    - `POST /api/mobile/auth/register`
    - a **first** Google or Apple sign-in via `POST /api/mobile/auth/google|apple`
  - **Existing accounts still sign in (email and social), export and delete.** Since 2026-11-06 the UK (GB + GG/JE/IM) is restricted too: the owner removed the UK from the App Store and Google Play instead of appointing a UK Art. 27 representative (0 UK users at the time).
  - The website has no Google/Apple sign-in; social sign-in exists only in the apps' auth routes.
  - **Residual:** the web form calls Supabase `auth.signUp` from the browser, so a caller using the public anon key directly can skip `/register`.
  - Reopening plan: `docs/EU_COMPLIANCE_PLAN.md`.
- **Legal pages:** this release ships the CURRENT live Privacy Policy (v1.2) and Terms unchanged, plus `/privacy-choices` and `/not-available`, which contain no placeholders.
  - Privacy Policy v1.3, the Consumer Health Data Privacy Policy, the French versions and the Terms update (Inov8r Labs Inc., a British Columbia corporation, BC1310005) are held in a separate patch until the owner fills the remaining placeholders: the street address and the named contacts (the UK representative is no longer needed while the UK is not offered).

## 8. Privacy by default

`lib/privacy/defaults.ts` (`PRIVACY_DEFAULTS`) is the single switch for users who never chose. The values are **unchanged**:

| Setting | Default today | Read by |
|---|---|---|
| Share new meals with circles | **off** (private by default since ee9722c, 2026-11-04) | `food-entry-privacy.shareMealsByDefault`, `mobile-profile-response` |
| Profile visibility | `public` | `UserService`, `circles/member-progress`, `mobile-profile-response`, `settings/preferences`, `preference-service` |
| Show weight / show progress | on / on | same |

To flip one, change the constant and deploy. Users who already chose keep their value.

Separately, the web onboarding form pre-selects `friends` (`app/onboarding/page.tsx`).

## 9. Export and deletion

**Export:** `GET /api/mobile/privacy/export` and `/api/privacy/export`.
- New in the response: `exportVersion: 2`, `generatedAt`, `signedUrlExpiresAt`, `tables` (`{name: rowCount}`), `manifest` (`rowCap`, `truncated[]`, `errors[]`, `signedUrls`) and `data` (every table).
- Photos are 1-hour signed URLs.
- Each table is capped at 50k rows.
- Rate limit: 5 an hour per user (per instance).
- Legacy keys are unchanged.
- No Pro gate.

**Deletion:** after the auth user is deleted, the server deletes the user at:
- Amplitude: the User Privacy API (needs `AMPLITUDE_SECRET_KEY`).
- RevenueCat: v2 customer delete.
- Stripe: `customers.del`. Stripe keeps invoices and charges for tax law.
- Resend: contacts, only if `RESEND_AUDIENCE_IDS` is set; the suppression hash is kept.
- Sentry: 90-day retention, no call.

`subscription_events.raw` identifiers are hashed. Each vendor gets up to 3 attempts. The result is added to the delete response as `processors`.
