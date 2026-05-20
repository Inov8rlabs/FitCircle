# FitCircle iOS App - Complete Feature Inventory
**Date:** May 19, 2026  
**Platform:** iOS (Swift, SwiftUI, TCA)  
**Architecture:** Composable Architecture (TCA) with MVVM components  

---

## 1. Features/ Subdirectories

### **Ads/**
Rewarded and interstitial ad system with frequency capping and user profiling.

**Screens/Views:**
- `FitCircleNativeAdCard.swift` — Native ad card container
- `BannerAdView.swift` — Bottom banner ad placement
- `RewardedAdButton.swift` — Button triggering rewarded ad flow (recently modified)
- `FitCircleNativeAdView.swift` — Full native ad renderer
- `AdLoadingPlaceholder.swift` — Skeleton loading state
- `NativeAdClickableWrapper.swift` — Interactive wrapper for ad tap
- `NativeAdLoader.swift` — Ad fetch and caching orchestrator

**TCA/ViewModels:** None (stateless components driven by AdManager)

**Core Managers:**
- `AdManager.swift` — Main ad orchestration (Core/Ads)
- `RewardedAdManager.swift` — Rewarded ad state machine
- `InterstitialAdManager.swift` — Interstitial ad controller
- `AdFrequencyManager.swift` — Impression capping and throttling
- `AdConfiguration.swift` — Ad unit IDs and configuration
- `UserAdProfile.swift` — User ad eligibility and targeting
- `ATTManager.swift` — App Tracking Transparency handling
- `AdContentCustomizer.swift` — Dynamic ad content personalization
- `AdsFeatureFlag.swift` — Feature flag for ad system

**Sub-flows/Modals:**
- Rewarded ad completion callback with XP reward UI
- Impression event tracking to backend
- Ad network (Google Mobile Ads) integration

**A/B Gates:**
- `useTestAdUnitsInNonProduction` flag (Core/Ads/AdConfiguration.swift) — toggles test vs. production ad unit IDs
- `AdsFeatureFlag` — global on/off for entire ad system

---

### **Authentication/**
Login, signup, password reset, and Apple Sign-In flows.

**Screens/Views:**
- `LoginFeature.swift` — TCA reducer for login/signup state (recently modified)
- No dedicated LoginView.swift found (likely in AppFeature or root coordinator)

**TCA Reducers:**
- **LoginFeature** — state: email, password, isLoading, errorMessage (with enum LoginError.Kind), resendConfirmationStatus, authResponse; actions: loginButtonTapped, signUpTapped, signInWithAppleTapped, forgotPasswordTapped, resendConfirmationTapped, loginResponse, signUpResponse, signInWithAppleResponse, dismissError
- **ForgotPasswordFeature** — password reset flow (recently modified)

**Services:**
- `AppleSignInManager.swift` — Apple Sign-In orchestration (recently modified)

**Sub-flows/Modals:**
- Forgot Password sheet (`ForgotPasswordFeature`)
- Email confirmation resend flow
- Password strength validation
- Sign-up validation (email format, password >= 8 chars, username availability check)

**Feature Flags:** None explicit

---

### **BeverageLog/**
Hydration and beverage tracking with quick-log shortcuts.

**Screens/Views:**
- `BeverageLogView.swift` — Main beverage log list (recently modified)
- `BeverageLogFeature.swift` — TCA reducer (recently modified)
- `BeverageQuickLogView.swift` — Quick-add beverage card (recently modified)
- `BeverageEntryFormView.swift` — Entry form with category, volume, calories, caffeine
- `FavoritesManagerView.swift` — Manage favorite beverages

**TCA Reducers:**
- **BeverageLogFeature** — state: entries, isLoading, showEntryForm, selectedEntry, favorites, syncStatus; actions: loadBeverageLogs, createBeverageEntry, updateEntry, deleteEntry, syncPending

**Services:**
- `BeverageLogService.swift` — CRUD and sync logic (Core/Services)

**Models:**
- `BeverageLog.swift` — BeverageLogEntry with id, loggedAt, category (enum), volumeMl, calories, caffeineMg, brand, syncStatus

**Sub-flows/Modals:**
- Quick-add modal with brand picker and volume picker
- Entry detail edit sheet
- Favorites quick-access bar

**UX Notable:**
- Renamed from QuickLog to BeverageQuickLog to avoid naming conflicts (from git history)

---

### **Challenges/**
Challenge templates, custom challenge creation, and circle-based challenges.

**Screens/Views:**
- `ChallengesListView.swift` — Challenge library browser (recently modified)
- `ChallengeTemplateCard.swift` — Template card component (recently modified)
- `CircleChallengeDetailView.swift` — Challenge detail in a circle context (recently modified)
- `ChallengeDetailFeature.swift` — TCA reducer (recently modified)
- `ChallengeLibraryView.swift` — Discover & join public challenges (recently modified, was repurposed from template library)
- `ChallengeLibraryFeature.swift` — TCA for library discovery (recently modified)
- `CreateChallengeView.swift` — Challenge creation wizard (recently modified)
- `CirclePickerSheet.swift` — Select circle to add challenge to (recently modified)
- `ChallengesViewModel.swift` — Legacy view model (recently modified, coexists with TCA)
- **CustomWizard/** — Multi-step custom challenge builder
  - `CustomChallengeWizardFeature.swift` — TCA reducer
  - `CustomChallengeWizardView.swift` — Wizard UI
  - `UnitPickerView.swift` — Unit selection (kg, lbs, steps, mins, etc.)

**TCA Reducers:**
- **ChallengeDetailFeature** — state: challenge, participants, leaderboard, isLoading, joinStatus; actions: loadChallenge, joinChallenge, logProgress, dismissDetail
- **ChallengeLibraryFeature** — state: templates, filters, selectedTemplate, isLoading, searchQuery; actions: loadTemplates, selectTemplate, joinChallenge
- **CustomChallengeWizardFeature** — multi-step: name, description, metricType, target, duration, unit, startDate, endDate

**Models:**
- `ChallengeTemplate.swift` — Pre-built templates with category, description, metricType, target
- `ChallengeTemplates.swift` — List response model
- `CircleChallenge.swift` — Circle-bound challenge with participants and progress tracking

**Sub-flows/Modals:**
- Custom wizard (5+ steps, dismissible)
- Circle picker modal
- Leaderboard modal (participants and rankings)
- Join confirmation flow

**Feature Flags:** 
- `onboarding.template_category` — re-enable library category filtering (from git history, suggests previous disable)

---

### **CheckIns/**
Daily check-in history, progress tracking, and individual check-in details.

**Screens/Views:**
- `CheckInRow.swift` — Row component for list
- `ProgressHistoryFeature.swift` — TCA for historical progression
- `CheckInDetailView.swift` — Modal detail view for a single check-in
- `EditCheckInView.swift` — Edit past check-in entry

**TCA Reducers:**
- **ProgressHistoryFeature** — state: entries, selectedDate, isLoading, filterType; actions: loadHistory, selectDate, updateEntry, deleteEntry

**Models:** Uses DailyTracking (defined in Core/Models)

**Sub-flows/Modals:**
- Edit check-in modal (date, value, privacy toggle)
- History range picker (week, month, all)

---

### **DailyChallenge/**
Time-limited daily challenges with progress and leaderboard.

**Screens/Views:**
- `DailyChallengeFeature.swift` — TCA reducer (recently modified)
- `DailyChallengeDetailView.swift` — Challenge detail modal (recently modified)
- `DailyChallengeProgressView.swift` — Progress ring and stats (recently modified)
- `DailyChallengeWidget.swift` — Compact widget for dashboard (recently modified)

**TCA Reducers:**
- **DailyChallengeFeature** — state: currentChallenge, userProgress, leaderboard, isLoading, joined, showDetail; actions: loadChallenge, joinChallenge, updateProgress, loadLeaderboard

**Models:**
- `DailyChallenge.swift` — name, description, metric, target, startDate, endDate, joinedCount
- `DailyChallengeProgress.swift` — user's current value and rank

**Sub-flows/Modals:**
- Join confirmation
- Leaderboard modal
- Progress update submission

**UX Notable:**
- Progress ring animation (EnhancedProgressRing from DesignSystem)
- Daily reset at midnight logic

---

### **DailyGoals/**
Personal daily fitness goals (steps, weight, workouts) with progress tracking.

**Screens/Views:**
- `DailyGoalFeature.swift` — TCA reducer
- `DailyGoalProgressView.swift` — Progress indicator and stats
- `GoalSetupView.swift` — Goal creation/edit form

**TCA Reducers:**
- **DailyGoalFeature** — state: goals[], selectedGoal, isLoading, editMode; actions: loadGoals, createGoal, updateGoal, deleteGoal, toggleGoal

**Models:**
- `DailyGoal.swift` — metric (enum: steps, weight, workoutMinutes), target, current, unit, completedAt
- `GoalRecommendation.swift` — Server-recommended defaults

**Sub-flows/Modals:**
- Create/edit goal modal
- Goal recommendation sheet (on first setup)

---

### **Dashboard/**
Main app hub—activity tracking, daily stats, widgets, health sync status.

**Screens/Views:**
- `DashboardFeature.swift` — TCA root reducer (recently modified, ~100+ states)
- `HealthSyncBanner.swift` — Apple Health permission & sync status banner (recently modified, added May 17)
- `PastDateLogModal.swift` — Logging for historical dates
- `ImprovedTrackingChart.swift` — Weight/steps chart visualization
- `StepHistoryView.swift` — 7-day step history detail
- **Widgets/** — Sub-components:
  - `StreakWidget.swift` — Engagement streak display
  - `DailyGoalsWidget.swift` — Daily goals overview
  - `WeeklyGoalsWidget.swift` — Weekly goals summary
  - `DataSubmissionWidget.swift` — Pending submission prompt
  - `AutoSyncSubmissionCard.swift` — Auto-sync enabled indicator
  - `MissingDaysWidget.swift` — Backfill missing data CTA

**TCA Reducers:**
- **DashboardFeature** — State: user, stats (TrackingStats), trackingHistory[], engagementStreak, momentum, dailyGoals, dailyChallenge, shareCardContext, pendingSubmissions, healthKitSyncStatus, pendingSyncDates[], isOffline, showHealthSyncBanner, healthKitBannerDismissedThisSession
  - Actions: loadStats, logWeight, logSteps, syncHealthKit, selectChartType, updateGoal, submitPendingAutoSync, acknowledgeOfflineMode
  - Sub-reducers: momentum (MomentumFeature), dailyGoals (DailyGoalFeature), dailyChallenge (DailyChallengeFeature)

**Models:**
- `DailyTracking.swift` — weight, steps, mood, calories, waterIntake, workoutMinutes, syncStatus, timestamp
- `TrackingStats.swift` — aggregated stats (current, weekly avg, goal progress)

**Services:**
- `HealthKitManager.swift` — Apple Health reading and sync (recently modified May 19)
- `HealthKitSyncService.swift` — Background sync orchestration

**Sub-flows/Modals:**
- Health Kit authorization flow (from HealthSyncBanner CTA)
- Past-date logging modal
- Step history detail sheet
- Quick-log shortcuts (weight, steps, mood)

**Feature Gates:**
- `healthKitSyncStatus` enum (granted, denied, notDetermined, syncing, error) — drives banner visibility
- `healthKitBannerDismissedThisSession` — prevents nagging
- `healthKitRequestingAuthorization` — loading state during permission request

**UX Notable:**
- Health sync status banner with actionable CTA (May 17 feature)
- Offline banner if isOffline=true
- Glass cards with subtle animations
- Chart type toggle (weight vs. steps)
- Bulk sync spinner (isBulkSyncing state)

---

### **ExerciseLog/**
Manual exercise entry with duration, intensity, calories burned.

**Screens/Views:**
- `ExerciseLogView.swift` — Main exercise log list
- `ExerciseLogFeature.swift` — TCA reducer
- `ExerciseEntryFormView.swift` — Exercise entry form (activity type, duration, intensity, calories)
- `ExerciseEntryFormFeature.swift` — TCA for form state
- `ExerciseEntryDetailView.swift` — Detail/edit modal
- `ExerciseEntryDetailFeature.swift` — TCA for detail state

**TCA Reducers:**
- **ExerciseLogFeature** — state: entries[], isLoading, selectedEntry, filters; actions: loadLog, createEntry, updateEntry, deleteEntry
- **ExerciseEntryFormFeature** — state: activityType, duration, intensity, calories, notes, timestamp; actions: saveEntry, validateInput
- **ExerciseEntryDetailFeature** — state: entry, editMode; actions: loadEntry, updateEntry, deleteEntry

**Models:**
- `ExerciseLog.swift` — activity (enum: running, cycling, swimming, etc.), duration (mins), intensity (enum: low/med/high), calories, notes, timestamp, syncStatus

**Sub-flows/Modals:**
- Entry form modal
- Detail/edit sheet
- Activity type picker
- Intensity picker

---

### **FitCircles/**
Social fitness circles (teams/groups) with challenges, quests, boosts, and participant management.

**Screens/Views:**
- **Main List:**
  - `CirclesListFeature.swift` — TCA list feature (recently modified)
  - Implicit list view (no separate CirclesListView.swift found; likely in routing)
  - Filter tabs: active, upcoming, past

- **Circle Detail:**
  - `CircleDetailFeature.swift` — TCA detail reducer
  - Implicit detail view

- **Create Wizard:**
  - `CreateCircleWizardView.swift` — Multi-step wizard (4 steps)
  - `CreateCircleFeature.swift` — TCA reducer (recently modified)
  - Step views:
    - `Step1BasicInfoView.swift` — Name, description, visibility (recently modified)
    - `Step2ChallengeView.swift` — Select challenge template (recently modified)
    - `Step2TimelineView.swift` — Start/end dates
    - `Step3SettingsView.swift` — Privacy, max participants (recently modified)
    - `Step4ReviewView.swift` — Confirmation (recently modified)

- **Manage Circle:**
  - `ManageCircleView.swift` — Admin settings
  - `ManageCircleFeature.swift` — TCA for management

- **Quests Sub-feature:**
  - `CircleQuestsView.swift` — Quest list (recently modified)
  - `CircleQuestsFeature.swift` — TCA quest list (recently modified)
  - `CircleQuestDetailView.swift` — Quest detail (recently modified)
  - `CircleQuestDetailFeature.swift` — TCA quest detail (recently modified)
  - `CircleQuestLeaderboardView.swift` — Quest leaderboard (recently modified)

- **Boost Sub-feature:**
  - `CircleBoostView.swift` — Boost UI/history (recently modified)
  - `CircleBoostFeature.swift` — TCA boost state (recently modified)

- **Invite:**
  - `InviteGeneratorView.swift` — Share invite link
  - `InviteGeneratorFeature.swift` — Invite link generation

**TCA Reducers:**
- **CirclesListFeature** — state: circles[], filter (enum: active/upcoming/past), showJoinModal, joinCode, circleDetail (presented), createCircle (presented), challengeLibrary (presented); actions: loadCircles, selectCircle, joinWithCode, showCreateModal, showChallengeLibrary
- **CircleDetailFeature** — state: circle, participants[], leaderboard[], challenges[], quests[], boosts[], isLoading; actions: loadCircle, loadLeaderboard, updateCircle, leaveCircle, removeParticipant
- **CreateCircleFeature** — state: step (enum 1-4), basicInfo, selectedChallenge, timeline, settings; actions: nextStep, previousStep, updateField, createCircle, validation
- **CircleQuestsFeature** — state: quests[], selectedQuest, isLoading; actions: loadQuests, selectQuest, createQuest, updateProgress
- **CircleBoostFeature** — state: boostStatus, history[], isLoading; actions: loadBoost, viewHistory

**Models:**
- `FitCircle.swift` — id, name, description, status (enum: draft/active/upcoming/completed/cancelled), visibility (enum: public/private/friends), createdBy, participants[], challenges[], startDate, endDate, metadata
- `CircleQuest.swift` — id, title, description, metric, target, startDate, endDate, participants, progress[]
- `CircleBoost.swift` — boostType (enum), duration, multiplier, appliedAt, expiresAt
- `CircleChallenge.swift` — challenge specific to a circle (from Core/Models)

**Sub-flows/Modals:**
- Create circle multi-step wizard (4 steps)
- Join circle by code modal
- Participant list modal
- Leaderboard modal
- Quest progress submission flow
- Boost history sheet
- Invite link generation & share sheet

**A/B Gates:**
- `onboarding.template_category` — re-enable template category picker in Step2ChallengeView (mentioned in git)

**UX Notable:**
- Wizard with progress indicator
- Tab-based filtering on list
- Animated transitions between steps
- Copy-to-clipboard for invite link
- Leaderboard rank highlighting

---

### **FoodLog/**
Photo-based meal logging with category, notes, optional nutrition estimation.

**Screens/Views:**
- `FoodLogView.swift` — Main food log list
- `FoodLogFeature.swift` — TCA list feature
- `FoodLogEntryFormView.swift` — Entry form with photo picker
- `FoodLogEntryFormFeature.swift` — TCA form state
- `FoodLogEntryDetailView.swift` — Detail/edit modal
- `FoodLogEntryDetailFeature.swift` — TCA detail state
- `FoodLogCameraView.swift` — Camera capture UI
- `FoodLogCameraFeature.swift` — TCA camera state
- `PhotoPickerFeature.swift` — Photo library picker
- `PhotoPickerView.swift` — Photo picker UI
- **Components:**
  - `CameraViewRepresentable.swift` — UIViewControllerRepresentable for native camera
  - `FoodLogEntryRow.swift` — List row component
  - `FoodLogComponents.swift` — Shared form components

**TCA Reducers:**
- **FoodLogFeature** — state: entries[], isLoading, selectedEntry, filters; actions: loadLog, createEntry, updateEntry, deleteEntry, applyFilter
- **FoodLogEntryFormFeature** — state: category, mealType, description, photoURL, mealType (enum: breakfast/lunch/dinner/snack), timestamp; actions: saveEntry, uploadPhoto
- **FoodLogCameraFeature** — state: capturedImage, isCapturing; actions: capturePhoto, retakePhoto, usePhoto
- **PhotoPickerFeature** — state: selectedPhotos[], isLoading; actions: selectPhoto, removePhoto, confirmSelection

**Models:**
- `FoodLog.swift` — FoodLogEntry with id, category (enum: beverage/supplement/meal), mealType, description, photoURL, waterMl (if logged), timestamp, syncStatus

**Services:**
- `FoodLogService.swift` — CRUD, photo upload, nutrition parsing (Core/Services)

**Sub-flows/Modals:**
- Camera capture modal (full-screen)
- Photo library picker modal
- Entry form sheet
- Detail/edit sheet
- Category/meal-type picker

**UX Notable:**
- Camera integration with retake flow
- Photo preview before save
- Inline photo display in list rows
- Gesture-based edit (swipe/long-press)

---

### **Momentum/**
Streak & consistency gamification with flame levels and milestones.

**Screens/Views:**
- `MomentumFeature.swift` — TCA reducer (recently modified)
- `MomentumDetailView.swift` — Full-screen detail (recently modified)
- `MomentumFlameView.swift` — Animated flame icon (recently modified)
- `MomentumMilestoneView.swift` — Milestone achievement card (recently modified)

**TCA Reducers:**
- **MomentumFeature** — state: currentFlameLevel (1-5), milestones[], nextMilestone, checkedInDaysCount, isLoading; actions: loadMomentum, checkIn, dismissMilestone

**Models:**
- `Momentum.swift` — currentLevel, flame (0-100), streakDays, nextLevelAt, milestones[]

**Sub-flows/Modals:**
- Milestone celebration modal (with animation)
- Detail view with milestone history

**UX Notable:**
- Animated flame (particle effects or Lottie)
- Gradient backgrounds matching flame level
- Celebration animation on milestone unlock

---

### **Notifications/**
Push notification settings and permission flows.

**Screens/Views:**
- `PushPermissionView.swift` — Request push notification permission (recently modified)

**TCA/Models:** None explicit (simple permission view)

**Services:**
- `PushNotificationService.swift` — Device token registration, notification handling (Core/Services)
- `StreakNotificationService.swift` — Streak-specific notifications (Core/Services)

**Sub-flows/Modals:**
- System permission request prompt (native iOS)
- Fallback "Enable in Settings" modal

---

### **Onboarding/**
Multi-screen new user setup with fitness assessment, goal setting, circle recommendations.

**Screens/Views:**
- `OnboardingFeature.swift` — TCA root feature (recently modified, ~100+ states, ~15 steps)
- `OnboardingCoordinatorView.swift` — Navigation coordinator (recently modified)
- `OnboardingAssessmentFeature.swift` — TCA for fitness assessment (recently modified)
- **Screens Sub-folder:**
  - `OnboardingWelcomeView.swift` — Email/password signup
  - `OnboardingSplashView.swift` — Splash intro
  - `OnboardingQuestionnaireView.swift` — 4-question persona quiz
  - `OnboardingAssessmentView.swift` — Fitness level assessment
  - `FitnessAssessmentQuestionView.swift` — Individual assessment question
  - `OnboardingMeetFitzyView.swift` — Intro to Fitzy mascot
  - `OnboardingProfileSetupView.swift` — Height, weight, gender
  - `OnboardingSetGoalsView.swift` — Daily goals config
  - `OnboardingPersonaFlowViews.swift` — Persona-specific content
  - `OnboardingCircleRecommendationsView.swift` — Suggested circles to join
  - `OnboardingCompletionView.swift` — Final "you're all set" screen
  - `OnboardingFinalScreens.swift` — Health permission & first check-in
- **Components Sub-folder:**
  - `FitzyAvatar.swift` — Animated Fitzy character
  - `HeightInputView.swift` — Height picker (ft/in or cm)
  - `CircularSlider.swift` — Custom slider for numeric input

**TCA Reducers:**
- **OnboardingFeature** — state: currentStep (enum ~15 values), questionnaireAnswers[], personaScores, detectedPersona, profileSetup (height, weight, gender), userGoals, email, password, passwordStrength, authResponse, assessment (child reducer); actions: nextStep, previousStep, skipStep, answerSelected, calculatePersona, signUp, validatePassword, completeOnboarding
- **OnboardingAssessmentFeature** — state: questions[], currentQuestion, selectedAnswers[], personaScores; actions: loadQuestions, answerQuestion, calculatePersona

**Models:**
- `Onboarding.swift` — OnboardingStep (enum), PersonaScores, ProfileSetup, UserGoal, Persona (enum: athlete, wellness, casual, etc.)

**Services:**
- Assessment submission to backend

**Sub-flows/Modals:**
- Multi-step wizard (splash → welcome → questionnaire → meetFitzy → profileSetup → setGoals → personaFlow → healthPermissions → firstCheckIn → celebration → dashboardTour → complete)
- Skip confirmation alert
- Health permission system modal
- Circle recommendations picker

**Feature Flags:**
- `onboarding.template_category` — controls whether Step2 shows category filter (mentioned in git)

**UX Notable:**
- Animated Fitzy mascot (FitnessAvatar component)
- Circular slider for smooth numeric input
- Progress bar across steps
- Persona-driven recommendations
- Celebration screen with animation

---

### **Profile/**
User profile display, settings, health preferences, historical data export.

**Screens/Views:**
- `ProfileFeature.swift` — TCA root
- Implicit profile list view
- **EditProfile Sub-folder:**
  - `EditProfileView.swift` — Bio, avatar, display name edit
  - `EditProfileFeature.swift` — TCA edit state
- **Settings Sub-folder:**
  - `SettingsView.swift` — Settings list root
  - `SettingsFeature.swift` — TCA settings state
  - `DisplaySettingsView.swift` — Theme, language, units
  - `HealthKitSettingsView.swift` — Health Kit authorization & sync controls
  - `NotificationSettingsView.swift` — Notification preference toggles
  - `PrivacySettingsView.swift` — Profile visibility, data sharing
- **HistoricalData Sub-folder:**
  - `HistoricalDataFeature.swift` — Data export/import functionality

**TCA Reducers:**
- **ProfileFeature** — state: user, editMode, showSettings; actions: loadProfile, updateProfile, logout
- **EditProfileFeature** — state: displayName, bio, avatar, isLoading; actions: updateProfile, uploadAvatar
- **SettingsFeature** — state: notifications (struct), privacy (struct), display (struct); actions: updateNotificationSettings, updatePrivacySettings, updateDisplaySettings

**Models:**
- Uses User from Core/Models

**Sub-flows/Modals:**
- Avatar upload modal
- Bio/name edit sheet
- Settings toggles and pickers
- Health Kit authorization from settings

**UX Notable:**
- Toggle switches for preferences
- Segmented pickers for theme/units
- Avatar upload with preview

---

### **QuickLog/**
Express logging for exercise with duration and intensity presets.

**Screens/Views:**
- `QuickLogView.swift` — Quick-log modal UI (recently modified)
- `QuickLogFeature.swift` — TCA state (recently modified)
- `DurationPickerView.swift` — Preset duration selector (recently modified)
- `BrandPickerView.swift` — Brand/activity selector (recently modified)

**TCA Reducers:**
- **QuickLogFeature** — state: selectedActivity, selectedDuration, selectedIntensity; actions: selectActivity, selectDuration, submitLog, dismiss

**Models:**
- `QuickLog.swift` — activity, duration (minutes), intensity level

**Sub-flows/Modals:**
- Quick-log modal (sheet or bottom modal)
- Duration picker (swipe-able or segmented)
- Brand/activity picker

**UX Notable:**
- Minimal form for speed
- Swipe/drag for duration selection
- Instant submit without validation

---

### **Share/**
Social sharing of progress and achievements.

**Screens/Views:**
- `ShareCardView.swift` — Shareable progress card (recently modified)
- `ShareCardFeature.swift` — TCA share state (recently modified)
- `ShareCardTrigger.swift` — Trigger logic & CTA (recently modified)

**TCA Reducers:**
- **ShareCardFeature** — state: cardContent, shareURL, showActivityViewController; actions: generateCard, share, dismiss

**Models:**
- `ShareCard.swift` — imageURL, text, metrics summary

**Services:**
- ShareCard generation endpoint (APIClient)

**Sub-flows/Modals:**
- Native share activity view controller

**UX Notable:**
- Dynamic progress card rendering (likely Canvas-based or custom View)
- Native iOS share sheet

---

### **Streaks/**
Daily engagement streaks, streak claims, freeze purchases, calendar view, milestone celebrations.

**Screens/Views:**
- `EngagementStreakFeature.swift` — TCA feature for engagement tracking
- `EngagementStreakDetailView.swift` — Full streak detail page
- `EngagementStreakWidget.swift` — Dashboard widget (recently modified)
- `DailyCheckInView.swift` — Daily check-in UI (recently modified)
- `DailyCheckInFeature.swift` — TCA check-in state (recently modified)
- `StreakShieldWidget.swift` — Freeze shield status indicator
- `StreakCalendarView.swift` — Calendar heatmap view (recently modified)
- **Streak Claim Sub-flows:**
  - `StreakClaimViewModel.swift` — Legacy view model (recently modified)
  - `StreakClaimButton.swift` — CTA button
  - `RetroactiveClaimView.swift` — Claim past streaks
  - `StreakClaimContainerView.swift` — Recently updated wrapper (mentioned as added)
- **Streak History Sub-flows:**
  - `StreakHistoryFeature.swift` — TCA history state
  - `StreakHistoryView.swift` — History list view
- **Activity History Sub-flows:**
  - `ActivityHistoryDetailFeature.swift` — TCA detail state
  - `ActivityHistoryDetailView.swift` — Detail view for single activity
- **Metric Streaks:**
  - `MetricStreaksView.swift` — Weight/steps/workout streaks list
  - `MetricStreakDetailView.swift` — Metric-specific streak detail
- **Celebrations & Recovery:**
  - `StreakCelebrationView.swift` — Milestone celebration animation
  - `MilestoneCelebrationView.swift` — Milestone unlock modal
  - `StreakRecoveryBanner.swift` — "Use shield" or "Reclaim" prompt
- **Feed:**
  - `StreakActivityFeedView.swift` — Activity feed for circle

**TCA Reducers:**
- **EngagementStreakFeature** — state: streak, activities[], calendarDays[], showPauseSheet, showFreezeSheet, showCelebration, pauseResumeDate, selectedPaymentMethod (enum: xp/currency), isPurchasing, activityDetail (child reducer); actions: loadStreak, togglePauseSheet, pauseStreak, pauseResponse, purchaseFreeze, purchaseResponse, dismissCelebration, checkMilestone
- **DailyCheckInFeature** — state: showCheckIn, selectedActivities[], isSubmitting; actions: toggleActivity, submitCheckIn, checkInResponse, dismiss
- **StreakHistoryFeature** — state: history[], isLoading, filters; actions: loadHistory, applyFilter
- **ActivityHistoryDetailFeature** — state: activity, details, isLoading; actions: loadActivity

**Models:**
- `StreakModels.swift` — EngagementStreak (currentStreak, lastCheckInDate, paused, pausedUntil, freezeBalance, milestones), EngagementActivity (activityDate, activityType enum: weightLog/stepsLog/moodLog/circleCheckin/socialInteraction)
- `StreakCheckInModels.swift` — StreakCheckIn (checkInDate, activities, completeness %), StreakCheckInRequest, StreakCheckInResponse, StreakFreezePurchaseRequest, StreakFreezePurchaseResponse
- `StreakClaimModels.swift` — ClaimStreakRequest, ClaimStreakResponse, RetroactiveClaimData

**Services:**
- `StreakClaimAPI.swift` — Claim/freeze endpoints (Core/Services)
- `StreakNotificationService.swift` — Streak notifications (Core/Services)

**Sub-flows/Modals:**
- Pause/Resume streak modal with date picker
- Freeze purchase modal (XP or currency payment)
- Milestone celebration animation overlay
- Streak recovery banner (retroactive claim CTA)
- Calendar view (swipeable or paginated)
- Activity history detail sheet
- Leaderboard modal (if applicable)

**A/B Gates:**
- Freeze purchase payment method (XP vs. currency toggle)

**UX Notable:**
- Animated celebration on milestone (likely Lottie or Canvas with confetti)
- Calendar heatmap with color coding (Met goal → green, partial → yellow, missed → gray)
- Haptic feedback on check-in submission
- Shield badge overlay on streak card (recently added subtle celebration)
- Toast notification on check-in success
- Retroactive claim flow for missed days

---

## 2. Core/ Layer

### **Network/**

**APIClient.swift** (115KB, main endpoint definitions)
- Struct with @Sendable closures for all API operations
- ~80 endpoint definitions covering:
  - Auth: login, register, signInWithApple, refreshToken, getSession
  - Daily Tracking: getDailyTracking, createDailyTracking, updateDailyTracking, bulkSyncDailyTracking
  - FitCircles: getFitCircles, createFitCircle, joinFitCircle, getCircleLeaderboard, updateCircle, leaveCircle, deleteCircle
  - Challenges: getChallengeTemplates, createChallengeFromTemplate, getCircleQuests, createCircleQuest, updateQuestProgress
  - Streaks: getEngagementStreak, pauseStreak, resumeStreak, purchaseFreeze, submitStreakCheckIn
  - Food/Beverage Log: createFoodLogEntry, uploadFoodPhoto, getFoodLog, createBeverageLogEntry, getBeverageLogs
  - Daily/Weekly Goals: getDailyGoals, createDailyGoal, updateDailyGoal, getWeeklyGoals, createWeeklyGoal
  - Momentum: getMomentumStatus, getMomentumMilestones, checkInMomentum
  - Data Submission: submitDataToCircles, checkPendingSubmissions, getMissingDays
  - Share: generateShareCard
  - Profile: getProfile, updateProfile, uploadAvatar, updatePreferences

**APIClient+DailyGoals.swift** — DailyGoal endpoint extension

**APIClient+Challenges.swift** — Challenge endpoint extensions (recently modified for library refactor)

**RefreshCoordinator.swift** — Coordinates token refresh across concurrent requests (prevents duplicate refresh calls)

**TokenRefreshManager.swift** — Token expiry tracking and refresh scheduling

**NetworkError.swift** — Error enum with cases: invalidResponse, decodingError, networkError, unauthorized, serverError, notFound

**DailyGoalError.swift** — Domain-specific error for daily goal operations

### **Services/**

**HealthKitManager.swift** (45KB, recently modified May 19)
- Singleton managing Apple Health integration
- Reads: steps, weight, workout calories
- Authorization request/status tracking
- Background sync scheduling (syncs on app launch, app return from background)
- Methods: `requestAuthorization()`, `readSteps(for:)`, `readWeight()`, `readWorkouts()`, `syncTodaysHealthData()`

**HealthKitSyncService.swift** (25KB) — Orchestrates background HealthKit sync, handles persistence

**FoodLogService.swift** (28KB) — CRUD for food entries, photo upload, local caching

**BeverageLogService.swift** (16KB) — CRUD for beverage entries, favorites management

**PushNotificationService.swift** — Device token registration, notification delegates

**StreakClaimAPI.swift** (10KB) — Dedicated endpoints: claimStreak, useStreakFreeze, retractClaim

**StreakNotificationService.swift** (13KB) — Streak notifications: milestones, at-risk alerts, break recovery

**CheckInService.swift** — Daily check-in submission and validation

**CameraManager.swift** — Photo capture permissions and delegation

**FeatureFlagService.swift** — Feature flag retrieval (calls APIClient for feature gates)

**DeepLinkRouter.swift** — Navigation from deep links (push notifications, share links, etc.)

### **Models/**

**User.swift** — Core user entity with profile, preferences, streaks, goals

**DailyTracking.swift** — weight, steps, mood, calories, waterIntake, workoutMinutes, syncStatus, timestamp

**FitCircle.swift** — Circle data model with participants, status, timeline

**ExerciseLog.swift** — activity, duration, intensity, calories, notes

**FoodLog.swift** — category, mealType, description, photoURL, timestamp

**BeverageLog.swift** — category, brand, volume, calories, caffeine

**StreakModels.swift** — EngagementStreak, EngagementActivity, CalendarDayActivity, StreakCelebration

**StreakCheckInModels.swift** — StreakCheckIn, StreakCheckInRequest/Response, freeze/pause operations

**StreakClaimModels.swift** — RetroactiveClaimData, ClaimStreakRequest/Response, MissedDayRecovery

**DailyGoal.swift** — metric (enum), target, current, unit, completedAt

**WeeklyGoal.swift** — weekly aggregation of daily goals

**DailyChallenge.swift** — name, metric, target, startDate, endDate, joinedCount

**CircleQuest.swift** — quest within circle context

**CircleChallenge.swift** — challenge within circle context

**CircleBoost.swift** — boostType, duration, multiplier

**ChallengeTemplate.swift** — pre-built template with category, metric, target (recently modified May 6)

**ChallengeTemplates.swift** — list response

**Momentum.swift** — currentFlameLevel, milestones, streakDays, nextLevelAt

**Onboarding.swift** — OnboardingStep enum, PersonaScores, ProfileSetup

**QuickLog.swift** — activity, duration, intensity

**ShareCard.swift** — imageURL, text, metrics

**NotificationModels.swift** — notification preferences and payloads

**LeaderboardModels.swift** — LeaderboardEntry, LeaderboardUserRank, ranking metadata

**GoalRecommendation.swift** — recommended default goals

**DataSubmissionModels.swift** — pending submission data structure

**EntryCategory.swift** — category enums for food, beverage, exercise

**APIResponse.swift** — generic response wrapper

**AuthModels.swift** — AuthResponse, LoginRequest, RegisterRequest, AppleSignInRequest

### **Storage/**

**KeychainManager.swift** — Token storage, secure password storage

### **Ads/**

**AdManager.swift** — Main ad orchestration (loads, displays, tracks impressions)

**AdConfiguration.swift** — Ad unit IDs, test device IDs, feature flags

**AdFrequencyManager.swift** — Impression capping, throttling logic

**RewardedAdManager.swift** — Rewarded ad state machine

**InterstitialAdManager.swift** — Interstitial ad display logic

**UserAdProfile.swift** — User ad eligibility, targeting data

**ATTManager.swift** — App Tracking Transparency handling

**AdContentCustomizer.swift** — Dynamic content personalization per user segment

**AdsFeatureFlag.swift** — Feature flag for ads system

### **Other Core Utilities**

**Cache/CacheManager.swift** — In-memory and disk caching for API responses

**Constants/AppConstants.swift** — App-wide constants (API base URL, timeouts, etc.)

**Extensions/** — Foundation/SwiftUI extensions (Date formatting, Color, etc.)

**Utilities/** — Helper functions, validators (EmailValidator, PasswordValidator, etc.)

**Navigation/**
- **DeepLinkCoordinator.swift** — Routes deep links to appropriate screens

---

## 3. DesignSystem/Components/

**GlassCard.swift** — Glassmorphism card with frosted glass background and subtle border (recently optimized to reduce jank; removed redundant `.cornerRadius()` and expensive blur passes)

**StatsCard.swift** (inside GlassCard.swift) — Specialized card for displaying metric stats with icon, title, value

**ShieldAppliedCelebration.swift** — Subtle celebration animation when streak freeze is applied (May 9 feature)

**CelebrationView.swift** — General celebration animation (confetti, particles, or Lottie)

**CircularProgress.swift** — Circular progress indicator (donut chart style)

**EnhancedProgressRing.swift** — Animated progress ring with gradient (used in daily goals, challenges)

**SyncStatusView.swift** — Visual indicator for data sync status (syncing spinner, success checkmark, error state)

**OfflineBannerView.swift** — "You're offline" banner with actionable CTA

**Buttons.swift** — Button variants: primary, secondary, outline, icon buttons with consistent styling

**TextFields.swift** — TextField variants: default, error state, password field (reveal/hide toggle)

**AppTheme.swift** (Theme folder) — Design system tokens:
  - **Colors:** background (slate-950), primary (purple), accent (orange, indigo, pink, cyan), text (primary/secondary/tertiary), status (success/error/warning/info)
  - **Gradients:** multiColor, purple, orange, indigo, green, red
  - **Typography:** largeTitle, title, title2, title3, headline, body, callout, subheadline, footnote, caption
  - **Spacing:** xs (4px), sm (8px), md (16px), lg (24px), xl (32px)
  - **CornerRadius:** sm (8px), md (12px), lg (16px), xl (20px)

---

## 4. Recently Changed (Last 30 Days)

**Most Active Areas (by commit frequency and recent modifications):**

1. **Streaks/** — Very active
   - Shield mechanics refinements (May 19 fixes for false-positive refresh, May 8 subtle celebration)
   - Check-in UX improvements
   - Claim button and calendar view updates

2. **Dashboard/** — Heavy activity
   - Apple Health sync status banner surfaced (May 17 feature, May 19 refinement)
   - Offline sync and pending submission handling
   - Dashboard performance fixes (jank reduction)

3. **Authentication/** — Moderate activity
   - Actionable error UX (May 2)
   - Password reset improvements
   - Apple Sign-In flow

4. **FitCircles/** — Moderate activity
   - Challenge Library repurposed to discover & join public circles (May 4)
   - Circle creation wizard improvements
   - Boost feature refinements

5. **Challenges/** — Moderate activity
   - Template library refactor (May 4)
   - Custom wizard enhancements

6. **Momentum/** — Moderate activity (newly active in sprint)

7. **Onboarding/** — Light activity
   - Template category support (May 2)

**Note:** Many features had minor bug fixes or dependency updates (ads configuration flips, target bumps, duplicate type deduplication), but the above list captures feature-level changes.

---

## 5. Notable iOS-Specific UX Behaviors

### **Haptics**
- Likely on: check-in submission, milestone unlock, streak break recovery
- Files to check: Search for `UIImpactFeedbackGenerator`, `UINotificationFeedback` in all feature files

### **Animations & Transitions**
- **GlassCard:** Optimized to reduce jank with single background + stroke overlay (no `.cornerRadius()` redundancy)
- **CelebrationView:** Likely Lottie-based or Canvas particle effects
- **ShieldAppliedCelebration:** Subtle fade + scale animation on shield apply (May 9)
- **EnhancedProgressRing:** Smooth progress updates with gradient fill
- **StreakCelebrationView:** Full-screen celebration with animations

### **Gradients**
- Multi-color gradients throughout (purple→pink, orange→lighter-orange, indigo→purple)
- Applied to buttons, cards, backgrounds, progress rings

### **Blur Effects**
- Historically used `.ultraThinMaterial.opacity()` but removed in GlassCard optimization (was a perf issue)
- Current approach: transparent fill + stroke on RoundedRectangle

### **Particle Effects**
- CelebrationView likely uses canvas-drawn particles or Lottie
- Streak milestone celebrations

### **Sound**
- No explicit sound files found in inventory; likely disabled or minimal

### **Navigation & Modals**
- TCA-driven `.sheet()` and `.fullScreenCover()` presentations
- Deep-link routing via DeepLinkCoordinator
- Tab-based bottom navigation (5 tabs: Dashboard, Circles, FoodLog, ExerciseLog, Profile)

### **Accessibility**
- VoiceOver support via accessibility modifiers (inferred from iOS best practices, not explicitly inventoried)

---

## Summary Statistics

- **Total Feature Subdirectories:** 18
- **Total Core Models:** 30+
- **Total TCA Reducers:** 40+
- **Total Network Endpoints:** ~80
- **Total Views/Components:** 150+
- **Design System Components:** 10
- **Services:** 11
- **Recently Modified Files (30 days):** ~65+

