/**
 * Centralized Analytics Module
 * Following Amplitude's naming conventions and best practices
 * Event names: Title Case, descriptive, action-based
 * Properties: snake_case, include context
 */

import amplitude from './amplitude';

// ============================================================================
// AUTHENTICATION EVENTS
// ============================================================================

export const trackSignUpStarted = (method: 'email' | 'google' | 'github' = 'email') => {
  amplitude.track('Sign Up Started', {
    signup_method: method,
  });
};

export const trackSignUpCompleted = (userId: string, userName?: string) => {
  amplitude.setUserId(userId);
  amplitude.track('Sign Up Completed', {
    signup_method: 'email',
    user_name: userName,
  });
};

export const trackLoginStarted = () => {
  amplitude.track('Login Started');
};

export const trackLoginCompleted = (userId: string, userName?: string) => {
  amplitude.setUserId(userId);
  amplitude.track('Login Completed', {
    user_name: userName,
  });
};

export const trackLogout = () => {
  amplitude.track('Logout');
  amplitude.reset(); // Clear user data
};

// ============================================================================
// ONBOARDING EVENTS
// ============================================================================

export const trackOnboardingStarted = () => {
  amplitude.track('Onboarding Started');
};

export const trackOnboardingStepCompleted = (stepNumber: number, stepName: string) => {
  amplitude.track('Onboarding Step Completed', {
    step_number: stepNumber,
    step_name: stepName,
  });
};

export const trackGoalSet = (goalType: 'weight' | 'steps' | 'workout', goalValue: number) => {
  amplitude.track('Goal Set', {
    goal_type: goalType,
    goal_value: goalValue,
  });
};

export const trackOnboardingCompleted = () => {
  amplitude.track('Onboarding Completed');
};

// ============================================================================
// DAILY CHECK-IN EVENTS
// ============================================================================

export const trackCheckInStarted = (source: 'dashboard' | 'fitcircle' | 'quick_entry') => {
  amplitude.track('Check-in Started', {
    source,
  });
};

export const trackWeightLogged = (weightKg: number, isHistorical: boolean = false) => {
  amplitude.track('Weight Logged', {
    weight_kg: weightKg,
    is_historical: isHistorical,
    unit_system: 'metric', // Could be dynamic based on user preference
  });
};

export const trackStepsLogged = (steps: number, isHistorical: boolean = false) => {
  amplitude.track('Steps Logged', {
    steps,
    is_historical: isHistorical,
  });
};

export const trackMoodLogged = (moodScore: number) => {
  amplitude.track('Mood Logged', {
    mood_score: moodScore,
  });
};

export const trackEnergyLogged = (energyLevel: number) => {
  amplitude.track('Energy Logged', {
    energy_level: energyLevel,
  });
};

export const trackCheckInCompleted = (dataTypes: string[], isHistorical: boolean = false) => {
  amplitude.track('Check-in Completed', {
    data_types: dataTypes, // e.g., ['weight', 'steps', 'mood']
    data_count: dataTypes.length,
    is_historical: isHistorical,
  });
};

// ============================================================================
// FITCIRCLE MANAGEMENT EVENTS
// ============================================================================

export const trackFitCircleCreationStarted = () => {
  amplitude.track('FitCircle Creation Started');
};

export const trackFitCircleCreated = (
  circleId: string,
  circleName: string,
  challengeType: string,
  durationDays: number,
  visibility: string
) => {
  amplitude.track('FitCircle Created', {
    circle_id: circleId,
    circle_name: circleName,
    challenge_type: challengeType,
    duration_days: durationDays,
    visibility,
  });
};

export const trackFitCircleJoinStarted = (source: 'invite_link' | 'browse' | 'code') => {
  amplitude.track('FitCircle Join Started', {
    source,
  });
};

export const trackFitCircleJoined = (
  circleId: string,
  circleName: string,
  challengeType: string,
  goalValue?: number
) => {
  amplitude.track('FitCircle Joined', {
    circle_id: circleId,
    circle_name: circleName,
    challenge_type: challengeType,
    goal_value: goalValue,
  });
};

export const trackInviteLinkCopied = (circleId: string, circleName: string) => {
  amplitude.track('Invite Link Copied', {
    circle_id: circleId,
    circle_name: circleName,
  });
};

export const trackFitCircleRenamed = (circleId: string, oldName: string, newName: string) => {
  amplitude.track('FitCircle Renamed', {
    circle_id: circleId,
    old_name: oldName,
    new_name: newName,
  });
};

export const trackFitCircleDeleted = (circleId: string, circleName: string, participantCount: number) => {
  amplitude.track('FitCircle Deleted', {
    circle_id: circleId,
    circle_name: circleName,
    participant_count: participantCount,
  });
};

export const trackManageModalOpened = (circleId: string) => {
  amplitude.track('Manage Modal Opened', {
    circle_id: circleId,
  });
};

// ============================================================================
// SOCIAL/ENGAGEMENT EVENTS
// ============================================================================

export const trackLeaderboardViewed = (circleId: string, participantCount: number) => {
  amplitude.track('Leaderboard Viewed', {
    circle_id: circleId,
    participant_count: participantCount,
  });
};

export const trackParticipantProfileViewed = (
  circleId: string,
  viewedUserId: string,
  isOwnProfile: boolean
) => {
  amplitude.track('Participant Profile Viewed', {
    circle_id: circleId,
    viewed_user_id: viewedUserId,
    is_own_profile: isOwnProfile,
  });
};

export const trackProgressShared = (shareMethod: 'link' | 'social') => {
  amplitude.track('Progress Shared', {
    share_method: shareMethod,
  });
};

// ============================================================================
// GOAL MANAGEMENT EVENTS
// ============================================================================

export const trackWeightGoalSet = (startingWeight: number, targetWeight: number, timeframe: number) => {
  amplitude.track('Weight Goal Set', {
    starting_weight_kg: startingWeight,
    target_weight_kg: targetWeight,
    weight_to_lose_kg: startingWeight - targetWeight,
    timeframe_days: timeframe,
  });
};

export const trackStepsGoalSet = (dailyStepsGoal: number) => {
  amplitude.track('Steps Goal Set', {
    daily_steps_goal: dailyStepsGoal,
  });
};

export const trackGoalUpdated = (
  goalType: 'weight' | 'steps' | 'workout',
  oldValue: number,
  newValue: number
) => {
  amplitude.track('Goal Updated', {
    goal_type: goalType,
    old_value: oldValue,
    new_value: newValue,
    change: newValue - oldValue,
  });
};

// ============================================================================
// NAVIGATION/PAGE VIEW EVENTS
// ============================================================================

export const trackPageViewed = (pageName: string, properties?: Record<string, any>) => {
  amplitude.track('Page Viewed', {
    page_name: pageName,
    ...properties,
  });
};

export const trackDashboardViewed = () => {
  amplitude.track('Dashboard Viewed');
};

export const trackFitCirclesViewed = (circleCount: number) => {
  amplitude.track('FitCircles Viewed', {
    circle_count: circleCount,
  });
};

export const trackProfileViewed = () => {
  amplitude.track('Profile Viewed');
};

// ============================================================================
// UNIT PREFERENCE EVENTS
// ============================================================================

export const trackUnitSystemChanged = (from: 'metric' | 'imperial', to: 'metric' | 'imperial') => {
  amplitude.track('Unit System Changed', {
    from_system: from,
    to_system: to,
  });
};

// ============================================================================
// SETTINGS EVENTS
// ============================================================================

export const trackSettingsViewed = () => {
  amplitude.track('Settings Viewed');
};

export const trackNotificationSettingChanged = (settingName: string, enabled: boolean) => {
  amplitude.track('Notification Setting Changed', {
    setting_name: settingName,
    enabled,
  });
};

// ============================================================================
// ERROR/FAILURE EVENTS
// ============================================================================

export const trackError = (errorType: string, errorMessage: string, context?: Record<string, any>) => {
  amplitude.track('Error Occurred', {
    error_type: errorType,
    error_message: errorMessage,
    ...context,
  });
};

export const trackCheckInFailed = (reason: string) => {
  amplitude.track('Check-in Failed', {
    failure_reason: reason,
  });
};

export const trackFitCircleJoinFailed = (reason: string) => {
  amplitude.track('FitCircle Join Failed', {
    failure_reason: reason,
  });
};

// ============================================================================
// USER PROPERTIES
// ============================================================================

export const setUserProperties = (properties: {
  email?: string;
  name?: string;
  has_weight_goal?: boolean;
  has_steps_goal?: boolean;
  total_check_ins?: number;
  current_streak?: number;
  total_fitcircles?: number;
  unit_preference?: 'metric' | 'imperial';
}) => {
  const identifyEvent = new amplitude.Identify();
  Object.entries(properties).forEach(([key, value]) => {
    if (value !== undefined) {
      identifyEvent.set(key, value);
    }
  });
  amplitude.identify(identifyEvent);
};

export const identifyUser = (userId: string, userProperties?: Record<string, any>) => {
  amplitude.setUserId(userId);
  if (userProperties) {
    const identifyEvent = new amplitude.Identify();
    Object.entries(userProperties).forEach(([key, value]) => {
      if (value !== undefined) {
        identifyEvent.set(key, value);
      }
    });
    amplitude.identify(identifyEvent);
  }
};
