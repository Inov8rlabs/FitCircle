import { describe, expect, it } from 'vitest';

import { toMobileGoals, toMobileUser, withPreferenceDefaults } from '../mobile-profile-response';

const AUTH = { id: '11111111-1111-1111-1111-111111111111', email: 'ani@privaterelay.appleid.com' };

/** Keys the iOS `User` decode requires (Core/Models/User.swift), all non-optional. */
const REQUIRED_KEYS = [
  'id',
  'username',
  'display_name',
  'email',
  'timezone',
  'goals',
  'preferences',
  'total_points',
  'current_streak',
  'longest_streak',
  'challenges_completed',
  'challenges_won',
  'is_active',
  'last_active_at',
  'created_at',
  'updated_at',
];

describe('toMobileUser', () => {
  it('fills every required key when there is no profile row', () => {
    for (const profile of [null, undefined, {}]) {
      const user = toMobileUser(profile, AUTH);
      for (const key of REQUIRED_KEYS) expect(user[key], key).not.toBeNull();
      expect(user.id).toBe(AUTH.id);
      expect(user.username).toBe('ani');
      expect(user.display_name).toBe('ani');
    }
  });

  it('fills the preference tree iOS requires when the profile stores {}', () => {
    const user = toMobileUser({ preferences: {}, goals: [], weight_kg: '72.50' }, AUTH);
    expect(user.preferences.notifications.push).toBe(true);
    expect(user.preferences.privacy.profile_visibility).toBe('public');
    expect(user.preferences.display.units).toBe('metric');
    expect(user.goals).toEqual([]);
    expect(user.weight_kg).toBe(72.5);
  });

  it('prefers the auth email over the row copy', () => {
    expect(toMobileUser({ email: 'old@x.com' }, AUTH).email).toBe(AUTH.email);
    expect(toMobileUser({ email: 'row@x.com' }).email).toBe('row@x.com');
  });

  it('sends date_of_birth as a calendar date, never an instant', () => {
    expect(toMobileUser({ date_of_birth: '1984-09-26' }, AUTH).date_of_birth).toBe('1984-09-26');
    expect(toMobileUser({ date_of_birth: '1984-09-26T00:00:00+00:00' }, AUTH).date_of_birth).toBe('1984-09-26');
    expect(toMobileUser({ date_of_birth: 'nope' }, AUTH).date_of_birth).toBeNull();
  });

  it('normalizes Postgres timestamps to millisecond ISO-8601', () => {
    const user = toMobileUser({ created_at: '2025-10-11 04:10:58.556029+00' }, AUTH);
    expect(user.created_at).toBe('2025-10-11T04:10:58.556Z');
  });

  it('only sends enum values iOS knows', () => {
    const user = toMobileUser(
      {
        fitness_level: 'pro',
        gender: 'other',
        preferences: {
          privacy: { profile_visibility: 'everyone', show_weight: 'yes' },
          display: { theme: 'auto', units: 'si' },
          notifications: { push: 'false' },
        },
      },
      AUTH
    );
    expect(user.fitness_level).toBeNull();
    expect(user.gender).toBeNull();
    expect(user.preferences.privacy.profile_visibility).toBe('public');
    expect(user.preferences.privacy.show_weight).toBe(true);
    expect(user.preferences.display).toMatchObject({ theme: 'dark', units: 'metric' });
    expect(user.preferences.notifications.push).toBe(true);
  });

  it('sends integers for the Int counters', () => {
    const user = toMobileUser({ total_points: '12', current_streak: 3.7, longest_streak: null }, AUTH);
    expect(user).toMatchObject({ total_points: 12, current_streak: 3, longest_streak: 0 });
  });
});

describe('toMobileGoals', () => {
  it('drops strings and goal types the iOS enum cannot decode', () => {
    expect(
      toMobileGoals([
        { type: 'weight', target_weight_kg: 70 },
        { type: 'hydration' },
        'steps',
        null,
        { type: 'steps', dailyStepsTarget: 8000.5 },
      ])
    ).toEqual([
      { type: 'weight', target_weight_kg: 70, starting_weight_kg: null, daily_steps_target: null },
      { type: 'steps', target_weight_kg: null, starting_weight_kg: null, daily_steps_target: 8000 },
    ]);
    expect(toMobileGoals('weight_loss')).toEqual([]);
  });
});

describe('withPreferenceDefaults', () => {
  it('reads legacy camelCase privacy keys', () => {
    const prefs = withPreferenceDefaults({ privacy: { profileVisibility: 'friends', showWeight: false } });
    expect(prefs.privacy).toMatchObject({ profile_visibility: 'friends', show_weight: false });
  });
});
