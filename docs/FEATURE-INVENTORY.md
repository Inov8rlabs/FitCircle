# FitCircle Feature Inventory

As of 2026-09-24. Source: the three codebases (FitCircleBE, FitCircle-iOS, Fitcircle-Android) and App Store Connect.

## What FitCircle is

FitCircle is a social fitness and nutrition tracker: log meals by photo, voice or hand, log workouts, keep a daily streak, and do it inside small "circles" of friends whose shared chat shows everyone's meals, workouts and check-ins. An AI coach (Fitzy) answers from the user's own logs, and a Pro subscription lifts the free tier's limits.

| Surface | Stack | Status on 2026-09-24 |
| --- | --- | --- |
| iOS app (iPhone only, iOS 17+) | Swift, SwiftUI, The Composable Architecture | Version 1.0, build 36, in App Review; on TestFlight |
| Android app | Kotlin, Jetpack Compose | Built to parity, not yet on Google Play |
| Web app | Next.js 15, React 19, Tailwind | Live at fitcircle.ai (same accounts as the apps) |
| Backend | Next.js API routes on Vercel, Supabase (Postgres, Auth, Storage, Realtime) | Live; serves all three clients |

All three clients call the same backend and share one account, so a meal logged on the phone appears on the web and vice versa. Business logic lives in the backend service layer, not in database procedures.

## Accounts, sign-in and onboarding

Sign-up needs only an email and password; Sign in with Apple and Google Sign-In are also supported on the apps, and a new social account is routed into onboarding while a returning one lands on the dashboard.

- Email confirmation with a resend option, forgot-password and reset-password flows (web and apps).
- Sessions use JWT access and refresh tokens; the apps refresh silently and force a sign-out when a session expires.
- Optional Face ID / Touch ID app lock on iOS, biometric lock on Android.
- Usernames are generated from the email and can be edited; profile has display name, bio, avatar, gender, height, weight, timezone and unit system (metric or imperial).

Onboarding runs in this order on the apps: welcome and sign-up, a short questionnaire that assigns one of four personas (Competitor, Social, Practical, Fitness Fanatic), "Meet Fitzy", profile setup, goal setting (current weight, target weight, timeline, daily steps, habits), a persona-specific flow that ends in a fitness assessment, Apple Health / Health Connect permissions, a first check-in, and a celebration. Completing it writes the profile, creates the first daily tracking entry and a steps goal, and opens the dashboard with a one-time tutorial. The web has a matching onboarding and assessment.

## Nutrition and food logging

Meals can be logged four ways, and every AI path ends in the same confirm-then-commit editor where each ingredient is a row the user can rename, re-portion, re-analyze or delete before saving.

| Method | How it works |
| --- | --- |
| Photo | Camera or library, up to several photos per meal, plus an optional text hint. Analysis runs in the background on the server (Claude Haiku 4.5 vision, Gemini 3 Flash as fallback) and returns items with calories, protein, carbs, fat, fiber, sugar, sodium, a confidence and a 0–10 health score. |
| Voice | Speak the meal; on-device speech recognition sends the transcript to the server (Claude Sonnet 4.6) which returns the same draft. |
| Manual | A form with category, meal slot, date and time, notes, a photo and a privacy toggle. |
| Search | Text search over the foods database, live barcode scanning, custom foods the user creates, and restaurant items via Nutritionix when configured. |

Entry details and editing:

- Meal slots: breakfast, lunch, dinner, snack, other. Slot and eaten-at time are editable after the fact.
- Editing a saved meal always opens the row-per-ingredient editor with the plate photo above the rows; rows are rebuilt from the saved notes when an older entry has no ingredient data. Water and supplements use a simpler form.
- Servings multiplier scales the whole meal; totals recompute from the scaled rows.
- Photos can be added to an existing meal (a second course or dessert) and the new items append to the entry.
- "Re-run AI analysis" re-parses the saved photo. A failed parse still saves the input as an entry with a note so nothing is lost.
- Per-entry privacy: private (never shared), circle, or shared, with a per-circle privacy tier setting.
- A free-tier quota of 5 AI parses per day (100 for Pro as an abuse ceiling); hitting it opens the Pro paywall.
- Optional training-sample capture of user corrections is built but switched off until the privacy policy covers it.

Beyond meals:

- Beverage log with coffee, tea, soda, juice, alcohol and other, each with customizations (size, milk, sugar) and nutrition; alcohol entries take a label photo. Favourites can be saved.
- Water quick-add on the dashboard against a daily goal.
- Supplements with name and dosage.
- Group meals: one member logs a shared meal and tags others in the circle, who accept it into their own diary with one tap.
- Plate Score: a 0–100 daily nutrition score built from adherence, macro balance (reference split 25% protein, 45% carbs, 30% fat) and goal fit, designed so a tiny "diet" day cannot score high. It is the default circle-visible metric instead of raw calories.
- Dietary preferences (diet type, allergies, dislikes) that steer Fitzy and suggestions.
- Insights: daily and weekly nutrition summaries, streaks of logging, and calorie balance against workouts.
- Nutrition import from Apple Health / Health Connect and write-back of logged meals, weight and water to them (see Workouts and health sync).

## Workouts, activity and health sync

Workouts can be logged by hand, in two taps from a "quick log" of popular workout brands, or synced automatically from Apple Health and Health Connect; a synced workout of 10 minutes or more also claims the day's streak.

- Manual workout form: exercise type from a catalog grouped by category (cardio, strength, flexibility and more), duration, calories (entered or estimated), distance, average heart rate, effort level, indoor or outdoor, who you trained with, notes, and an optional set-by-set exercise editor.
- Quick log: pick a brand or class type (OrangeTheory, CrossFit, Peloton, yoga, run, walk, swim) and a duration; recent activities are cached for one-tap re-logging.
- Exercise log screen with detail view, edit, delete, recent types, per-exercise history and stats.
- Calorie balance view: calories eaten against calories burned for the day.
- Steps: read from Apple Health / Health Connect with a background observer, bulk back-fill of the last 3 to 5 days on launch and foreground, and a manual steps entry with a daily steps goal (default 10,000). Steps can be submitted to circles for step challenges.
- Apple Health (iOS) reads steps, workouts, distance, active energy, weight, body fat, lean mass and height, and writes back logged meals (calories, protein, carbs, fat, water) and weight. Health Connect (Android) covers the same categories. Sync is optional and the app is fully usable without it.
- Nutrition already in Apple Health / Health Connect from other apps can be imported, deduplicated by source, and appears as imported entries.

## Vitals, weight and body composition

The dashboard shows three vitals cards (weight, BMI, water) for a 7-day window, and a separate body-composition journal tracks the fuller picture from smart scales and scans.

- Weight: logged from the dashboard, the daily check-in, onboarding, or synced from Apple Health / Health Connect. The card shows current weight, change against the period's baseline, the trend series and progress toward a target weight (target and starting weight live in the profile goals).
- BMI is derived from profile height and latest weight, in the user's unit system.
- Water: quick-add buttons against a daily hydration goal stored in preferences.
- Body composition journal: entries with weight, body fat %, fat mass, skeletal muscle mass, lean mass, body water, bone mass, visceral fat level, BMR and segmental (per-limb) data. Entries come from manual input, automatic import of smart-scale readings via Apple Health / Health Connect, or a photo scan of an InBody printout, InBody app screenshot or DEXA summary (up to 3 photos, parsed by AI, confirmed before saving).
- Body-composition trends with period selection and a summary card on the dashboard.
- Photo scan, trends, segmental data and coach commentary on body composition are Pro-gated; basic logging is free.
- Historical data: a profile screen to back-fill past days (weight, steps, mood, energy, notes) and see missing days.
- Data export of everything as JSON from Settings, and full account deletion.

## Streaks, shields, momentum and check-ins

One engagement streak per user, claimed automatically by the server whenever the user logs a meal, completes a check-in, or syncs a workout of at least 10 minutes; no separate "claim" tap is needed.

- Daily check-in: a short flow for mood, energy, optional weight (typed or pulled from Apple Health), notes, and how the previous day went. It can back-fill a past day, ends in a celebration, and feeds the dashboard streak card.
- Shields (streak freezes): a new user starts with 1; free users earn +1 every 7 consecutive days and +1 extra every 30, banked up to 3. A shield auto-covers a single missed day; Pro users have unlimited shields. Streaks can be paused, and a freeze can be purchased.
- Milestones with celebrations at 3, 7, 14, 30, 60, 100, 180, 365, 500, 730 and 1,000 days, each with a badge; milestone moments can be shared as cards.
- Momentum: a flame that levels up with the streak (Spark 0–6 days, Flame 7–13, Blaze 14–29, Inferno 30–99, Eternal 100+), with a momentum screen, milestones and best-momentum tracking.
- Metric streaks alongside the main one: consecutive days of measurements or photos, and streak history with an activity-history detail view.
- Circle streak: a collective streak the circle earns on days when most active members log a calorie-bearing meal, with one "streak save" per period where a member can cover for another.
- Reminders are state-aware: a push at the user's chosen hour only if they haven't logged or checked in yet that day in their timezone (see Notifications).

## Circles

A circle is a small private group with one shared chat, a challenge and a leaderboard; the chat is where accountability happens because meals, workouts, check-ins and streak events post there on their own.

- Create a circle with a name, description, visibility (private or public), dates, and an optional challenge from the template library or the custom wizard. Free accounts can have 2 active circles they created; Pro is unlimited.
- Join by invite code, by invite link (fitcircle.ai/join/CODE, which deep-links into the app), or from the public circles browser. Invites can be copied as code or link or handed to the share sheet; pending invites can be declined.
- Chat: text and photo messages, edit within a window, delete (tombstone), report, mute, read receipts, realtime delivery over Supabase Realtime, day headers, and @mentions that pierce a mute.
- Reactions: long-press any message or card for thumbs up, high five, heart, fire, clap and laugh; one tray at a time, tap outside to dismiss; the author gets a push.
- Automatic system posts: meal cards (photo, title, calories and macros, honoring the entry's privacy), workouts, check-ins, streak milestones, shields, circle boost, and a daily summary at 21:00 in the circle's timezone that only posts when someone checked in.
- Food privacy per circle: each member picks what the circle can see (full, macros only, private), and the shared meal feed respects it.
- Member profiles: weight progress (starting, current, target, lost, to go), check-in history, and per-member privacy settings, with blocking.
- Circle boost: a multiplier on points for days when a threshold of members check in (1.5× at half, 2× at 80%, up to 3× for a perfect day), with boost history.
- Circle streak and streak saves (see Streaks), nutrition leaderboard on Plate Score, and group meals (see Nutrition).
- Manage circle: rename, edit, remove members, leave, delete.
- Safety: block users, report messages, chat mute; a demo circle and reviewer account exist for App Review.

## Challenges, leaderboards, quests and daily challenges

Challenges attach to circles and rank members on a live leaderboard; there are also circle quests and a fresh daily micro-challenge each morning.

| Kind | What it is |
| --- | --- |
| Circle challenge | Weight loss, step count, workout minutes, check-in, or custom. Members submit progress (weight or steps) through data submission; progress and the leaderboard recalculate in real time. Halfway, ending-tomorrow and completed pushes go to members. |
| Template library | 31 ready-made challenge templates (13 strength, 8 cardio, 5 wellness, 3 flexibility, 2 custom) that pre-fill the create-circle wizard. |
| Custom challenge wizard | Build a challenge from a metric, unit, target and dates, validated server-side. |
| Nutrition challenge | Makes nutrition a challenge metric (Plate Score, protein, logging days) on top of the existing challenge, with its own leaderboard. |
| Circle quests | Individual, collaborative or competitive quests inside a circle with per-member progress and pending or active states. |
| Daily challenge | One small challenge per day (for example 10-minute move, 5,000 steps, 8 glasses of water, 15 minutes stretching, 50 bodyweight reps) with join, progress and its own leaderboard; the day's challenge is pushed as a "daily drop". |
| Daily goals | Personal goals (steps, water, weight) with recommendations, a streak per goal, and auto-adjust support. |

Leaderboards rank by challenge progress, with a v2 leaderboard service, boost multipliers applied to points, and a per-member detail view.

## Fitzy, the AI coach

Fitzy is a multi-turn chat coach that answers from the user's own data: logged meals and macros, weight trend, workouts, streaks and circles, plus their dietary preferences and goals.

- Available on iOS and Android as a chat screen, and on the web as a drawer reachable from every signed-in page.
- Covers training, movement, recovery, nutrition and plateaus, with meal ideas that fit the macros left for the day.
- Guardrails: no medical or clinical advice, body- and food-neutral language, no restrictive prescriptions or disordered-eating triggers; model output is scanned and dropped on a hit.
- Conversation history is kept per user and can be cleared.
- Free tier: 5 messages per day (200 for Pro as an abuse ceiling); the limit opens the Pro paywall.
- Runs on the Vercel AI Gateway with the same model family as meal analysis.

## Notifications and reminders

Push goes through Firebase Cloud Messaging on both apps, orchestrated server-side with per-category preferences, quiet hours, a daily cap and suppression rules, so a user gets at most a few nudges a day and none while a chat they are looking at is open.

- Categories the user can toggle: journey, momentum, circle, challenge, social, celebration. Quiet hours default to 22:00–07:00 in the user's timezone and can be changed or turned off. A legacy master push switch is honoured.
- Journey: day-1 nothing logged, day-3 circle invite nudge, day-14 challenge nudge, day-30 recap, dormant at 7, 14 and 30 days, win-back at 60 days, weekly summary.
- Momentum and streaks: state-aware daily reminder (only if nothing logged yet), momentum at risk, near a milestone, shield applied, shield earned, streak lost, reset encouragement, lunch and dinner meal reminders.
- Circles and challenges: chat messages (with sender and preview), @mentions, reactions, rally posts, meal and check-in cards, friend joined circle, circle boost threshold, perfect day, challenge halfway, ending tomorrow and completed, daily drop.
- Conversation traffic (chat messages, mentions, reactions) is exempt from the daily cap.
- Deep links: every push opens the right screen (circle chat, dashboard, food log, exercise log, challenges), including cold-start taps, and opens are recorded.
- Notification history is available through the API; iOS asks for push permission after sign-in and re-registers the token on each foreground.

## Sharing and share cards

Share cards turn a moment into an image the user can post anywhere: milestone, streak milestone, challenge complete, perfect week, momentum flame and circle boost.

- Cards are generated server-side, previewed in the app, then shared through the system share sheet, saved to Photos, or copied as a link; shares are recorded.
- Custom share themes are a Pro feature.
- Circle invites share as a code or a link, and the web join page (fitcircle.ai/join/CODE) hands off into the app or the web app.
- A food-log entry can be shared to a circle explicitly, and meal cards in chat can be reacted to.

## FitCircle Pro

Everything is free to use; Pro removes the free tier's limits and ads. Prices below are the App Store values as of 2026-09-24 (the web checkout through Stripe must match).

| Plan | Product id | USA | Canada | UK |
| --- | --- | --- | --- | --- |
| Pro Monthly | com.inov8rlabs.fitcircle.pro.monthly | $9.99/mo | CA$9.99 | £9.99 |
| Pro Annual | com.inov8rlabs.fitcircle.pro.annual | $29.99/yr | CA$39.99 (or CA$3.99/mo in instalments) | £29.99 (or £2.99/mo) |
| Pro Lifetime | com.inov8rlabs.fitcircle.pro.lifetime | $179.99 once | CA$189.99 | automatic |

No free trial at launch. Purchases run through StoreKit (iOS), Play Billing (Android) and Stripe (web), all validated by RevenueCat under one entitlement, so a purchase on one platform unlocks the others. The backend reconciles through webhooks, a pull-based sync after purchase, and an hourly reconcile job; complimentary grants can be issued by an admin API.

| Free | Pro |
| --- | --- |
| 5 AI photo or voice parses per day | Unlimited (100/day abuse ceiling) |
| 5 Fitzy messages per day | Unlimited (200/day ceiling) |
| 14 days of history and trends | Full history |
| 2 active circles created | Unlimited |
| Shields earned weekly, banked up to 3 | Unlimited shields |
| Body-composition logging | Plus photo scan, trends, segmental data, coach |
| Standard share cards | Custom themes |
| Banner and interstitial ads (with ATT prompt) | Ad-free |
| — | Data export |

Entry points: hitting any limit, the "Go Pro" card on the dashboard, Settings, the "Remove ads" link under a banner, and the web /upgrade page. Restore Purchases is on the paywall and in Settings; a manage-subscription screen shows status, renewal and platform, and deep-links to the store's management sheet or the Stripe portal.

## Settings, privacy, data export and account deletion

Settings cover profile, units, notifications, privacy, display, health sync, subscription, security, data and account.

- Profile: name, username, bio, avatar, gender, height, weight, timezone; goals (target weight, steps).
- Units: metric or imperial, applied across weight, height and nutrition displays.
- Notifications: six category toggles, quiet hours, system permission status and a shortcut to iOS/Android settings.
- Privacy: profile visibility (public or private), show weight, show progress; per-circle food privacy tier; block list.
- Display: theme and language preferences (the apps are dark-mode first).
- Health: connect or disconnect Apple Health / Health Connect, choose what to import and write back, see last sync.
- Security: biometric app lock.
- Data: export all personal data as a JSON download; delete account, which removes personal data, leaves circles, and deletes circles that have no other members.
- Legal: terms of service and privacy policy at fitcircle.ai; the web has a GDPR/CCPA cookie consent banner that gates analytics, and Global Privacy Control signals are honoured.
- Support page at fitcircle.ai/support and support@fitcircle.ai.

## Platform parity

iOS is the reference; Android matches it for almost everything, and the web covers the core loop but not the phone-only inputs.

| Area | iOS | Android | Web |
| --- | --- | --- | --- |
| Photo meal logging | Yes, background analysis | Yes | Yes (upload) |
| Voice logging | Yes | Yes | No |
| Barcode scan | Yes | Yes | No |
| Health sync | Apple Health | Health Connect | No |
| Circle chat with realtime | Yes | Yes | Yes |
| Meal cards in chat | Rich card with photo and macros | Rendered as plain text (parity gap) | Rich card |
| Reactions incl. thumbs up | Yes | Yes | Yes |
| Separate circle food feed | Removed (lives in chat) | Still present | Still present |
| Fitzy | Chat screen | Chat screen | Drawer |
| Body-composition photo scan | Yes | Yes | No |
| Share cards | Yes | Yes | Button on dashboard |
| Pro purchase | StoreKit | Play Billing | Stripe |
| Biometric lock | Face ID / Touch ID | Yes | No |
| Offline-first food log cache | Yes | No (calls backend directly) | No |
| Installable / offline | Native | Native | PWA with offline page |
| Product analytics | Amplitude (61 events) | Pending | Amplitude autocapture only |

Android is built and compiles but is not yet listed on Google Play.

## Under the hood

One backend serves all clients: about 150 mobile API endpoints under /api/mobile, a service layer of roughly 80 TypeScript services, and Supabase for Postgres, auth, storage and realtime; business logic stays in services rather than database procedures.

- AI: Vercel AI Gateway with Claude Haiku 4.5 for photo and per-item estimates, Claude Sonnet 4.6 for voice parsing, Gemini 3 Flash as fallback; a nutrition evaluation harness and optional training-sample capture.
- Foods data: a foods database with semantic (embedding) search, barcode lookup, custom foods, and Nutritionix for restaurant items when keys are set.
- Realtime: Supabase Realtime channels for circle chat, with a per-user realtime token endpoint.
- Scheduled jobs (Vercel cron): hourly state-aware reminders, hourly circle daily summaries, journey and dormancy pushes, subscription reconcile.
- Payments: RevenueCat (App Store, Play, Stripe) with webhook idempotency, pull-based sync, complimentary grants, and feature gates stored in the database so tiers can be switched without a release.
- Analytics: Amplitude (Inov8r Labs project) with a 61-event tracking plan on iOS covering sign-up, onboarding, logging, circles, paywall and ads; Vercel Web Analytics and Amplitude autocapture on the web.
- Monitoring: Sentry on the backend, web and iOS (crashes, hangs, failed requests, dSYM upload from Xcode Cloud); AdMob for ads with Google User Messaging Platform for consent.
- Push: Firebase Cloud Messaging on both apps behind a notification orchestrator with quiet hours, caps and logging.
- Build and release: Xcode Cloud for iOS TestFlight and App Store builds, Vercel for web and API, Supabase migrations numbered through 087.
- Web-only extras: PWA manifest and service worker (network-first pages), cookie consent, Stripe checkout and billing portal, an admin API for complimentary grants.
