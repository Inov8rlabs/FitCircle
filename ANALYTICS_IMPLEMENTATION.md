# Analytics Implementation Guide

This document outlines where to add Amplitude event tracking throughout the FitCircle application.

## Quick Reference

Import the analytics module:
```typescript
import { trackEventName } from '@/lib/analytics';
```

## Authentication Flow

### File: `apps/web/app/(auth)/register/page.tsx`

**Location:** `onSubmit` function, line ~65

```typescript
const onSubmit = async (data: RegisterFormData) => {
  try {
    // ADD: Track sign up started
    trackSignUpStarted('email');

    await registerUser({
      email: data.email,
      password: data.password,
      name: data.name,
      username: data.email.split('@')[0],
    });

    // ADD: Track sign up completed (get user ID from auth store)
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      trackSignUpCompleted(userId, data.name);
    }

    showToast('Account created successfully!', 'success');
    router.push('/onboarding');
  } catch (error) {
    showToast('Registration failed. Please try again.', 'error');
  }
};
```

### File: `apps/web/app/(auth)/login/page.tsx`

**Location:** `onSubmit` function

```typescript
const onSubmit = async (data: LoginFormData) => {
  try {
    // ADD: Track login started
    trackLoginStarted();

    await login(data.email, data.password);

    // ADD: Track login completed
    const user = useAuthStore.getState().user;
    if (user?.id) {
      trackLoginCompleted(user.id, user.name);
    }

    showToast('Welcome back!', 'success');
    router.push('/dashboard');
  } catch (error) {
    showToast('Invalid email or password', 'error');
  }
};
```

## Onboarding Flow

### File: `apps/web/app/onboarding/page.tsx`

**Location:** Multiple locations

```typescript
useEffect(() => {
  // ADD: Track onboarding started
  trackOnboardingStarted();
}, []);

const handleNext = () => {
  // ADD: Track step completed
  trackOnboardingStepCompleted(currentStep + 1, getStepName(currentStep + 1));
  setCurrentStep(currentStep + 1);
};

const handleFinish = async () => {
  // ADD: Track goal set
  if (goals.weight) {
    trackWeightGoalSet(
      goals.weight.starting_weight_kg,
      goals.weight.target_weight_kg,
      90 // timeframe in days
    );
  }

  // ADD: Track onboarding completed
  trackOnboardingCompleted();

  router.push('/dashboard');
};
```

## Daily Check-ins

### File: `apps/web/app/dashboard/page.tsx`

**Location:** Check-in submission

```typescript
const handleCheckInSubmit = async () => {
  if (!checkInForm.weight && !checkInForm.steps && !checkInForm.mood && !checkInForm.energy) {
    return;
  }

  setIsSubmitting(true);
  try {
    // ADD: Track check-in started
    trackCheckInStarted('dashboard');

    const dataTypes: string[] = [];
    const isHistorical = checkInForm.date !== new Date().toISOString().split('T')[0];

    // Track individual data entries
    if (checkInForm.weight) {
      const weightKg = parseWeightToKg(checkInForm.weight, unitSystem);
      trackWeightLogged(weightKg, isHistorical);
      dataTypes.push('weight');
    }

    if (checkInForm.steps) {
      trackStepsLogged(parseInt(checkInForm.steps), isHistorical);
      dataTypes.push('steps');
    }

    if (checkInForm.mood) {
      trackMoodLogged(checkInForm.mood);
      dataTypes.push('mood');
    }

    if (checkInForm.energy) {
      trackEnergyLogged(checkInForm.energy);
      dataTypes.push('energy');
    }

    // Submit to database...
    const { error } = await supabase.from('daily_tracking').upsert(updateData);

    if (!error) {
      // ADD: Track check-in completed
      trackCheckInCompleted(dataTypes, isHistorical);

      toast.success('Check-in saved!');
    } else {
      trackCheckInFailed(error.message);
    }
  } catch (error) {
    trackCheckInFailed('Unknown error');
  } finally {
    setIsSubmitting(false);
  }
};
```

**Location:** Dashboard view

```typescript
useEffect(() => {
  if (user) {
    // ADD: Track dashboard viewed
    trackDashboardViewed();
    fetchCheckIns();
    fetchGoalWeight();
    fetchDailyStats();
  }
}, [user]);
```

**Location:** Goal updates

```typescript
const handleStepsGoalUpdate = async (newGoal: number) => {
  const oldGoal = dailyStepsGoal;
  setDailyStepsGoal(newGoal);

  // ADD: Track goal updated
  trackGoalUpdated('steps', oldGoal, newGoal);

  // Save to database...
};
```

## FitCircle Creation

### File: `apps/web/app/components/CircleCreationWizard.tsx`

**Location:** When modal opens

```typescript
const handleOpen = () => {
  setIsOpen(true);
  // ADD: Track creation started
  trackFitCircleCreationStarted();
};
```

**Location:** When FitCircle is created (after API success)

```typescript
const handleCreateCircle = async () => {
  try {
    const response = await fetch('/api/fitcircles', {
      method: 'POST',
      body: JSON.stringify(circleData),
    });

    const result = await response.json();

    if (response.ok && result.challenge) {
      // ADD: Track FitCircle created
      trackFitCircleCreated(
        result.challenge.id,
        formData.name,
        formData.type,
        calculateDurationDays(formData.startDate, formData.endDate),
        formData.visibility
      );

      onSuccess(result.challenge.id);
    }
  } catch (error) {
    console.error(error);
  }
};
```

## FitCircle Join Flow

### File: `apps/web/app/join/[code]/page.tsx`

**Location:** When user clicks join

```typescript
const handleJoinClick = () => {
  // ADD: Track join started
  trackFitCircleJoinStarted('invite_link');

  if (!user) {
    router.push(`/login?returnUrl=/join/${inviteCode}`);
  } else {
    setShowGoalSetting(true);
  }
};
```

**Location:** After successful join

```typescript
const handleGoalSet = async (goalData: any) => {
  setIsJoining(true);
  try {
    // Join the circle...
    const { error } = await supabase.from('challenge_participants').insert(...);

    if (!error) {
      // ADD: Track FitCircle joined
      trackFitCircleJoined(
        circleDetails.id,
        circleDetails.name,
        circleDetails.type,
        goalData.target_value
      );

      toast.success('Successfully joined!');
      router.push(`/fitcircles/${circleDetails.id}`);
    } else {
      trackFitCircleJoinFailed(error.message);
    }
  } catch (error) {
    trackFitCircleJoinFailed('Unknown error');
  }
};
```

## FitCircle Management

### File: `apps/web/app/fitcircles/[id]/page.tsx`

**Location:** Leaderboard view

```typescript
useEffect(() => {
  if (fitCircle && user) {
    // ADD: Track leaderboard viewed
    trackLeaderboardViewed(circleId, participants.length);
  }
}, [fitCircle, participants]);
```

**Location:** Participant profile click

```typescript
const handleParticipantClick = async (participant: Participant) => {
  if (participant.user_id === user?.id || participant.is_public) {
    // ADD: Track profile viewed
    trackParticipantProfileViewed(
      circleId,
      participant.user_id,
      participant.user_id === user?.id
    );

    // Fetch progress history...
    setShowDetailModal(true);
  }
};
```

**Location:** Manage modal

```typescript
const handleManageClick = () => {
  // ADD: Track manage modal opened
  trackManageModalOpened(circleId);
  setShowManageModal(true);
};
```

**Location:** Copy invite link

```typescript
const copyInviteCode = async () => {
  if (!fitCircle?.invite_code) return;

  const inviteUrl = `${window.location.origin}/join/${fitCircle.invite_code}`;
  await navigator.clipboard.writeText(inviteUrl);

  // ADD: Track invite copied
  trackInviteLinkCopied(circleId, fitCircle.name);

  setCopySuccess(true);
  setTimeout(() => setCopySuccess(false), 2000);
};
```

**Location:** Rename FitCircle

```typescript
const handleSaveName = async () => {
  if (!editedName.trim() || !fitCircle) return;

  setIsSavingName(true);
  try {
    const { error } = await supabase
      .from('challenges')
      .update({ name: editedName.trim() })
      .eq('id', circleId);

    if (!error) {
      // ADD: Track rename
      trackFitCircleRenamed(circleId, fitCircle.name, editedName.trim());

      setFitCircle({ ...fitCircle, name: editedName.trim() });
      setIsEditingName(false);
    }
  } catch (err) {
    console.error(err);
  } finally {
    setIsSavingName(false);
  }
};
```

**Location:** Delete FitCircle

```typescript
const handleDeleteChallenge = async () => {
  if (!confirm('Are you sure?')) return;

  try {
    const { error } = await supabase
      .from('challenges')
      .delete()
      .eq('id', circleId);

    if (!error) {
      // ADD: Track deletion
      trackFitCircleDeleted(circleId, fitCircle.name, participants.length);

      router.push('/fitcircles');
    }
  } catch (err) {
    console.error(err);
  }
};
```

## Navigation/Page Views

### File: `apps/web/app/fitcircles/page.tsx`

```typescript
useEffect(() => {
  if (user) {
    // ADD: Track FitCircles page viewed
    trackFitCirclesViewed(myCircles.length);
    fetchMyCircles();
  }
}, [user]);
```

### File: `apps/web/app/profile/page.tsx`

```typescript
useEffect(() => {
  // ADD: Track profile viewed
  trackProfileViewed();
}, []);
```

## Unit Preference Changes

### File: Wherever unit toggle component is used

```typescript
const handleUnitChange = (newUnit: 'metric' | 'imperial') => {
  const oldUnit = unitSystem;
  setUnitSystem(newUnit);

  // ADD: Track unit change
  trackUnitSystemChanged(oldUnit, newUnit);
};
```

## User Identification

### File: `apps/web/app/providers.tsx` or auth initialization

```typescript
useEffect(() => {
  if (user) {
    // ADD: Identify user with properties
    identifyUser(user.id, {
      email: user.email,
      name: user.name,
      unit_preference: unitSystem,
    });
  }
}, [user]);
```

## Update User Properties Periodically

### File: `apps/web/app/dashboard/page.tsx`

```typescript
useEffect(() => {
  if (user && dailyStats) {
    // ADD: Update user properties with latest stats
    setUserProperties({
      total_check_ins: dailyStats.totalCheckIns,
      current_streak: dailyStats.currentStreak,
      has_weight_goal: !!goalWeightKg,
      has_steps_goal: !!dailyStepsGoal,
    });
  }
}, [user, dailyStats, goalWeightKg, dailyStepsGoal]);
```

## Implementation Checklist

- [ ] Authentication (register, login, logout)
- [ ] Onboarding flow
- [ ] Daily check-ins (weight, steps, mood, energy)
- [ ] FitCircle creation
- [ ] FitCircle join flow
- [ ] Leaderboard viewing
- [ ] Participant profile viewing
- [ ] Invite link copying
- [ ] FitCircle management (rename, delete)
- [ ] Goal setting and updates
- [ ] Page views (dashboard, FitCircles, profile)
- [ ] Unit preference changes
- [ ] User identification and properties
- [ ] Error tracking

## Testing Events

After implementation, test in development:

```typescript
// In browser console
window.amplitude.track('Test Event', { test: true });
```

Check Amplitude dashboard to verify events are being received.

## Best Practices

1. **Always include context** - Add properties that help understand the event
2. **Use consistent naming** - Follow Title Case for events, snake_case for properties
3. **Track failures** - Don't just track successes, track errors too
4. **Set user properties** - Keep user profile up to date
5. **Don't over-track** - Focus on meaningful user actions, not every click
6. **Test thoroughly** - Verify events in Amplitude before deploying
