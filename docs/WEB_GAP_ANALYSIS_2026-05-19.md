# FitCircle Web App Gap Analysis vs iOS
**Date:** May 19, 2026  
**iOS Inventory Date:** May 19, 2026  
**Web App Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, shadcn/ui, Zustand, Recharts  
**Comparison Scope:** Web front-end UI/UX completeness vs iOS feature parity

---

## Executive Summary

### Status Overview

The Web app is approximately **35-40% feature-complete** relative to iOS. While core scaffolding exists for most feature areas, substantial gaps remain in:

1. **Complete Feature Absence (8 major areas):** Ads, Notifications (PWA push), BeverageLog standalone, ExerciseLog, QuickLog, Share Cards, Momentum UI, Daily Challenges
2. **Partial/Incomplete (6 areas):** Streaks (missing calendar, freeze, claims), FitCircles (missing quests/boosts), Challenges (read-only), Profile (settings missing), Onboarding (4-step stub), CheckIns (dashboard-only)
3. **Diverged Behavior (3 areas):** Authentication (no Apple Sign-In), Dashboard (no HealthKit sync banner), Notifications (no in-app push handling)

### Priority Gaps (Impact Score)

**Highest Impact—User Engagement Critical:**
1. **Streaks**: Calendar view, freeze purchases, retroactive claims (iOS has rich visual + purchase flow)
2. **Daily Challenges**: No landing page or UI (iOS has dedicated feature with leaderboard)
3. **Momentum**: No visualization or detail view (iOS: animated flame + milestones)
4. **FitCircles Quests/Boosts**: Partial—circle detail exists but sub-features missing
5. **Share Cards**: No progress card generation or social sharing (iOS: native share sheet)

**Medium Impact—Feature Completeness:**
6. **ExerciseLog**: No dedicated page (iOS: full CRUD with activity types)
7. **BeverageLog**: Only component exists, no standalone page
8. **Notifications**: No in-app preferences UI (iOS has toggle settings)
9. **Ads**: Zero implementation (iOS: rewarded + interstitial system)
10. **Profile Settings**: Display/Health/Privacy/Notifications tabs incomplete

**Lower Impact—Polish/Nice-to-Have:**
11. **QuickLog**: No express UI for exercise
12. **CheckIns Detail**: Read-only modals (iOS: edit past entries)
13. **Onboarding**: Minimal 4-step flow (iOS: 15-step persona assessment + circle recommendations)

---

## Per-Feature Gap Matrix

### 1. Ads

| iOS Component | Web Status | Notes |
|---|---|---|
| `AdManager.swift` | 🔴 **MISSING** | No ad system on web; not required for browser context but may be needed if PWA monetization planned |
| `RewardedAdButton.swift` | 🔴 **MISSING** | No rewarded ad UI or flow |
| `InterstitialAdManager.swift` | 🔴 **MISSING** | No interstitial placement |
| `AdFrequencyManager.swift` | 🔴 **MISSING** | No impression capping or frequency rules |
| Feature flag: `AdsFeatureFlag` | 🔴 **MISSING** | No feature gate for ad system |

**Classification:** ⚪ **N/A (for now)** — Web has different monetization model (assumed SaaS subscription or no ads). Consider implementing if PWA app store distribution planned.

---

### 2. Authentication

| iOS Component | Web Status | Notes |
|---|---|---|
| `LoginFeature.swift` (TCA) | ✅ **PARITY** | Email/password login implemented at `/auth/login` |
| `ForgotPasswordFeature.swift` | 🟡 **PARTIAL** | UI exists but unclear if full reset flow is wired |
| `AppleSignInManager.swift` | 🔴 **MISSING** | No Apple Sign-In button or OAuth integration on web |
| Sign-up flow | ✅ **PARITY** | Email/password registration at `/auth/register` |
| Password strength validation | ✅ **PARITY** | Likely in form validation (needs verification) |

**Classification:** 🟡 **PARTIAL** — Core email/password auth works; Apple Sign-In missing (web alternative: Google OAuth would be better UX). iOS has `signInWithApple` as key feature.

---

### 3. BeverageLog

| iOS Component | Web Status | Notes |
|---|---|---|
| `BeverageLogView.swift` (main list) | 🔴 **MISSING** | No standalone beverage log page; only component exists `/components/food-log/beverage-type-card.tsx` |
| `BeverageLogFeature.swift` (TCA) | 🟡 **PARTIAL** | Service layer exists (`beverage-log-service.ts`) but no dedicated page/route |
| `BeverageQuickLogView.swift` | 🔴 **MISSING** | No quick-add modal for beverages |
| `FavoritesManagerView.swift` | 🔴 **MISSING** | No favorites management UI |
| Water preset buttons | 🟡 **PARTIAL** | Component exists but likely only in food-log context, not standalone |

**Classification:** 🔴 **MISSING** — No standalone beverage logging page. Current food-log integration is insufficient for tracking water/drinks as primary feature.

**Target for Port:** Create `/app/(app)/beverage-log/page.tsx` and `/beverage-log/new` with TCA-inspired state management (Zustand store), reusing `BeverageLogService` and beverage card components.

---

### 4. Challenges

| iOS Component | Web Status | Notes |
|---|---|---|
| `ChallengesListView.swift` | 🔴 **MISSING** | `/challenges` redirects to `/fitcircles`; no dedicated library view |
| `ChallengeTemplateCard.swift` | 🟡 **PARTIAL** | `ChallengeTemplateGrid.tsx` component exists but unused in active flow |
| `ChallengeLibraryView.swift` | 🟡 **PARTIAL** | Repurposed to FitCircles; component exists (`ChallengeLibraryFeature.swift`) but disconnected |
| `CreateChallengeView.swift` | 🟡 **PARTIAL** | `ChallengeCreationWizard.tsx` exists but only in FitCircle context (Step 2 of circle wizard) |
| `CustomChallengeWizardFeature.swift` | 🟡 **PARTIAL** | Custom wizard stub; not fully functional or visible |
| `CircleChallengeDetailView.swift` | 🟡 **PARTIAL** | Challenge detail modal in circle context exists; standalone is missing |
| `CirclePickerSheet.swift` | 🟡 **PARTIAL** | Exists as part of circle detail but not extractable standalone |

**Classification:** 🟡 **PARTIAL** (leaning MISSING) — Challenges are entirely subsumed into FitCircles. No standalone "Challenges" landing page with library discovery, template browsing, or custom creation wizard. This is a major UX divergence from iOS.

**Target for Port:** Separate `/challenges` landing (template library + search), `/challenges/[id]` (detail view), and `/challenges/create` (wizard). Reuse existing components; decouple from FitCircles context.

---

### 5. CheckIns

| iOS Component | Web Status | Notes |
|---|---|---|
| `ProgressHistoryFeature.swift` (TCA) | 🟡 **PARTIAL** | Fetch/display logic exists but only in dashboard context |
| `CheckInDetailView.swift` (edit modal) | 🟡 **PARTIAL** | Modal exists (`CheckInDetailModal.tsx` & `CheckInDetailSheet.tsx`) but read-only in dashboard |
| `EditCheckInView.swift` | 🔴 **MISSING** | No ability to edit past check-in dates/values from modal |
| History range picker (week/month/all) | 🔴 **MISSING** | No date range filter UI |
| `CheckInRow.swift` (list component) | ✅ **PARITY** | `CheckInCard.tsx` renders individual check-ins |

**Classification:** 🟡 **PARTIAL** — Check-in cards visible on dashboard but missing:
- Edit sheet for past entries
- Dedicated check-in history page with filtering
- Privacy toggle UI (code exists but no modal button)

**Target for Port:** Create `/app/(app)/check-ins/page.tsx` listing all check-ins with date range picker, reuse modals from dashboard, add edit capability to `CheckInDetailModal`.

---

### 6. DailyChallenge

| iOS Component | Web Status | Notes |
|---|---|---|
| `DailyChallengeFeature.swift` (TCA) | 🔴 **MISSING** | No TCA reducer or state management |
| `DailyChallengeDetailView.swift` | 🔴 **MISSING** | No detail modal or page |
| `DailyChallengeProgressView.swift` | 🔴 **MISSING** | No progress ring visualization |
| `DailyChallengeWidget.swift` | 🔴 **MISSING** | No dashboard widget |
| Leaderboard | 🔴 **MISSING** | No leaderboard modal |
| Join flow | 🔴 **MISSING** | No join confirmation |

**Classification:** 🔴 **MISSING** — Daily Challenges are completely absent from web. iOS has dedicated reducer, detail view, progress tracking, and leaderboard.

**Target for Port:** Create `/app/(app)/daily-challenge/page.tsx` with `DailyChallengeService`, Zustand store, animated progress ring (use `circular-progress` component), and join/log flow. Consider dashboard widget integration later.

---

### 7. DailyGoals

| iOS Component | Web Status | Notes |
|---|---|---|
| `DailyGoalFeature.swift` (TCA) | 🟡 **PARTIAL** | `useDailyGoals` hook exists; goal recommendations endpoint exists |
| `DailyGoalProgressView.swift` | ✅ **PARITY** | `GoalProgressIndicator.tsx` renders goal progress |
| `GoalSetupView.swift` | 🟡 **PARTIAL** | `GoalSettingForm.tsx` and `GoalSetupDialog.tsx` components exist but not in full onboarding flow |
| Goal metrics (steps, weight, workouts) | ✅ **PARITY** | Steps and weight goals in profile; workouts missing |
| Goal recommendation flow | 🟡 **PARTIAL** | API endpoint exists; UI not integrated into onboarding |

**Classification:** 🟡 **PARTIAL** — Goal creation/editing works in profile; missing:
- Full DailyGoalFeature TCA equivalent (has Zustand hook instead)
- Goal recommendation modal on first signup
- Workout minutes goal type
- Goal detail view with historical progress

**Target for Port:** No major changes needed; ensure goal setup is triggered in onboarding and add workout goal type to profile.

---

### 8. Dashboard

| iOS Component | Web Status | Notes |
|---|---|---|
| `DashboardFeature.swift` (TCA) | 🟡 **PARTIAL** | Heavy state management exists in `/dashboard/page.tsx` (1000+ lines, not TCA) |
| `HealthSyncBanner.swift` (May 17 feature) | 🔴 **MISSING** | No Apple Health / HealthKit sync status banner |
| `PastDateLogModal.swift` | ✅ **PARITY** | `BackfillDataDialog.tsx` allows logging past dates |
| `ImprovedTrackingChart.swift` | ✅ **PARITY** | Weight & steps charts via Recharts |
| `StepHistoryView.swift` | 🟡 **PARTIAL** | Steps shown in chart but no dedicated detail sheet |
| Widgets (StreakWidget, GoalWidget, etc.) | 🟡 **PARTIAL** | Some exist; missing DailyChallenge, Momentum, auto-sync clarity |
| Offline banner | 🟡 **PARTIAL** | Component exists; integration unclear |

**Classification:** 🟡 **PARTIAL** — Core dashboard exists and is feature-rich (quick log, charts, check-ins). Missing:
- HealthKit sync status banner (iOS May 17 feature)
- Step history detail sheet
- More prominent daily challenge widget
- Momentum flame visualization
- Better auto-sync unlock UX

**Target for Port:** Add `HealthSyncBanner` equivalent (web would show "Connect to Health" CTA if applicable), integrate daily challenge more visibly, add momentum display.

---

### 9. ExerciseLog

| iOS Component | Web Status | Notes |
|---|---|---|
| `ExerciseLogView.swift` (main list) | 🔴 **MISSING** | No dedicated exercise log page; service exists but no UI |
| `ExerciseLogFeature.swift` (TCA) | 🔴 **MISSING** | State management missing (service: `exercise-service.ts` exists) |
| `ExerciseEntryFormView.swift` | 🔴 **MISSING** | No form for new exercise entries |
| `ExerciseEntryDetailView.swift` | 🔴 **MISSING** | No detail/edit modal |
| Activity type picker | 🔴 **MISSING** | No enum of exercise types (running, cycling, swimming, etc.) |
| Intensity picker | 🔴 **MISSING** | No UI for low/med/high intensity selection |

**Classification:** 🔴 **MISSING** — Exercise logging is completely absent from web UI, despite backend service existing. iOS has full CRUD, activity type picker, and intensity controls.

**Target for Port:** Create `/app/(app)/exercise-log/page.tsx`, `/exercise-log/new`, and detail modals. Build TCA-like Zustand store for exercise state. Reuse form components from food-log pattern. Add activity type enum selector.

---

### 10. FitCircles

| iOS Component | Web Status | Notes |
|---|---|---|
| `CirclesListFeature.swift` (TCA) | 🟡 **PARTIAL** | Web has list at `/fitcircles`; missing filter tabs (active/upcoming/past) |
| `CircleDetailFeature.swift` | 🟡 **PARTIAL** | `/fitcircles/[id]` page exists (1878 lines); comprehensive but shows divergences |
| `CreateCircleFeature.swift` (4-step wizard) | 🟡 **PARTIAL** | `CircleCreationWizard.tsx` exists; web version differs in UX |
| `Step1BasicInfoView.swift` | 🟡 **PARTIAL** | Name/description/visibility in wizard step 1 |
| `Step2ChallengeView.swift` | 🟡 **PARTIAL** | Challenge selection in step 2 |
| `CircleQuestsFeature.swift` | 🔴 **MISSING** | No quest UI or leaderboard |
| `CircleQuestDetailView.swift` | 🔴 **MISSING** | Quest detail view missing |
| `CircleBoostFeature.swift` | 🔴 **MISSING** | No boost UI or history |
| `InviteGeneratorView.swift` | 🟡 **PARTIAL** | Invite link generation exists; unclear if copy-to-clipboard works |
| Participant management | 🟡 **PARTIAL** | List visible; remove/edit unclear |
| Leaderboard | 🟡 **PARTIAL** | Component exists; integration may be incomplete |

**Classification:** 🟡 **PARTIAL** — Circle CRUD and detail view functional; missing critical sub-features (quests, boosts) that are prominent in iOS. List lacks filter tabs.

**Target for Port:** Add filter tabs to circle list, implement quest CRUD and leaderboard, implement boost feature (history + purchase flow), enhance invite modal, add copy-to-clipboard feedback.

---

### 11. FoodLog

| iOS Component | Web Status | Notes |
|---|---|---|
| `FoodLogView.swift` (main list) | ✅ **PARITY** | `/app/(app)/food-log` page with list and stats |
| `FoodLogFeature.swift` (TCA) | 🟡 **PARTIAL** | Service exists; state in component, not TCA |
| `FoodLogEntryFormView.swift` | ✅ **PARITY** | `/food-log/new` form exists |
| `FoodLogCameraView.swift` | 🔴 **MISSING** | No camera capture for photos (web: file upload only) |
| `PhotoPickerFeature.swift` | 🟡 **PARTIAL** | File picker via standard input; native photo library missing |
| `FoodLogEntryDetailView.swift` | 🟡 **PARTIAL** | Detail view exists but editing in modal not clear |
| Meal type picker (breakfast/lunch/dinner/snack) | ✅ **PARITY** | Component exists |
| Nutrition estimation | 🟡 **PARTIAL** | Service layer references it; UI unclear |
| Category-based logging | ✅ **PARITY** | Categories shown in new entry form |

**Classification:** 🟡 **PARTIAL** — Food logging functional (list, create, basic edit). Missing camera capture (unavoidable on web without native app) and photo library integration (can add via web Camera/File APIs). Detail view editing unclear.

**Target for Port:** Clarify edit flow from detail view, consider adding Camera API for photo capture (fallback to file upload), ensure nutrition preview UI is visible on form.

---

### 12. Momentum

| iOS Component | Web Status | Notes |
|---|---|---|
| `MomentumFeature.swift` (TCA) | 🔴 **MISSING** | No reducer or page |
| `MomentumDetailView.swift` | 🔴 **MISSING** | No detail view or full-screen momentum display |
| `MomentumFlameView.swift` (animated flame) | 🔴 **MISSING** | No flame icon or animation |
| `MomentumMilestoneView.swift` (achievement card) | 🔴 **MISSING** | No milestone celebration modal |
| Flame level (1-5) + animation | 🔴 **MISSING** | No visual representation of momentum progression |
| Milestone history | 🔴 **MISSING** | No milestone tracking UI |

**Classification:** 🔴 **MISSING** — Momentum is completely absent from web. iOS has animated flame, milestone celebrations, and detailed progression view.

**Target for Port:** Create `/app/(app)/momentum/page.tsx` with Zustand store, animated flame component (Framer Motion), milestone modal, and history list. Integrate `momentum-service.ts` backend. Add flame widget to dashboard.

---

### 13. Notifications

| iOS Component | Web Status | Notes |
|---|---|---|
| `PushPermissionView.swift` | 🔴 **MISSING** | No in-app push notification permission request UI |
| `PushNotificationService.swift` | 🟡 **PARTIAL** | Backend service exists; no browser push subscription UI |
| `StreakNotificationService.swift` | 🟡 **PARTIAL** | Streak notification service exists; no in-app UI |
| Notification preferences/settings | 🔴 **MISSING** | No toggles for notification types (streaks, challenges, etc.) |
| Permission flow modal | 🔴 **MISSING** | No "Enable notifications?" modal on first login |

**Classification:** 🟡 **PARTIAL** (leaning MISSING) — Backend notification infrastructure exists. Missing:
- In-app permission request modal (PWA push)
- Notification preferences in settings
- In-app notification center or toast handling for push events

**Target for Port:** Add `PushPermissionView.tsx` modal to onboarding/dashboard, implement notification preferences toggle in `/settings/notifications`, wire up service worker push event handling.

---

### 14. Onboarding

| iOS Component | Web Status | Notes |
|---|---|---|
| `OnboardingFeature.swift` (TCA, ~15 steps) | 🟡 **PARTIAL** | Web stub at `/onboarding` with only 4 steps |
| `OnboardingCoordinatorView.swift` | 🟡 **PARTIAL** | Basic navigation; missing step progression indicator |
| `OnboardingSplashView.swift` | 🟡 **PARTIAL** | Welcome screen exists but minimal |
| `OnboardingQuestionnaireView.swift` (4-question persona quiz) | 🔴 **MISSING** | No persona assessment |
| `OnboardingAssessmentView.swift` (fitness assessment) | 🔴 **MISSING** | No fitness level questions |
| `FitnessAssessmentQuestionView.swift` | 🔴 **MISSING** | No individual question UI |
| `OnboardingMeetFitzyView.swift` (mascot intro) | 🔴 **MISSING** | No Fitzy character introduction |
| `OnboardingProfileSetupView.swift` | 🟡 **PARTIAL** | Height/weight/gender collection exists in onboarding |
| `OnboardingSetGoalsView.swift` | 🟡 **PARTIAL** | Goal setup step exists |
| `OnboardingCircleRecommendationsView.swift` | 🔴 **MISSING** | No circle suggestions/recommendations |
| `OnboardingCompletionView.swift` | 🔴 **MISSING** | No "you're all set" celebration screen |
| `FitzyAvatar.swift` (animated character) | 🔴 **MISSING** | No mascot animation |
| `HeightInputView.swift` (picker UI) | 🟡 **PARTIAL** | Height input exists; unclear if picker or text input |
| `CircularSlider.swift` (numeric input) | 🟡 **PARTIAL** | May exist in component library |
| Persona detection & recommendations | 🔴 **MISSING** | No persona calculation or result-based recommendations |

**Classification:** 🔴 **MISSING** (leaning 🟡 PARTIAL) — Web has skeleton 4-step flow; iOS has 15-step rich assessment with persona detection, circle recommendations, health sync, and celebration. This is a major UX gap.

**Target for Port:** Expand `/onboarding` to 15-step flow matching iOS structure:
1. Splash
2. Welcome (email/password)
3. Questionnaire (4 persona questions)
4. Fitness assessment (multiple questions)
5. Meet Fitzy
6. Profile setup (height, weight, gender)
7. Goal setup
8. Persona flow (personalized content based on results)
9. Circle recommendations
10. Health permissions (sync consent)
11. First check-in
12. Celebration modal
13. Dashboard tour
14. Completion
15. Redirect to app

Implement `persona-service.ts` integration, add Fitzy animation, circle recommendation logic, and celebration modal.

---

### 15. Profile

| iOS Component | Web Status | Notes |
|---|---|---|
| `ProfileFeature.swift` (TCA) | 🟡 **PARTIAL** | Profile page exists at `/profile`; state in component, not TCA |
| `EditProfileView.swift` (bio, avatar, display name) | 🟡 **PARTIAL** | Edit form exists but avatar upload unclear |
| `EditProfileFeature.swift` | 🟡 **PARTIAL** | Service layer exists; no dedicated edit modal |
| `SettingsView.swift` (root) | 🟡 **PARTIAL** | Settings structure exists at `/settings`; incomplete tabs |
| `DisplaySettingsView.swift` (theme, language, units) | 🟡 **PARTIAL** | Unit toggle exists; no theme or language pickers |
| `HealthKitSettingsView.swift` | 🔴 **MISSING** | No HealthKit auth/sync toggle (web would be "Health Connect" or similar) |
| `NotificationSettingsView.swift` | 🔴 **MISSING** | No notification preference toggles |
| `PrivacySettingsView.swift` | 🟡 **PARTIAL** | Privacy settings page exists at `/settings/privacy`; unclear what's configurable |
| `HistoricalDataFeature.swift` (export/import) | 🔴 **MISSING** | No data export/import UI |
| Goal editing (weight, steps) | ✅ **PARITY** | Goal edit in profile works |

**Classification:** 🟡 **PARTIAL** — Profile view and basic settings exist. Missing:
- Avatar upload modal
- Theme/language preferences UI
- Health sync settings (web equivalent)
- Notification preferences
- Data export/import
- Full settings tabs organization

**Target for Port:** Add missing settings pages:
- `/settings/display` — theme (dark only currently), language
- `/settings/health` — sync preferences
- `/settings/notifications` — notification type toggles
- `/settings/privacy` — ensure configured properly
- `/settings/data` — export/import options
Implement avatar upload in edit profile modal. Verify all goal edit flows.

---

### 16. QuickLog

| iOS Component | Web Status | Notes |
|---|---|---|
| `QuickLogView.swift` (modal UI) | 🔴 **MISSING** | No dedicated quick-log modal for express exercise logging |
| `QuickLogFeature.swift` (TCA) | 🔴 **MISSING** | No state management for quick log |
| `DurationPickerView.swift` (preset durations) | 🔴 **MISSING** | No preset duration selector |
| `BrandPickerView.swift` (activity selector) | 🔴 **MISSING** | No quick activity picker |
| Minimal form with speed focus | 🔴 **MISSING** | No express logging UX |

**Classification:** 🔴 **MISSING** — QuickLog is entirely absent from web. iOS has dedicated modal for fast exercise entry without validation friction.

**Target for Port:** Create `QuickLogModal.tsx` component with minimal form (activity preset, duration preset, intensity quick select) as floating action or dashboard card. Integrate with exercise log backend.

---

### 17. Share

| iOS Component | Web Status | Notes |
|---|---|---|
| `ShareCardView.swift` (progress card) | 🔴 **MISSING** | No shareable progress card generation |
| `ShareCardFeature.swift` (TCA) | 🔴 **MISSING** | No share state management |
| `ShareCardTrigger.swift` (CTA logic) | 🔴 **MISSING** | No trigger logic or button |
| Native share activity view | 🟡 **PARTIAL** | Web can use native Web Share API; no UI to trigger |
| Dynamic card rendering | 🔴 **MISSING** | No canvas/image generation of progress cards |

**Classification:** 🔴 **MISSING** — Share cards completely absent. iOS generates animated progress cards and opens native share sheet.

**Target for Port:** Create `ShareCardDialog.tsx` with:
- Progress card preview (using Recharts or canvas)
- Share button (Web Share API or copy-to-clipboard fallback)
- Custom message input
- Social link generation
Integrate `share-card-service.ts` backend.

---

### 18. Streaks

| iOS Component | Web Status | Notes |
|---|---|---|
| `EngagementStreakFeature.swift` (TCA) | 🟡 **PARTIAL** | Core streak state exists; `EngagementStreakCard.tsx` on dashboard |
| `EngagementStreakDetailView.swift` (full detail page) | 🔴 **MISSING** | No dedicated streak detail page |
| `DailyCheckInFeature.swift` (TCA) | 🟡 **PARTIAL** | Check-in modal exists; integration into streaks unclear |
| `DailyCheckInView.swift` | 🟡 **PARTIAL** | Check-in UI exists in dashboard context |
| `StreakCalendarView.swift` (heatmap, recently modified May 19) | 🔴 **MISSING** | No calendar heatmap visualization |
| `StreakClaimButton.swift` | 🔴 **MISSING** | No claim button or UI |
| `RetroactiveClaimView.swift` (claim past streaks) | 🔴 **MISSING** | No retroactive claim flow |
| `StreakClaimContainerView.swift` | 🔴 **MISSING** | No claim container/coordinator |
| `StreakHistoryFeature.swift` & View | 🟡 **PARTIAL** | History modal exists (`StreakHistoryModal.tsx`); limited functionality |
| `MetricStreaksView.swift` (weight/steps streaks) | 🔴 **MISSING** | No separate metric streak tracking view |
| `StreakCelebrationView.swift` (animation) | 🔴 **MISSING** | No milestone celebration animation |
| `MilestoneCelebrationView.swift` | 🔴 **MISSING** | No milestone modal |
| `StreakRecoveryBanner.swift` ("use shield" or "reclaim") | 🔴 **MISSING** | No recovery prompt banner |
| Freeze purchases (XP vs. currency) | 🔴 **MISSING** | No freeze purchase modal or payment flow |
| Shield badge/visual | 🔴 **MISSING** | No shield indicator on streak card |
| Pause/resume with date picker | 🔴 **MISSING** | No pause modal or date selection |
| `StreakActivityFeedView.swift` (circle activity) | 🔴 **MISSING** | No activity feed for streaks in circles |

**Classification:** 🔴 **MISSING** (leaning 🟡 PARTIAL) — Streak system is severely incomplete. Only dashboard card and history modal exist. iOS has rich detail page, calendar, claims, freeze purchases, and celebrations.

**Target for Port:** Create `/app/(app)/streaks/page.tsx` with:
- Engagement streak detail card (current level, flame animation)
- Calendar heatmap (activity grid by day)
- Daily check-in button
- Claim/retroactive claim flow
- Pause/resume modal with date picker
- Freeze purchase modal (XP cost)
- Milestone celebration modal
- Streak recovery banner
- Metric streak tabs (weight, steps, etc.)
Add all to `engagement-streak-service.ts` integration and Zustand store.

---

## Summary Counts

### By Classification

| Status | Count | Affected Areas |
|---|---|---|
| ✅ **PARITY** | 8 | Auth (partial), Food Log, Daily Goals (partial), Dashboard (partial), Check-Ins (cards only), Challenges (template card only) |
| 🟡 **PARTIAL** | 28 | Auth, BeverageLog, Challenges, CheckIns, DailyGoals, Dashboard, ExerciseLog, FitCircles, FoodLog, Onboarding, Profile, Streaks, Food/Beverage components |
| 🔴 **MISSING** | 42 | Ads, BeverageLog (page), Challenges (library), DailyChallenge (entire), ExerciseLog (page + CRUD), Momentum (entire), QuickLog (entire), Share Cards (entire), Streaks (calendar, claims, freeze, celebrations), Notifications (UI), Onboarding (10 steps), Profile (edit modal, settings tabs), Quests/Boosts |
| ⚪ **N/A** | 8 | Apple Health sync banner (web: N/A but needs equivalent), Native camera (web: file API only), HealthKit (web: Health Connect or none), Push notifications native (web: PWA push instead), iOS app tracking transparency (web: N/A) |

### By Feature Area Priority

**🔴 CRITICAL (0% UI, block user engagement):**
1. Streaks detail page, calendar, claims, freeze
2. Daily Challenges
3. Momentum visualization
4. FitCircles quests/boosts
5. Share Cards

**🟡 HIGH (partial UI, confuses users):**
6. Challenges (library/discovery)
7. ExerciseLog (no page)
8. BeverageLog (no page)
9. Onboarding (4-step → 15-step expansion)
10. Profile (settings tabs incomplete)

**🔵 MEDIUM (polish, nice-to-have):**
11. QuickLog
12. Notifications (settings UI)
13. Ads (monetization)
14. CheckIns detail editing

---

## Recent iOS Work Not Yet on Web (Last 30 Days)

Based on iOS inventory "recently modified" tracking:

| iOS Feature (Modified) | Last Modified | Web Status | Port Target |
|---|---|---|---|
| **Streaks Shield Mechanics** | May 19, May 8 | 🔴 Missing | `/streaks` page: pause/freeze modal, shield visual |
| **Dashboard HealthKit Banner** | May 17, 19 | 🔴 Missing | `/dashboard`: add health sync permission banner component |
| **Onboarding Assessment** | May 2+ | 🔴 Stub | `/onboarding`: expand to 15-step flow with questionnaire |
| **FitCircles Quests/Boosts** | May 19+ | 🔴 Missing | `/fitcircles/[id]`: quest list, leaderboard, boost UI |
| **Challenges Library Refactor** | May 4+ | 🟡 Partial | `/challenges`: create standalone library (currently in fitcircles) |
| **Momentum (newly active)** | May+ | 🔴 Missing | `/momentum`: animated flame, milestone view |
| **Share Cards** | May 19+ | 🔴 Missing | `/app/share`: card generator, social share modal |
| **Daily Challenges** | May 19+ | 🔴 Missing | `/daily-challenge`: landing page, leaderboard |
| **Authentication Improvements** | May 2+ | 🟡 Partial | Add Google OAuth, improve error UX |
| **Momentum Milestones** | May 19+ | 🔴 Missing | `/momentum`: milestone history, celebration animations |

---

## Recommended Port Order

### Phase 1: P0 Quick Wins (Effort: 2-3 weeks)

**Goal:** Close highest-impact, shortest-effort gaps to unlock core UX loops.

1. **Streaks Calendar & Detail Page** (Effort: 4-5 days)
   - Port `StreakCalendarView.swift` heatmap to web (Recharts or custom SVG)
   - Create `/app/(app)/streaks/page.tsx` with detail display
   - Integrate `engagement-streak-service.ts`
   - Add daily check-in button linking to dashboard flow
   - **Impact:** Unblock streak visualization + streak claiming workflow

2. **Daily Challenges Landing** (Effort: 3-4 days)
   - Create `/app/(app)/daily-challenge/page.tsx`
   - Port `DailyChallengeFeature` logic to Zustand store
   - Display current challenge, join button, progress ring, leaderboard
   - Reuse `circular-progress` component for ring visualization
   - **Impact:** New daily engagement loop; ties to dashboard

3. **Momentum Visualization** (Effort: 3-4 days)
   - Create `/app/(app)/momentum/page.tsx`
   - Implement flame animation (Framer Motion, SVG, or Lottie)
   - Display milestone history + next milestone
   - Add flame widget to dashboard
   - **Impact:** Gamification loop; dashboard polish

4. **ExerciseLog Page + CRUD** (Effort: 4-5 days)
   - Create `/app/(app)/exercise-log/page.tsx` + `/exercise-log/new`
   - Build Zustand store for exercise state (pattern: use `useDailyGoals` as template)
   - Reuse form components from food-log pattern
   - Add activity type selector (running, cycling, swimming, etc.)
   - **Impact:** Complete activity tracking; pairs with food/beverage logs

5. **FitCircles Quests & Boosts** (Effort: 4-5 days)
   - Add quest list + detail modal to `/fitcircles/[id]`
   - Implement quest leaderboard modal
   - Add boost UI (history, purchase modal for shields)
   - Integrate with existing `circle-challenge-service.ts`
   - **Impact:** Unlock circle engagement loops; social competition

**Phase 1 Subtotal:** ~20 days (4 weeks with parallel work)

---

### Phase 2: Medium Impact Features (Effort: 3-4 weeks)

6. **Onboarding Expansion to 15 Steps** (Effort: 5-6 days)
   - Expand `/onboarding` from 4 to 15 steps
   - Implement persona questionnaire (4 questions → persona detection)
   - Add fitness assessment questions
   - Implement circle recommendations logic (via `onboarding-service.ts`)
   - Add health sync consent screen
   - Add first check-in flow + celebration modal
   - **Impact:** Improved new user retention; persona-driven recommendations

7. **Notification Settings UI** (Effort: 2-3 days)
   - Create `/settings/notifications` page
   - Add toggles for notification types (streaks, challenges, quests, milestones, etc.)
   - Wire to `notification-preferences-service.ts`
   - Add PWA push subscription modal to dashboard/onboarding
   - **Impact:** User control over engagement; reduces churn

8. **Standalone BeverageLog Page** (Effort: 2-3 days)
   - Create `/app/(app)/beverage-log/page.tsx` (duplicate food-log structure)
   - Port `BeverageQuickLogView.swift` as modal/card
   - Add favorites manager UI
   - Ensure water preset buttons prominent
   - **Impact:** Dedicated hydration tracking; complete logging trio (food, beverage, exercise)

9. **Standalone Challenges Library** (Effort: 3-4 days)
   - Move challenges out of fitcircles context
   - Create `/challenges` landing with template library + search
   - Implement custom challenge wizard (currently only in circle creation)
   - Add challenge detail page (template view before creation)
   - **Impact:** Challenge creation without circle dependency; self-contained feature

10. **Share Cards Implementation** (Effort: 3-4 days)
    - Implement card preview generator (Recharts or canvas rendering)
    - Add share modal with Web Share API fallback
    - Integrate `share-card-service.ts` backend
    - Add share button to dashboard, streaks, achievements
    - **Impact:** Social virality loop; user-generated content sharing

**Phase 2 Subtotal:** ~21 days (4 weeks)

---

### Phase 3: Polish & Nice-to-Have (Effort: 2-3 weeks)

11. **Profile Settings Tabs** (Effort: 2-3 days)
    - Complete `/settings/display` (theme, language)
    - Complete `/settings/health` (sync preferences)
    - Add `/settings/data` (export/import)
    - Implement avatar upload modal in profile edit
    - **Impact:** User customization; data privacy control

12. **QuickLog Modal** (Effort: 2 days)
    - Create express logging modal for exercise
    - Add preset activity + duration selector
    - Minimal form, fast submission
    - Surface as dashboard card or floating button
    - **Impact:** Friction reduction for power users

13. **Streaks Freeze Purchase Flow** (Effort: 2-3 days)
    - Implement freeze purchase modal (XP cost)
    - Add pause/resume with date picker
    - Integrate with `streak-claiming-service.ts`
    - Add shield badge visual to streak card
    - **Impact:** Monetization loop; engagement retention

14. **CheckIn Detail Edit Sheet** (Effort: 1-2 days)
    - Enhance `CheckInDetailModal.tsx` with edit capability
    - Add date picker for past check-in editing
    - Add privacy toggle UI
    - **Impact:** Data correction; user confidence

15. **Ads System (if needed)** (Effort: 5-7 days)
    - Implement rewarded ad widget (for PWA if monetization needed)
    - Add frequency capping logic
    - Wire to backend ad configuration
    - **Impact:** Monetization (optional, depends on product roadmap)

**Phase 3 Subtotal:** ~15 days (3 weeks)

---

## Port Architecture Guidelines

### Recommended Tech Stack (Web Equivalents)

| iOS Pattern | Web Equivalent | Library/Location |
|---|---|---|
| **TCA Reducers** | Zustand stores | `/stores/` + `/hooks/useFeatureName` |
| **SwiftUI Views** | React TSX components | `/components/` organized by feature |
| **Navigation** | Next.js App Router | Routes in `/app/(app)/` |
| **Services** | Service classes in `/lib/services/` | Already following this pattern |
| **Models** | TypeScript types in `/lib/types/` | Already following this pattern |
| **UI Components** | shadcn/ui (Radix + Tailwind) | `/components/ui/` |
| **Animations** | Framer Motion | Already in use (`motion` import) |
| **State (Global)** | Zustand atoms (per feature) | Auth store already using this |
| **Async State** | React hooks + service layer | Use `useState` + service calls |

### Component Pattern (Template)

```typescript
// /components/FeatureName.tsx
'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useFeatureStore } from '@/stores/feature-store'; // Zustand
import { FeatureService } from '@/lib/services/feature-service';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  userId?: string;
}

export function FeatureComponent({ userId }: Props) {
  const { state, setState } = useFeatureStore();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (userId) {
      void loadData();
    }
  }, [userId]);

  async function loadData() {
    setIsLoading(true);
    try {
      const data = await FeatureService.fetchData(userId!);
      setState(data);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Card>
        {/* UI */}
      </Card>
    </motion.div>
  );
}
```

### Service Pattern (Template)

```typescript
// /lib/services/feature-service.ts
import { createServerSupabase } from '@/lib/supabase-server';

export class FeatureService {
  static async fetchData(userId: string) {
    const supabase = await createServerSupabase();
    const { data } = await supabase
      .from('feature_table')
      .select('*')
      .eq('user_id', userId);
    return data;
  }

  static async updateData(userId: string, updates: any) {
    const supabase = await createServerSupabase();
    const { data } = await supabase
      .from('feature_table')
      .update(updates)
      .eq('user_id', userId)
      .select();
    return data;
  }
}
```

### Store Pattern (Template)

```typescript
// /stores/feature-store.ts
import { create } from 'zustand';

interface FeatureState {
  items: any[];
  isLoading: boolean;
  error: string | null;
  setState: (state: Partial<FeatureState>) => void;
}

export const useFeatureStore = create<FeatureState>((set) => ({
  items: [],
  isLoading: false,
  error: null,
  setState: (newState) => set(newState),
}));
```

---

## Migration Checklist for Each Port

When porting an iOS feature to Web:

- [ ] Create Zustand store at `/stores/feature-store.ts`
- [ ] Create service class at `/lib/services/feature-service.ts`
- [ ] Create types at `/lib/types/feature.ts`
- [ ] Create main page at `/app/(app)/feature/page.tsx`
- [ ] Create detail modal/sheet at `/components/feature/FeatureDetail.tsx`
- [ ] Create list component at `/components/feature/FeatureList.tsx`
- [ ] Wire service to API routes in `/app/api/feature/`
- [ ] Add Tailwind styling (use dark theme + accent colors)
- [ ] Add Framer Motion animations where iOS has transitions
- [ ] Test on mobile (responsive design with Tailwind breakpoints)
- [ ] Add to main navigation (navbar/bottom nav)
- [ ] Write integration tests (follow pattern in `/components/__tests__/`)

---

## High-Level Effort Estimate

| Phase | Duration | Features | Effort |
|---|---|---|---|
| **Phase 1** | 4 weeks | Streaks, Daily Challenges, Momentum, ExerciseLog, FitCircles Quests | 20 days |
| **Phase 2** | 4 weeks | Onboarding, Notifications, BeverageLog, Challenges, Share Cards | 21 days |
| **Phase 3** | 3 weeks | Settings, QuickLog, Freeze, CheckIn Edit, Ads (optional) | 15 days |
| **Total** | ~11 weeks | All 18 feature areas + extras | ~56 days |

**With 1 full-time dev + 0.5 QA: 12-14 weeks to feature parity.**

---

## Divergences Worth Investigating

1. **Challenges Architecture:** iOS separates challenges from circles; web merged them. Consider whether web design is intentional (simpler model) or should align with iOS.
2. **Authentication:** iOS has Apple Sign-In; web has email/password only. Recommend adding Google OAuth for parity in user convenience.
3. **Health Integration:** iOS heavily features HealthKit (sync banner, permissions, background sync). Web needs equivalent: Health Connect on Android, or skip if web-only. If supporting Android app later, this is critical.
4. **Streaks Claims:** iOS has retroactive claim flow with evidence submission. Web can simplify or mirror.
5. **Onboarding Persona:** iOS detects user persona (athlete, wellness, casual); web doesn't. This drives recommendations; web needs equivalent.

---

**Generated:** 2026-05-19  
**Analyst:** Claude (AI Code Review)
**Status:** Ready for Prioritization
