# Where meal logs die — abandonment analysis (Nov 2026)

Analysis only — no app or backend code was changed. Written 2026-11-16.
Windows: **30d = Oct 17 – Nov 16 2026**, **7d = Nov 9 – Nov 16** (UTC).
Sources: Amplitude prod (746168), read-only prod DB (`nutrition_training_samples`, `food_log_entries`,
`ai_usage_events`, `user_active_days`), Sentry, and the iOS-115 / Android-115 / BE-engage115 code.

Every rate below shows its n. With ~50 daily users most cuts are small; I call out the ones that
are noise.

---

## Summary: the biggest leaks

1. **An AI result that is never saved is the biggest single leak, and it is mostly an Android and new-user problem.**
   The server produced 304 AI drafts (photo/voice/text) for real users in 30 days, and only 181 (60%) became a saved meal.
   - For photos, Android saved **52%** of results (63/122) and iOS **73%** (66/90). The gap is not noise (p = 0.002).
   - "Dead" drafts (no save within 60 min and no re-scan) were **34%** on Android (41/122) and **12%** on iOS (11/90).
   - Latency does **not** explain this. Drafts that took 5–8 s, 8–12 s or 12–20 s were saved at the same ~65% rate.
2. **First scans are lost because onboarding moves on before the result arrives.**
   - When a new user scans in onboarding, the app goes straight to the next step. The result then waits behind Ask Fitzy, reminders, friends, summary and the onboarding paywall (shown to 126 Android and 40 iOS users).
   - On Android, if the result lands while the paywall or any other "busy" screen is open, it is marked as prompted and **never opens by itself again**. It sits as a "Ready — tap to review" row in the Food Log.
   - First-hour scans: 24 of 59 new users who scanned in their first hour never saved that meal. Only 2 of those 24 saved anything on day 0.
   - In Amplitude, half of the people who scan during onboarding don't save within 24 h: Android 19/38, iOS 6/12.
3. **About 60% of new users skip the first-meal step, they decide in about 5 seconds, and very few log later.**
   - Skip rate: about 57% on Android (87/154 viewer-versions) and about 67% on iOS (28/42).
   - Median time from seeing the step to skipping: about 5 s on Android (n = 80) and about 4 s on iOS (n = 28). Three quarters skip within 9 s.
   - Only about **10%** of skippers log a meal by day 1 (Android 8/74, iOS 3/28), and that barely moves by day 7.
4. **About 3 in 10 people who tap the camera or library never upload a photo, and we can't see why.**
   - User-level, 30d: Android 66 → 45 reached upload (68%), iOS 31 → 22 (71%).
   - The reasons we can see are small: 6 Android users declined the AI-consent dialog, and about 14 users hit the free-scan limit.
   - The rest are camera cancelled, preview cancelled or permission denied, none of which sends an event (see Instrumentation gaps).
5. **AI failures are *not* a real leak.**
   - Sentry shows 2 gateway timeouts in 30 days. `ai_usage_events` shows 5 of 60 photo model calls failed since Nov 11; a failed call falls back to another model.
   - The failures users see are mostly rate limits (9 users), and 4 of those 9 still logged within an hour.
   - Fixing speed or reliability will not move the save rate. The fix is getting people to the review screen and through Save.

**Correlation, not proof:** new users who saved a meal in their first hour were active on day 1 at 37% (13/35). Users who did not scan were at 14% (35/244), p = 0.003. Users who scanned but didn't save were at 17% (4/24), the same as non-scanners. This fits "the first saved meal matters", but self-selection is likely.

---

## 1. Step funnel, by method

### 1a. Photo (camera + library): user level, first attempt, 30-minute window (Amplitude, Play robots excluded)

| Step | Android 30d | iOS 30d | Android 7d | iOS 7d |
|---|---|---|---|---|
| Tapped camera/library (`Meal Log Started`) | 66 | 31 | 33 | 10 |
| Photo uploaded (`Meal Photo Analysis Started`) | 45 (68%) | 22 (71%) | 23 (70%) | 4 |
| Result returned (`Meal Photo Analyzed`) | 45 (100%) | 21 (95%) | 22 | 4 |
| Saved (`Meal Logged`, not an edit) | 22 (**49%** of results) | 16 (**76%**) | 10 (45%) | 2 |
| **Overall start → saved** | **33%** | **52%** | 30% | 2/10 (noise) |

Median times: tap → upload about 20 s; upload → result 8–10 s; result → save about 66 s on Android and 33 s on iOS.
iOS 7d is too small to read.

**Where the abandoned Android photo logs stopped** (30d, n = 44 non-savers out of 66): 21 before upload (48%), 0 during analysis, 23 after the result and before saving (52%).
For iOS (n = 15): 9 before upload, 1 during analysis, 5 after the result.

### 1b. Attempt level, from the server (DB, real users, 30d)

Every successful AI parse writes a `nutrition_training_samples` row. Saving the meal links it to the entry (`entry_id`).

| Method / platform | Drafts | Saved (linked) | Re-scanned within 10 min | Saved some other entry within 60 min | Dead (no save, no re-scan) | Users with a dead draft |
|---|---|---|---|---|---|---|
| Photo, Android | 122 | 63 (52%) | 17 | 11 | **41 (34%)** | 30 |
| Photo, iOS | 90 | 66 (73%) | 12 | 11 | **11 (12%)** | 6 |
| Text describe, iOS | 53 | 32 (60%) | 16 | 15 | 5 | 3 |
| Text describe, Android | 17 | 10 | 5 | 6 | 1 | 1 |
| Voice, Android | 11 | 6 | 3 | 2 | 2 | 2 |
| **All (incl. unknown platform)** | **304** | **181 (60%)** | 56 | 46 | **64** | **43** |

The middle columns overlap.

7d: Android photo 32/56 saved (57%), iOS photo 11/16 (69%).

- **Who abandons:** on Android, 53 of 122 photo drafts were made in the user's **first hour**. Only 23 of those 53 were saved, and 23 were dead.
- **Users who never saved after the first hour:** users past their first hour saved 40 of 69 drafts on Android (58%) and 59 of 75 on iOS (79%). Android is still worse, but iOS photo volume comes from 13 mostly loyal users.
- **"No food found" results:** drafts with 0 items (17, nearly all on Android) were **never** saved. The UI has no good next step for them.

### 1c. Other methods: user level, start → saved within 1 h (30d)

| Method | Android | iOS |
|---|---|---|
| Manual form | 13/19 (68%) | 13/19 (68%) |
| Search | 6/8 | not instrumented |
| Voice | 1/1 | sent as `manual` |
| Barcode | not instrumented (typed code inside search) | not instrumented |
| Quick add / repeat | no code path sends these | no code path sends these |

Event totals (30d, robots excluded), `Meal Log Started` → `Meal Logged` (new):

| Method | Android started → logged | iOS started → logged |
|---|---|---|
| Camera | 157 → 59 | 102 → 58 |
| Library | 46 → 8 | 57 → 30 |
| Manual | 98 → 76 | 176 → 103 |
| Search | 13 → 3 | not instrumented |
| Voice | 1 → 6 | not instrumented |

These are not clean conversion rates, because saves are mislabelled. On iOS, voice, search, barcode and "log it myself" all save as `manual`. On Android, edits save as `manual`. Use 1a and 1b for rates.

### 1d. Onboarding first-meal step (`v3_first_meal`)

See section 4.

---

## 2. AI analysis: success, failure, latency

**Server latency** (DB `latency_ms`, successful parses, 30d; this excludes upload time, which no one measures):

| | n | p50 | p90 | max |
|---|---|---|---|---|
| Photo, Android | 122 | 7.1 s | 12.4 s | 23 s |
| Photo, iOS | 90 | 8.8 s | 14.0 s | 17.6 s |
| Text describe | 75 | ≈6.8–8.4 s | ≈10–14.6 s | 15 s |
| All | 304 | 7.5 s | 13.0 s | 41 s |

Client side, the Amplitude median from upload to result is 8 s on Android and 10 s on iOS. Model time alone (`ai_usage_events`, since Nov 11) is p50 4.4 s and p90 7.9 s.

**Does abandonment rise with latency? No.** Photo save rate by server latency (30d):

| Latency | Photo drafts | Saved |
|---|---|---|
| < 5 s | 30 | 10 (33%) |
| 5–8 s | 92 | 61 (66%) |
| 8–12 s | 64 | 41 (64%) |
| 12–20 s | 29 | 18 (62%) |
| 20 s + | 3 | 1 |

The < 5 s bucket is low because it holds the fast "no food found" results, not because fast results get abandoned. Confidence behaves the same way: confidence 0.0 → 0/10 saved; 0.7–1.0 → about 63–68% saved.

**Failures** (Amplitude `Meal Photo Analysis Failed`, users, 30d):

| Error | Users | Saved a meal within 1 h |
|---|---|---|
| rate_limited (free allowance) | 9 | 4 |
| network | 3 | 3 |
| cancelled | 1 | 0 |
| validation | 1 | 0 |

- Event totals: Android 14 failed out of 137 starts, iOS 14 out of 127. Both clients fire Started and Failed on **every automatic retry**, so the real per-meal failure rate is lower than ~10%.
- Server side: 2 Sentry gateway timeouts (FITCIRCLE-WEB-BACKEND-4, Oct 26–27). 5 of 60 photo model calls failed since Nov 11; those fall back to another model.
- No "unparsed photo" fallback entries were created for real users in 30 days.
- **AI limit reached:** 14 users in 30d. Within 1 h, 5 of 7 on Android and 3 of 7 on iOS still logged a meal (manual or after the paywall).

What users do after a failure: the sample is too small to say more than "most still log something".

---

## 3. The review/edit step

There is **no event** for "review shown", "edited", "re-analyzed", "discarded", "save for later" or "back" on either platform. So we can only infer from outcomes:

- **Results that reached the user but were never saved:** Android 23 of 45 users (51%), iOS 5 of 21 (24%). At attempt level, 64 dead drafts (43 users) in 30 days.
- **Re-scans:** 56 unsaved drafts were followed by another scan within 10 minutes. People retake rather than edit; examples include 3 scans in 6 minutes, or 5 scans in 45 minutes, with nothing ever saved.
- **Editing does not look like the blocker.** Among saved drafts, the server's diff (`was_edited`, `items_added`/`removed`) exists. But users who abandon leave no trace of edit attempts, so we can't measure abandonment after an edit.
- **Android-specific cause (from code):** `MainScreen.kt` auto-opens a ready review only if the user is idle.
  - If the result lands while they are on the paywall, camera, search, a form, or Fitzy, the job is `markReviewPrompted` and **never auto-opens again**. It waits as a Food Log row or pill.
  - The onboarding paywall is in that "busy" set, so this is exactly what happens to onboarding scans.
- **Possible double charge:** several users got a second AI parse of the same photo about 60 s after the first, with no new photo. This looks like the review re-parsing when opened. Each extra parse costs a free scan credit. Worth checking in 1.1.5 QA (not confirmed from code).
- **Observed timelines** (example user ids are in the analysis scratch, not reproduced here):
  - Android, Nov 16: scan on the first-meal step → result in 12 s → second parse 40 s later → Ask Fitzy → reminders → friends → summary → onboarding paywall → left. Nothing saved.
  - iOS, Nov 14: onboarding scan → result arrives while on reminders → paywall → Food Log → two more scans, each analyzed → stays about 80 s on the result → leaves. Nothing saved.

---

## 4. Onboarding first-meal step

Robots (OnePlus 8 Pro, 18 Android viewers, and one emulator) are excluded from funnels. Internal accounts are **not** excluded in Amplitude (there is no flag for them; see gaps). They are a handful at most.

**Viewers, skips and saves by platform/version** (unique users per version, 30d; the per-version view counts include robots):

| Platform | Version | Viewed | Skipped | Skip rate | Viewed → result within 24 h | → saved within 24 h |
|---|---|---|---|---|---|---|
| Android | 1.1.0 | 16 | 8 | 50% | 3/11 | 1 |
| Android | 1.1.1 | 40 | 22 | 55% | 14/33 | 7 |
| Android | 1.1.2 | 57 | 34 | 60% | **9/51** | 3 |
| Android | 1.1.3 | 18 | 10 | 56% | 6/18 | 5 |
| Android | 1.1.4 | 23 | 13 | 57% | 7/23 | 3 |
| iOS | 1.1.0 | 7 | 4 | — | 2/7 | 1 |
| iOS | 1.1.1 | 13 | 7 | 54% | 5/13 | 3 |
| iOS | 1.1.2 | 6 | 5 | — | 1/6 | 1 |
| iOS | 1.1.3 | 16 | 12 | 75% | 4/16 | 1 |

- **Totals (30d, robots excluded):** Android 135 viewed → 38 got a result (28%) → 19 saved (14%). iOS 42 → 12 (29%) → 6 (14%).
- **Last 7d:** Android 68 → 14 → 8. iOS 17 → 4 → 1.
- **Version differences are mostly noise.** The one possible exception is Android 1.1.2, where scan rate fell from 42% to 18% versus 1.1.1 (p = 0.02). 1.1.2 shipped trial-first, which may be related. Treat this as a hint, not a finding.
- **Users who neither skip nor scan:** about 20–30% on Android (viewed minus skipped minus scanned) back out or quit on this step.
- **Time on the step before skipping:** median about 5 s on Android (n = 80) and about 4 s on iOS (n = 28); 75% within 9 s. This is a reflexive skip, not "tried and gave up".
- **Within-1-hour onboarding funnel** (Amplitude):
  - Android: 135 → 34 uploaded → 34 results → **15 saved** (44% of results). Median result → save was 71 s.
  - iOS: 42 → 9 → 8 → **3 saved**.
- **Do skippers log later?** (cumulative `Meal Logged`, new entries only):

| | by D0 | by D1 | by D7 |
|---|---|---|---|
| Android skippers | 8/76 (11%) | 8/74 (11%) | 3/38 (8%)* |
| iOS skippers | 2/28 (7%) | 3/28 (11%) | 3/15 (20%) |

*The D7 cohorts are older and smaller, so the D7 column isn't comparable to D0. The plain reading: about 1 in 10 skippers ever log.

- **Do onboarding scanners retain better?** Any activity, N-day:

| Cohort | n | D1 | D7 |
|---|---|---|---|
| `Onboarding Meal Logged` | 20 | 70% (14/20) | 58% (7/12) |
| `Onboarding Meal Step Skipped` | 104 | 36% (37/102) | 38% (20/53) |

  D1: p = 0.007. D7: p = 0.21, so not significant. A DB cross-check on new users (signed up 1–31 days ago, internal excluded):

| Group | n | Active D1 | Active D6–8 | Saved a meal by D7 |
|---|---|---|---|---|
| Saved a meal in first hour | 35 | 13 (37%) | 6/24 (25%) | 24/24 |
| Scanned in first hour, never saved it | 24 | 4 (17%) | 1/16 (6%) | 1/16 |
| No first-hour scan | 244 | 35 (14%) | 20/146 (14%) | 8/146 |

The savers' D1 lead over non-scanners is significant (p = 0.003). Scanners who never saved look like non-scanners (p = 0.76). Self-selection (motivated users both save and come back) can explain part or all of this.

---

## Ranked fixes

"1.1.5 fit" assumes 1.1.5 is otherwise built: S changes can ride along, M is a stretch, L is next release. Expected effects are rough projections from the n above, not promises.

| # | Fix | Where | Expected effect | Effort | 1.1.5? |
|---|---|---|---|---|---|
| 1 | **Never lose a ready result.** Android: when a result lands during a "busy" screen, defer instead of `markReviewPrompted`, and auto-open it on the next idle moment (after the paywall closes and Home appears). iOS: same rule for the review card after onboarding and the paywall. Add a Home feed card for "Your meal is ready — save it" while a draft is unsaved. | Android `navigation/MainScreen.kt` (auto-review coordinator); iOS `MealAnalysisFeature` / `AppFeature`; home feed rule (BE) | Targets the about 23 Android and 5 iOS users per month who got a result and never saved it. If the post-result save rate reaches iOS's level, that is about +10–12 users with a first saved meal per month. | S–M | **Yes** (client S; the feed card is a BE rule, S) |
| 2 | **Finish the first meal inside onboarding.** On the first-meal step, wait for the result (p50 about 8 s, p90 about 13 s) with a progress state, show the review inline with one big **Save**, then continue. Don't hand off to a background queue during onboarding. | iOS `OnboardingV3Feature` + adapter; Android `OnboardingV3ViewModel.onMealHandedOff` / `OnboardingV3Flow` | Onboarding scanners who get a result save 44% (Android) and 38% (iOS) today. Inline review should approach the 76% iOS main-app rate. That is about +8–10 saved first meals per month at current volume. | M | Stretch. If not, ship #1, which covers most of it. |
| 3 | **Auto-save abandoned drafts as a "draft meal".** If a ready result isn't saved within about 30 min, or the app is backgrounded on the review, save it with an "AI estimate — tap to confirm" badge. Alternatively, the server can create it from the training sample. | BE (a cron over unreconciled `nutrition_training_samples`, using the existing unparsed-photo entry pattern) or client outbox | Rescues most of the 64 dead drafts per month (43 users). This is a product call: it saves meals the user didn't confirm. | M | No: needs a product decision and a privacy/sharing check (shared-meal default) |
| 4 | **Day-0 nudge for skippers.** Send a meal-slot push at the next mealtime on day 0/1 for users who skipped the first-meal step and have not logged ("Snap your lunch — it takes 10 seconds"). Use the existing meal reminders and push caps. | BE push rules | Skippers log only about 10% by D1 (n ≈ 100). Even +5–10 points is 5–10 extra activated users per month. | S | **Yes** (server-side, no app release) |
| 5 | **Make "no food found" useful.** For a 0-item result, show "Couldn't spot food — describe it instead" (text box prefilled) rather than an empty review. | iOS/Android review; optionally BE returns a hint | 17 drafts per month, 0 saved today | S | Yes |
| 6 | **Rework the skip moment** (test it, don't assume). People skip in about 5 s. Try: a sample result preview ("here's what you'll get"), "Describe it" as an equal option to the camera, and "Do it at my next meal" instead of "Maybe later" (sets the reminder in #4). Run it as an experiment. | Onboarding v3 both apps; experiments v2 | Unknown; 60% skip is the largest raw drop. Needs about 2 weeks at about 45 viewers per week to read. | S–M | Yes, as an experiment |
| 7 | **Find the pre-upload leak** (about 3 in 10 photo starters). First instrument it (gaps 1–3). Two known pieces: Android consent declines (6 users per month), so ask for consent once in onboarding with clear copy; and the free-scan pre-gate. | Both apps | Can't size until it's instrumented | S | Instrumentation: yes |
| 8 | **Check the double parse.** Confirm whether opening a review re-parses the same photo (seen about 60 s after the first parse, for several users). If so, reuse the cached draft. It costs the user a free scan and a wait. | Android review / onboarding review | Saves AI credits for free users | S | Yes, if confirmed |
| — | Not worth it now: faster models or more retries. Latency has no visible effect on saving (5–20 s all about 65%), and real AI failures are rare. | — | — | — | — |

---

## Instrumentation gaps (what makes the funnel unmeasurable)

Detailed call-site maps came from reading `FitCircle-iOS-115` and `Fitcircle-Android-115`.

1. **No review-step events** on either platform: review shown (auto vs tapped), item edited, re-analyze, discard, save-for-later, back/leave. This is the step where most AI logs die. Proposed events: `Meal Review Shown {job_id, auto_opened, source}` and `Meal Review Closed {job_id, outcome: saved|discarded|later|back, edit_count, reanalyzed}`.
2. **No pre-upload events:**
   - camera opened, picker cancelled, preview cancelled
   - camera or mic permission denied (`Permission Prompted` fires only in onboarding)
   - on iOS, the consent "Not now" that ends the flow
   - Proposed: `Meal Capture Cancelled {stage: consent|permission|camera|preview|paywall}`.
3. **No job id.** `Meal Log Started`, `Analysis Started/Analyzed/Failed` and `Meal Logged` can't be tied to one attempt. Add `analysis_job_id` (and the server `parse_hash`) to all of them.
4. **Retries inflate counts.** Both apps fire `Analysis Started` and `Failed` on every automatic retry. Add `attempt` and count failures once per job.
5. **No latency.** No client timing is sent. Add `latency_ms` (upload + server) to `Meal Photo Analyzed`/`Failed`. Server latency exists only in the DB.
6. **`Meal Logged` fires on local save,** not on server acceptance, on both platforms. Sync failures are invisible.
7. **Method labels are wrong or missing:**
   - iOS: voice, search, barcode and AI-fallback saves are sent as `manual`; `search` is never sent; search and barcode have **no events at all**.
   - Android: edits are sent as `manual`; barcode is logged as `search` with no lookup events; `voice` and `search` starts have no `surface`.
   - Both: `quick_add` and `repeat` are never sent; library picked from inside the camera stays `photo_camera`.
8. **Consent ordering differs.** `Meal Log Started` fires *before* consent in the main app on both platforms, but *after* consent in iOS onboarding.
9. **iOS text-describe jobs fire `Meal Photo Analyzed`/`Failed`** (without Started), which inflates the photo funnel.
10. **Double fires:**
    - Android voice `Started` fires twice on foldables, and prefill flows add a second `Started`.
    - iOS `AI Limit Reached` fires twice on voice/text 429s.
11. **`Onboarding Meal Logged` is unreliable:**
    - It only fires for AI saves with items; manual saves in onboarding never fire it.
    - On Android, a pending flag can fire it on a *later* meal.
    - So use `Meal Logged` within N hours of `Onboarding Meal Step Viewed` instead.
12. **iOS sends upper-case user ids.** Amplitude has two profiles per iOS user (client upper-case, server events lower-case), which splits funnels that mix client and server events. Lower-case the id on iOS.
13. **No `Screen Viewed` for logging screens** (preview, camera, review, search, voice, entry form) on either platform.
14. **Android `Food Scan Paywall Resolved.had_saved_entry` is always false.**
15. **Amplitude can't exclude internal users.** There is no internal/test user property and no cohort. Play robots are identifiable only by device ("OnePlus OnePlus OnePlus8Pro"). Add an `is_internal` user property, and a saved robot-exclusion segment.
16. **The server-side save link is approximate.** `reconcileEntry` links a save to the user's *newest* unreconciled draft within 3 h. Older drafts from the same session count as unsaved, which is correct for "abandoned", but a save of an older draft would be mis-attributed.

## Method notes

- **Real users:** DB queries exclude `@inov8rlabs.com`, `@fitcircle.ai`, one internal personal domain, and `user_attribution.is_test`.
- **Platform:** taken from `app_opens` (since Nov 9), falling back to `push_tokens`. About 26 users have no platform and are shown as unknown/null.
- **Amplitude:** funnels exclude the OnePlus 8 Pro robot and one emulator. Rates are user-level unless marked as events.
- **Significance:** two-sided Fisher exact tests.
