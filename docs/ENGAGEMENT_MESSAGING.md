# Lifecycle messaging: welcome, onboarding, re-engagement, weekly report

Status: built 2026-10-31 on `feat/lifecycle-messaging`. Everything that sends is behind env flags that default to **off**, except the welcome email (on by default, with a kill switch). Migration **119** must be applied before the crons will send.

## 1. Two kinds of email

| | Transactional (core) | Engagement (lifecycle) |
|---|---|---|
| What | Welcome, password reset, email confirmation, receipts | Weekly report, onboarding and re-engagement steps, growth nudges |
| Where | `apps/web/app/lib/email/` (`welcome-email.ts`, `brand-shell.ts`, `email-service.ts`) and `lib/services/user-created-hook.ts` | `apps/web/app/lib/engagement/` |
| Consent | Always allowed. No unsubscribe link. | Opt-out with one-click unsubscribe (`List-Unsubscribe` + `List-Unsubscribe-Post`), per stream or all |
| Future | Stays in FitCircle | Moves to Engage (§2.2) |

Password reset and confirmation emails are sent by **Supabase Auth**, not Resend (see §11).

## 2. The engagement module

```
lib/engagement/
  types.ts            content model (typed blocks), MessageKey, SkipReason, MessagePlan
  facts.ts            UserFacts shapes (WeekActivity, WeeklyReportFacts, LifecycleFacts)
  messages/
    weekly-report.ts  pure: WeeklyReportFacts → MessagePlan | skip
    lifecycle.ts      pure: steps (condition, channels, period, goal, copy) + selectLifecycleMessage
  render/email.ts     blocks → { subject, html, text } (uses lib/email/brand-shell.ts)
  render/push.ts      PushContent → NotificationOrchestrator type + data
  links.ts            deep links + UTM + msg/msg_id
  config.ts           flags, holdouts, budgets, deterministic hashing
  dispatcher.ts       holdout → consent → ledger claim → render → send → ledger → analytics
  runners.ts          weekly-report and lifecycle cron passes (adapters in, summary out)
  unsubscribe.ts      signed per-stream unsubscribe tokens
  resend-webhook.ts   Svix verification + event → ledger/analytics
  stats.ts            per message / variant aggregates
  cron.ts             shared cron request parsing (auth, dryRun, userId, max)
  adapters/           the ONLY FitCircle-specific code
    types.ts                    UserFactsProvider, ConsentProvider, EmailSender, PushSender, SendLedger, AnalyticsSink
    fitcircle-facts.ts          reads FitCircle activity tables
    fitcircle-consent.ts        profiles.preferences + privacy_settings + user_consent + referral_email_optouts
    fitcircle-attribution.ts    goal → table mapping, stamps converted_at
    resend-email.ts             EmailSender over lib/email/email-service (one Resend client)
    orchestrator-push.ts        PushSender over NotificationOrchestrator.send
    supabase-ledger.ts          SendLedger over engagement_sends
    amplitude-analytics.ts      AnalyticsSink over the Amplitude HTTP API
    index.ts                    fitCircleAdapters()
```

Message definitions are data plus pure functions: facts in, a `MessagePlan` (subject, preheader, typed blocks, push copy, variants, goal) out. The same plan renders identically in previews, dry runs and real sends.

### 2.1 Content model

Blocks: `hero`, `celebration`, `stat_grid` (tiles with label, value, delta, accent), `circle`, `goals`, `list`, `text`, `growth` (the rotating slot, with its own CTA), `cta`. The email renderer turns them into table HTML; the push renderer uses the plan's `push` (title, body, screen).

### 2.2 Moving into Engage

| Here | Engage |
|---|---|
| `adapters/types.ts` interfaces | Engage adapter contracts (ENGAGE_IMPLEMENTATION_PLAN §4.1): Facts/fields, Consent/policy, Email, Push, Analytics |
| `engagement_sends` | `engage_sends` (same idempotency idea: unique per user/message/occurrence/channel); import rows as delivery history |
| `MessagePlan.variants` + holdout | Message variants + per-campaign control group |
| `LIFECYCLE_STEPS` | First journeys (ENGAGE_V2_SPEC §9): entry condition, message steps, goal exit |
| `buildWeeklyReport` | A recurring campaign with a custom content renderer (or kept as a FitCircle-owned renderer called by Engage) |
| `render/email.ts` + `brand-shell.ts` | Engage email shell (`shell_v2`) |
| `lifecycle_nudge` push type | The `engage` NotificationType family |

To lift: re-implement `adapters/*` against Engage's API, register the step definitions as journeys, import `engagement_sends`, then turn off `ENGAGEMENT_*` / `WEEKLY_REPORT_*` here. The pure files (`messages/`, `render/`, `links.ts`, `time.ts`, `stats.ts`) move as they are.

## 3. Message catalogue

| Key | Trigger (all user-local time) | Channels | Period / cooldown | Goal (window) | Stops when | Copy variants |
|---|---|---|---|---|---|---|
| `welcome` | Account newly created (web register, web client sign-up, mobile register, first Apple / Google sign-in) | email (transactional) | `once` | `meal_logged` (48 h) | sent | 1 template; subject with/without first name |
| `onboarding_first_meal` | 20–96 h after sign-up, 0 meals ever | email only (push already covered by `meal_reminder_*` + the `first_meal` feed card) | `once` | `meal_logged` (48 h) | a meal is logged | 3 subjects (2 without a name) |
| `onboarding_first_circle` | ≥ 1 meal, in no circle, 44 h – 14 days after sign-up | email + push (`lifecycle_nudge`, screen `circles`) | `once` | `circle_joined` (48 h) | they join/create a circle | 3 subjects |
| `onboarding_invite_friend` | In a circle (active or lobby) where they're the only member, joined ≥ 24 h ago, account < 21 days | email + push (`invite_hub`) | `circle:<id>` | `invite_sent` (48 h) | someone else joins (member count > 1) | 3 subjects; circle link `fitcircle.ai/join/<code>?ref=<code>` |
| `celebrate_streak` | Streak reaches 7, 30, 100 or 365 (today or yesterday) | email only (push already covered by `milestone_achieved` / `shield_earned`) | `streak:<n>:<run start>` | `active` (48 h) | sent | 3 subjects × milestone copy |
| `reengage_comeback` | Last activity 3–6 days ago | email + push (`food_log`) | `lapse:<last active date>`; ≤ 1 per 14 days | `active` (48 h) | they log anything | 3 subjects |
| `weekly_report` | Local Sunday 18:00–21:59, once per ISO week | email (+ optional push `weekly_summary`) | ISO week, e.g. `2026-W44` | `active` (48 h); growth slot goal (7 days) | dormant 4+ weeks → skipped | 6 week types × 3 subjects; 5 growth variants |

Rules on top:

- Lifecycle emails go out 09:00–19:59 local; at most **one lifecycle message per person per run**; no two lifecycle emails within **44 h**; at most **3 engagement emails per rolling 7 days** (weekly report counts, welcome doesn't).
- Every push goes through `NotificationOrchestrator.send`: journey category toggle, daily cap (3), quiet hours, dedupe key `engagement:<key>:<period>`.
- A ledger row for a period (any status, including `holdout` / `skipped`) marks it done.
- Activity = a meal, workout, water entry, weigh-in or streak check-in. Auto-synced steps alone don't count (background Health sync would hide inactivity).

### 3.1 Existing push coverage (audited, not duplicated)

| Existing | Sender | Covers |
|---|---|---|
| `meal_reminder_breakfast/lunch/snack/dinner` | `/api/cron/meal-reminders` (MealReminderService) | "log a meal" moments, including new users who haven't logged |
| `fitzy_intro` (day 2–4), `fitzy_*` | `/api/cron/fitzy-coach` | meeting Fitzy, coaching tips |
| `momentum_at_risk`, `near_milestone` | `/api/cron/reminders` | evening streak reminder |
| `streak_lost`, `shield_applied`, `shield_earned`, `milestone_achieved` | streak crons / engagement-streak-service | streak outcomes and milestones |
| `trial_ending_reminder` | `/api/cron/trial-reminders` | trial |
| referral + circle lobby/streak pushes | `/api/cron/referrals`, `/api/cron/circles` | invite rewards, kickoff, circle streaks |
| `campaign` | `/api/cron/campaigns` | Hold the Line, Advent, … |
| `day1_nothing_logged`, `day3_circle_invite`, `day14_challenge_nudge`, `day30_monthly_recap`, `dormant_7d/14d/30d`, `win_back_60d`, `weekly_summary` | `lib/cron/notification-crons.ts` | **dead code**: nothing calls it (and it reads a non-existent `users` table). Not revived; this module replaces the day-1, day-3, dormant and weekly-summary ideas. |

New push type: `lifecycle_nudge` (journey category; title, body and screen come from data; the screen must be one of the apps' allowlisted screens, else `dashboard`). The weekly report push reuses `weekly_summary` (its template now accepts supplied copy).

## 4. Weekly report

- **When:** hourly cron; a person is in the window during local Sunday 18:00–21:59 (`profiles.timezone`, unset/UTC → America/Los_Angeles). Period = ISO week of that Sunday. Reported week = that ISO week (Mon–Sun); comparison = the week before.
- **Skip:** no activity this week or the 4 weeks before (`dormant`). Zero this week but some recently → the short **fresh start** email (hero, three easy restarts, one CTA; no stats).
- **Week type** (drives hero + subject): `best_week` (more active days than any of the previous 8 weeks, ≥ 3, needs ≥ 2 weeks of history), `comeback` (last week 0, earlier history), `consistent` (≥ 5 days), `building` (≥ 2 and not fewer than last week), `quiet`, `fresh_start`. Three subject lines each (two without a first name), picked per user + week.
- **Biggest win** (only from real data, highest score wins, else omitted): record week; streak ≥ 7; most active in a circle (≥ 2 members); meals on ≥ 5 days; more workouts; ≥ 10 % more steps; water goal on ≥ 4 days; weight moving toward the target the person set.
- **Stats** (max 6 tiles, each only when we have data for that person): active days, meals (count + days), workouts (+ minutes), average daily steps, current streak (or check-ins), water (days at goal / days logged), weight change in their unit. Deltas vs last week; a decline reads "9 last week", never red.
- **Circle:** up to 2 circles: "4 of 5 members active this week · you were #1 of 5" (aggregate only, never another member's data).
- **Next week:** 2–3 targets from their own numbers and goals: active days (+1, min 3), steps on N days (step goal) or +10 % average, meal-log days (+1), workouts (+1), water goal days.
- **Growth slot** (deterministic per user + ISO week):
  - variants: `join_campaign` (live or starting within 14 days and not joined, e.g. Hold the Line Nov 15–Dec 15, Advent Dec 1–24), `create_circle` (in no circle), `invite_friend` (has a share code and ≥ 2 active days; shows their link and the real referral reward), `try_fitzy` (never opened Fitzy, ≥ 1 meal), `try_photo` (≥ 3 meals, none by photo);
  - skipped ~1 week in 3; always skipped after two weeks in a row with a slot; never the same variant two weeks running; a relevant campaign wins when allowed.
- **Push** (`WEEKLY_REPORT_PUSH_ENABLED`): "Your week in review" / "4 days active, 9 meals logged. Your full recap is in your inbox." No health values on the lock screen.
- **Holdout:** 5 % (sticky per user) get a `holdout` ledger row and nothing else.

## 5. Send ledger (migration 119)

`public.engagement_sends`: `id, user_id, message_key, period_key, channel (email|push), status (pending|sent|failed|suppressed|skipped|holdout), variant, template_version, provider_id (Resend id), goal_key, created_at, sent_at, delivered_at, opened_at, clicked_at, bounced_at, complained_at, unsubscribed_at, converted_at, meta jsonb`, **unique (user_id, message_key, period_key, channel)**. RLS on, service role only, no functions or triggers.

- The dispatcher inserts the row (`pending`) **before** calling Resend/the orchestrator; a duplicate insert means someone already claimed it, so nothing is sent.
- Transient Resend errors (rate limit, 5xx, network) delete the claim so the next run retries; anything else marks `failed`.
- Resend idempotency key `engagement/<send id>` (welcome: `welcome/<user id>`) as a second guard.
- Account deletion: rows cascade with the profile (`on delete cascade`).

## 6. Email design

`lib/email/brand-shell.ts` (shared by transactional and engagement mail):

- App tokens (DESIGN_LANGUAGE.md §3): `bg #070A1A`, `surface-1 #11162A`, `surface-2 #1A2036`, text `#F5F7FF / #AEB6CC / #8E97AE`, brand gradient `#7C3AED → #DB2777` (CTAs and the 4 px top bar only), accents violet/orange/green/cyan. Inter with system fallbacks.
- 600 px max table layout, fluid to 320 px; stat grid 2-up, collapsing to 1-up under 350 px (where media queries are stripped it stays 2-up, which still fits at 320 px).
- Bulletproof buttons (VML `roundrect` for Outlook, solid colour behind the gradient), ≥ 48 px tall.
- `color-scheme: dark` (+ `supported-color-schemes`), preheader with padding, hosted logo `https://www.fitcircle.ai/icons/icon-96x96.png` with a gradient "F" fallback when images are off. No emoji anywhere.
- Footer: why you get it, unsubscribe links (engagement only), "FitCircle by Inov8r Labs" and `EMAIL_POSTAL_ADDRESS` when set.
- Sizes: weekly report 9–18 KB HTML (Gmail clips at 102 KB). Every email has a plain-text part.

Preview any of them for a real user (admins only, nothing sent or written):
`GET /api/admin/engagement/preview?userId=<uuid>&message=weekly_report&week=2026-W44` (`&format=json` for the plan, the push and the text part; `message=welcome` or any lifecycle key).

## 7. Links and app attribution

Every CTA: `utm_source=email`, `utm_medium=lifecycle|transactional`, `utm_campaign=<message_key>`, `utm_content=<variant>` (week type / growth variant), `utm_term=<cta id>` (`primary`, `growth`), plus:

| Param | Value | For the apps |
|---|---|---|
| `screen` | `food_log`, `circles`, `invite_hub`, `fitzy_chat`, `streaks`, `dashboard` | open that screen (same names as the push `screen` contract) |
| `msg` | message key | forward as an analytics property on the app-open event |
| `msg_id` | `engagement_sends.id` | forward too; lets us join an app open to the exact email |

App destinations are `https://fitcircle.ai/open?screen=…` (the apex `/open` path is in apple-app-site-association; without the app it falls through to `/get`, the right store). Campaign CTAs use `https://www.fitcircle.ai/c/<slug>` (App Link on both platforms). **Mobile follow-up (not built here):** iOS/Android should read `screen`, `msg`, `msg_id` and the `utm_*` params on `/open` and send them with their open event (e.g. extend `Push Notification Opened` or add `Email Link Opened`). Android has no App Link filter for `/open`; Android taps go to the Play listing ("Open") until one is added.

## 8. Analytics, delivery tracking, attribution

### 8.1 Events (tracking plan v17, server-sent, `platforms: ["web"]`)

| Event | When | Key properties |
|---|---|---|
| `Email Sent` | Resend accepted (lifecycle + welcome) | message_key, variant, period_key, template_version, medium, channel, send_id, growth_slot, week_type |
| `Email Delivered` / `Email Opened` / `Email Clicked` / `Email Bounced` / `Email Complained` | Resend webhook, first occurrence only | message_key, variant, period_key, template_version, send_id, cta (clicked), bounce_type |
| `Email Unsubscribed` | unsubscribe link or one-click | scope (weekly_report / tips / all), message_key, send_id when known |
| `Push Sent` | orchestrator delivered a lifecycle push | message_key, variant, period_key, notification_type |
| `Weekly Report Sent` | weekly report email sent | variant, period_key, week_type, growth_slot, stat_count, active_days |
| `Lifecycle Message Skipped` | a due message wasn't sent | message_key, reason (`consent, cooldown, cap, dormant, no_data, flag_off, holdout, no_email, bounced, push_suppressed, …`), channel, period_key, detail |
| `Lifecycle Goal Converted` | goal happened within the window (sent **and** holdout rows) | message_key, variant, goal, status |

Sent through `lib/analytics/amplitude-server.ts` (`AMPLITUDE_SERVER_API_KEY`, `auto` = prod/dev project), with `insert_id = <send id>:<event>` so retries count once. Skips for dormant/cap/cooldown are emitted at most once per person per window (first hour), not every hourly run.

### 8.2 Resend webhook

`POST /api/webhooks/resend` verifies the Svix signature on the raw body (`RESEND_WEBHOOK_SECRET`, 5-minute tolerance), finds the ledger row by our `send_id` tag (or the Resend email id), stamps the first `delivered/opened/clicked/bounced/complained` time and emits the event. Hard bounces and complaints set `profiles.preferences.emailSuppressed` (complaints also `marketingEmails = false`), which stops engagement email. Every send is tagged `message_key`, `period_key`, `variant`, `medium`, `send_id`. Opens are provider-observed (Apple Mail Privacy Protection pre-opens), so read open rate as directional; clicks and conversions are the real signals.

### 8.3 Outcome attribution and holdouts

The hourly lifecycle cron stamps `converted_at` (goal within 48 h of `sent_at`, or of the holdout row) and `meta.growth_converted_at` (growth-slot goal within 7 days). Goals: `meal_logged` (food entry), `circle_joined`, `invite_sent` (referral or circle invite), `active` (meal, workout or check-in), growth: invite / circle / `campaign_participants` / `fitzy_opened_at` / photo meal.

Holdouts are deterministic (`sha256(engagement-holdout:<key>:<user>)`), sticky, per message: default **weekly_report 5 %**, others 0 (`ENGAGEMENT_HOLDOUTS=weekly_report:5,reengage_comeback:10`).

`GET /api/admin/engagement/stats?days=30&by=all|hero|growth|subject` returns per message/channel/variant: sent, failed, suppressed, skipped, holdout, delivered, opened, clicked, bounced, complained, unsubscribed, converted, rates, holdout conversion and lift (percentage points). Same numbers in SQL:

```sql
select message_key, channel, variant,
  count(*) filter (where status = 'sent')                                   as sent,
  count(*) filter (where status = 'sent' and delivered_at is not null)      as delivered,
  round(100.0 * count(*) filter (where status = 'sent' and opened_at is not null)  / nullif(count(*) filter (where status = 'sent'), 0), 1) as open_rate,
  round(100.0 * count(*) filter (where status = 'sent' and clicked_at is not null) / nullif(count(*) filter (where status = 'sent'), 0), 1) as ctr,
  round(100.0 * count(*) filter (where status = 'sent' and unsubscribed_at is not null) / nullif(count(*) filter (where status = 'sent'), 0), 2) as unsub_rate,
  round(100.0 * count(*) filter (where status = 'sent' and converted_at is not null)    / nullif(count(*) filter (where status = 'sent'), 0), 1) as conversion,
  round(100.0 * count(*) filter (where status = 'holdout' and converted_at is not null) / nullif(count(*) filter (where status = 'holdout'), 0), 1) as holdout_conversion
from engagement_sends
where created_at > now() - interval '30 days'
group by 1, 2, 3 order by 1, 2, 3;
```

## 9. Flags and endpoints

| Env | Default | Effect |
|---|---|---|
| `WELCOME_EMAIL_ENABLED` | on | `false` stops the welcome email |
| `ENGAGEMENT_EMAILS_ENABLED` | off | onboarding / re-engagement emails |
| `ENGAGEMENT_PUSH_ENABLED` | off | onboarding / re-engagement pushes |
| `WEEKLY_REPORT_ENABLED` | off | weekly report email |
| `WEEKLY_REPORT_PUSH_ENABLED` | off | "your week in review" push |
| `ENGAGEMENT_MAX_PER_RUN` | 200 | per-cron-run send budget (each cron, ≤ 2000) |
| `ENGAGEMENT_HOLDOUTS` | `weekly_report:5` | control group % per message (0–50) |
| `ENGAGEMENT_DISABLED_KEYS` | – | pause individual message keys, e.g. `reengage_comeback,weekly_report` |
| `ENGAGEMENT_TEST_USER_IDS` | – | crons only consider these users (staged rollout) |
| `RESEND_WEBHOOK_SECRET` | – | Svix signing secret of the Resend webhook (webhook returns 401 without it) |
| `EMAIL_POSTAL_ADDRESS` | – | postal address in every footer (CAN-SPAM) |
| `AMPLITUDE_SERVER_API_KEY` | (existing) | `auto` = prod/dev project; unset = no server events |

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /api/cron/engagement/lifecycle` (`25 * * * *`) | `CRON_SECRET` | `?dryRun=1`, `&ignoreWindow=1`, `&now=<ISO>`, `&userId=`, `&max=`; also runs attribution |
| `GET /api/cron/engagement/weekly-report` (`45 * * * *`) | `CRON_SECRET` | same params; 503 until migration 119 is applied |
| `GET/POST /api/engagement/unsubscribe?t=&s=` | signed token | GET = confirm page (no side effects); POST = unsubscribe (RFC 8058 one-click) |
| `POST /api/webhooks/resend` | Svix signature | |
| `GET /api/admin/engagement/preview` | admin (campaigns admin gate) | renders, never sends |
| `GET /api/admin/engagement/stats` | admin | |
| `POST /api/auth/welcome` | web session cookie | web client sign-up asks for its welcome email; server re-checks the account is < 1 h old |

Unsubscribe scopes: `weekly_report` → `preferences.engagementEmails.weekly_report = false`; `tips` (onboarding/re-engagement) → `engagementEmails.tips = false`; `all` → `preferences.marketingEmails = false` (the same switch campaign emails honour).

## 10. Rollout

1. Apply migration 119 **alone**: `npx -y supabase@latest db query --linked -f supabase/migrations/119_engagement_sends.sql`, then insert `'119'` into `supabase_migrations.schema_migrations`. (118 stays reserved for Engage; never `db push --include-all`.)
2. Ops in Resend: add webhook `https://www.fitcircle.ai/api/webhooks/resend` for `email.delivered, email.opened, email.clicked, email.bounced, email.complained`; copy its signing secret to Vercel `RESEND_WEBHOOK_SECRET`; turn on open and click tracking for the `fitcircle.ai` domain.
3. Vercel env: `EMAIL_POSTAL_ADDRESS`, `AMPLITUDE_SERVER_API_KEY=auto` (if not already), keep all `*_ENABLED` flags off. Deploy; confirm the build is READY.
4. Make sure the Vercel firewall / bot protection lets through: `/api/webhooks/resend` (Resend servers), `/api/engagement/unsubscribe` (mail providers' one-click POST) and `/icons/*` (Gmail/Apple image proxies).
5. Dry runs: `curl -H "Authorization: Bearer $CRON_SECRET" "https://www.fitcircle.ai/api/cron/engagement/weekly-report?dryRun=1&ignoreWindow=1"` and the same for `/lifecycle`. Read `decisions` (who, which message, subject). Preview a few real people via `/api/admin/engagement/preview`.
6. Internal first: `ENGAGEMENT_TEST_USER_IDS=<team ids>`, then `WEEKLY_REPORT_ENABLED=true` (and/or `ENGAGEMENT_EMAILS_ENABLED=true`). Check inboxes (Gmail app, Apple Mail, Outlook), the ledger rows, the webhook stamps and Amplitude.
7. Everyone: remove `ENGAGEMENT_TEST_USER_IDS`. Turn pushes on last (`ENGAGEMENT_PUSH_ENABLED`, `WEEKLY_REPORT_PUSH_ENABLED`) after a week of email data. Watch `/api/admin/engagement/stats` (unsubscribe rate, lift vs holdout).
8. Mobile: regenerate tracking-plan constants in the iOS and Android repos (`node analytics/codegen.mjs`) at their next release (the new events are server-only, so nothing breaks before), and pick up `msg`/`msg_id` on `/open` (§7).

## 11. Audit findings (2026-10-31)

- **Welcome email** existed only in `/api/auth/register` (web). That route is **not used by the web app** (it signs up client-side with `supabase.auth.signUp`), and none of the mobile paths sent it, so effectively nobody got a welcome email. Now: `triggerUserCreated` from `/api/auth/register`, `/api/mobile/auth/register`, first-time `/api/mobile/auth/apple` and `/google` (`isNewUser`), and the web client calls `POST /api/auth/welcome` after a successful sign-up. Idempotent via the ledger; fire-and-forget after the response.
- **Email confirmation is off** in production (all 121 auth users are confirmed and none has `confirmation_sent_at`), so no confirmation emails are sent. `/api/mobile/auth/resend-confirmation` redirects to `/auth/callback`, which doesn't exist in the web app; harmless while confirmations are off, but must be built before turning confirmation on.
- **Password reset** (`/api/mobile/auth/forgot-password` and the web store) uses Supabase Auth's mailer (`recovery_sent_at` is set on 2 users, most recently 2026-10-31). Whether Supabase uses a custom SMTP (Resend) or the built-in mailer, its sender, rate limit and template, and whether `${NEXT_PUBLIC_APP_URL}/auth/reset-password` is in the Auth redirect allow-list, can only be checked in the Supabase dashboard (not verified). The built-in mailer only delivers to project team members and is heavily rate-limited, so custom SMTP is required for real users.
- **Apple "Hide my email" users** (`@privaterelay.appleid.com`): mail to them is only delivered if the sending domain/address (`fitcircle.ai`, `team@fitcircle.ai`) is registered in Apple Developer → Sign in with Apple → Email Communication. Not verified.
