import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  authed: true,
  user: { id: 'u1', email: 'a@b.com', date_of_birth: null as string | null },
  row: {} as Record<string, any>,
  updates: [] as Array<Record<string, any>>,
  updateError: null as null | { code: string; message: string },
};

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => {
    if (!state.authed) throw new Error('Unauthorized');
    return state.user;
  },
}));

vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: {
    updateUserProfile: async (_userId: string, updates: Record<string, any>) => {
      state.updates.push(updates);
      if (state.updateError) throw Object.assign(new Error(state.updateError.message), { code: state.updateError.code });
      state.row = { ...state.row, ...updates };
      return { ...state.row };
    },
    getUserProfileWithStats: async () => ({ ...state.row }),
  },
}));

import { PUT } from '../route';

const put = (body: unknown, headers: Record<string, string> = {}) =>
  PUT(
    new Request('http://localhost/api/mobile/profile', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', authorization: 'Bearer t', ...headers },
    }) as any
  );

beforeEach(() => {
  state.authed = true;
  state.user = { id: 'u1', email: 'a@b.com', date_of_birth: null };
  state.row = {
    id: 'u1',
    username: 'ani',
    display_name: 'Ani',
    email: 'a@b.com',
    timezone: 'UTC',
    goals: [],
    preferences: {},
  };
  state.updates = [];
  state.updateError = null;
});

describe('PUT /api/mobile/profile', () => {
  it('old request shape (Android Edit Profile) works exactly as before', async () => {
    const res = await put({
      displayName: 'Ani B',
      bio: 'hi',
      dateOfBirth: '1984-09-26',
      heightCm: 177.6,
      weightKg: 74.5,
      fitnessLevel: 'expert',
      avatarUrl: 'https://x.supabase.co/storage/v1/object/public/avatars/avatars/u1.jpg',
    });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([
      {
        display_name: 'Ani B',
        bio: 'hi',
        date_of_birth: '1984-09-26',
        height_cm: 178,
        weight_kg: 74.5,
        fitness_level: 'expert',
        avatar_url: 'https://x.supabase.co/storage/v1/object/public/avatars/avatars/u1.jpg',
      },
    ]);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data.user).toMatchObject({ id: 'u1', display_name: 'Ani B', date_of_birth: '1984-09-26' });
    expect(typeof body.meta.requestTime).toBe('number');
  });

  it('gender: accepted and persisted (iOS + Android onboarding send it)', async () => {
    state.row.gender = null;
    const res = await put({ displayName: 'Ani', gender: 'prefer_not_to_say' });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toEqual({ display_name: 'Ani', gender: 'prefer_not_to_say' });
    expect((await res.json()).data.user.gender).toBe('prefer_not_to_say');
  });

  it('gender: a value the clients cannot decode is rejected', async () => {
    const res = await put({ gender: 'other' });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it('gender: the response has no gender key while the column does not exist', async () => {
    const res = await put({ displayName: 'Ani' });
    expect('gender' in (await res.json()).data.user).toBe(false);
  });

  it('response is decodable by iOS even when stored preferences is {}', async () => {
    const res = await put({ displayName: 'Ani' });
    const user = (await res.json()).data.user;
    expect(user.preferences.notifications.weekly_insights).toBe(true);
    expect(user.preferences.privacy).toMatchObject({
      profile_visibility: 'public',
      show_weight: true,
      show_progress: true,
      allow_team_invites: true,
      allow_challenge_invites: true,
    });
    expect(user.preferences.display).toEqual({ theme: 'dark', language: 'en', units: 'metric' });
  });

  describe('dateOfBirth as the ISO-8601 datetime iOS sends', () => {
    it('UTC-negative zone: midnight in Los Angeles', async () => {
      const res = await put({ dateOfBirth: '1984-09-26T07:00:00Z' }, { 'X-Client-Timezone': 'America/Los_Angeles' });
      expect(res.status).toBe(200);
      expect(state.updates[0]).toEqual({ date_of_birth: '1984-09-26' });
    });

    it('UTC-positive zone: midnight in Kolkata is the previous day in UTC', async () => {
      const res = await put({ dateOfBirth: '1984-09-25T18:30:00Z' }, { 'X-Client-Timezone': 'Asia/Kolkata' });
      expect(res.status).toBe(200);
      expect(state.updates[0]).toEqual({ date_of_birth: '1984-09-26' });
    });

    it('no zone header: falls back to the local-midnight rule', async () => {
      await put({ dateOfBirth: '1984-09-26T07:00:00Z' });
      await put({ dateOfBirth: '1984-09-25T18:30:00Z' });
      expect(state.updates).toEqual([{ date_of_birth: '1984-09-26' }, { date_of_birth: '1984-09-26' }]);
    });

    it('an unchanged date echoed from the login response is not shifted', async () => {
      state.user.date_of_birth = '1984-09-26';
      await put({ dateOfBirth: '1984-09-26T00:00:00Z' }, { 'X-Client-Timezone': 'America/Los_Angeles' });
      expect(state.updates[0]).toEqual({ date_of_birth: '1984-09-26' });
    });

    it('a future date is still rejected', async () => {
      const res = await put({ dateOfBirth: '2999-01-01T07:00:00Z' }, { 'X-Client-Timezone': 'America/Los_Angeles' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toEqual({ dateOfBirth: 'Date of birth cannot be in the future' });
    });
  });

  it('username: accepts what register accepts (periods)', async () => {
    const res = await put({ username: 'john.doe' });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toEqual({ username: 'john.doe' });
  });

  it('username: uniqueness handling is unchanged (409 USERNAME_TAKEN)', async () => {
    state.updateError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const res = await put({ username: 'taken_name' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('USERNAME_TAKEN');
  });

  it('null tolerance: explicit nulls on optional fields mean "not sent"', async () => {
    const res = await put({ displayName: 'Ani', bio: null, dateOfBirth: null, heightCm: null, gender: null });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toEqual({ display_name: 'Ani' });
  });

  it('validation error keeps its keys and carries a readable message', async () => {
    const res = await put({ heightCm: 500, username: 'x' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.meta).toBeNull();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.heightCm).toBe('Height must be less than 300 cm');
    expect(typeof body.error.details.username).toBe('string');
    expect(typeof body.error.timestamp).toBe('string');
    expect(body.error.message).toMatch(/^username: .+\(\+1 more\)$/);
  });

  it('401 is unchanged', async () => {
    state.authed = false;
    const res = await put({ displayName: 'Ani' });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });
});
