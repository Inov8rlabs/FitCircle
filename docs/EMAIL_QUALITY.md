# Email quality: invite validation, welcome email, bounces and complaints

Status: built 2026-11-04 on `feat/email-quality`. Not deployed. Migration 127 is written but **not applied**.

Three parts:

| | What | Main code |
|---|---|---|
| A | Typed invite addresses are validated before anything is sent (typos, real TLD, MX) | `lib/validation/email-address.ts`, `lib/email/invite-email-check.ts` |
| B | One welcome email on every first-time sign-up | `lib/services/welcome-email-service.ts`, `lib/email/welcome-email.ts`, `lib/email/brand-shell.ts` |
| C | Resend webhook: hard bounces and complaints suppress the address for every future send | `app/api/webhooks/resend/route.ts`, `lib/email/resend-webhook.ts`, `lib/email/suppression.ts` |

All paths are relative to `apps/web/app/` unless they start with `supabase/` or `docs/`.

## One sender

Every FitCircle email now goes through `sendEmail` in `lib/email/email-service.ts`. Before this change, the referral, campaign and notification paths each built their own Resend client. `sendEmail`:

1. drops recipients on the suppression list (§C). If none are left, it returns `{ success: false, errorName: 'suppressed' }` and sends nothing;
2. tags the message with `category` (`welcome`, `circle_invite`, `referral_invite`, `referral_reminder`, `referral_reward`, `campaign`, `onboarding_nudge`, `notification`, `ads_report`). Resend's dashboard and the webhook log use this tag to tell the streams apart;
3. supports `fromName` (`Maya via FitCircle <team@fitcircle.ai>`), headers, a Resend idempotency key and extra tags;
4. never throws.

| Sender | Path | Category |
|---|---|---|
| Welcome | `services/welcome-email-service.ts` | `welcome` |
| Circle invite (web) | `api/fitcircles/[id]/invite` → `sendInvitationEmail` | `circle_invite` |
| Referral invite, reminder, reward | `services/referral-invite-service.ts` `sendReferralEmail` | `referral_*` |
| Campaign emails | `services/campaign-delivery-service.ts` `sendCampaignEmail` | `campaign` |
| Onboarding "finish setting up" | `services/onboarding-nudge-service.ts` | `onboarding_nudge` |
| Generic notification email (no callers today) | `services/notification-service.ts` | `notification` |
| Twice-daily ads report (internal) | `ads/services/email-report-service.ts` | `ads_report` |
| Pro lifecycle | push only; it sends no email (checked) | – |
| Password reset, email confirmation | **Supabase Auth**, through its SMTP settings (Resend SMTP). Not sent by our code, so `sendEmail` doesn't gate them. Resend still reports their bounces and complaints to the webhook, which suppresses those addresses for our own mail. | – |

`lib/email/templates.tsx` no longer has the old welcome template. `scripts/test-welcome-email.js` was removed. `scripts/test-welcome-email.ts` now renders the email (`--out <dir>`), or sends a `[Test]` copy to your own inbox (`--send you@… "Name"`).

## Brand in email

Every email uses the real FitCircle mark: the app icon plus the live "FitCircle" wordmark. That is the same pairing the website's `<Logo>` uses (`components/ui/logo.tsx`). Neither the apps nor the site have a wordmark image, so the email doesn't either.

**Logo asset**
- Source: `public/brand/fitcircle-icon-512.png`, the app icon copied from the iOS AppIcon set (`FitCircle-iOS/FitCircle/Assets.xcassets/AppIcon.appiconset`).
- Email file: `public/email/fitcircle-icon-40@2x.png`, 80×80, built by `node apps/web/scripts/build-email-assets.mjs`. It has rounded-square corners baked in (transparent outside), so it looks the same in Outlook, which ignores border-radius.
- Served from: `https://www.fitcircle.ai/email/fitcircle-icon-40@2x.png`. Static PNGs are outside the auth middleware matcher. **It only resolves after deploy.**

**How it's placed** (`emailBrandHeader()` in `lib/email/brand-shell.ts`)
- `<img>` with fixed `width=40 height=40`, `alt="FitCircle logo"`.
- The background colour is `#070C2E`, the icon's own navy, so with images blocked you see the alt text on a dark square.
- Next to it is the live text "FitCircle": 20 px, weight 700, tracking −0.5 px, in the Inter/system stack.

**Colours**
- App tokens: page `#070A1A`, card `#11162A`, tiles `#1A2036`, border `#232A44`.
- The brand gradient `#7C3AED → #DB2777` is used only on the CTA button, per DESIGN_LANGUAGE §3.
- The old gradient header bands and the invented white-circle italic "f" are gone.

**Every template now uses the shared shell:**
- welcome (app and web versions);
- circle invite and generic notification (`templates.tsx`, rewritten; user values are now escaped);
- referral invite, reminder and reward (`referral-emails.ts`);
- campaign emails (`campaign-emails.ts`);
- onboarding nudges, which go through `campaignEmail`.

The internal ads report (`ads/email-report.ts`) keeps its white data layout and gets the same icon and wordmark in dark text.

`lib/email/__tests__/brand.test.ts` enforces this. It renders every template and asserts the hosted logo `<img>` (URL, size, alt) and the wordmark are present, and that there is no `<svg`, no Georgia/italic, no lone "f"/"F" glyph and no old icon path. It also checks the PNG is 80×80 and scans the email sources for drawn logos.

### Mobile layout

These rules live in `brand-shell.ts` and apply to every template:
- **Padding.** At 480 px or less, a media query cuts the outer padding to 6 px and the card padding to 22 px (18 px at 360 px or less). That gives a text measure of about 332 px at 390 px.
- **Fallback.** Where `<style>` is stripped, the base padding (8 px outer, 28 px card) still leaves about 316 px at 390 px.
- **Primary button.** It goes full width on phones. It is bulletproof (VML for Outlook) and at least 52 px tall.
- **Secondary button** (`emailButtonSecondary`). It is a solid `#1A2036` fill with a `#4C3A8F` border, 44 px or more tall, and full width on phones.
- **Type.** Body text uses a 1.45 line height. The mobile H1 is 24/30.
- **Colours.** Every colour is set explicitly (`bgcolor` plus inline styles) and `color-scheme: dark`, so dark-mode clients don't invert the palette.

**Welcome email.** One primary CTA (Open FitCircle, or Go to FitCircle on web), then three flat step rows separated by dividers, with no nested cards. Each row has:
- a purple number badge on the title line (`emailStepBadge`);
- a 17–18 px semibold title;
- one or two lines of 15 px body text;
- a secondary button.

### Dark mode

**The bug (2026-11-04).** In Gmail iOS dark mode, Gmail "fully inverted" the password-reset email:
- the page and card turned light and the headline turned dark;
- the white button label became dark on the (uninverted) purple gradient.

**The fix** (`brand-shell.ts`, applies to every `emailShell` email):

1. **Locked backgrounds.** Every dark surface (page, card, tiles, secondary buttons, step badges, info boxes) carries `background-image: linear-gradient(c,c)` next to `background-color` (`solidBg`). Gmail doesn't invert background images. The `bgcolor` attributes stay for Outlook.
2. **Protected text.** Every text run is wrapped in Gmail's blend spans (`gmailText`): `u + .body .fc-gs {background:#000; mix-blend-mode:screen}` around `u + .body .fc-gd {background:#000; mix-blend-mode:difference}`. `protectTextForGmail()` wraps all p, h1–h3 and button labels automatically. Td text (wordmark, step titles, badges, info boxes, footer) is wrapped explicitly. The selector only matches inside Gmail, and where Gmail doesn't invert, the two blends cancel out.
3. **Neutral text colours.** The blend trick restores neutral greys and white faithfully but can shift saturated hues, so text is white or grey only. Brand colour stays in the locked surfaces (buttons, badges, gradients). The pink eyebrow and the coloured tile values are now neutral, and links are white and underlined.
4. **Borders.** Borders can't be locked, so:
   - the card's 1px frame is a padded cell with a locked background;
   - dividers are locked 1px rows;
   - other hairlines (`.fc-line`, the invite tiles) are dropped in Gmail rather than flipped to white.
5. **Colour scheme and Outlook.com.** The `color-scheme` and `supported-color-schemes` meta and `:root` are set to `light dark`, so Apple Mail and iOS Mail never auto-invert. Outlook.com gets `[data-ogsb]` and `[data-ogsc]` overrides for the page, card, surface-2, button labels, h1, wordmark and paragraphs.
6. **Ads report.** It is a white layout, so Gmail's normal inversion keeps it readable; it is not protected. Its solid purple button is now an outlined button (`#5B21B6` text with a `#6D28D9` border), which stays readable whether or not it's inverted.

**Contrast.** White on the button gradient is 4.60:1 to 5.71:1 across the whole button (about 5.5:1 behind the centred label). Secondary buttons are 15:1.

**Not verified in real clients.** Gmail Android, Outlook Windows/Mac/iOS dark mode and Outlook.com were not checked; that needs Litmus, Email on Acid or real devices. Outlook Windows' VML buttons can't take the blend trick.

**Simulation.** `gmail-dark-before-*.png` and `gmail-dark-after-*.png` in `email-shots/` are a **simulation**, not real Gmail:
- the HSL lightness of every background and text colour is inverted, background images are left alone, and Gmail's `<u></u><div class="body">` wrapper is added;
- it reproduces the owner's report exactly ("before");
- it can't prove how Gmail's exact algorithm treats saturated colours.

**Tests.** `lib/email/__tests__/brand.test.ts` checks every template for:
- the `light dark` meta and the Gmail blend and Outlook.com rules;
- every dark inline background locked with its gradient;
- the primary button gradient locked and its label protected;
- no visible text outside a protected run, and no border hairlines;
- no saturated text colours.

### Supabase Auth templates

The repo has no Supabase Auth templates: `[auth.email.template.*]` is commented out in `supabase/config.toml`. They are managed only in the Supabase dashboard. I didn't read or change them there; the dashboard needs owner access.

Branded, paste-ready versions are generated into `supabase/templates/` by `npx tsx apps/web/scripts/render-auth-email-templates.ts`, from `lib/email/auth-templates.ts`. Subjects are listed in `supabase/templates/subjects.txt`.

**Owner steps.** In the Supabase dashboard, go to the project → Authentication → Emails → Templates. For each template below, paste the HTML from the file and set the subject from `subjects.txt`:

| Template | File | Subject |
|---|---|---|
| Confirm signup | `confirmation.html` | "Confirm your FitCircle email" |
| Reset Password | `recovery.html` | "Reset your FitCircle password" |
| Magic Link | `magic_link.html` | "Your FitCircle sign-in link" |
| Change Email Address | `email_change.html` | "Confirm your new FitCircle email" |
| Invite user | `invite.html` | "You're invited to FitCircle" |
| Reauthentication | `reauthentication.html` | "Your FitCircle verification code" |

The templates keep Supabase's own variables: `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}`, `{{ .NewEmail }}`.

Before pasting, deploy so the logo URL resolves. Then send yourself a password reset to check the result.

## A. Invite email validation

The full contract is in `docs/INVITE_EMAIL_VALIDATION.md`. In summary:

- **Validator**: format, the bundled IANA TLD list (`email-tlds.generated.ts`, refreshed with `scripts/refresh-email-tlds.mjs`) and provider-typo suggestions. The shared test vectors are in `lib/validation/__fixtures__/email-cases.json`; copy them into the iOS and Android tests.
- **MX check** (server only): MX first, then A/AAAA as an implicit MX. Each lookup has a 1.5 s timeout, and definitive verdicts are cached for 6 h per instance. The check fails open, and **a timeout is never a reason to block**: if any lookup the verdict depends on timed out or errored, the address passes and the verdict isn't cached. Kill switch: `INVITE_EMAIL_MX_CHECK=off` (also accepts `false` or `0`).
- **All-or-nothing 422 `INVALID_EMAIL`** with `{ index, email, reason, suggestion? }` per address:
  - `POST /api/mobile/referrals/invites` and `POST /api/referrals/me/invites` return it in the standard envelope, in both `data.invalidEmails` and `error.details.invalidEmails`;
  - `POST /api/fitcircles/[id]/invite` (web share dialog) returns the legacy shape `{ error: 'INVALID_EMAIL', message, invalidEmails }`.
- **Reminders** (`nudgeInvite`) skip stored addresses that now fail validation, or are suppressed, and give the reminder slot back.
- **Web forms**: `InviteByContactForm`, `ShareFitCircleDialog` and `CircleCreationWizard` validate on blur, show "Did you mean …?" and map server 422 indexes back to fields.
- **Analytics**: tracking plan **v28** adds `Invite Email Rejected` and `Invite Email Suggestion Accepted`. The web file was regenerated. The iOS and Android generated files are in `/Users/ani/Code/FitCircle/email-analytics/` for the app agents.
- **Shipped apps**: iOS reads only `error.code` and `error.message` (`MobileAPIError`). Android throws `HttpException` on any non-2xx. Both show their generic failure copy and keep the contacts. `api/mobile/referrals/__tests__/invalid-email-shipped-client-compat.test.ts` replays the real route through ports of both decoders.
- **Auto-join invite links** (e011199): the invite emails still link to `/join/<code>` and `/i/<code>`, which now auto-join. Validation runs before any invite row or email exists, so it doesn't interact with joining.

## B. Welcome email

**When.** Only where an account was just created:

| Path | Trigger |
|---|---|
| `POST /api/auth/register` (web, server-side) | always (the route creates the account) |
| Web client sign-up (`stores/auth-store.ts` → `supabase.auth.signUp`) | the store calls **`POST /api/auth/welcome`** with the session cookie and a Supabase bearer token. The server re-checks that the account is less than 1 h old. |
| `POST /api/mobile/auth/register` | always |
| `POST /api/mobile/auth/apple`, `/google` | only when `findOrCreateSocialUser` returns `isNewUser` |

**Exactly once.** Before calling Resend, the send is claimed in `profiles.metadata.welcome_email` with a conditional update (`… where metadata->welcome_email is null`). A retried request, a double tap, or a web sign-up followed by a mobile sign-in can't send twice. Resend's idempotency key `welcome/<user id>` is a second guard. No migration is needed.

```json
"welcome_email": { "status": "sent|failed|skipped|suppressed|sending", "claimed_at": "…", "sent_at": "…",
                   "provider_id": "re_…", "reason": "…", "method": "email|apple|google",
                   "platform": "web|ios|android|null", "template": "welcome@4" }
```

**Never sent to:**
- Play pre-launch and Firebase Test Lab robots (`X-Test-Device: 1` on the sign-up request, or `metadata.test_device`);
- the App Review demo account;
- QA domains (`example.com`, `test.com`, …) and Google's generated Play tester addresses.

These use the same classifier as the ads console and onboarding nudges (`ads/test-users.ts`). Internal team addresses do get the email, so we can QA it.

**After the response.** Sending runs through `runAfterResponse`. On a transient Resend error (rate limit, 5xx, network) it retries once after 2 s with the same idempotency key. A permanent failure is recorded as `failed` and never retried. Every outcome is logged as `[welcome-email] {"outcome":…}`. Nothing fails the sign-up.

**Content** (`lib/email/welcome-email.ts`, dark brand shell `brand-shell.ts`, no emoji, plain-text part, about 12 KB HTML):
1. Log your first meal: photo or text, with calories and macros estimated.
2. Join or start a circle: invite link or code, shared check-ins and a group streak.
3. Meet Fitzy, the coach in the app.

Links depend on the sign-up platform:
- **App sign-ups**: `https://fitcircle.ai/open?utm_…`. The iOS app opens it as a universal link. Elsewhere it goes to `/get`, which sends phones to the store listing (Play shows "Open" when the app is installed).
- **Web sign-ups**: `www.fitcircle.ai/food-log` and `/fitcircles`. Fitzy, and a "get the app" line, link to `/get`.

All links carry `utm_source=email&utm_medium=transactional&utm_campaign=welcome&utm_content=<step>`.

> Limitation: neither app routes `/open?screen=…` to a specific screen today, so the links open the app's home screen rather than the food log. The copy says "Open FitCircle" and "Log a meal" and doesn't promise a screen.

**Classification: transactional / relationship.** The email confirms the account the person just created:
- It is sent even if marketing email is off, because a brand-new account can't have opted out.
- It still carries a working **one-click unsubscribe** for our marketing mail: the `List-Unsubscribe` and `List-Unsubscribe-Post` headers plus a footer link. Both point to `/api/campaigns/unsubscribe?t=…`, which sets `profiles.preferences.marketingEmails = false`. Campaign emails and onboarding nudges honour this flag.
- It is never sent to a suppressed address.

The footer includes `EMAIL_POSTAL_ADDRESS` when that variable is set (CAN-SPAM).

Screenshots and HTML for every email are in `/Users/ani/Code/FitCircle/email-shots/`, as `<email>-desktop.png`, `-mobile.png` and `-mobile-images-off.png`, plus `welcome-app-mobile-light.png`.

## C. Resend webhook: bounces and complaints

The Resend account (team inov8rlabs) also sends mail for other apps, and Resend webhooks are account-wide. The handler ignores any event whose `from` is not `fitcircle.ai` or a subdomain (`reason: 'other_sender'`), so another app's bounces never land on FitCircle's suppression list.

`POST /api/webhooks/resend`:
- **Signature**: Svix, verified on the raw body with `RESEND_WEBHOOK_SECRET` (`whsec_…`). It accepts multiple `v1,` signatures (secret rotation), allows a 5-minute timestamp window (replay protection) and compares in constant time. A wrong or stale signature gets **401**. A missing secret gets **503**, which makes Resend retry.
- **`email.bounced`** with `bounce.type = Permanent`: every `to` address is added to `email_suppressions` with reason `hard_bounce`. Transient and undetermined bounces are only logged.
- **`email.complained`**: the address is suppressed with reason `complaint`. A complaint outranks a bounce and is never downgraded.
- **`email.delivered`, `opened`, `clicked`, `sent`, `delivery_delayed`, `failed`**: one structured log line each, `[email-event] {type, category, template, email_id, domains, bounce_type?, link?}`. These are the cheap engagement metrics, queryable in Vercel logs. Logs carry domains only, never addresses; click links are reduced to host and path.
- **Duplicate `svix-id`** on the same instance: acknowledged without re-processing. Writes are idempotent anyway.
- **Suppression write fails** (e.g. migration 127 not applied): **500**, so Resend retries later.
- **`RESEND_WEBHOOK_ENABLED=false`**: the event is verified and acknowledged with 200, then ignored.

**Storage**: `public.email_suppressions` (migration `supabase/migrations/127_email_suppressions.sql`, **not applied**):
- keyed by `email_hash`, the salted sha256 of the lower-cased address. It's the same hash as `referral_invites.contact_hash`, so no plaintext is stored for non-members;
- other columns: `reason`, `domain`, `source`, `first_event_at` / `last_event_at`, `event_count`, `last_provider_email_id` and `detail`;
- RLS is on with no policies (service role only). There are no functions or triggers.

A new table was needed for three reasons:
- invitees aren't users, so `profiles.preferences` can't hold their suppression;
- `referral_email_optouts` means "unsubscribed from friends' invites", and reusing it would also block that person's own welcome email after they sign up;
- we need the reason, to tell a complaint from a bounce.

**Fail-open.** Until 127 is applied:
- the suppression check returns "not suppressed" and logs loudly, at most once a minute per instance:
  `[email-suppression] … table public.email_suppressions is MISSING — apply supabase/migrations/127_email_suppressions.sql. Sending WITHOUT …`
- the webhook answers 500 to bounce and complaint events (Resend retries for about a day), and 200 to engagement events.

To lift a suppression (for example, a user who fixed their mailbox):
```sql
-- hash = sha256('<REFERRAL_DEVICE_SALT>:email:<lower-cased address>')
delete from public.email_suppressions where email_hash = encode(sha256(convert_to('<salt>:email:someone@example.com', 'UTF8')), 'hex');
```

## Config

| Env (Vercel) | Default | Effect |
|---|---|---|
| `WELCOME_EMAIL_ENABLED` | on | `false` / `off` / `0` stops the welcome email |
| `INVITE_EMAIL_MX_CHECK` | on | `off` skips the DNS check (format, TLD and typo rules still apply) |
| `RESEND_WEBHOOK_ENABLED` | on | `false` makes the webhook verify, acknowledge and ignore events |
| `RESEND_WEBHOOK_SECRET` | – | Svix signing secret from Resend (**sensitive**). The webhook returns 503 until it is set. |
| `EMAIL_POSTAL_ADDRESS` | – | postal address in the welcome footer (CAN-SPAM); recommended |
| `RESEND_API_KEY` | (existing) | unchanged |
| `REFERRAL_DEVICE_SALT` | (existing) | salt of the address hash; **never change it** (it would orphan opt-outs and suppressions) |

## Owner steps to ship

1. **Review and merge** `feat/email-quality`. Nothing is committed yet.
2. **Apply migration 127 alone.** Never use `db push --include-all`:
   ```
   cd FitCircleBE
   npx -y supabase@latest db query --linked -f supabase/migrations/127_email_suppressions.sql
   npx -y supabase@latest db query --linked "insert into supabase_migrations.schema_migrations(version, name) values ('127','email_suppressions')"
   node scripts/db-contract/refresh-snapshot.mjs   # then drop 'email_suppressions' from PENDING_RELATIONS in __tests__/unit/db-contract.test.ts
   ```
   126 belongs to the unapplied `FitCircleBE-adrevenue` branch. If that lands first, nothing collides.
3. **Register the webhook in Resend**:
   1. Open https://resend.com/webhooks and choose **Add Webhook**.
   2. Endpoint URL: `https://www.fitcircle.ai/api/webhooks/resend`. Use the `www` host, the canonical one; a webhook POST may not survive a redirect from the apex.
   3. Events: `email.bounced`, `email.complained` (required), plus `email.delivered`, `email.opened`, `email.clicked`, `email.delivery_delayed` (engagement logs).
   4. Save, open the webhook and copy its **Signing Secret** (`whsec_…`).
   5. Add it to Vercel → fitcircle project → Settings → Environment Variables as **`RESEND_WEBHOOK_SECRET`**, type **Sensitive**, Production (and Preview if you test there). Pipe it from the clipboard; don't paste it into a terminal that logs.
   6. Optional: Resend → Domains → fitcircle.ai → enable open and click tracking for the opened/clicked events.

   Resend also exposes webhooks over its API, which the newer SDK calls `resend.webhooks.create({ endpoint, events })`. That needs a full-access API key, and the installed `resend@^4` SDK may predate it. It was **not** used.
4. Check that the Vercel firewall and bot protection let Resend POST to `/api/webhooks/resend`.
5. Optional: set `EMAIL_POSTAL_ADDRESS`.
6. **Deploy**, confirm the build is READY, then:
   - in Resend → Webhooks, use "Send test event" and confirm a 200 response and an `[email-event]` line in the Vercel logs;
   - sign up a fresh test account with your own address: one welcome email arrives, and `profiles.metadata.welcome_email.status = 'sent'`;
   - sign in again: no second email.
7. **Apple "Hide my email"**: welcome email to `@privaterelay.appleid.com` addresses is delivered only if `team@fitcircle.ai` and `fitcircle.ai` are registered under Apple Developer → Sign in with Apple → Email Communication. Otherwise Apple bounces it, and the webhook then suppresses that relay address.
8. **App agents**: drop the generated files from `FitCircle/email-analytics/` in at the apps' next release, and use the shared fixtures for the iOS and Android validators (branches `FitCircle-iOS-emailval`, `Fitcircle-Android-emailval`).

## Tests

- `api/__tests__/signup-welcome-email.test.ts`: every sign-up path through the real routes. Covers one email, nothing on a returning sign-in, web then mobile duplicates, robots and test accounts, provider errors and throws, the kill switch, and `/api/auth/welcome` with new, repeat, old and unauthenticated accounts.
- `lib/services/__tests__/welcome-email-service.test.ts`: claim, concurrent claim, transient retry, permanent failure, suppressed, missing profile, skip rules, links and content.
- `lib/email/__tests__/suppression.test.ts`: hashing, reason ranking, fail-open with a missing table, and suppression enforced in every sender (circle invite, referral invite / reminder / reward, campaign, notification, onboarding nudge, ads report, welcome).
- `lib/email/__tests__/resend-webhook.test.ts`: valid, invalid and rotated signatures, replay window, duplicate delivery, each event type, missing secret (503), kill switch, and a failed write returning 500 then succeeding on retry.
- `lib/email/__tests__/invite-email-check.test.ts`: DNS rules, including "MX timeout never blocks" and "inconclusive verdicts are not cached".
- `lib/validation/__tests__/email-address.test.ts`: shared fixtures.
- `api/mobile/referrals/__tests__/invalid-email-shipped-client-compat.test.ts`: the 422 shape as decoded by shipped iOS and Android.
- `api/fitcircles/[id]/invite/__tests__/route.test.ts`, `lib/services/__tests__/referral-invites.test.ts`, `lib/referrals/__tests__/invite-form.test.ts`, `api/mobile/referrals/__tests__/referral-routes.test.ts`: the 422 response, normalisation, opt-outs and suppression.
