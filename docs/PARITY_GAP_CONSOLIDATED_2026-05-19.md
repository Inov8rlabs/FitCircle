# FitCircle Parity Gap — Consolidated Report
**Date:** 2026-05-19
**Source of truth:** iOS app
**Compared platforms:** Android, Web

> ⚠️ This report supersedes the earlier `ANDROID_GAP_ANALYSIS_2026-05-19.md` which
> overestimated Android parity. Direct LOC and file-content verification revealed
> meaningful gaps in newer iOS features (last 30 days). Web report is accurate.

---

## TL;DR

| Platform | Reported Parity | Verified Parity | Key Gap Areas |
|----------|----------------|-----------------|---------------|
| Android  | ~95% (claimed) | **~75% (verified)** | Ads, Streak Claim, Share Cards, Onboarding Assessment, Momentum animation, design-system polish |
| Web      | ~35–40%        | ~35–40% (accurate) | 8 feature areas absent; 6 partial; entire engagement loop is thin |

---

## Android — Verified Gaps (LOC-based)

### 🔴 P0 — Substantial gaps in recent iOS work

| Area | Android LOC | iOS LOC | Coverage | What's missing |
|------|-------------|---------|----------|----------------|
| **Ads** | 205 (2 files) | 2,272 (16 files) | **9%** | AdManager, RewardedAdManager, InterstitialAdManager, AdFrequencyManager, ATTManager, AdContentCustomizer, UserAdProfile, RewardedAdButton, BannerAdView, NativeAdLoader, NativeAdClickableWrapper, FitCircleNativeAdCard, AdLoadingPlaceholder, AdsFeatureFlag |
| **Streak Claim** | 480 (2 files) | 2,290 (4 files) | **21%** | StreakClaimContainerView (670 LOC), RetroactiveClaimView (244 LOC), bulk of StreakClaimViewModel logic (1,099 LOC vs Android 253) |
| **Share Cards** | 320 (1 file) | 677 (3 files) | **47%** | ShareCardFeature (TCA state), ShareCardTrigger (CTA/orchestration), full card-rendering pipeline |
| **Onboarding Assessment** | — | — | **Missing flow** | FitnessAssessmentQuestionView, OnboardingAssessmentView, OnboardingCircleRecommendationsView, OnboardingCompletionView, OnboardingProfileSetupView, OnboardingSetGoalsView, HeightInputView (most assessment + recommendation screens). Android collapses much into `OnboardingRemainingScreens.kt` |
| **Momentum animation** | 793 (2 files) | 1,190 (4 files) | **67%** | MomentumFlameView (animated flame, 343 LOC), MomentumMilestoneView (milestone unlock card, 212 LOC), MomentumFeature TCA state separation |
| **Daily Challenge** | 875 (2 files) | 1,199 (4 files) | **73%** | DailyChallengeDetailView (modal, 477 LOC), DailyChallengeProgressView (ring + stats, 212 LOC), DailyChallengeFeature TCA separation |

### 🟡 P1 — Service / model layer gaps

| iOS file | Android equivalent | Gap |
|----------|-------------------|-----|
| `StreakNotificationService.swift` (378 LOC) | Not found | At-risk alerts, milestone notifications, break-recovery scheduling |
| `StreakClaimAPI.swift` (276 LOC) | Not found as dedicated module | claimStreak / useStreakFreeze / retractClaim — verify they're wired through repositories |
| `CheckInService.swift` | Not found | Verify daily check-in submission/validation lives in a service |
| `FeatureFlagService.swift` | Not found | Feature gate fetching — needed for `onboarding.template_category` etc. |
| `CameraManager.swift` | Inlined likely | Centralized photo capture permissions |

### 🟡 P1 — Design system gaps

| iOS component | Android | Note |
|---------------|---------|------|
| `CelebrationView.swift` | Missing | General confetti/particle celebration |
| `EnhancedProgressRing.swift` | Missing | Animated gradient ring (used for daily goals, challenges) |
| `OfflineBannerView.swift` | Missing | "You're offline" actionable banner |
| `ShieldAppliedCelebration.swift` | Missing | Subtle shield-apply animation (May 9 feature) |
| `SyncStatusView.swift` | Missing | Sync state indicator (spinner / check / error) |

### ✅ Already at parity (verified)

- HealthSyncBanner (134 vs 142 LOC)
- Food Log (AuthenticatedAsyncImage, BeverageIconHelper, camera capture)
- Beverages (favorites manager, quick log)
- Dashboard widgets (Missing Days, Auto Sync, Week-navigable chart, Today Checklist)
- Auth flows (Google Sign-In is the platform-correct analog of Apple Sign-In)
- Engagement Streaks core (calendar, pause, freeze flows present)
- Repositories for FitCircles, Challenges, Tracking, DailyGoals, WeeklyGoals

---

## Web — Verified Gaps (from agent report)

### 🔴 P0 — Entire feature areas absent

1. **Ads** — none (acceptable; PWA may not need)
2. **Notifications** — no in-app or PWA push
3. **Standalone BeverageLog** — no dedicated page
4. **ExerciseLog** — no page at all
5. **QuickLog** — no modal
6. **Share Cards** — no UI
7. **Momentum** — no flame/milestone visualization
8. **Daily Challenges** — no landing page

### 🟡 P1 — Partial implementations

| Area | What exists | What's missing |
|------|-------------|----------------|
| Streaks | Basic widget | Calendar heatmap, freeze purchases, retroactive claims, detail page |
| FitCircles | List + detail | Quests, boosts, sub-feature engagement |
| Challenges | Read-only | Custom wizard, library browse, joining |
| Profile | Single page | Settings tabs (display, health, notifications, privacy), avatar upload |
| Onboarding | 4 steps | Full 15-step iOS flow (assessment, recommendations, celebration) |
| CheckIns | Dashboard only | Detail / edit sheet |

### 🔵 Diverged

- Auth: no Apple Sign-In (consider Google OAuth for web — platform analog)
- Dashboard: no HealthKit banner (could proxy via mobile API + Health Connect)
- Notifications: no in-app feed

---

## Highest-Impact Gaps (Engagement Critical)

These hurt user engagement most and should be prioritized:

1. **Android Ads** — entire monetization layer absent (P0)
2. **Android Streak Claim** — core retention loop, 79% missing (P0)
3. **Android Onboarding Assessment** — first impression / persona detection (P0)
4. **Web Streaks/Daily Challenge/Momentum** — entire daily engagement loop on web is thin (P0)
5. **Web ExerciseLog/BeverageLog** — basic feature absence (P1)
6. **Android Momentum animation** — visible gamification UX (P1)
7. **Android Share Cards** — virality loop incomplete (P1)
8. **Web FitCircles Quests/Boosts** — social engagement layer (P1)

---

## Recommended Execution Plan

### Phase A — Android P0 (estimated 12–15 dev-days)

1. **Streak Claim full port** (4–5d) — StreakClaimContainerView, RetroactiveClaimView, port StreakClaimViewModel logic (1,099 LOC iOS → Kotlin)
2. **Onboarding Assessment flow** (3–4d) — FitnessAssessmentQuestion, OnboardingAssessment, OnboardingCircleRecommendations, OnboardingCompletion, HeightInputView, OnboardingProfileSetup, OnboardingSetGoals
3. **Ads system foundation** (4–5d) — AdManager + RewardedAdManager + InterstitialAdManager + AdFrequencyManager + ATTManager equivalent for Android (Google Mobile Ads), RewardedAdButton, BannerAdView (note: this is heavy; could be scoped down)
4. **Daily Challenge Detail/Progress views** (1–2d) — split out from monolithic Screen file
5. **Momentum FlameView + MilestoneView animations** (1–2d)

### Phase B — Android P1 (estimated 5–7 dev-days)

6. **Design system additions** — CelebrationView, EnhancedProgressRing, OfflineBannerView, ShieldAppliedCelebration, SyncStatusView
7. **Share Cards TCA + Trigger** (1–2d)
8. **StreakNotificationService** Android equivalent (using WorkManager for at-risk alerts)
9. **CheckInService / FeatureFlagService** dedicated modules

### Phase C — Web P0 (estimated 14–18 dev-days)

After Android closes parity:
10. Streaks detail + calendar + freeze + claims (4–5d)
11. Daily Challenges landing (3–4d)
12. Momentum visualization (3–4d)
13. ExerciseLog page (4–5d)
14. FitCircles Quests/Boosts (4–5d)

### Phase D — Web P1 (estimated 14–18 dev-days)

15. Onboarding 15-step flow (5–6d)
16. Notification settings + PWA push (2–3d)
17. Standalone BeverageLog (2–3d)
18. Standalone Challenges + Custom Wizard (3–4d)
19. Share Cards (3–4d)

### Phase E — Polish (1–2 weeks)

Profile settings tabs, QuickLog modal, freeze purchase modal, check-in edit sheet.

---

## What I Recommend We Do First

Given "Android first, then web":

**Sprint 1 (this conversation):** Start Phase A item 1 — **Android Streak Claim full port**. It's the biggest engagement gap, has the clearest iOS reference (StreakClaimContainerView + RetroactiveClaimView + ViewModel), and is a self-contained workstream.

Alternatively, if you want a different first slice, the candidates are:
- **Onboarding Assessment** (smaller scope, higher impact on first-time users)
- **Daily Challenge Detail/Progress split** (quick win, < 2 days)
- **Design system additions** (unblocks many later screens)

Tell me which slice to start, and I'll go deep.
