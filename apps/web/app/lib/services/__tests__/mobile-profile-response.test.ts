import { describe, expect, it } from 'vitest';

import { safeGender, toProfileUpdateResponse, withPreferenceDefaults } from '../mobile-profile-response';

/** Keys the iOS `User.preferences` decode needs (Core/Models/User.swift). */
const IOS_NOTIFICATION_KEYS = [
  'push',
  'email',
  'sms',
  'challenge_invite',
  'team_invite',
  'check_in_reminder',
  'achievement',
  'comment',
  'reaction',
  'leaderboard_update',
  'weekly_insights',
];
const IOS_PRIVACY_KEYS = [
  'profile_visibility',
  'show_weight',
  'show_progress',
  'allow_team_invites',
  'allow_challenge_invites',
];
const IOS_DISPLAY_KEYS = ['theme', 'language', 'units'];

describe('withPreferenceDefaults', () => {
  it('fills every key iOS needs when preferences is the Postgres default {}', () => {
    const prefs = withPreferenceDefaults({});
    expect(Object.keys(prefs.notifications)).toEqual(expect.arrayContaining(IOS_NOTIFICATION_KEYS));
    expect(Object.keys(prefs.privacy)).toEqual(expect.arrayContaining(IOS_PRIVACY_KEYS));
    expect(Object.keys(prefs.display)).toEqual(expect.arrayContaining(IOS_DISPLAY_KEYS));
    expect(prefs.privacy).toMatchObject({
      profile_visibility: 'public',
      show_weight: true,
      show_progress: true,
      allow_team_invites: true,
      allow_challenge_invites: true,
    });
    expect(prefs.display).toEqual({ theme: 'dark', language: 'en', units: 'metric' });
  });

  it('handles null / non-object preferences', () => {
    for (const stored of [null, undefined, 'x', []]) {
      expect(withPreferenceDefaults(stored).privacy.allow_team_invites).toBe(true);
    }
  });

  it('is additive: every stored key and value is returned unchanged', () => {
    const stored = {
      unitSystem: 'imperial',
      hydration: { daily_target_ml: 2500 },
      notifications: { push: false, quiet: 'custom' },
      privacy: { show_weight: false, allow_team_invites: false, profileVisibility: 'friends' },
      display: { theme: 'light' },
      security: { biometric_auth_enabled: true },
    };
    const prefs = withPreferenceDefaults(stored);

    expect(prefs.unitSystem).toBe('imperial');
    expect(prefs.hydration).toEqual({ daily_target_ml: 2500 });
    expect(prefs.security).toEqual({ biometric_auth_enabled: true });
    expect(prefs.notifications).toMatchObject({ push: false, quiet: 'custom', email: true });
    expect(prefs.privacy).toMatchObject({
      show_weight: false,
      allow_team_invites: false,
      profileVisibility: 'friends', // kept
      profile_visibility: 'friends', // filled from the legacy key
      allow_challenge_invites: true,
    });
    expect(prefs.display).toEqual({ theme: 'light', language: 'en', units: 'imperial' });
  });

  it('does not mutate the stored object', () => {
    const stored = { privacy: { show_weight: false } };
    withPreferenceDefaults(stored);
    expect(stored).toEqual({ privacy: { show_weight: false } });
  });
});

describe('safeGender', () => {
  it('passes the four known values and nothing else', () => {
    for (const value of ['female', 'male', 'non_binary', 'prefer_not_to_say']) expect(safeGender(value)).toBe(value);
    for (const value of ['other', 'Male', '', null, undefined, 3]) expect(safeGender(value)).toBeNull();
  });
});

describe('toProfileUpdateResponse', () => {
  const row = {
    id: 'u1',
    username: 'ani',
    display_name: 'Ani',
    date_of_birth: '1984-09-26',
    goals: [],
    preferences: {},
  };

  it('keeps every column and adds no gender key before migration 088', () => {
    const user = toProfileUpdateResponse(row)!;
    expect(user).toMatchObject({ id: 'u1', username: 'ani', display_name: 'Ani', date_of_birth: '1984-09-26' });
    expect('gender' in user).toBe(false);
    expect(user.preferences.privacy.allow_challenge_invites).toBe(true);
  });

  it('returns gender once the column exists, and never an unknown value', () => {
    expect(toProfileUpdateResponse({ ...row, gender: 'female' })!.gender).toBe('female');
    expect(toProfileUpdateResponse({ ...row, gender: null })!.gender).toBeNull();
    expect(toProfileUpdateResponse({ ...row, gender: 'other' })!.gender).toBeNull();
  });

  it('passes null through', () => {
    expect(toProfileUpdateResponse(null)).toBeNull();
  });
});
