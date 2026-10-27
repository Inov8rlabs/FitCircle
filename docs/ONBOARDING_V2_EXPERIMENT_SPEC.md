# Onboarding v2 + Free Trial + Experimentation — Spec

**Status:** APPROVED 2026-10-27 (decisions in §11) · in build
**Owner:** Ani · **Platforms:** iOS + Android (parity required), backend, Admin Tools
**Related:** ACTIVATION_JOURNEY_SPEC.md (1.1.0), HOME_FEED_SPEC.md (bucketing), PROMO_CARD_SPEC.md, SUBSCRIPTION-LAUNCH-CHECKLIST.md

---

## 0. TL;DR

1. **3-day free trial for everyone** on Pro Monthly and Pro Annual, on App Store, Google Play and Stripe. It isn't part of the experiment: every paywall, in every arm, offers it.
2. **A new onboarding, "v2: tour",** that shows people what FitCircle does by having them *do* it. They pick a goal, get a personal plan, log a real meal with AI, ask Fitzy a question, start their streak and set reminders. It ends on a plan summary and a paywall framed by a transparent trial timeline.
3. **Three-arm experiment, `onboarding_v2`:**

| Arm | Onboarding | Paywall at the end | After the paywall without subscribing |
|---|---|---|---|
| `control` | today's v1 | none (existing in-app paywall moments, now with trial) | app as today |
| `tour_hard` | v2 tour | **required**: no close button | locked "Start your trial" screen until subscribed |
| `tour_soft` | v2 tour | same paywall + **"I'll do it later"** | free app; re-offered later on a schedule |

4. **Internal experimentation system,** not Amplitude Experiment:
   - Assignment happens on the backend: sticky, salted, persisted, and decided right after sign-up.
   - The arm goes to Amplitude as an exposure event plus a user property, so the funnels are charted there.
   - The authoritative results (trial starts, trial→paid, revenue) are computed in Admin Tools, joined to `subscription_events`.
   - Reasons, briefly: Experiment isn't provisioned on our Amplitude Starter plan; RevenueCat Experiments can only vary offerings, not flows; and the outcome we care about (paid conversion) lives in our database. Details in §6.1.
5. **Fix onboarding robustness for every arm first.** Android drops ~93% of users before "Onboarding Completed", because back exits and relaunch skips onboarding. iOS skips it after a kill. Otherwise the control arm is measured on a broken flow and any v2 "win" is partly just bug fixes.

---

## 1. Why

**Baseline, Amplitude prod, last 30 days to 2026-10-27:**

| | iOS | Android |
|---|---|---|
| Sign-ups | 18 | 44 |
| Onboarding Started | 18 | 44 |
| Onboarding Completed | 16 | **1** |
| Meal logged (7 days) | 7 | 0 |
| Paywall viewed | 1 | 0 |
| Purchase | 0 | 0 |

The Android step funnel: questionnaire 41 → meet_fitzy 28 → profile 14 → goals 14 → persona 13 → (assessment, not tracked: 9 reached the circle recommendations) → health **1**.

Root causes (code-confirmed):
- **Android:** onboarding has no `BackHandler` and is the only screen on the back stack, so one back gesture exits the app. Relaunch routes to Main whenever a session exists, so nobody returns to onboarding.
- **iOS:** onboarding completion isn't stored. Killing the app mid-onboarding relaunches into the tabs, and the profile, weight and goal are never saved.
- **The assessment's "Get Started" looks like the end of onboarding but isn't.** Health, check-in and the celebration still follow it.

What this tells us:
- Almost nobody **sees a paywall**: 1 in 62.
- Almost nobody **experiences the core value** (the AI meal log) during onboarding.

The v2 tour fixes both. It puts the "aha" (photo → nutrition in seconds) inside onboarding, and then asks for the trial while the value is fresh.

---

## 2. Goals, metrics and decision rule

**Primary metric:** **paid conversion per assigned user by day 10 (D10)**.
- "Paid conversion" means a trial converted to paid (first `RENEWAL` after a trial), or a direct purchase, within 10 days of assignment.
- D10 = 3-day trial + store billing retries + reporting lag.

**Secondary metrics:**
- Trial start rate per assigned user, measured at day 1. This is the leading indicator.
- Trial → paid rate.
- Revenue per assigned user at day 30, net of refunds.
- Onboarding completion rate.
- Time to first meal logged.

**Guardrails.** A guardrail failure blocks shipping even if the primary metric wins.
- D1 and D7 retention, defined as any active event.
- Meal-logging users at D7.
- Cancellation rate during the trial.
- Refund rate.
- Account-deletion rate within 7 days.
- Uninstall proxy: no activity after day 1.
- App Store and Play ratings, watched manually.

**Decision rule.** Bayesian; computed in Admin Tools (§6.6).
- Ship the arm with the highest D30 revenue per assigned user, but only if P(best) ≥ 90% **and** no guardrail is worse than control with P ≥ 90% by more than its tolerance (retention −15% relative, deletions +3 pp).
- If `tour_hard` wins revenue but fails retention, ship `tour_soft`.

**Sample size, stated honestly.** We get about **60 new sign-ups a month** across both platforms (~2/day).
- Assumptions: control converts ≈ 1–2%, and the tour arms plausibly reach 5–15% trial starts with 30–50% of trials converting.
- To separate *control vs tour* at 80% power, we need ~150–250 users per arm. At organic volume that is **7–12 months**. Too slow.

Recommendations:
1. **Weights: `control` 20 / `tour_hard` 40 / `tour_soft` 40.** Control's conversion is already near zero and known. The real open question is hard vs soft. *This needs your decision.*
2. **Point paid UA at it.** The US Apple Ads campaign brings in ~25 installs per $100; Google is at $40/day. A few weeks of spend reaches ~300 assigned users. Segment the results by `channel`, which is recorded in `user_attribution`.
3. **Read the leading indicator early.** Trial-start rate separates arms in ~2–3 weeks. Paid conversion confirms it later.
4. **Run for at least 2 full weeks**, even if one arm looks like it's winning early, to cover weekday/weekend mix and novelty effects.

---

## 3. The 3-day free trial (all users)

### 3.1 Store configuration

| Store | Products | What to set |
|---|---|---|
| App Store Connect | `com.inov8rlabs.fitcircle.pro.monthly`, `.annual` (group "FitCircle Pro") | Introductory offer → **Free → 3 days**, all territories, starting immediately. Eligibility is Apple's: once per subscription group per Apple ID. Lifetime gets no trial. |
| Google Play | base plans `monthly`, `annual` | New offer on each, e.g. `monthly-trial3d` / `annual-trial3d`: one **free trial phase, 3 days**; eligibility **"New customer acquisition — never had a subscription in this app"**. RevenueCat's `defaultOption` picks the longest free phase automatically. |
| Stripe (web) | Monthly / Annual | `STRIPE_TRIAL_DAYS=3` (Vercel prod). Checkout already supports it. |
| RevenueCat | `default` offering | No product changes. Offering metadata `paywall_headline` may be updated for trial copy. |

Notes:
- **The trial applies to every paywall in every arm,** including existing ones: AI limit, the post-aha paywall, the Pro card. That is intended ("trial for all users").
- **An intro offer replaces the "pay up front" annual intro;** they can't stack. None exists today, so nothing is lost.
- The existing iOS eligibility check (`checkTrialOrIntroDiscountEligibility`) and Android `defaultOption.pricingPhases` parsing already render "Try free for 3 days". Users who aren't eligible (they've had a trial before) see the normal CTA. **The client needs no trial-specific code** beyond the copy and timeline described below.

### 3.2 Backend trial support

**Entitlements:** `GET /api/mobile/entitlements` and `/subscriptions/sync` gain:
```json
"subscription": { "status": "trialing", "isTrial": true, "trialEndsAt": "2026-11-02T14:05:00Z", "willRenew": true, ... }
```

**Migration `112_trials_experiments.sql`** (next free number is 112; see §9) adds:
- `profiles.trial_started_at`, `trial_ends_at`, `trial_converted_at` (timestamptz, nullable).
- Written by `SubscriptionService.mapEvent` from RevenueCat events:
  - `INITIAL_PURCHASE` with `period_type=TRIAL` sets started and ends.
  - The first `RENEWAL` after a trial sets `trial_converted_at`.
  - Handle `period_type=INTRO` explicitly too. Today it is treated as a normal purchase.

**Trial reminder (trust feature):** a push 24 h before `trial_ends_at` when `will_renew = true`:
> "Your FitCircle Pro trial ends tomorrow. Keep it, or cancel anytime in Settings → Subscriptions."
- Delivered via the existing cron + push service.
- Exempt from the notification cap (transactional), and respects quiet hours by delivering at 10:00 local.
- Neither Apple nor Google sends reminders for a 3-day trial. Telling people first lowers refunds and complaints, and our paywall timeline promises it (§5.7).

**RevenueCat → Amplitude:** turn on RevenueCat's native Amplitude integration, sending to prod 746168 with `user_id` = profile UUID. Trial started / converted / cancelled / renewal / refund events then land in Amplitude with revenue. Today nothing on the server sends to Amplitude.

---

## 4. Robustness fixes (all arms, ship before the experiment starts)

| # | Platform | Fix |
|---|---|---|
| R1 | Android | System back inside onboarding goes to the previous step. On the first step it shows a "Leave setup? You can finish later" dialog that moves the task to the background, never finishing the flow. |
| R2 | both | **Server-persisted onboarding progress**:<br>• `PATCH /api/mobile/onboarding/progress {flow, step, data}` is called on every step change and is debounced. The `onboarding_progress` table already exists; add `flow` and `step` columns.<br>• On launch with a session, the app calls `GET /api/mobile/onboarding/status`. If `completed=false` and the account is under 30 days old, it **resumes onboarding at the saved step** with saved answers prefilled.<br>• Applies to v1 and v2.<br>• Older accounts (≥ 30 days) are never pushed back into onboarding. |
| R3 | both | Profile, weight and goals are saved **as each step completes**, not only at the end, so an exit loses nothing. |
| R4 | Android | Add `Onboarding Step Viewed/Completed` to the assessment sub-flow (`assessment_questions`, `circle_recommendations`, `assessment_done`). Rename its "Get Started" button to "Continue" so it no longer looks like the end. |
| R5 | both | `Onboarding Started` fires when the first real step is shown, not when the view model is created. |

These change control's behavior, so they ship and bake for at least one week **before** assignment starts. The experiment then compares the arms on a fixed baseline.

---

## 5. Onboarding v2: "the tour"

### 5.1 Principles
1. **Do, don't tell.** Every feature is introduced by having the person use it once, for real, with their own data. No carousel of screenshots.
2. **Value before the ask.** By the paywall they have a personal plan, a logged meal with real AI nutrition, a Fitzy answer, a day-1 streak and reminders set. The paywall unlocks *more* of something they've already used.
3. **Fast:** a 60–120 s target, one decision per screen, big tap targets. Choices auto-advance; text entry is avoided.
4. **Never a dead end.** Every interactive tour step has "Maybe later". Only the goal pick (one tap) is required. Optional data fields are optional.
5. **Honest.** No fabricated social proof, ratings, testimonials or "X people joined today" (see feedback: *no fake data*). Example content is labelled "Example". Prices, trial terms and renewal dates are exact.
6. **Fitzy is the guide.** One consistent voice with short lines, speaking in first person. Its avatar is the existing code-drawn `FitzyAvatar` (no new assets needed).
7. **Delight on the beat:** haptics on selection, a satisfying "plan building" moment, a celebratory streak flame and confetti on the right beats. Respect Reduce Motion.
8. **Parity:** identical steps, copy, order, analytics names and payload on iOS and Android. Native idioms are kept where expected: iOS sheets and haptics, Android back and predictive back, Material 3 dialogs.

### 5.2 Flow

```
Sign up ─► [experiment assignment] ─► arm?
   control   ─► v1 onboarding (with R1–R5 fixes)
   tour_*    ─► V2:
     1 Welcome (Fitzy)                       required (tap)
     2 Your goal                              required (1 tap)
     3 About you  (height/weight/target)      optional, skippable
     4 Your plan reveal (daily targets)       auto, "Looks good" / tweak
     5 Try it: snap your first meal           skippable ("Maybe later" → labelled example)
     6 Try it: ask Fitzy                      skippable
     7 Your streak starts today               auto beat
     8 Reminders: when should I nudge you?    skippable → notification permission in context
     9 Friends make it stick (circles)        skippable (invite / join code / later)
    10 Your plan summary                      ─► Paywall (onboarding placement)
          tour_hard: Start free trial | Restore | (⋯ Sign out / Delete account)
          tour_soft: Start free trial | Restore | "I'll do it later"
    11 Welcome to Pro / Welcome to FitCircle ─► Home (dashboard tour)
```

HealthKit / Health Connect is **not** asked in v2 onboarding. It moves to a contextual ask: the steps card on Home plus a home-feed card, at D1. A permission wall before value is a common drop-off point. (Control keeps its health step unchanged.)

### 5.3 Steps in detail

Each step lists its copy, interaction and data. `step_name` values are the analytics ids.

**1. `v2_welcome`**
- Fitzy waves in (scale and fade, haptic `.soft`).
- "Hey {firstName}! I'm Fitzy, your coach. Let's build your plan — takes about a minute."
- CTA **Let's go**. A progress bar appears at the top (10 segments, filled by step; the paywall isn't counted).

**2. `v2_goal`**
- "What's your main goal?" Four big cards with an icon, title and one line each:
  - Lose weight
  - Eat healthier
  - Build better habits
  - Get fit with friends
- Tap = select + haptic + auto-advance after 350 ms.
- Saves `primary_goal`. This drives copy and plan defaults downstream.

**3. `v2_about_you`**
- Height, current weight, target weight (target only shown for "Lose weight").
- Units are defaulted from locale (imperial for US/LR/MM), with a toggle.
- Steppers and dials; no keyboard required.
- Live, *computed-only* feedback, e.g. "Losing 6 kg at a healthy pace takes about 12 weeks." Uses 0.5 kg/week. The guardrail rejects unhealthy targets (BMI < 18.5) with a kind message.
- "Skip" → plan uses defaults.
- Saves profile height/weight and a goal row immediately (R3).

**4. `v2_plan`**
- A ~1.8 s "Building your plan…" moment with three checklist ticks appearing ("Calories", "Protein", "Daily steps"). This is real work, not a fake delay: the server computes targets meanwhile.
- Then the **plan card**: daily calories, protein g, water, steps, each with a one-line *why* ("Based on your height, weight and goal").
- Formula: Mifflin–St Jeor BMR × activity 1.35, minus 400 kcal for weight loss. Protein 1.6 g/kg target weight. Water 30 ml/kg. Steps 8k (lose) / 7k default.
- Computed server-side by `POST /api/mobile/onboarding/plan` so iOS, Android and web agree. Clients fall back to the same formula locally if offline.
- Buttons: **Looks good** / **Adjust** (an inline sheet with ± steppers). Saves as daily goals.
- If step 3 was skipped: generic targets with the line "Add your details anytime to personalise these."

**5. `v2_try_meal`: the aha**
- "Snap whatever you're eating next — or anything nearby. I'll do the math."
- **Take a photo** / **Choose from library** / **Describe it instead**. The AI consent sheet comes first, as today.
- Reuses the 1.1.0 first-meal plumbing and the new **analysis queue**. The analysis runs in the background while the tour continues to step 6.
- When ready, a small toast/card slides in: "Your meal is ready — 540 kcal, 32 g protein." Tap → review → save. If it's still analysing at the summary, the summary shows "Analysing…" and the review opens after the paywall.
- **Maybe later** → an animated, clearly labelled **"Example"** analysis of a sample plate (bundled image + fixed numbers). It shows what the feature does without claiming it's theirs.
- Events: existing `Onboarding Meal Step *` / `Onboarding Meal Logged`, with `flow=v2`.

**6. `v2_try_fitzy`**
- "Ask me anything about food or training." Three suggestion chips, personalised by goal (e.g. "High-protein breakfast ideas?", "How do I hit 8k steps?", "Is my calorie target realistic?"). There's also a text field.
- Tapping streams a **real** Fitzy answer: Fitzy v2 `/api/mobile/fitzy/chat`, Haiku, max ~80 words, onboarding system prompt, persisted to their Fitzy history.
- **Continue** appears once the stream starts. **Maybe later** skips.
- This counts as "Fitzy opened" for the journey: `profiles.fitzy_opened_at` is set, so the 1.1.0 "Meet Fitzy" sheet doesn't repeat.

**7. `v2_streak`**
- Celebration beat: the flame ignites (particles, success haptic).
- If a meal was logged in step 5: "Day 1 ✓ — your streak has started. Log once a day to keep it alive." The streak is auto-claimed server-side, as today.
- If no meal was logged: "Log your first meal today to start your streak." The flame stays unlit with an outline.
- Auto-advance after 2 s, or tap.

**8. `v2_reminders`**
- "When should I nudge you?" Four toggles: Breakfast 8:00 / Lunch 12:30 / Snack 16:00 / Dinner 19:00. Times are editable; defaults come from the 1.1.0 meal-reminder slots. Two are pre-selected (lunch, dinner).
- **Turn on reminders** → saves `MealReminderPrefs`, then the **system notification prompt** (iOS `requestAuthorization`; Android 13+ `POST_NOTIFICATIONS`). The OS prompt arrives right after the user chose to be reminded, the highest-acceptance moment.
- **Not now** → nothing is asked. The existing post-onboarding prompt logic applies later (Android 7-day re-ask).
- This replaces the unprimed post-onboarding prompt **for v2 only**.

**9. `v2_circles`**
- "People who log with friends stick with it longer." **Only shown if** backed by our own data at launch time; otherwise use "Logging is easier with friends." No uncited claims.
- Options:
  - **Invite a friend** (share link, from referrals)
  - **I have a code** (join circle)
  - **Maybe later**
- A pending invite (deep link) jumps straight to "Join {circle}?" and replaces the step.
- The post-onboarding "Build your circle" wizard is suppressed for v2 if this step was interacted with.

**10. `v2_summary`**
- "You're all set, {firstName}." A recap card that only shows real items:
  - ✓ Goal: Lose 6 kg by Feb 3
  - ✓ Daily plan: 1,850 kcal · 120 g protein
  - ✓ First meal logged (or "Ready when you are")
  - ✓ Fitzy on call
  - ✓ Reminders at 12:30 & 19:00
  - ✓ Streak: Day 1
- CTA **Continue** → paywall.
- `Onboarding Completed {flow: v2}` fires here, before the paywall, so completion is comparable across arms.

### 5.4 Paywall (placement `onboarding`)

The same paywall component, extended:
- **Header:** "Unlock your full plan"
- **What Pro adds**, personalised to the arm's goal and limited to real Pro gates:
  - Unlimited AI meal scans
  - Fitzy coach unlimited
  - Unlimited circles
  - Full history & insights
  - No ads
- **Plans:** Annual (pre-selected, "Best value · $2.50/mo") and Monthly. **Lifetime hidden in the onboarding placement** to keep a two-choice focus; still available elsewhere.
- **Trial timeline**, the trust device:
  ```
  ● Today        Full Pro access. No charge today.
  ● Day 2        We'll remind you before your trial ends.
  ● Day 3        Trial ends — $29.99/year starts. Cancel anytime before.
  ```
  Dates are rendered as real dates. Copy adapts when the user isn't eligible for the trial: no timeline, CTA "Subscribe".
- **CTA:** **Start my free trial** (eligible) / **Subscribe**.
- **Under the CTA:** "3 days free, then $29.99/year. Cancel anytime in Settings." Exact store-localised price.
- **Footer:** Restore purchases · Terms · Privacy, required by App Review 3.1.2 and Play's subscriptions policy.
- **`tour_hard`:**
  - No close button.
  - A small **⋯** menu (top right) with **Restore purchases**, **Sign out** and **Delete account**. Account deletion must stay reachable (App Review 5.1.1(v)).
  - Android back → the `moveTaskToBack` app exits to home but stays on the paywall. iOS: no swipe dismissal (`interactiveDismissDisabled`).
- **`tour_soft`:** a secondary text button, **"I'll do it later"**, below the CTA. Plain, not hidden or greyed; dark-pattern-free.
- **Purchase success:**
  - A "Welcome to Pro 🎉" celebration with confetti, showing the trial end date and "We'll remind you on {date}".
  - Then Home, then the dashboard tour.

### 5.5 `tour_hard`: locked state semantics

- **Gate:** an account with `onboarding_gate = 'subscription_required'` and no active `fitcircle_pro` entitlement sees the **Locked** screen instead of the tabs, on every launch.
- **Locked screen:**
  - The same paywall with the header "Pick up where you left off".
  - A summary of what they set up.
  - Restore · Sign out · Delete account · Contact support.
- **Subscribing or restoring removes the lock** immediately, after an entitlement refresh.
- **Lapse (trial cancelled → expired, or subscription expired):** the lock returns.
  - Data is kept. The screen says "Your data is safe — resubscribe to continue."
  - **Needs your confirmation.** The alternative is to lock only until the first purchase and degrade to free on lapse. That is softer but reduces the arm's meaning.
- **Server is the source of truth:**
  - `profiles.onboarding_gate` (`none` | `subscription_required`).
  - Set when a `tour_hard` user reaches the paywall.
  - Returned by `GET /api/mobile/entitlements` as `gate`.
  - Clients cache it per user, so offline still respects the last known gate. **Fail open** if the gate is unknown and there's no cache. Never lock someone out because of a network error.
- **Emergency release:** the Admin Tools "Release hard gate" button sets every `subscription_required` to `none` and pauses the arm (§6.5).
- **Web:** the web app reads the same gate and shows the web paywall (Stripe, with trial) on sign-in. Web is not enrolled in the experiment, but must respect the gate.

### 5.6 `tour_soft`: after "I'll do it later"

- Lands on Home with a one-time, dismissable **Pro trial card** at the top of the feed: the `pro_value` promo with an onboarding-specific creative, "Your 3-day free trial is waiting".
- **Counts as an automatic paywall** for the journey rules: sets `paywall_auto_last_at`. The post-aha paywall (`first_meal_aha`) is therefore suppressed for 72 h, and only shown once ever.
- **One re-offer, D2:** a home-feed card "Try Pro free for 3 days". **No push.** Respects promo caps.
- Existing natural paywall moments (AI limit, history limit, etc.) apply unchanged.

### 5.7 Trial trust and delight details
- Trial reminder push at D2 (§3.2). The timeline promises it, so it must be reliable. QA'd in sandbox.
- **Settings → Subscription** shows "Trial — ends {date}" with **Manage** (opens the store subscription page).
- **Pro badge:** subtle Pro sparkle on the avatar from the first day of the trial.

### 5.8 Motion, haptics, accessibility
- Transitions: horizontal push between steps on iOS (matched-geometry Fitzy avatar persists); Android shared-element Fitzy + `AnimatedContent` slide.
- Haptics:
  - selection → `.selection` / `HapticFeedbackConstants.CLOCK_TICK`
  - success beats → `.success` / `CONFIRM`
  - paywall CTA → `.medium`
- Reduce Motion / "Remove animations": cross-fades only; no confetti; flame static.
- Dynamic Type / font scale up to XXL. VoiceOver/TalkBack labels on cards and dials. Minimum 44 pt / 48 dp targets. Contrast AA.
- Strings: English v1, but all copy in string catalogs / `strings.xml` (no hard-coded text) so localisation is cheap later.

### 5.9 Debug & QA hooks
- iOS launch argument `-OnboardingV2Preview <step|paywall_hard|paywall_soft|locked>`, mirroring `-JourneyPreview`.
- Android debug activity `OnboardingV2PreviewActivity --es step <...>`.
- Both: `-ForceExperimentArm onboarding_v2=<arm>` for local builds. Server-side QA overrides are in §6.5.
- Store screenshot captures for review notes.

---

## 6. Experimentation system (internal)

### 6.1 Build vs buy

| Option | Verdict |
|---|---|
| **Amplitude Experiment** | Per amplitude.com/pricing (checked 2026-10-27), Free and Plus include unlimited feature flags and 1 active experiment, but **no A/B/n testing and no experiment results**. Those start at **Growth** (custom pricing; extra experiments are add-ons priced as a % of the plan). Our org is on the free tier (`starter_v4`, zero deployments), so a 3-arm test with results needs a Growth contract. It also needs a new SDK in both apps, and trial→paid revenue only arrives once RevenueCat→Amplitude is on. Strong analysis UI. **Not now; revisit if we move to Growth.** A free-tier hybrid is possible: an Amplitude flag with 3 variants for assignment, plus our own analysis. But the backend would still need the arm for the hard gate and the revenue joins, so most of the internal work remains. |
| **RevenueCat Experiments** | Can only vary *offerings* (prices, trial lengths, paywall). It can't change the onboarding flow. Useful later for price tests **on top of** the winning arm. |
| **PostHog flags/experiments** | SDKs are already in both apps (flags disabled) and the free tier is generous. But it's a second analytics source of truth, and person identity has to be merged. A credible fallback if the internal system slips. |
| **Internal (recommended)** | We already have salted sha256 bucketing, an arms schema and an audience matcher in the home-feed engine (`lib/home-feed/rules.ts`). Outcomes (`subscription_events`, activity) live in our database. Assignment happens post-sign-up when we have `user_id`, so there's no device-id stitching problem. Admin Tools already has the module pattern. One small system then serves onboarding, home-feed, promos and future flags. |

### 6.2 Data model (migration `112_trials_experiments.sql`)

```sql
create table experiments (
  key            text primary key,               -- 'onboarding_v2'
  name           text not null,
  description    text,
  status         text not null default 'draft'   -- draft | running | paused | concluded
                 check (status in ('draft','running','paused','concluded')),
  salt           text not null,                  -- random at creation; never reused
  arms           jsonb not null,                 -- [{key, weight, payload}] weights sum to 100
  traffic_pct    int  not null default 100,      -- % of eligible users enrolled at all
  audience       jsonb not null default '{}',    -- see 6.3
  fallback_arm   text not null,                  -- served when not enrolled / paused
  winner_arm     text,                           -- when concluded: everyone (new) gets this
  started_at     timestamptz, ended_at timestamptz,
  created_by     text, updated_at timestamptz default now()
);

create table experiment_assignments (
  experiment_key text references experiments(key),
  user_id        uuid references profiles(id) on delete cascade,
  arm            text not null,
  assigned_at    timestamptz not null default now(),
  first_exposed_at timestamptz,
  platform       text, app_version text, country text,
  reason         text not null,                  -- bucket | override | fallback
  primary key (experiment_key, user_id)
);

create table experiment_overrides (               -- QA / reviewer / employees
  experiment_key text references experiments(key),
  user_id uuid, arm text not null, note text,
  primary key (experiment_key, user_id)
);
```
- RLS: **no client access** to any of these tables, only via the API using the service role. This fixes the `feature_flags` mistake, where anyone can read the allowlists.
- Profile columns from §3.2 and §5.5 are added in the same migration:
  - `onboarding_flow text` (`v1|v2`)
  - `onboarding_gate text default 'none'`
  - the trial timestamps

### 6.3 Assignment rules
- **Bucketing:** `sha256(salt + ':' + user_id)`, first 4 bytes, mod 10000, so weights get 0.01% resolution. The helper is shared with the home feed: `lib/experiments/bucket.ts`, and `rules.ts` is refactored to import it.
- **Sticky:** the first assignment is persisted and always returned afterwards, even if weights change. Changing weights affects new users only.
- **Eligibility** (`audience`): everything is evaluated server-side from headers and profile.
  - `platforms: ['ios','android']`
  - `minAppVersion: '1.2.0'`, the first build with v2
  - `newUsersOnly: true`: profile created < 24 h ago and onboarding not completed
  - `excludeUserIds`: the reviewer demo account and complimentary-Pro users (`complimentary_grants`)
  - optional `countries`
- **Order:** override → not eligible ⇒ `fallback_arm` (not persisted) → status ≠ running ⇒ `fallback_arm` → traffic bucket → arm bucket ⇒ persist with `reason='bucket'`.
- **Concluded** experiments return `winner_arm` to new users. Existing assignments keep theirs.

### 6.4 API
- `POST /api/mobile/experiments/assign`
  - Request: `{ keys: ['onboarding_v2'] }`
  - Response: `{ assignments: { onboarding_v2: { arm, payload, enrolled } } }`
  - Idempotent. Called **immediately after sign-up / `is_new_user` social sign-in, before the first onboarding screen**.
  - The client waits ≤ 2.5 s behind the existing post-sign-up spinner. On timeout or error it uses `control` with `enrolled=false`. That user is not enrolled and is excluded from analysis.
  - The client caches `{user_id → arm}` locally so resume uses the same arm.
- `POST /api/mobile/experiments/exposure`
  - Request: `{ key, arm, surface }`
  - Sets `first_exposed_at` once.
  - The client also sends the Amplitude event.
  - Exposure = the **first onboarding screen of the arm rendered**. Analysis is per *exposed* user (intent-to-treat among exposed).
- `GET /api/mobile/entitlements` adds `gate` and `isTrial`/`trialEndsAt`.
- `GET /api/mobile/onboarding/status` adds `flow`, `step`, `data` for resume (R2).
- Admin (Bearer `ADMIN_API_SECRET` via the Admin Tools proxy):
  - `GET/POST/PATCH /api/admin/experiments`
  - `POST /api/admin/experiments/{key}/overrides`
  - `GET /api/admin/experiments/{key}/results`
  - `POST /api/admin/experiments/{key}/release-gate`

### 6.5 Admin Tools: "Experiments" module (inov8r-admin)

**List view:** status, arms and weights, enrolled/exposed per arm, started date.

**Detail view:**
- **Edit:** draft → running → paused → concluded (pick winner). Weights and traffic % (with a confirm dialog warning that it only affects new users). Audience JSON form.
- **QA overrides:** add a user by email → force arm. Used for the team and testers.
- **Emergency:** **Release hard gate** sets every `tour_hard` user's `onboarding_gate` to `none`, pauses the experiment and writes an audit row. Double confirm.
- **Results:** see §6.6.
- **Audit log** of every change (actor email from `X-Admin-Actor`).

### 6.6 Results computation (`/results`)
- Computed from the database, not from Amplitude: `experiment_assignments` ⨝ `profiles` (onboarding, trial, gate) ⨝ `subscription_events` ⨝ `payments` ⨝ activity (meals, check-ins).
- Per arm:
  - exposed n
  - onboarding completed %
  - paywall viewed %
  - trial started % (D1)
  - trial→paid %
  - paid conversion D10 %
  - revenue/user D30 (net of refunds; store share excluded)
  - D1/D7 retention
  - D7 meal-loggers %
  - trial cancellation %
  - refunds %
  - account deletions D7 %
- **Bayesian:**
  - Beta-Binomial for rates, with P(best) and P(> control) and 90% credible intervals.
  - Revenue/user via bootstrap.
- Segments: platform, channel (`user_attribution`), country.
- Users whose window hasn't elapsed are excluded per metric. The UI shows "n mature".
- Cached for 15 min.
- Links out to the Amplitude dashboard for step-level funnels.

### 6.7 Amplitude
- Tracking plan v15 (`analytics/tracking-plan.json` → codegen to all three repos):
  - **`Experiment Exposed`** `{experiment_key*, arm*, surface*}`
  - User property **`exp_onboarding_v2`** = arm. Set when exposed.
  - All `Onboarding *` events gain **`flow`** (`v1|v2`).
  - New `step_name` values `v2_*`.
  - `Paywall Viewed/Dismissed/Plan Selected`, `Purchase *` gain **`placement`** (`onboarding|locked|…`), **`is_hard`** (bool), **`trial_eligible`** (bool).
  - `Purchase Completed` gains **`is_trial`**.
  - New: `Paywall Later Tapped {placement}` (soft "I'll do it later"), `Locked Screen Viewed`, `Onboarding Resumed {flow, step}`, `Onboarding Plan Adjusted`, `Onboarding Fitzy Asked {suggestion|typed}`, `Trial Reminder Sent` (server).
- RevenueCat → Amplitude integration for trial/renewal/refund revenue events (§3.2).
- Dashboard "Onboarding v2 experiment":
  - funnel per arm (exposed → each step → summary → paywall → trial → paid)
  - step drop-off
  - time in onboarding
  - retention by `exp_onboarding_v2`

---

## 7. Client architecture

### 7.1 iOS (TCA)
- `ExperimentsClient` (dependency):
  - `assign(keys)`, `exposure(key, arm, surface)`
  - local cache in `UserDefaults` keyed by user id
- `AppFeature.enterOnboarding` / `enterSocialSession(isNewUser)`:
  - Show the existing splash/spinner, call `assign`, then build `OnboardingFeature` (v1) or the new `OnboardingV2Feature`.
  - Resume uses `onboarding/status` (R2).
- **Paywall inside onboarding:**
  - `OnboardingV2Feature` embeds `PaywallFeature` as a child step with `PaywallContext.onboarding(hard:)`.
  - This bypasses `AppFeature.showPaywall`'s `isAuthenticated` guard by being a child, not a global presentation. The `subscriptionsEnabled` kill switch is still honored: if off, the paywall step is skipped and both tour arms finish as soft.
- **Locked state:** `AppFeature` routes to `LockedView` (wraps `PaywallFeature` with `.locked` context) when `entitlements.gate == subscription_required && !isPro`. Re-evaluated on entitlement refresh and on `scenePhase` active.
- New files under `Features/OnboardingV2/`: one reducer + view per step. Shared components extracted from v1: `FitzyAvatar`, progress bar, confetti.

### 7.2 Android (Compose + Hilt)
- `ExperimentsRepository`:
  - `assign` / `exposure`
  - cache in DataStore per user
- Navigation:
  - `onboarding_v2/{step}` nested graph with its own back handling (R1).
  - The paywall is a destination inside that graph (`PaywallScreen(context = Onboarding(hard))`). For hard, `BackHandler { activity.moveTaskToBack(true) }`.
- `MainActivity` start-destination logic:
  - signed in + `onboarding/status.completed=false` + account < 30 d → resume onboarding
  - else if `gate == subscription_required && !pro` → `Locked`
  - else → `Main`
- `FeatureFlagService` stub stays as it is. Experiments are a separate, real client.

### 7.3 Shared contract
- One fixture set (`docs/fixtures/onboarding_v2/*.json`): assign response, status, plan, entitlements with gate.
- Used by BE route tests, iOS decoder tests and Android decoder tests. Same pattern as the home feed.

---

## 8. Compliance

- **App Store 3.1.1 / 3.1.2:**
  - Clear price, period, trial length and what happens after the trial on the paywall.
  - Restore available.
  - Terms (EULA) and Privacy links.
  - Hard paywalls are allowed for subscription apps.
- **5.1.1(v):** in-app account deletion is reachable from the hard paywall and locked screen.
- **App Review:**
  - The reviewer demo account is excluded (override → `control`) and already has complimentary Pro.
  - The review notes describe the onboarding experiment and the 3-day trial, and how to test v2 with a fresh account.
  - We don't hide behavior from review (2.3.1).
- **Google Play subscriptions policy:**
  - Trial terms are disclosed before purchase.
  - Cancellation instructions are given.
  - No misleading "free" without the price after.
  - Back-button handling must not trap: back exits to the launcher, not into a loop.
- **No fake social proof** (internal policy).

---

## 9. Rollout plan

| Phase | What | Ships in |
|---|---|---|
| P0 | R1–R5 robustness fixes + assessment events; tracking plan v15 (flow, placement…) | iOS/Android 1.1.1 + BE |
| P1 | **3-day trial**: ASC + Play offers, `STRIPE_TRIAL_DAYS=3`, entitlements `isTrial/trialEndsAt`, trial reminder push, RevenueCat→Amplitude | store config (no app release needed) + BE; settings trial row in 1.1.1 |
| P2 | Experiments backend: migration 112, assign/exposure/results APIs, bucket refactor; Admin Tools module | BE + inov8r-admin |
| P3 | Onboarding v2 + onboarding paywall + locked state on both platforms; preview hosts; QA overrides | iOS/Android **1.2.0** |
| P4 | QA matrix (§10), internal team on overrides for ~3 days | — |
| P5 | Start: `traffic_pct` 20% for 48 h (watch crashes, gate errors, store review) → 100% at 20/40/40 | Admin Tools |
| P6 | Read the leading indicator at 2–3 weeks; decide at maturity; conclude → winner for all new users; delete the losing code path one release later | — |

Notes:
- Migration numbering: next free is **112** (111 = releases tracker). Apply alone via `db query` + history insert, like 106/107/108. **Never `db push --include-all`** (104 is still unapplied).
- `PROMOS_ENABLED`, `FITZY_PUSH_ENABLED` and the other flags are unaffected.

---

## 10. QA matrix (both platforms)

- **Assignment:** each arm via override; timeout → control and not enrolled; reinstall mid-onboarding → same arm and resumes the step; existing user signs in → never enrolled.
- **Resume:** kill the app or press Android back at every step → relaunch resumes there with saved answers.
- **Trial:**
  - Eligible sandbox account sees the timeline. A second trial on the same Apple ID / Google account shows "Subscribe", with no timeline.
  - Sandbox accelerated renewal confirms `trialing` → `active`, sets `trial_converted_at`, and sends the reminder push.
- **Hard:**
  - No dismiss path. Back exits. Relaunch → locked.
  - Restore unlocks. Sign out and delete account work.
  - Offline with cached gate → locked. Offline with no cache → fail open.
  - Emergency release unlocks on the next entitlement refresh.
- **Soft:** "I'll do it later" → Home + card; no post-aha paywall within 72 h; D2 card once.
- **Meal in background:** analysis finishes during the Fitzy step / at the paywall / after the purchase celebration. The review appears at the right moment and nothing is lost (uses the queue from fix/foodlog-analysis-queue).
- **Accessibility:** XXL type, VoiceOver/TalkBack full pass, Reduce Motion.
- **Kill switches:** `subscriptionsEnabled=false` → tours finish without a paywall; experiment paused → new users get control.

---

## 11. Decisions (approved 2026-10-27)

1. **Experiment platform: internal.** Arm weights, traffic %, pause, QA overrides, winner and emergency gate release are all controlled from **Admin Tools → Experiments**. Changes take effect for new assignments immediately, with **no app or backend deploy** (§6.5). Existing assignments are sticky.
2. **Arm weights at launch: 20 `control` / 40 `tour_hard` / 40 `tour_soft`.** Start at `traffic_pct` 20% for 48 h, then 100%.
3. **`tour_hard` lapse: re-lock on lapse.** Data is kept.
4. **Onboarding paywall:** Annual pre-selected, Lifetime hidden.
5. **Health permission moved out of v2 onboarding:** a contextual ask from the D1 steps card.
6. **Paid UA:** ~$50/day for 3–4 weeks via the existing Apple Ads + Google campaigns once 1.2.0 is live. Results are segmented by channel.
7. **Web:** not enrolled; honors the hard gate.
8. **3-day trial for all users,** not experimented.

## 12. Out of scope (v1 of this experiment)

- Price or trial-length tests: later, via RevenueCat Experiments on the winning arm.
- Localised copy, and pre-sign-up onboarding (doing the tour before account creation). The latter is a strong future test, but needs device-id bucketing.
- ML-personalised plans; Health import inside onboarding.
