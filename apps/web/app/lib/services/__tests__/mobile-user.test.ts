import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toMobileGoals, toMobileProfile, toMobileUser, withPreferenceDefaults, withRequestTestSignal, withTestAccountHeader } from '../mobile-profile-response';

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

describe('test_account / test_account_kind (docs/TEST_ACCOUNT_CONTRACT.md)', () => {
  const ENV_KEYS = ['ADS_TEST_EMAILS', 'ADS_TEST_EMAIL_DOMAINS'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });

  const kind = (row: Record<string, any> | null, email: string, ctx?: Parameters<typeof toMobileUser>[2]) => {
    const u = toMobileUser(row, { id: AUTH.id, email }, ctx);
    return [u.test_account, u.test_account_kind];
  };

  it('a real user is always sent false / null (keys always present)', () => {
    expect(kind(null, 'jane.doe@gmail.com')).toEqual([false, null]);
    expect(kind({ metadata: null, is_admin: false }, 'jane.doe@gmail.com')).toEqual([false, null]);
    expect(kind({ metadata: { welcome_email: {} } }, 'janedoe12@gmail.com')).toEqual([false, null]);
  });

  it('every non-real kind', () => {
    expect(kind({ is_admin: true }, 'jane.doe@gmail.com')).toEqual([true, 'internal']);
    expect(kind({}, 'ani@fitcircle.ai')).toEqual([true, 'internal']);
    expect(kind({}, 'fitcircle.user@gmail.com')).toEqual([true, 'review']);
    expect(kind({}, 'robot@cloudtestlabaccounts.com')).toEqual([true, 'test_lab']);
    expect(kind({}, 'qa@example.com')).toEqual([true, 'qa']);
    expect(kind({}, 'jordanbaker.48213@gmail.com')).toEqual([true, 'play_testers']);
    expect(kind({}, 'jane.doe@gmail.com', { mockAttribution: true })).toEqual([true, 'mock_attribution']);
    expect(kind({ metadata: { test_device: { at: 'x' } } }, 'jane.doe@gmail.com')).toEqual([true, 'test_device']);
    expect(kind({}, 'jane.doe@gmail.com', { headers: new Headers({ 'x-test-device': '1' }) })).toEqual([true, 'test_device']);
  });

  it('the email rules win over the device signal (more specific kind)', () => {
    expect(kind({ metadata: { test_device: { at: 'x' } } }, 'jordanbaker.48213@gmail.com')).toEqual([true, 'play_testers']);
  });

  it('toMobileProfile carries it; the profile row cannot override it', () => {
    const p = toMobileProfile({ id: AUTH.id, email: 'qa@example.com', test_account: false });
    expect([p.test_account, p.test_account_kind]).toEqual([true, 'qa']);
  });

  it('withRequestTestSignal only upgrades a real user on X-Test-Device', () => {
    const real = toMobileUser({}, { id: AUTH.id, email: 'jane.doe@gmail.com' });
    expect(withRequestTestSignal(real, new Headers())).toBe(real);
    expect(withRequestTestSignal(real, new Headers({ 'x-test-device': '1' }))).toMatchObject({ test_account: true, test_account_kind: 'test_device' });
    const qa = toMobileUser({}, { id: AUTH.id, email: 'qa@example.com' });
    expect(withRequestTestSignal(qa, new Headers({ 'x-test-device': '1' })).test_account_kind).toBe('qa');
  });

  it('withTestAccountHeader sets X-Test-Account: 1 only for test accounts', () => {
    const r1 = withTestAccountHeader(new Response('{}'), { test_account: true });
    const r2 = withTestAccountHeader(new Response('{}'), { test_account: false });
    const r3 = withTestAccountHeader(new Response('{}'), null);
    expect([r1.headers.get('x-test-account'), r2.headers.get('x-test-account'), r3.headers.get('x-test-account')]).toEqual(['1', null, null]);
  });
});
