# FitCircle 1.1.0: onboarding v3, design language, Pro surfaces

**Status:** plan, 2026-10-28. Covers iOS, Android, the backend and Admin Tools.

**Inputs:**
- Prototype: https://claude.ai/artifact/G1Riib85KSza3rXeCzKhq5 (the "Onboarding flow" and "Icon system" pages)
- `docs/DESIGN_LANGUAGE.md`
- `docs/ONBOARDING_V2_EXPERIMENT_SPEC.md` (experiment infrastructure, already live)
- Audits in `/private/tmp/claude-501/design-audit/{ios,android,backend}.md`

**Version (owner, 2026-10-28):** ships as **1.1.0**, folding in the unsubmitted 1.1.0 activation journey. Branches are still named `release/1.2.0`. Icon keys are gated by `X-Client-Features: icon_keys`, not by version, because early 1.1.0 test builds render emoji.

**Ship rule:** nothing is submitted to App Review or Play production until the product owner says so. Internal builds (TestFlight, Firebase, Play internal) are fine.

## What ships in 1.2.0

1. **Onboarding v3** for everyone. It replaces the v1 questionnaire, the assessment, the dashboard tour and the v2 tour.
2. **A skippable paywall** at the end. This is where experiments run.
3. **Home Pro surfaces:** the crown badge with a marker, the "crown unlocked" celebration, a Fitzy card, a Getting started checklist and a Pro trial card.
4. **The design language** across both apps: icons, type, colour, components, no emoji in system UI.
5. **Server copy and data** made emoji-free, plus an icon-key contract.
6. Already built and riding along:
   - the food-log analysis queue
   - the cross-account local-data isolation fix
   - onboarding resume / back / per-step saves
   - the 3-day trial UI

## Workstreams and order

```
W0 integrate ──► W1 foundations ──┬─► W2 onboarding v3 ─┐
                                  ├─► W3 home + Pro ────┼─► W6 QA + experiment ─► (owner) submit
               W4 backend copy ───┘   W5 sweep ─────────┘
```

### W0: integrate the branches (first, about half a day)
- Commit the uncommitted work on `feat/onboarding-v2` (iOS + Android): P0 robustness, the P3 tour and the cross-account fix. Merge `fix/foodlog-analysis-queue` and swap the one meal adapter per app.
- Cut `release/1.2.0` on both platforms from that, and bump to 1.2.0 (Android versionCode in sequence).
- The full suites must stay green: iOS about 1,130 tests, Android about 1,740.

### W1: foundations (blocks W2, W3, W5)
**Tokens (both apps):**
- Bring `AppTheme` (iOS) and the Compose theme (Android) to the doc's palette. `bg` is `#070A1A`; add `surface-1/2`, `accent-violet`, `accent-gold` and a selection token.
- Fix `text-tertiary` contrast; both platforms fail 4.5:1 today.
- Restrict the brand gradient to `PrimaryButton` and the Fitzy button.
- Add one macro colour mapping (calories orange, protein violet, carbs …, fat …).

**Type:**
- iOS: rebuild `AppTheme.Typography` on Dynamic Type text styles. Its 1,808 call sites then scale with no per-call change; the remaining ~740 fixed sizes are migrated in W5.
- Android: one Material 3 type scale mapped from the iOS styles, replacing the second, custom scale.

**Components** (one implementation each, with snapshot tests):
- `PrimaryButton` (56 pt, radius 16), `SecondaryButton`, `Card`, `OptionCard`, `IconTile`
- `FitzyAvatar` (32/40/160; replaces 3–4 variants)
- `ProBadge` (free+marker / pro), `LevelMeter`, `FlameArt`, a single `Confetti`, `OnboardingHeader`

**Icon-key contract (backend + apps):**
- `analytics/`-style source of truth `design/icons.json`: key → SF Symbol → Material symbol, with codegen into Swift and Kotlin enums.
- The apps render server icon keys and fall back to a neutral symbol for unknown keys.
- Android: adopt Material Symbols Rounded weight 500. Generate the ~60 icons we use as vector drawables; until then use `Icons.Rounded`.

### W2: onboarding v3 (iOS + Android in parallel, after W1)
**Steps, per the prototype:**
1. Welcome
2. Goal
3. About you: Health fill, which is the permission moment for Apple Health / Health Connect
4. Activity
5. Plan
6. First meal: camera permission on tap
7. Ask Fitzy (`context: onboarding`)
8. Reminders: notification permission on "Turn on reminders"
9. Friends: invite link, code, open circles
10. Summary

Then the paywall (always skippable), then Home.

**Reused from the v2 tour:** step reducers/VMs, the plan API, progress / resume, exposure analytics, and the meal adapter. Content and layout get rebuilt to the prototype.

**Removed:**
- v1 questionnaire, profile setup and the separate goals screen
- the persona explainer and the 5-step assessment, with both "All set" screens
- the separate first check-in and the "Achievement unlocked" screen
- the dashboard modal tour and the v2 hard paywall / locked screen (code kept behind the payload, unused)

**Account details:**
- The username is auto-generated from the sign-up name and editable in Profile. The display name comes from sign-up.
- The ATT prompt moves from first launch to after onboarding, on the first Home appearance.

**Analytics:** new `step_name`s `v3_*`, with `flow: v3` on all onboarding events. The tracking plan bumps to v16.

### W3: Home and Pro surfaces (after W1, alongside W2)
**Header:** greeting "Hi {name}" (fixes "Welcome back" for new users), the `ProBadge` and the Fitzy button.

**Marker rules:**
- shown to non-subscribers until the paywall is opened;
- re-armed by a server flag in `GET /entitlements` (`proBadge.marker`) for a new offer, or weekly for the first month;
- never shown to subscribers or users on a trial.

**Crown celebration:** a one-time card on the first Home after purchase or trial start, stored per user, with confetti and a haptic. Tapping the crown opens Pro status (perks, member since, trial end).

**Feed:**
- **Fitzy card** first: a home-feed card type `fitzy_hint`, server-driven from the user's day (calories left, Pro perk for subscribers).
- **Getting started checklist:** log a meal, set reminders, join a circle, connect Health, invite a friend. It's computed from server state and disappears when complete or dismissed.
- **Pro trial card:** the existing `pro_value` promo with a new creative, for non-subscribers who skipped.

### W4: backend copy and data (in parallel from now)
**Code copy:**
- Remove emoji from push copy, circle system posts (update the eval), promo creatives, campaign utils, seasons, challenge templates, streak / momentum badges, check-in messages and emails.
- Add a "no emoji" rule to every Fitzy, focus, plan, nudge and nutrition prompt, and a shared `stripEmoji()` on every LLM string that reaches push, feed, posts or food names.
- Run the Fitzy live eval after the prompt changes.

**Icon keys with backward compatibility:**
- Shipped apps (≤1.1.x) render the `emoji` fields, so the API keeps sending `emoji` to old clients and adds `icon` (a key) for 1.2.0+, gated by `x-app-version`.
- Push and system-post text changes apply to everyone immediately.

**Migration 114 (data):**
- campaigns `emoji` / marks / doors / notification titles. Hold the Line (Nov 15) and Advent (Dec 1) go first.
- `challenge_templates.icon_name` (37 rows) gets icon keys in a new column, so old clients keep the emoji column.
- `user_achievements.achievement_icon` and optionally trailing emoji on system `circle_messages` (never user rows).
- The OG share-card renderer switches to SVG icons.

**Experiment:** repurpose the draft `onboarding_v2` into `onboarding_paywall` in Admin Tools, with no deploy. All arms are skippable and carry the 3-day trial.
- `control` (prototype 11) = annual + monthly cards, annual pre-selected, Today / Day 2 / Day 3 timeline. Payload `{"paywall":"soft","layout":"plans"}`.
- `variantA` = "Your plan" paywall: the same plans, headed by the user's own targets and goal date. Payload `{"paywall":"soft","layout":"plan_recap"}`.
- `variantB` (prototype 11B, owner's call 2026-10-28) = annual only, shown against monthly: "Save 75%", $119.88 struck through vs $29.99, "You save $89.89 a year", with the free trial as the headline. Monthly sits behind "Other plans". Payload `{"paywall":"soft","layout":"annual_savings"}`.
- Savings are computed from the store prices per locale, never hard-coded.

**Owner decisions (2026-10-28):** variants as above; delete the dead features (Momentum, QuickLog, Boost, Quests); auto-generated usernames; ATT after onboarding; emoji stays in the reaction picker and user content.

### W5: design sweep (after W1; P0 runs alongside W2/W3)
- **P0 screens:** Dashboard, Food log, meal review, Paywall, Fitzy chat, Circles and circle chat, the daily check-in, notification copy in the app.
  - Swap emoji for symbols and migrate fixed fonts to text styles.
  - Use the canonical components; Fitzy and the macro colours are applied consistently.
- **P1:** everything else that's reachable. Settings and wizards also get sentence case.
- **Dead code** (Momentum, QuickLog, Boost, Quests, unused streak and challenge views) is deleted, not fixed, if the owner confirms.
- **Accessibility pass:** XXL Dynamic Type / font scale 2.0, VoiceOver / TalkBack labels, contrast.

### W6: QA and launch
- **Snapshot tests:** onboarding, Home, the paywall and the P0 screens (iOS snapshot tests, Android Roborazzi) in light of the tokens.
- **Device QA matrix:**
  - fresh sign-up; resume after kill at every step; each permission allowed or denied
  - paywall skip / trial / restore; crown celebration
  - account switch (isolation); offline meal queue
  - sandbox trial → paid
- **Builds:** TestFlight, plus Firebase / Play internal for owner review. The owner iterates.
- **When the owner approves:**
  1. Start `onboarding_paywall` at 20%.
  2. Point paid UA at it.
  3. Submit, only on the owner's go.
