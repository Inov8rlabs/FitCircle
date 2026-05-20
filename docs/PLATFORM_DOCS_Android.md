# Android Platform Docs

Last updated: 2026-05-19. Companion: [`PLATFORM_DOCS_README.md`](./PLATFORM_DOCS_README.md).

iOS is the source of truth — when in doubt, check the corresponding iOS
file in [`PLATFORM_DOCS_iOS.md`](./PLATFORM_DOCS_iOS.md). This doc
covers how those features are realised on Android.

---

## 1. Stack

| Layer | Choice |
|-------|--------|
| Language | Kotlin 2.0+ |
| UI | Jetpack Compose (Material 3) |
| Architecture | MVI + MVVM. ViewModels with `StateFlow`, Hilt-injected. No TCA on Android. |
| Networking | Retrofit + kotlinx.serialization + OkHttp |
| Storage | Room (offline cache), EncryptedSharedPreferences (tokens) |
| Health data | Health Connect (`androidx.health.connect`) |
| Background work | WorkManager (notifications, sync) |
| Ads | Google Mobile Ads SDK (`com.google.android.gms:play-services-ads`) |
| Auth | Supabase Auth (via direct API) + Google Sign-In via Credentials API |
| Min SDK | 26 |
| Target SDK | 35 |
| Build | Gradle 9 + AGP 9 with Kotlin DSL |

---

## 2. Project layout

```
Fitcircle-Android/
├── FitCircle/                          # ← the Gradle project root (open this in AS)
│   ├── settings.gradle.kts
│   ├── app/
│   │   ├── build.gradle.kts
│   │   └── src/main/java/com/fitcircle/app/
│   │       ├── MainActivity.kt
│   │       ├── FitCircleApplication.kt
│   │       ├── navigation/
│   │       │   ├── NavGraph.kt         # Route sealed class + constants
│   │       │   └── MainScreen.kt       # NavHost composables
│   │       ├── features/               # ← per-feature code
│   │       │   ├── auth/
│   │       │   ├── beveragelog/
│   │       │   ├── challenges/
│   │       │   ├── circlechallenges/
│   │       │   ├── circles/            # ≡ iOS FitCircles
│   │       │   ├── dailychallenge/
│   │       │   ├── dailygoals/
│   │       │   ├── dashboard/
│   │       │   ├── exerciselog/
│   │       │   ├── foodlog/
│   │       │   ├── momentum/
│   │       │   ├── onboarding/
│   │       │   ├── profile/
│   │       │   ├── quicklog/
│   │       │   ├── settings/
│   │       │   ├── share/
│   │       │   ├── streaks/
│   │       │   └── widgets/
│   │       ├── core/
│   │       │   ├── ads/                # Google Mobile Ads facade
│   │       │   ├── data/               # Repositories + Room
│   │       │   ├── health/             # Health Connect
│   │       │   ├── model/              # @Serializable data classes
│   │       │   ├── network/            # Retrofit APIs
│   │       │   ├── services/           # CheckIn, FeatureFlag, StreakNotification, etc.
│   │       │   └── utils/              # Helpers, animations, formatters
│   │       ├── designsystem/
│   │       │   ├── theme/AppTheme.kt
│   │       │   └── components/         # Reusable composables
│   │       ├── di/                     # Hilt modules
│   │       │   ├── NetworkModule.kt
│   │       │   ├── DataModule.kt
│   │       │   ├── DatabaseModule.kt
│   │       └── workers/                # WorkManager workers
│   ├── docs/                            # build / setup notes (live alongside code)
│   └── scripts/                         # CI security checks
├── ANDROID_IOS_PARITY_TICKETS.md        # (stale, kept for history)
└── docs/                                # cross-platform docs
```

Open `FitCircle/` in Android Studio. The outer `Fitcircle-Android/` is
just a wrapper — the real project root is one level down.

---

## 3. Feature catalogue

Same shape as iOS: each feature has a `<FeatureName>Screen.kt` composable
+ `<FeatureName>ViewModel.kt` + sub-components. Repositories live in
`core/data/`, Retrofit APIs in `core/network/`, models in `core/model/`.

### Ads (`core/ads/` + dashboard usage)

Full Google Mobile Ads suite, ported from iOS during the parity sprint.

| File | Role |
|------|------|
| `core/ads/AdConfiguration.kt` | Test vs prod unit IDs, frequency caps, content categories. Mirrors iOS. |
| `core/ads/AdsFeatureFlag.kt` | Master on/off, persisted in SharedPreferences, exposed as `StateFlow<Boolean>` |
| `core/ads/AdFrequencyManager.kt` | Per-session + per-day caps + min-interval between interstitials. Mutex-guarded (matches iOS actor semantics). |
| `core/ads/AdManager.kt` | SDK init facade, default `AdRequest` builder with keyword targeting |
| `core/ads/RewardedAdManager.kt` | Load + show + outcome reporting (`Outcome(earned, rewardAmount, rewardType, errorMessage)`) |
| `core/ads/InterstitialAdManager.kt` | Load + show with frequency gating |
| `core/ads/UserAdProfile.kt` | Premium tier + personalisation consent + keyword preferences |
| `core/ads/BannerAdView.kt` | Compose `AndroidView` wrapping `AdView` |
| `core/ads/RewardedAdButton.kt` | Compose CTA that plays a rewarded ad and reports back |
| `core/ads/AdLoadingPlaceholder.kt` | Pulsing skeleton |
| `core/ads/NativeAdLoader.kt` | Cached native loader (single in-flight, shared via `StateFlow`) |
| `core/ads/FitCircleNativeAdView.kt` | Inline native ad renderer (kept from pre-parity) |

ATTManager (iOS App Tracking Transparency) is **not** present on Android —
Google's `UserMessagingPlatform` SDK is the analog when consent flow is wired.

### Auth (`features/auth/`)

- `AuthScreen.kt` — root entry with login/register tabs
- `LoginScreen.kt` + `LoginViewModel.kt`
- `RegistrationScreen.kt` + `RegistrationViewModel.kt`
- `ForgotPasswordScreen.kt`
- `GoogleSignInHelper.kt` — Credentials API + Supabase ID-token exchange

Google Sign-In replaces iOS's Apple Sign-In. The token plumbing is the same: get a Supabase JWT, store via `TokenManager`.

### Beverage log (`features/beveragelog/`)

- `BeverageLogScreen.kt` — main list
- `BeverageQuickLogView.kt` — quick-add card
- `BeverageEntryFormView.kt` — form
- `FavoritesManagerView.kt` — saved favourites
- `BeverageIconHelper.kt` — emoji + colour per beverage type (mirrors iOS `BeverageIconHelper.swift`)
- Repository: `core/data/BeverageLogRepository.kt`
- Model: `core/model/BeverageLog.kt`

### Challenges (`features/challenges/`)

- `ChallengeLibraryScreen.kt` — browse templates
- `ChallengeDetailScreen.kt`
- `ChallengeLibraryViewModel.kt`
- Used standalone and from inside circle-creation wizard.

### Circle challenges (`features/circlechallenges/`)

- `CircleChallengesViewModel.kt` — manages challenges for a circle
- Composed by `CircleDetailScreen.kt` (under `features/circles/`)

### Circles (`features/circles/` — ≡ iOS FitCircles)

- `CirclesListScreen.kt` + `CirclesListViewModel.kt`
- `CircleDetailScreen.kt` + `CircleDetailViewModel.kt`
- `CreateCircleWizard.kt` — multi-step wizard (4 steps, ~1500 LOC, all-in-one file with internal state machine)
- `JoinCircleScreen.kt`, `JoinCircleModal.kt`
- `UserDetailModal.kt`
- `InviteGeneratorScreen.kt`

### Daily challenge (`features/dailychallenge/`)

- `DailyChallengeScreen.kt` — main screen (containers + state)
- `DailyChallengeDetailView.kt` — extracted detail card
- `DailyChallengeProgressView.kt` — progress card with quick-add buttons + Almost There hint
- `DailyChallengeWidget.kt` — compact dashboard widget

### Daily goals (`features/dailygoals/`)

- `DailyGoalsScreen.kt` / `DailyGoalsViewModel.kt`

### Dashboard (`features/dashboard/`)

The main hub. Composes many widgets.

- `DashboardScreen.kt` / `DashboardViewModel.kt`
- `HealthSyncBanner.kt` — Health Connect permission prompt
- `StreakWidget.kt`, `StreakViewModel.kt`, `WeeklyStatsWidget.kt`, `WeeklyGoalsWidget.kt`, `WeeklyGoalsViewModel.kt`
- `DailyGoalsWidget.kt`, `DataSubmissionWidget.kt`, `DataSubmissionViewModel.kt`
- `MissingDaysWidget.kt`, `AutoSyncSubmissionCard.kt`
- `WeekNavigableChart.kt`, `InteractiveCharts.kt`, `StepHistoryView.kt`
- `WeightEntryCard.kt`, `DailyCheckinBottomSheet.kt`
- `PastDateLogModal.kt`, `EditCheckInDialog.kt`
- `ProgressHistoryView.kt`, `CheckInDetailView.kt`

### Exercise log (`features/exerciselog/`)

- `ExerciseLogScreen.kt` / `ExerciseLogViewModel.kt`
- `ExerciseEntryScreen.kt` — entry form

### Food log (`features/foodlog/`)

- `FoodLogScreen.kt` / `FoodLogViewModel.kt`
- `FoodImageCapture.kt` — camera integration
- Uses `core/data/FoodLogRepository.kt` + `OfflineSyncWorker` for offline-first

### Momentum (`features/momentum/`)

- `MomentumScreen.kt` / `MomentumWidget.kt`
- `MomentumFlameView.kt` — animated flame via `Canvas` + multi-layer teardrop paths, level-driven gradients and pulse speed
- `MomentumMilestoneView.kt` — full-screen celebration with confetti + Share button

### Onboarding (`features/onboarding/`)

- `OnboardingCoordinator.kt` — entry composable that switches on step
- `OnboardingViewModel.kt` — main state machine
- `models/OnboardingModels.kt` — `OnboardingStep` enum, `Persona`, `ProfileSetup`, `UserGoal`, `QuestionnaireData`
- `models/AssessmentModels.kt` — `AssessmentQuestion`, `AssessmentOption`, `FitnessLevel`, `CircleRecommendation`, etc. (iOS-equivalent)
- `OnboardingAssessmentViewModel.kt` — sub-flow VM for the 5-question fitness assessment
- `screens/`:
  - `OnboardingSplashScreen.kt`, `OnboardingWelcomeScreen.kt`
  - `OnboardingQuestionnaireScreen.kt` (4-question persona quiz)
  - `OnboardingMeetFitzyScreen.kt`
  - `OnboardingPersonaFlowScreen.kt`
  - `OnboardingRemainingScreens.kt` — `OnboardingProfileSetupScreen`, `OnboardingSetGoalsScreen`, `OnboardingHealthPermissionsScreen` (consolidated for compactness)
  - `OnboardingAssessmentScreen.kt` — fitness assessment container with phase switching
  - `OnboardingCircleRecommendationsBody.kt`, `OnboardingCompletionBody.kt`
  - `OnboardingFirstCheckInScreen.kt`, `OnboardingCelebrationScreen.kt`
- `components/`:
  - `FitnessAssessmentQuestion.kt` — per-question UI
  - `CircularSlider.kt`, `ConfettiAnimation.kt`, `FitzyAvatar.kt`

### Profile (`features/profile/`)

- `ProfileScreen.kt` / `ProfileViewModel.kt`
- `EditProfileScreen.kt`

### Quick log (`features/quicklog/`)

- `QuickLogScreen.kt`

### Settings (`features/settings/`)

- `SettingsScreen.kt`
- `PrivacySettingsView.kt`
- `HealthConnectAndAccountSettings.kt`

### Share (`features/share/`)

- `ShareCardScreen.kt` — full-screen share preview
- `ShareCardTrigger.kt` — `ShareCardContext` sealed interface (`MomentumMilestoneContext`, `ChallengeCompleteContext`, etc.) + `ShareCardButton` composable with 3 styles (`PRIMARY` / `SECONDARY` / `ICON`)

### Streaks (`features/streaks/`)

The most heavily ported feature.

- `StreakClaimScreen.kt` — main claim hub (hero card + sync card + retro strip + shield + milestone grid + activity feed) — mirrors iOS `StreakClaimContainerView`
- `StreakClaimViewModel.kt` — port of iOS `StreakClaimViewModel`. Single `StateFlow<StreakClaimUiState>`. Optimistic claim with rollback. Parallel loading via `coroutineScope` + `async/await`. Health Connect hooks.
- `EngagementStreakScreen.kt` — separate streak summary screen
- `StreakDetailsScreen.kt` — long-form stats + activity feed + check-in history (706 LOC)
- `StreakActivityFeedView.kt`
- `StreakCalendarView.kt`
- `TodayChecklistWidget.kt`
- `FreezePurchaseFlow.kt`, `PauseStreakFlow.kt`
- `MetricStreaksView.kt`, `MetricStreakDetailView.kt`
- `components/`:
  - `RetroactiveClaimView.kt` — horizontal 7-day pill strip with gradients, step counts, frozen icon
  - `StreakClaimButton.kt` — large circular CTA
  - `StreakShieldWidget.kt`
  - `StreakRecoveryBanner.kt`
  - `ClaimStatusTipCard.kt`, `HealthDataSyncCard.kt`, `MilestoneGridView.kt`
  - `MilestoneCelebrationDialog.kt` — Int-based + rich `ClaimMilestone` overloads

### Widgets (`features/widgets/`)

- `WidgetUpdateHelper.kt` — Glance-based app widget updater (skeleton)

---

## 4. Core layer

### Network (`core/network/`)

Each feature has its own Retrofit interface — one file per top-level
backend resource:

```
AuthApi.kt
ChallengeApi.kt
CirclesApi.kt
DailyChallengeApi.kt
DailyGoalsApi.kt
FoodLogApi.kt
BeverageLogApi.kt
ExerciseApi.kt
MomentumApi.kt
OnboardingApi.kt
ProfileApi.kt
ShareCardApi.kt
StreaksApi.kt
TrackingApi.kt
```

Each is `@JvmSuppressWildcards suspend`-method Retrofit interface declared against the same backend used by iOS. Hilt-injected through `NetworkModule`.

### Data layer (`core/data/`)

Repository classes per feature:

```
StreaksRepository.kt
TrackingRepository.kt
FoodLogRepository.kt
BeverageLogRepository.kt
CircleChallengesRepository.kt
DailyGoalRepository.kt
WeeklyGoalsRepository.kt
LeaderboardRepository.kt
DataSubmissionRepository.kt
```

Plus:

- `TokenManager.kt` — token storage in EncryptedSharedPreferences + user ID accessor
- `TokenRefreshManager.kt` — proactive refresh + concurrent-call coordination
- `SessionManager.kt` — wraps Supabase session lifecycle
- `OfflineQueueManager.kt` + `PendingOperationDao.kt` — offline-first claim/freeze/log queue
- `CacheConfig.kt` — TTLs per cache type + `CacheStatus` / `AllCacheStatuses` data classes
- `FitCircleDatabase.kt` + `FitCircleDatabaseDaos.kt` + `FitCircleDatabaseEntities.kt` — Room DB
- `DailyGoalDatabase.kt` — separate Room DB for daily goals

### Models (`core/model/`)

Every `@Serializable` data class lives here:

- `AuthModels.kt`, `User.kt`, `Profile.kt`
- `DailyTracking.kt`, `DailyGoalModels.kt`, `WeeklyGoalsModels.kt`
- `FitCircle.kt`, `Circle.kt`, `CircleChallengeModels.kt`
- `ExerciseModels.kt`, `FoodLog.kt`, `BeverageLog.kt`
- `StreakModels.kt` — includes `ClaimMilestone`, `ClaimableDay`, `ShieldStatus`, `ClaimResult`, `ClaimStatus`, `FreezeResult`, `Recovery`, `RecoveryType`
- `MomentumModels.kt`, `DailyChallengeModels.kt`
- `ShareCardModels.kt`
- `NotificationModels.kt`, `LeaderboardModels.kt`, `EntryCategoryModels.kt`

### Services (`core/services/`)

- `StreakNotificationService.kt` — schedule/cancel/one-shot facade over WorkManager + NotificationManagerCompat. Surface mirrors iOS:
  - `scheduleAllStreakNotifications(currentStreak, nextMilestone)`
  - `cancelAllStreakNotifications()`
  - `cancelTodayRemindersAfterClaim()`
  - `sendMilestoneAchievedNotification(milestone)`
  - `sendFreezeActivatedNotification(freezesRemaining)`
- `CheckInService.kt` — `getCheckIn`, `filterCheckIns`, `canView`
- `FeatureFlagService.kt` — SharedPreferences-backed flag store with `isEnabled`, `override`, `refreshFromServer`
- `PushNotificationService.kt` — FCM registration
- `DeepLinkRouter.kt`

### Health (`core/health/`)

- `HealthConnectManager.kt` — Health Connect SDK wrapper
  - `isAvailable()`, `hasPermissions()`, `requestPermissions()` flow
  - `currentSyncStatus(): HealthConnectSyncStatus` — returns `GRANTED | DENIED | NOT_DETERMINED | UNAVAILABLE`
  - `fetchTodaySteps()`, `fetchStepsForDate(date)`, `fetchWeightForDate(date)`
  - Uses kotlinx.datetime; permissions: `Steps`, `Weight`

### Utils (`core/utils/`)

- `StreakAnimations.kt` — shared animations: `ConfettiAnimation` composable + `rememberPulsingScale`, `rememberDayIndicatorPulse`, `rememberShieldGlow`, `rememberMilestoneScale`, `rememberShimmer`
- `DateFormatting.kt` — relative time helpers (`toRelativeString`, etc.)
- `BeverageIconHelper.kt` — emoji + colour per beverage
- `WeightValidation.kt`

### DI (`di/`)

- `NetworkModule.kt` — Retrofit + OkHttp + all `*Api` providers (~25 endpoints)
- `DataModule.kt` — repositories
- `DatabaseModule.kt` — Room

---

## 5. Design system

Path: `designsystem/`.

### `theme/AppTheme.kt`

```kotlin
AppTheme.Colors.background          // slate-950
AppTheme.Colors.backgroundSecondary // slate-900
AppTheme.Colors.backgroundCard      // slate-800
AppTheme.Colors.backgroundInput
AppTheme.Colors.backgroundTertiary
AppTheme.Colors.surfaceElevated     // slate-700

AppTheme.Colors.purple   // #8B5CF6
AppTheme.Colors.indigo   // #6366F1
AppTheme.Colors.orange   // #F97316
AppTheme.Colors.cyan     // #06B6D4
AppTheme.Colors.green    // #10B981
AppTheme.Colors.pink     // #EC4899

AppTheme.Colors.textPrimary       // white
AppTheme.Colors.textSecondary     // slate-400
AppTheme.Colors.textTertiary      // slate-500
AppTheme.Colors.textDisabled      // slate-600

AppTheme.Colors.error     // #EF4444
AppTheme.Colors.warning   // #F59E0B
AppTheme.Colors.success   // #10B981
AppTheme.Colors.info      // #3B82F6
AppTheme.Colors.glassBorder

AppTheme.Spacing.xs   // 4.dp
AppTheme.Spacing.sm   // 8.dp
AppTheme.Spacing.md   // 16.dp
AppTheme.Spacing.lg   // 24.dp
AppTheme.Spacing.xl   // 32.dp
AppTheme.Spacing.xxl  // 48.dp
AppTheme.Spacing.xxxl // 64.dp

AppTheme.CornerRadius.xs   // 4.dp
AppTheme.CornerRadius.sm   // 8.dp
AppTheme.CornerRadius.md   // 12.dp
AppTheme.CornerRadius.lg   // 16.dp
AppTheme.CornerRadius.xl   // 20.dp
AppTheme.CornerRadius.xxl  // 24.dp
AppTheme.CornerRadius.full // 9999.dp

AppTheme.Typography.largeTitle  // 34.sp bold
AppTheme.Typography.title       // 28.sp bold
AppTheme.Typography.title2      // 22.sp bold
AppTheme.Typography.title3      // 20.sp semibold
AppTheme.Typography.headline    // 17.sp semibold
AppTheme.Typography.body        // 17.sp regular
AppTheme.Typography.callout     // 16.sp
AppTheme.Typography.subheadline // 15.sp
AppTheme.Typography.footnote    // 13.sp
AppTheme.Typography.caption     // 12.sp
AppTheme.Typography.caption2    // 11.sp

AppTheme.Stroke.thin    // 1.dp
AppTheme.Stroke.medium  // 2.dp

AppTheme.Elevation.*
```

### Components (`designsystem/components/`)

| File | What it gives you |
|------|-------------------|
| `Buttons.kt` | `PrimaryButton(text, onClick, enabled, isLoading, color, icon)`, `SecondaryButton(...)` |
| `TextFields.kt` | `StyledTextField` variants |
| `GlassCard.kt` | `GlassCard(modifier, onClick) { content }` |
| `LoadingIndicator.kt` | Centered spinner |
| `ErrorAndLoading.kt` | `ErrorMessage(message, onRetry)`, `LoadingState()` |
| `CircularProgress.kt` | Donut |
| `ActivityRing.kt` | Apple-Activity-style ring with `RingData` |
| `EnhancedProgressRing.kt` | Animated ring with optional glow + `NestedProgressRings` for multi-ring layouts |
| `EmptyStateView.kt` | Empty state with icon + title + description + CTA |
| `AuthenticatedAsyncImage.kt` | Coil image with Bearer-token auth header |
| `CelebrationView.kt` | Full-screen confetti modal |
| `ShieldAppliedCelebration.kt` | Subtle shield-apply animation (glow + sparkles) |
| `OfflineBannerView.kt` | Offline banner + `PendingSyncBadge` + `SyncStatusChip` |
| `SyncStatusView.kt` | `LastSyncedIndicator`, `SyncStatusBar`, `CompactSyncIndicator`, `DataFreshnessBadge` |

---

## 6. Patterns

### ViewModel + StateFlow + Hilt template

```kotlin
@HiltViewModel
class MyViewModel @Inject constructor(
    private val repository: MyRepository
) : ViewModel() {
    private val _state = MutableStateFlow<MyUiState>(MyUiState.Loading)
    val state: StateFlow<MyUiState> = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { MyUiState.Loading }
            val result = repository.fetch()
            result.fold(
                onSuccess = { items -> _state.update { MyUiState.Success(items) } },
                onFailure = { e -> _state.update { MyUiState.Error(e.message ?: "Failed") } }
            )
        }
    }
}

sealed interface MyUiState {
    data object Loading : MyUiState
    data class Success(val items: List<Thing>) : MyUiState
    data class Error(val message: String) : MyUiState
}
```

Then in the screen:

```kotlin
@Composable
fun MyScreen(viewModel: MyViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    when (val s = state) {
        is MyUiState.Loading -> LoadingIndicator()
        is MyUiState.Error -> ErrorMessage(s.message) { viewModel.load() }
        is MyUiState.Success -> MyContent(s.items)
    }
}
```

### Parallel data load with optimistic update

The canonical example is `StreakClaimViewModel.loadStreakData(force)`:

```kotlin
coroutineScope {
    val a = async { repo.getThis() }
    val b = async { repo.getThat() }
    val c = async { repo.getOther() }
    LoadResults(a.await(), b.await(), c.await())
}
```

For optimistic claims with rollback, see the same file's `claimTodayStreak()`.

### Calling backend

Backend is the same Next.js API as iOS. Mobile routes use Bearer auth. Hilt provides Retrofit instances configured with an auth interceptor that reads from `TokenManager`.

To add a new endpoint:

1. Add to the appropriate `*Api.kt` interface in `core/network/`:
   ```kotlin
   @POST("api/mobile/feature/action")
   suspend fun doAction(@Body request: ActionRequest): ApiResponse<ActionResult>
   ```
2. Add request/response data classes to `core/model/`.
3. Add a method on the repository that calls the API and wraps in `Result<T>`.
4. Inject the repository into your VM.

### Optimistic UI

Pattern from streak claim:

```kotlin
// Snapshot current state for rollback
val previousStreak = current.currentStreak
val previousDays = current.claimableDays

// Apply optimistic update
_uiState.update { current.copy(
    currentStreak = previousStreak + 1,
    claimableDays = previousDays.map { if (it.date == today) it.copy(status = CLAIMED) else it },
    isClaiming = true,
    showConfetti = true,
) }

viewModelScope.launch {
    val result = repository.claimStreak(...)
    result.fold(
        onSuccess = { /* reconcile with authoritative server state */ },
        onFailure = { error ->
            if (isNetworkError(error)) {
                // Keep optimistic update + queue for offline sync
                offlineQueue.enqueueStreakClaim(today)
            } else {
                // Roll back
                _uiState.update { current.copy(
                    currentStreak = previousStreak,
                    claimableDays = previousDays,
                    isClaiming = false,
                    showConfetti = false,
                    errorMessage = error.message,
                ) }
            }
        }
    )
}
```

### Health Connect

For step / weight reads, inject `HealthConnectManager`:

```kotlin
@HiltViewModel
class MyVM @Inject constructor(
    private val healthConnect: HealthConnectManager
) : ViewModel() {
    fun syncSteps() {
        viewModelScope.launch {
            val steps = healthConnect.fetchTodaySteps() ?: 0
            // ... push to backend
        }
    }
}
```

To request permissions from a Compose screen:

```kotlin
val permissionLauncher = rememberLauncherForActivityResult(
    contract = PermissionController.createRequestPermissionResultContract()
) { granted -> viewModel.onPermissionResult(granted) }

Button(onClick = { permissionLauncher.launch(HealthConnectManager.PERMISSIONS) }) {
    Text("Connect Health Connect")
}
```

### Notifications + WorkManager

- Reminders use periodic `WorkManager` workers. See `workers/StreakNotificationWorker.kt`.
- One-shot notifications use `NotificationManagerCompat.notify(id, builder.build())`.
- Always check `areNotificationsEnabled()` before posting.
- Channels are created lazily by `ensureChannel()` in `StreakNotificationService`.

To add a new scheduled notification:

1. Add a new `Worker` in `workers/`.
2. Schedule it from a service method (e.g. from `StreakNotificationService.scheduleAllStreakNotifications`).
3. Add a notification channel + handle the result.

### Navigation

`navigation/NavGraph.kt`:

```kotlin
sealed class Route(val route: String) {
    data object Dashboard : Route("dashboard")
    data object StreakClaim : Route("streaks/claim")
    data object FoodLog : Route("food_log")
    data object FoodLogEntry : Route("food_log/entry")
    // ... etc
}
```

`navigation/MainScreen.kt` declares the `NavHost`:

```kotlin
NavHost(navController, startDestination = Route.Dashboard.route) {
    composable(Route.Dashboard.route) { DashboardScreen(...) }
    composable(Route.StreakClaim.route) { StreakClaimScreen() }
    // ...
}
```

To add a new screen:
1. Add a `Route` entry in `NavGraph.kt`.
2. Add a `composable` block in `MainScreen.kt`.
3. Wire a navigate call from wherever you want to enter the screen.

---

## 7. Build & deploy

```bash
# From Fitcircle-Android/FitCircle/
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH=$JAVA_HOME/bin:$PATH

./gradlew :app:compileDebugKotlin       # type-check + compile
./gradlew :app:assembleDebug            # build the debug APK
./gradlew :app:assembleRelease          # release APK (signed)

# Tests
./gradlew :app:testDebugUnitTest
./gradlew :app:connectedDebugAndroidTest
```

Output: `app/build/outputs/apk/debug/app-debug.apk`.

Java 17 is required. The outer `Fitcircle-Android/` has its own
`settings.gradle.kts` that doesn't include the app project — **always
build from the inner `FitCircle/` directory**.

---

## 8. Testing

Use the standard Compose + Hilt testing toolkit:
- Unit tests: `app/src/test/java/...` with `kotlinx.coroutines.test.runTest`
- UI tests: `app/src/androidTest/java/...` with `createAndroidComposeRule`

Use `MutableStateFlow` to drive ViewModel state in tests; assert UI with
`onNodeWithText` / `onNodeWithTag`.

---

## 9. How to add a new feature (recipe)

1. **Define the model.** Add `@Serializable` data classes in `core/model/`. Match the backend response shape (snake_case keys via `@SerialName`).

2. **Add the endpoint.** Create or extend a Retrofit interface in `core/network/`. Wire it in `di/NetworkModule.kt`.

3. **Add a repository.** In `core/data/`, create a `MyRepository @Inject constructor(private val api: MyApi)` that returns `Result<T>`. Handle errors with `try/catch`.

4. **Create the feature folder.**
   ```
   features/myfeature/
     MyFeatureScreen.kt
     MyFeatureViewModel.kt
     components/   (if needed)
   ```

5. **Build the ViewModel.** Single `StateFlow<MyUiState>`, sealed UI state, public `fun` actions.

6. **Build the Screen.** Stateless `@Composable` that takes a VM via `hiltViewModel()`, observes state, dispatches actions.

7. **Add the route.** Edit `navigation/NavGraph.kt` + `navigation/MainScreen.kt`. Add a `composable` entry.

8. **Style with `AppTheme`.** Always — no hardcoded values.

9. **Add tests.** At minimum a VM unit test covering load, success, and error transitions.

10. **Verify the build.**
    ```bash
    ./gradlew :app:assembleDebug
    ```

11. **Mirror to iOS / Web** per cross-platform parity.

---

## 10. Pre-existing quirks to know about

- **Merge-conflict markers** historically remained in `CreateCircleWizard.kt` and `CircleChallengeModels.kt` after a stash-pop. These were resolved during the parity sprint. If you see `<<<<<<<` in a Kotlin file, run a state-machine cleanup (see `ANDROID_PARITY_COMPLETE_2026-05-19.md` for the script).
- **`HealthSyncBanner.kt`** had a wrong import (`com.fitcircle.app.ui.theme.AppTheme`) instead of `com.fitcircle.app.designsystem.theme.AppTheme`. Fixed.
- **Outer `Fitcircle-Android/` has its own broken `settings.gradle.kts`** — always build from `Fitcircle-Android/FitCircle/`.
- **`StreakDetailsScreen.kt`** and **`StreakClaimScreen.kt`** are two distinct screens. The Dashboard's "View streak" CTA goes to `StreakClaim` (richer, primary). `StreakDetails` remains accessible for the legacy stats view.
- **iOS Apple Sign-In ≠ Android Apple Sign-In.** Android uses Google Sign-In via Credentials API — both are platform-correct analogs.
