# iOS Platform Docs

Last updated: 2026-05-19. Companion: [`PLATFORM_DOCS_README.md`](./PLATFORM_DOCS_README.md).

iOS is the **source of truth** for UX and feature behaviour. When porting
to Android or Web, mirror iOS unless there's a platform-specific reason
not to.

---

## 1. Stack

| Layer | Choice |
|-------|--------|
| Language | Swift 5.9+ |
| UI | SwiftUI |
| State / Architecture | The Composable Architecture (TCA) by Point-Free, plus MVVM where TCA is overkill |
| Networking | URLSession via `Core/Network/APIClient` |
| Storage | Keychain (tokens), SwiftData (offline cache), UserDefaults (preferences) |
| Health data | HealthKit (`Core/Services/HealthKitManager`) |
| Ads | Google Mobile Ads SDK (`Core/Ads/*`) |
| Min iOS | 17.0 |

The TCA reducer + state + action pattern is used for any feature with
non-trivial state. Smaller views use plain `@StateObject` ViewModels.

---

## 2. Project layout

```
FitCircle-iOS/
├── FitCircle/
│   ├── FitCircleApp.swift              # @main entry
│   ├── AppDelegate.swift
│   ├── Features/                       # ← all feature code
│   │   ├── AppFeature.swift            # root TCA reducer
│   │   ├── Ads/
│   │   ├── Authentication/
│   │   ├── BeverageLog/
│   │   ├── Challenges/
│   │   ├── CheckIns/
│   │   ├── DailyChallenge/
│   │   ├── DailyGoals/
│   │   ├── Dashboard/
│   │   ├── ExerciseLog/
│   │   ├── FitCircles/                 # the "circles" social layer
│   │   ├── FoodLog/
│   │   ├── Momentum/
│   │   ├── Notifications/
│   │   ├── Onboarding/
│   │   ├── Profile/
│   │   ├── QuickLog/
│   │   ├── Share/
│   │   └── Streaks/
│   ├── Core/
│   │   ├── Network/                    # APIClient + refresh
│   │   ├── Services/                   # platform integrations
│   │   ├── Models/                     # Codable response/request types
│   │   ├── Storage/                    # KeychainManager
│   │   ├── Ads/                        # ad-system managers
│   │   ├── Cache/                      # in-memory + disk cache
│   │   ├── Components/                 # cross-cutting small views
│   │   ├── Extensions/
│   │   └── Utilities/                  # Config, validators
│   └── DesignSystem/
│       ├── Theme/                      # AppTheme
│       └── Components/                 # reusable UI primitives
├── Challenges/                          # (legacy / target metadata)
├── FitCircleTests/
└── FitCircleUITests/
```

**Convention:** every feature lives under `Features/<FeatureName>/` and
imports from `Core/` and `DesignSystem/` — never the other direction.

---

## 3. Feature catalogue

Each feature follows the same pattern: a TCA `Feature` (state + actions)
+ one or more SwiftUI views + any feature-local components. Models live in
`Core/Models/` so they can be shared. Backend calls live in
`Core/Network/APIClient.swift` extensions, sometimes wrapped in a
dedicated `Core/Services/*.swift` actor.

### Ads (`Features/Ads/` + `Core/Ads/`)
**Purpose:** Native, banner, interstitial, rewarded video ads via Google
Mobile Ads.

| File | Role |
|------|------|
| `Core/Ads/AdConfiguration.swift` | Unit IDs (test vs prod), frequency caps, content categories |
| `Core/Ads/AdManager.swift` | SDK init facade, default request builder |
| `Core/Ads/AdFrequencyManager.swift` | Per-session / per-day caps for interstitials |
| `Core/Ads/RewardedAdManager.swift` | Rewarded ad state machine |
| `Core/Ads/InterstitialAdManager.swift` | Interstitial controller |
| `Core/Ads/UserAdProfile.swift` | Premium + personalisation consent |
| `Core/Ads/ATTManager.swift` | App Tracking Transparency prompt |
| `Core/Ads/AdContentCustomizer.swift` | Per-user content personalisation |
| `Core/Ads/AdsFeatureFlag.swift` | Master on/off (with premium gating) |
| `Features/Ads/Components/RewardedAdButton.swift` | "Watch ad for +XP" CTA |
| `Features/Ads/Components/BannerAdView.swift` | Bottom-of-screen banner |
| `Features/Ads/Components/FitCircleNativeAdView.swift` | Inline native ad |
| `Features/Ads/Components/FitCircleNativeAdCard.swift` | Card-styled native variant |
| `Features/Ads/Components/NativeAdLoader.swift` | Cached loader |
| `Features/Ads/Components/NativeAdClickableWrapper.swift` | Click delegation |

### Authentication (`Features/Authentication/`)
**Purpose:** Email/password login + Apple Sign-In + forgot password.

- `LoginFeature.swift` — TCA reducer (email, password, isLoading, errorMessage, resendConfirmationStatus, authResponse). Action surface: `loginButtonTapped`, `signUpTapped`, `signInWithAppleTapped`, `forgotPasswordTapped`, `resendConfirmationTapped`
- `ForgotPasswordFeature.swift` — TCA reducer for password reset
- `AppleSignInManager.swift` (in `Core/Services/`) — wraps `ASAuthorizationAppleIDProvider`

### BeverageLog (`Features/BeverageLog/`)
**Purpose:** Hydration tracking with quick-log and favourites.

- `BeverageLogView.swift`, `BeverageLogFeature.swift` — main list
- `BeverageQuickLogView.swift` — quick-add card
- `BeverageEntryFormView.swift` — detailed entry
- `FavoritesManagerView.swift` — saved favourites
- Service: `Core/Services/BeverageLogService.swift`
- Model: `Core/Models/BeverageLog.swift`

### Challenges (`Features/Challenges/`)
**Purpose:** Browse and create challenges (used in FitCircles context and standalone).

- `ChallengesListView.swift`, `ChallengeLibraryView.swift` — browse
- `ChallengeTemplateCard.swift`, `CircleChallengeDetailView.swift`
- `CreateChallengeView.swift` + `CustomWizard/CustomChallengeWizard*` — multi-step builder
- `CirclePickerSheet.swift` — pick destination circle
- Feature flag `onboarding.template_category` controls category filter visibility

### CheckIns (`Features/CheckIns/`)
**Purpose:** Daily check-in history + detail + edit.

- `CheckInRow.swift`, `CheckInDetailView.swift`, `EditCheckInView.swift`
- `ProgressHistoryFeature.swift` — TCA for historical view
- Backed by `DailyTracking` model (`Core/Models/`)

### DailyChallenge (`Features/DailyChallenge/`)
**Purpose:** Daily time-limited challenge with leaderboard.

- `DailyChallengeFeature.swift` — TCA state
- `DailyChallengeDetailView.swift` — modal detail
- `DailyChallengeProgressView.swift` — progress ring + manual entry + quick-add + "Almost there"
- `DailyChallengeWidget.swift` — compact dashboard widget

### DailyGoals (`Features/DailyGoals/`)
**Purpose:** Steps / weight / workout-minutes daily goals.

- `DailyGoalFeature.swift` — TCA
- `DailyGoalProgressView.swift`, `GoalSetupView.swift`

### Dashboard (`Features/Dashboard/`)
**Purpose:** Main hub. Composes widgets.

- `DashboardFeature.swift` — ~100+ states, sub-reducers for momentum, daily goals, daily challenge
- `HealthSyncBanner.swift` — Apple Health permission prompt
- `Widgets/StreakWidget.swift`, `DailyGoalsWidget.swift`, `WeeklyGoalsWidget.swift`, `DataSubmissionWidget.swift`, `AutoSyncSubmissionCard.swift`, `MissingDaysWidget.swift`
- `PastDateLogModal.swift` — backfill UI
- `ImprovedTrackingChart.swift` — weight/steps line chart

### ExerciseLog (`Features/ExerciseLog/`)
**Purpose:** Manual workout logging.

- `ExerciseLogView.swift` / `ExerciseLogFeature.swift` — list
- `ExerciseEntryFormView.swift` / `ExerciseEntryFormFeature.swift` — entry
- `ExerciseEntryDetailView.swift` — detail/edit

### FitCircles (`Features/FitCircles/`)
**Purpose:** Social groups with challenges, quests, boosts.

- **List**: `CirclesListFeature.swift` (no separate `View` — routed)
- **Detail**: `CircleDetailFeature.swift`
- **Create wizard**: 4 steps (`Step1BasicInfo`, `Step2ChallengeView` or `Step2TimelineView`, `Step3Settings`, `Step4Review`) driven by `CreateCircleFeature.swift`
- **Manage**: `ManageCircleView.swift`, `ManageCircleFeature.swift`
- **Quests** (sub-feature):
  - `CircleQuestsView.swift`, `CircleQuestsFeature.swift`
  - `CircleQuestDetailView.swift`, `CircleQuestDetailFeature.swift`
  - `CircleQuestLeaderboardView.swift`
- **Boost** (sub-feature):
  - `CircleBoostView.swift`, `CircleBoostFeature.swift`
- **Invite**: `InviteGeneratorView.swift`, `InviteGeneratorFeature.swift`

### FoodLog (`Features/FoodLog/`)
**Purpose:** Photo-based meal logging.

- `FoodLogView.swift` / `FoodLogFeature.swift` — main list
- `FoodLogEntryFormView.swift` / `FoodLogEntryFormFeature.swift` — entry
- `FoodLogCameraView.swift` / `FoodLogCameraFeature.swift` — capture (uses `CameraViewRepresentable.swift`)
- `PhotoPickerView.swift` / `PhotoPickerFeature.swift`
- `Components/FoodLogEntryRow.swift`, `Components/FoodLogComponents.swift`

### Momentum (`Features/Momentum/`)
**Purpose:** Engagement streak with flame visual + milestones.

- `MomentumFeature.swift` — TCA state
- `MomentumDetailView.swift` — full-screen detail
- `MomentumFlameView.swift` — animated flame (multi-layer SVG, level-driven colors)
- `MomentumMilestoneView.swift` — full-screen celebration with share

### Notifications (`Features/Notifications/`)
**Purpose:** Push permission flow.

- `PushPermissionView.swift` — request prompt
- Services: `Core/Services/PushNotificationService.swift`, `Core/Services/StreakNotificationService.swift`

### Onboarding (`Features/Onboarding/`)
**Purpose:** 15-step new user flow.

- `OnboardingFeature.swift` — root TCA (~100+ states, step enum drives switch)
- `OnboardingCoordinatorView.swift` — navigates between step views
- `OnboardingAssessmentFeature.swift` — sub-feature for the 5-question fitness assessment
- `Screens/`:
  - `OnboardingSplashView.swift`
  - `OnboardingWelcomeView.swift` (signup)
  - `OnboardingQuestionnaireView.swift` (4-question persona quiz)
  - `OnboardingMeetFitzyView.swift` (mascot intro)
  - `OnboardingProfileSetupView.swift` (height, weight)
  - `OnboardingSetGoalsView.swift` (steps, daily target)
  - `OnboardingAssessmentView.swift` (fitness assessment container)
  - `FitnessAssessmentQuestionView.swift` (per-question UI)
  - `OnboardingCircleRecommendationsView.swift`
  - `OnboardingCompletionView.swift`
  - `OnboardingFinalScreens.swift` (health permission, first check-in)
  - `OnboardingPersonaFlowViews.swift` (persona-specific intros)
- `Components/`: `FitzyAvatar.swift`, `HeightInputView.swift`, `CircularSlider.swift`

### Profile (`Features/Profile/`)
**Purpose:** User profile + settings + historical data.

- `ProfileFeature.swift`
- `EditProfile/EditProfileView.swift` + `EditProfileFeature.swift`
- `Settings/SettingsView.swift`, `SettingsFeature.swift`
- `Settings/DisplaySettingsView.swift`, `HealthKitSettingsView.swift`, `NotificationSettingsView.swift`, `PrivacySettingsView.swift`
- `HistoricalData/HistoricalDataFeature.swift` (data export)

### QuickLog (`Features/QuickLog/`)
**Purpose:** Express exercise logging modal.

- `QuickLogView.swift`, `QuickLogFeature.swift`
- `DurationPickerView.swift`, `BrandPickerView.swift`

### Share (`Features/Share/`)
**Purpose:** Generate + share achievement cards.

- `ShareCardFeature.swift` — TCA state for one card
- `ShareCardView.swift` — preview + share sheet
- `ShareCardTrigger.swift` — defines `ShareCardContext` sealed enum + `ShareCardButton` (3 styles); drop into any feature that has an achievement event

### Streaks (`Features/Streaks/`)
**Purpose:** Daily streak claim hub, retroactive claims, shields.

- `EngagementStreakFeature.swift`, `EngagementStreakDetailView.swift`, `EngagementStreakWidget.swift`
- `StreakClaimContainerView.swift` — main claim screen (hero + sync card + retro strip + shields + milestones + activity feed)
- `StreakClaimButton.swift` — the big circular CTA
- `StreakClaimViewModel.swift` — observable view model (1099 LOC; not TCA because it pre-dates the TCA migration of this area)
- `RetroactiveClaimView.swift` — horizontal 7-day strip
- `StreakShieldWidget.swift` — freeze display
- `StreakCalendarView.swift` — calendar heatmap
- `StreakHistoryView.swift`, `StreakHistoryFeature.swift`
- `DailyCheckInView.swift`, `DailyCheckInFeature.swift`
- `StreakActivityFeedView.swift` — recent activity list
- `StreakRecoveryBanner.swift`
- `MilestoneCelebrationView.swift`, `StreakCelebrationView.swift`
- `MetricStreaksView.swift`, `MetricStreakDetailView.swift` (per-metric streaks)
- `ActivityHistoryDetailView.swift`, `ActivityHistoryDetailFeature.swift`

---

## 4. Core layer

### Network (`Core/Network/`)

- `APIClient.swift` — struct with `@Sendable` closures for ~80 endpoints. Each closure is a typed function. Dependencies are injected via TCA's `@Dependency`.
- `APIClient+Challenges.swift`, `APIClient+DailyGoals.swift` — endpoint extensions
- `RefreshCoordinator.swift` — single-flight token refresh
- `TokenRefreshManager.swift` — schedules pro-active refresh before expiry
- `NetworkError.swift` — `enum NetworkError: Error { case invalidResponse, decodingError, networkError, unauthorized, serverError, notFound, timeout }`
- `DailyGoalError.swift` — domain error

**Pattern:** every endpoint is a `@Sendable` async closure stored on
`APIClient`. To add an endpoint, add the closure to the struct, declare
it in the corresponding `Core/Models/<Feature>.swift` request/response
types, and implement it in the `liveValue`/`testValue` factories.

### Services (`Core/Services/`)

These are platform integrations or business-logic actors that don't fit
the simple endpoint closure pattern:

- `HealthKitManager.swift` — Apple Health reads + permissions
- `HealthKitSyncService.swift` — background sync orchestration
- `FoodLogService.swift` — CRUD + photo upload + caching
- `BeverageLogService.swift` — CRUD + favourites
- `StreakClaimAPI.swift` — dedicated claim endpoints (`claimStreak`, `useStreakFreeze`, etc.)
- `StreakNotificationService.swift` — local notifications via `UserNotifications`
- `PushNotificationService.swift` — device token + APNs registration
- `CheckInService.swift` — daily check-in submission/validation
- `CameraManager.swift` — capture + permissions
- `FeatureFlagService.swift` — fetches feature flags via APIClient
- `DeepLinkRouter.swift` — handles deep links from push / shared URLs
- `AppleSignInManager.swift`

### Models (`Core/Models/`)

Every Codable model lives here. Major models:

- `User.swift`, `AuthModels.swift`, `APIResponse.swift`
- `DailyTracking.swift`, `DailyGoal.swift`, `WeeklyGoal.swift`, `GoalRecommendation.swift`
- `FitCircle.swift`, `CircleChallenge.swift`, `CircleQuest.swift`, `CircleBoost.swift`, `ChallengeTemplate.swift`, `ChallengeTemplates.swift`
- `ExerciseLog.swift`, `FoodLog.swift`, `BeverageLog.swift`
- `StreakModels.swift`, `StreakCheckInModels.swift`, `StreakClaimModels.swift`
- `Momentum.swift`, `DailyChallenge.swift`
- `Onboarding.swift` (assessment types)
- `ShareCard.swift`
- `NotificationModels.swift`, `LeaderboardModels.swift`, `EntryCategory.swift`, `DataSubmissionModels.swift`, `QuickLog.swift`

### Storage (`Core/Storage/`)

- `KeychainManager.swift` — secure token storage with auto-refresh

### Cache (`Core/Cache/`)

- `CacheManager.swift` — in-memory + disk cache for API responses
- `PersistenceManager.swift` — SwiftData-based offline cache (used by `StreakClaimViewModel` for instant UI)
- `OfflineOperationQueue.swift` — queues claim/freeze ops when offline

### Utilities (`Core/Utilities/`)

- `Config.swift` — API base URL, build flags
- `HapticFeedbackType.swift` — wrapper around UIKit haptics (`.light`, `.medium`, `.success`, `.warning`, `.error`)
- `EmailValidator.swift`, `PasswordValidator.swift`

---

## 5. Design system

Path: `DesignSystem/`.

### `Theme/AppTheme.swift` — tokens

```swift
AppTheme.Colors.background       // slate-950
AppTheme.Colors.backgroundCard
AppTheme.Colors.backgroundSecondary
AppTheme.Colors.backgroundTertiary

AppTheme.Colors.purple    // #8B5CF6 — weight, achievements, primary CTA
AppTheme.Colors.indigo    // #6366F1 — steps, info, accent
AppTheme.Colors.orange    // #F97316 — streaks, energy
AppTheme.Colors.green     // #10B981 — success
AppTheme.Colors.cyan      // #06B6D4
AppTheme.Colors.pink      // #EC4899
AppTheme.Colors.yellow

AppTheme.Colors.textPrimary
AppTheme.Colors.textSecondary
AppTheme.Colors.textTertiary
AppTheme.Colors.success / .error / .warning / .info

AppTheme.Gradients.multiColor    // purple→pink→orange (achievement)
AppTheme.Gradients.purple
AppTheme.Gradients.orange
AppTheme.Gradients.indigo
AppTheme.Gradients.green

AppTheme.Spacing.xs   // 4
AppTheme.Spacing.sm   // 8
AppTheme.Spacing.md   // 16
AppTheme.Spacing.lg   // 24
AppTheme.Spacing.xl   // 32
AppTheme.Spacing.xxl  // 48

AppTheme.CornerRadius.sm / .md / .lg / .xl / .full

AppTheme.Typography.largeTitle(weight: .bold)
AppTheme.Typography.title(weight: .bold)
AppTheme.Typography.title2, title3
AppTheme.Typography.headline(weight: .semibold)
AppTheme.Typography.body(weight: .semibold)
AppTheme.Typography.subheadline, caption, caption2
```

### Components (`DesignSystem/Components/`)

| Component | Purpose |
|-----------|---------|
| `Buttons.swift` | `PrimaryButton`, `SecondaryButton`, icon buttons |
| `TextFields.swift` | Styled input variants (default, error, password reveal) |
| `GlassCard.swift` | Frosted card background (optimised for perf — single fill + stroke, no `.cornerRadius` redundancy) |
| `CircularProgress.swift` | Donut progress |
| `EnhancedProgressRing.swift` | Apple-Fitness-inspired ring with glow at 100 % |
| `CelebrationView.swift` | Full-screen confetti + emoji |
| `ShieldAppliedCelebration.swift` | Subtle shield apply animation (glow + sparkles burst) |
| `SyncStatusView.swift` | `LastSyncedIndicator`, `SyncStatusBar`, `CompactSyncIndicator`, `DataFreshnessBadge` |
| `OfflineBannerView.swift` | Top-of-screen offline pill + `PendingSyncBadge` + `SyncStatusChip` |

---

## 6. Patterns

### TCA feature template

```swift
@Reducer
struct MyFeature {
    @ObservableState
    struct State: Equatable {
        var items: [Thing] = []
        var isLoading = false
        var errorMessage: String?
    }

    enum Action: BindableAction {
        case binding(BindingAction<State>)
        case onAppear
        case itemsLoaded(Result<[Thing], Error>)
        case selectItem(Thing.ID)
    }

    @Dependency(\.apiClient) var apiClient

    var body: some ReducerOf<Self> {
        BindingReducer()
        Reduce { state, action in
            switch action {
            case .binding: return .none
            case .onAppear:
                state.isLoading = true
                return .run { send in
                    await send(.itemsLoaded(Result { try await apiClient.getThings() }))
                }
            case .itemsLoaded(.success(let items)):
                state.isLoading = false
                state.items = items
                return .none
            case .itemsLoaded(.failure(let error)):
                state.isLoading = false
                state.errorMessage = error.localizedDescription
                return .none
            case .selectItem:
                return .none
            }
        }
    }
}
```

Then a `View` consumes it:

```swift
struct MyView: View {
    @Bindable var store: StoreOf<MyFeature>

    var body: some View {
        List(store.items, id: \.id) { item in
            Button(item.name) { store.send(.selectItem(item.id)) }
        }
        .onAppear { store.send(.onAppear) }
    }
}
```

### Sub-reducer composition

```swift
@Reducer
struct DashboardFeature {
    struct State { var momentum = MomentumFeature.State() }
    enum Action { case momentum(MomentumFeature.Action) }
    var body: some ReducerOf<Self> {
        Scope(state: \.momentum, action: \.momentum) { MomentumFeature() }
        Reduce { state, action in /* ... */ }
    }
}
```

### Optimistic update with rollback

The streak claim flow is the canonical example. See
`StreakClaimViewModel.claimTodayStreak()`:

1. Capture `previousStreak`, `previousLongest`, `previousClaimableDays`.
2. Increment `currentStreak`, mark today as claimed, set `showConfetti = true`.
3. Call backend. On success, replace optimistic state with authoritative values.
4. On non-network failure, roll back; on network failure, queue the operation in `OfflineOperationQueue`.

### NotificationCenter for cross-feature events

iOS uses `NotificationCenter` notifications for events that need to fan out across features. Examples:

```swift
NotificationCenter.default.post(name: .streakClaimed, userInfo: ["currentStreak": 7])
NotificationCenter.default.post(name: .streakShieldApplied, userInfo: ["freezesAvailable": 2])
NotificationCenter.default.post(name: .stepsLoggedToBackend, userInfo: ["source": "manual"])
NotificationCenter.default.post(name: .streakAutoClaimed, userInfo: ["source": "food_log"])
```

Constants live in `Core/Extensions/Notification+Extensions.swift`. Subscribers (e.g. `StreakClaimViewModel.init`) listen via Combine `publisher(for:)`.

### Haptic feedback

Use `HapticFeedbackType` — it wraps UIKit and degrades gracefully on unsupported devices:

```swift
HapticFeedbackType.medium.trigger()    // tap
HapticFeedbackType.success.trigger()   // success notification
HapticFeedbackType.warning.trigger()   // warning
HapticFeedbackType.error.trigger()
HapticFeedbackType.light.trigger()
```

### Confetti / celebration

Use the existing `CelebrationView` or `ConfettiView` (in DesignSystem) — don't import a third-party confetti lib.

### Sheet vs full-screen cover

- Detail / edit modals → `.sheet(item:)` or `.sheet(isPresented:)`
- Milestone celebrations, onboarding takeover → `.fullScreenCover(item:)`

---

## 7. Build & deploy

```bash
# Open in Xcode
open FitCircle-iOS/FitCircle.xcodeproj

# Command-line build (from the FitCircle-iOS dir)
xcodebuild -scheme FitCircle -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build

# Tests
xcodebuild -scheme FitCircle -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test
```

TestFlight uploads run via `ci_scripts/`. See `TESTFLIGHT-CHECKLIST.md`.

---

## 8. Testing

`FitCircleTests/` for unit tests, `FitCircleUITests/` for UI tests. TCA
ships its own test helpers — use `TestStore`:

```swift
@MainActor
func testLoadItems() async {
    let store = TestStore(initialState: MyFeature.State()) {
        MyFeature()
    } withDependencies: {
        $0.apiClient.getThings = { [Thing.mock1, Thing.mock2] }
    }

    await store.send(.onAppear) { $0.isLoading = true }
    await store.receive(\.itemsLoaded.success) {
        $0.isLoading = false
        $0.items = [Thing.mock1, Thing.mock2]
    }
}
```

---

## 9. How to add a new feature (recipe)

1. **Decide if it's a feature or just a screen.** If it has more than a
   couple of state fields and async loads, make a TCA feature.

2. **Define the model.** Create or extend a file in
   `Core/Models/<Feature>.swift`. Match the backend response shape
   exactly (snake_case keys decoded via `CodingKeys`).

3. **Add the endpoint.** Open `Core/Network/APIClient.swift`, declare a
   new `@Sendable` closure on the struct, and wire its `liveValue`
   implementation. Add a `testValue` mock that returns deterministic data.

4. **Create the feature folder.** `mkdir Features/<MyFeature>/`. Inside,
   add:
   - `<MyFeature>Feature.swift` — TCA reducer
   - `<MyFeature>View.swift` — main SwiftUI view
   - Sub-views or `Components/` if the file would exceed ~400 lines

5. **Wire navigation.** Most features are presented from existing roots
   (Dashboard, FitCircle detail, Profile). Add a route via
   `NavigationStack` or a sheet/cover modifier.

6. **Style with `AppTheme`.** Never hardcode colours or font sizes — use
   `AppTheme.Colors.*`, `AppTheme.Spacing.*`, `AppTheme.Typography.*`.

7. **Add haptics + analytics** on the meaningful actions.

8. **Write a TCA test** that exercises the load + success + failure paths.

9. **Verify on physical device** for haptics + Apple Health integration if
   applicable.

10. **Mirror to Android / Web** — see those platform docs.
