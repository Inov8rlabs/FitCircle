const IOS_FITNESS_LEVELS = new Set(['beginner', 'intermediate', 'advanced', 'expert']);
const IOS_GOAL_TYPES = new Set(['weight', 'steps', 'workout_minutes']);

/** ISO-8601 with millisecond precision. Postgres timestamps carry microseconds. */
export function formatDateForIOS(dateValue: string | Date | null | undefined): string | null {
  if (!dateValue) return null;
  const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function iosNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Shape a profiles row into the user object iOS `User` can decode.
 * `preferences` defaults to `{}` in Postgres, and synthesized Swift Codable
 * does not fill in the nested notification/privacy/display defaults.
 */
export function toIosAuthUser(
  profile: Record<string, any> | null | undefined,
  userId: string,
  email: string
) {
  const fallbackName = email.split('@')[0] || 'user';
  const dbPreferences = profile?.preferences || {};
  const goals = Array.isArray(profile?.goals) ? profile.goals : [];

  return {
    id: userId,
    username: profile?.username || fallbackName,
    display_name: profile?.display_name || profile?.username || fallbackName,
    email,
    avatar_url: profile?.avatar_url || null,
    bio: profile?.bio || null,
    date_of_birth: formatDateForIOS(profile?.date_of_birth),
    height_cm: iosNumber(profile?.height_cm),
    weight_kg: iosNumber(profile?.weight_kg),
    timezone: profile?.timezone || 'UTC',
    fitness_level: IOS_FITNESS_LEVELS.has(profile?.fitness_level) ? profile.fitness_level : null,
    goals: goals
      .filter((goal: any) => goal && typeof goal === 'object' && IOS_GOAL_TYPES.has(goal.type))
      .map((goal: any) => ({
        type: goal.type,
        target_weight_kg: iosNumber(goal.target_weight_kg ?? goal.targetWeightKg),
        starting_weight_kg: iosNumber(goal.starting_weight_kg ?? goal.startingWeightKg),
        daily_steps_target: iosNumber(goal.daily_steps_target ?? goal.dailyStepsTarget),
      })),
    preferences: {
      notifications: {
        push: dbPreferences.notifications?.push ?? true,
        email: dbPreferences.notifications?.email ?? true,
        sms: dbPreferences.notifications?.sms ?? false,
        challenge_invite: dbPreferences.notifications?.challenge_invite ?? true,
        team_invite: dbPreferences.notifications?.team_invite ?? true,
        check_in_reminder: dbPreferences.notifications?.check_in_reminder ?? true,
        achievement: dbPreferences.notifications?.achievement ?? true,
        comment: dbPreferences.notifications?.comment ?? true,
        reaction: dbPreferences.notifications?.reaction ?? true,
        leaderboard_update: dbPreferences.notifications?.leaderboard_update ?? true,
        weekly_insights: dbPreferences.notifications?.weekly_insights ?? true,
      },
      privacy: {
        profile_visibility:
          dbPreferences.privacy?.profile_visibility ||
          dbPreferences.privacy?.profileVisibility ||
          'public',
        show_weight: dbPreferences.privacy?.show_weight ?? dbPreferences.privacy?.showWeight ?? true,
        show_progress:
          dbPreferences.privacy?.show_progress ?? dbPreferences.privacy?.showProgress ?? true,
        allow_team_invites:
          dbPreferences.privacy?.allow_team_invites ?? dbPreferences.privacy?.allowTeamInvites ?? true,
        allow_challenge_invites:
          dbPreferences.privacy?.allow_challenge_invites ??
          dbPreferences.privacy?.allowChallengeInvites ??
          true,
      },
      display: {
        theme: dbPreferences.display?.theme || 'dark',
        language: dbPreferences.display?.language || 'en',
        units: dbPreferences.display?.units || dbPreferences.unitSystem || 'metric',
      },
    },
    total_points: profile?.total_points || 0,
    current_streak: profile?.current_streak || 0,
    longest_streak: profile?.longest_streak || 0,
    challenges_completed: profile?.challenges_completed || 0,
    challenges_won: profile?.challenges_won || 0,
    is_active: profile?.is_active !== undefined ? profile.is_active : true,
    last_active_at: formatDateForIOS(profile?.last_active_at) || new Date().toISOString(),
    created_at: formatDateForIOS(profile?.created_at) || new Date().toISOString(),
    updated_at: formatDateForIOS(profile?.updated_at) || new Date().toISOString(),
  };
}
