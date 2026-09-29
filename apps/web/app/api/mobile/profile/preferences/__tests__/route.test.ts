import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PUT /api/mobile/profile/preferences is the path the iOS app calls. It delegates
 * to the real settings/preferences handler (not mocked here) and answers with the
 * `{ user }` wrapper iOS decodes.
 */
const state = {
  authed: true,
  row: {} as Record<string, any>,
  writes: [] as Array<Record<string, any>>,
};

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => {
    if (!state.authed) throw new Error('Unauthorized');
    return { id: 'u1', email: 'a@b.com' };
  },
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: async (_req: unknown, res: any) => {
    res.headers.set('X-New-Access-Token', 'fresh-token');
    return res;
  },
}));

function profilesTable() {
  return {
    select: () => ({
      eq: () => ({ single: async () => ({ data: { ...state.row }, error: null }) }),
    }),
    update: (patch: Record<string, any>) => ({
      eq: () => ({
        select: () => ({
          single: async () => {
            state.writes.push(patch);
            state.row = { ...state.row, ...patch };
            return { data: { ...state.row }, error: null };
          },
        }),
      }),
    }),
  };
}
function otherTable() {
  const result = { data: [], count: 0, error: null };
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}
vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: (table: string) => (table === 'profiles' ? profilesTable() : otherTable()),
  }),
}));

import { PUT } from '../route';

const put = (body: unknown) =>
  PUT(
    new Request('http://localhost/api/mobile/profile/preferences', {
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer t',
        'x-client-timezone': 'America/Los_Angeles',
      },
    }) as any
  );

/** Exactly what JSONEncoder produces for iOS `UpdatePreferencesRequest`. */
const iosBody = (privacy: Record<string, unknown> = {}, display: Record<string, unknown> = {}) => ({
  preferences: {
    notifications: {
      push: true,
      email: true,
      sms: false,
      challenge_invite: true,
      team_invite: true,
      check_in_reminder: true,
      achievement: true,
      comment: true,
      reaction: true,
      leaderboard_update: true,
      weekly_insights: true,
    },
    privacy: {
      show_weight: true,
      show_progress: true,
      profile_visibility: 'public',
      allow_team_invites: true,
      allow_challenge_invites: true,
      ...privacy,
    },
    display: { theme: 'dark', language: 'en', units: 'metric', ...display },
  },
});

beforeEach(() => {
  state.authed = true;
  state.writes = [];
  state.row = {
    id: '6f1c2f0e-5a3b-4a53-9d0a-0d2f5a1b7c11',
    username: 'ani',
    display_name: 'Ani',
    email: 'a@b.com',
    timezone: 'UTC',
    goals: [],
    preferences: { hydration: { daily_target_ml: 2500 }, notifications: { push: false } },
    total_points: 10,
    current_streak: 1,
    longest_streak: 2,
    challenges_completed: 0,
    challenges_won: 0,
    is_active: true,
    last_active_at: '2026-09-28T10:00:00+00:00',
    created_at: '2026-01-01T10:00:00+00:00',
    updated_at: '2026-09-28T10:00:00+00:00',
  };
});

describe('PUT /api/mobile/profile/preferences (iOS alias)', () => {
  it('saves the privacy and display sections iOS sends', async () => {
    const res = await put(
      iosBody({ profile_visibility: 'private', allow_team_invites: false, allow_challenge_invites: false }, { units: 'imperial' })
    );
    expect(res.status).toBe(200);
    expect(state.writes).toHaveLength(1);
    expect(state.row.preferences.privacy).toEqual({
      show_weight: true,
      show_progress: true,
      profile_visibility: 'private',
      allow_team_invites: false,
      allow_challenge_invites: false,
    });
    expect(state.row.preferences.display).toEqual({ theme: 'dark', language: 'en', units: 'imperial' });
  });

  it('does not overwrite notification settings or other stored preferences', async () => {
    await put(iosBody());
    expect(state.row.preferences.notifications).toEqual({ push: false });
    expect(state.row.preferences.hydration).toEqual({ daily_target_ml: 2500 });
  });

  it('answers with the { user } wrapper iOS decodes (APIResponse<ProfileResponseWrapper>)', async () => {
    const res = await put(iosBody({ allow_team_invites: false }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    const user = body.data.user;

    // Non-optional properties of iOS `User` (Core/Models/User.swift).
    for (const key of [
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
    ]) {
      expect(user[key], key).not.toBeUndefined();
      expect(user[key], key).not.toBeNull();
    }
    expect(Object.keys(user.preferences.notifications)).toHaveLength(11);
    expect(user.preferences.notifications.push).toBe(false);
    expect(user.preferences.privacy).toEqual({
      profile_visibility: 'public',
      show_weight: true,
      show_progress: true,
      allow_team_invites: false,
      allow_challenge_invites: true,
    });
    expect(user.preferences.display).toEqual({ theme: 'dark', language: 'en', units: 'metric' });
  });

  it('is never cacheable and passes the silent token refresh through', async () => {
    const res = await put(iosBody());
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-New-Access-Token')).toBe('fresh-token');
  });

  it('also accepts the body without the `preferences` wrapper', async () => {
    const res = await put({ privacy: { allow_challenge_invites: false } });
    expect(res.status).toBe(200);
    expect(state.row.preferences.privacy).toEqual({ allow_challenge_invites: false });
    expect((await res.json()).data.user.preferences.privacy.allow_challenge_invites).toBe(false);
  });

  it('validation errors come from the delegated handler, in the standard envelope', async () => {
    const res = await put(iosBody({ profile_visibility: 'everyone' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/^privacy\.profile_visibility: /);
    expect(state.writes).toHaveLength(0);
  });

  it('a body that is not JSON is a 400', async () => {
    const res = await put('not json');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    state.authed = false;
    const res = await put(iosBody());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(state.writes).toHaveLength(0);
  });
});
