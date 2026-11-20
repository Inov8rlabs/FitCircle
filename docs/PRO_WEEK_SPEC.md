# Pro Week: 7 days of Pro for every new user, no card (Bet 1)

Status: APPROVED by founder 2026-11-17. Target release 1.1.6. Draft spec; §9 lists open decisions.

## 1. Why

30-day data (2026-11-17): most users finish onboarding, look at Home and leave. Almost nobody reaches
what Pro unlocks (meal scans, Fitzy), so in-app paywalls barely show (about 20 views a week vs 77 at
onboarding). Store trials have been 0 since Nov 8; 7 of 8 people who open the store sheet back out.
Opt-in trials ask for a card before anyone has experienced Pro. A no-card Pro week lets every new user
use Pro first and asks for money at the end, with proof of what they'd lose.

## 2. What the user experiences

| When | What |
|---|---|
| End of onboarding | "Your Pro week starts now: 7 days free, no card." A dismissible screen (not a paywall) listing unlimited scans, Fitzy coach and insights. |
| Days 1–4 | Full Pro. Home shows a small "Pro week · 5 days left" chip; tapping it lists what Pro is doing for them. |
| Day 5 | Recap card + push: "Your Pro week so far: 9 meals logged, Fitzy planned your week, 4-day streak." CTA "Keep Pro". |
| Day 6 | Reminder push: "Pro week ends tomorrow." |
| Day 7 (end) | Drops to free. The next open shows the "Keep Pro" paywall with what they used (closable). |
| After | Normal free limits. Win-back ladder unchanged. |

## 3. Who gets it

- Every new account created on or after launch, on any platform, including invited users.
- Not: accounts that ever had a store trial or purchase, review/test accounts (they're Pro or excluded
  anyway), or a second account on the same device (integrity device id; one Pro week per device).
- Existing free users: not in v1. Possible later as a win-back ("a Pro week on us") once v1 is measured.

## 4. Mechanism (backend)

- Built on `ComplimentaryGrantService`: a grant with `note = 'pro_week'`, `granted_by = 'system:pro_week'`,
  `expires_at = signup + 7 days` (local end of day 7). The profile is pinned to premium while it's active,
  and every downgrade path already respects grants. A store purchase overrides it as today.
- Granted when onboarding completes (server-side, idempotent; one grant per user and per device).
- Expiry: the existing reconcile cron or a new `/api/cron/pro-week` (hourly) ends expired grants, sets
  the profile back to free, and records `pro_week_ended`.
- AI cost guard: during the Pro week, meal scans are capped at 15/day and Fitzy at 30 messages/day
  (remote-config keys `pro_week_scan_daily_cap`, `pro_week_fitzy_daily_cap`). Paid Pro is unchanged.
- Remote config `pro_week` (on/off, default off until launch) and `pro_week_days` (int, default 7).
- API: `GET /api/mobile/paywall/config` and the profile payload gain
  `proWeek: { active, endsAt, daysLeft, recap? }` (additive; old clients ignore it and simply see Pro).
- Recap: counts from existing tables (meals saved, Fitzy messages, streak, scans used).

## 5. Clients (1.1.6)

- The onboarding end screen replaces the onboarding paywall for users with an active Pro week.
- Home chip, day-5 recap card, end-of-week "Keep Pro" paywall (closable) with a recap header.
- The paywall offers the normal plans. See §9 for whether the store trial is still offered on top.
- Pushes: `pro_week_recap` (day 5) and `pro_week_ending` (day 6), both habit-type (audience rules apply).
- Old clients (≤1.1.5) just see a Pro account that later ends; they get no chip or recap.

## 6. Analytics

New events: Pro Week Started, Pro Week Recap Viewed, Pro Week Ended, Keep Pro Tapped (source).
Metric: paid conversions within 14 days of sign-up per sign-up, vs the pre-launch baseline and the
forced-trial test result. Guardrails: D7 retention, AI cost per new user, refund rate.

## 7. Rollout and test

- Running it against the 1.1.5 forced-trial test at the same time would split ~9 sign-ups/day three
  ways. Order: forced-trial test runs 2 weeks on 1.1.5, then Pro week ships in 1.1.6 as an
  `onboarding_paywall` arm vs the winner (50/50, 3–4 weeks).
- Kill switch: `pro_week = off` stops new grants. Existing ones run to their end.

## 8. App Store / Play notes

- Free access with no purchase is allowed; the wording must not say "free trial" (that implies a store
  subscription). Use "Pro week, on us" / "7 days of Pro free, no card".
- The end-of-week paywall needs price, renewal terms, Restore, Terms and Privacy as today.

## 9. Open decisions (founder)

1. At day 7, also offer the 7-day store trial (another week free with a card), or only paid plans with
   an introductory discount? Recommendation: keep the store trial; it's the lowest-friction "yes".
2. Caps during the week: 15 scans/day, 30 Fitzy messages/day OK?
3. Existing free users: later win-back only (recommended), or include at launch?
