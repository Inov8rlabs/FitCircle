import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  authed: true,
  preferences: {} as Record<string, any>,
  writes: [] as Array<Record<string, any>>,
};

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => {
    if (!state.authed) throw new Error('Unauthorized');
    return { id: 'u1', email: 'a@b.com' };
  },
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: async (_req: unknown, res: unknown) => res,
}));
vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { preferences: state.preferences }, error: null }) }),
      }),
      update: (patch: Record<string, any>) => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              state.writes.push(patch);
              state.preferences = patch.preferences;
              return { data: { preferences: patch.preferences }, error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

import { GET, PUT } from '../route';

const request = (method: string, body?: unknown) =>
  new Request('http://localhost/api/mobile/settings/preferences', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
  }) as any;

const put = (body: unknown) => PUT(request('PUT', body));
const get = () => GET(request('GET'));

beforeEach(() => {
  state.authed = true;
  state.preferences = {};
  state.writes = [];
});

describe('PUT /api/mobile/settings/preferences', () => {
  it('persists allow_team_invites and allow_challenge_invites (Android body)', async () => {
    const res = await put({
      privacy: {
        profile_visibility: 'friends',
        show_weight: false,
        show_progress: true,
        allow_team_invites: false,
        allow_challenge_invites: false,
      },
    });
    expect(res.status).toBe(200);
    expect(state.preferences.privacy).toEqual({
      profile_visibility: 'friends',
      show_weight: false,
      show_progress: true,
      allow_team_invites: false,
      allow_challenge_invites: false,
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.privacy.allow_team_invites).toBe(false);
    expect(body.data.privacy.allow_challenge_invites).toBe(false);
  });

  it('old request shape still works: the iOS biometric toggle', async () => {
    state.preferences = { privacy: { allow_team_invites: false } };
    const res = await put({ security: { biometric_auth_enabled: true } });
    expect(res.status).toBe(200);
    expect(state.preferences.security).toEqual({ biometric_auth_enabled: true });
    expect(state.preferences.privacy).toEqual({ allow_team_invites: false }); // untouched
  });

  it('old request shape still works: privacy without the two new keys', async () => {
    state.preferences = { privacy: { allow_team_invites: false, show_weight: true } };
    await put({ privacy: { profile_visibility: 'private', show_weight: false } });
    expect(state.preferences.privacy).toEqual({
      allow_team_invites: false,
      show_weight: false,
      profile_visibility: 'private',
    });
  });

  it('keeps everything else stored in preferences (hydration goal, unit system)', async () => {
    state.preferences = {
      hydration: { daily_target_ml: 2500 },
      unitSystem: 'metric',
      units: { weight: 'kg', height: 'cm' },
      notifications: { push: false },
    };
    await put({ privacy: { allow_team_invites: false } });
    expect(state.preferences.hydration).toEqual({ daily_target_ml: 2500 });
    expect(state.preferences.unitSystem).toBe('metric');
    expect(state.preferences.units).toEqual({ weight: 'kg', height: 'cm' });
    expect(state.preferences.notifications).toEqual({ push: false });
  });

  it('keeps an existing legacy camelCase twin in step, and creates none', async () => {
    state.preferences = { privacy: { profileVisibility: 'friends', allowTeamInvites: true } };
    await put({
      privacy: { profile_visibility: 'private', allow_team_invites: false, allow_challenge_invites: false },
    });
    expect(state.preferences.privacy).toEqual({
      profileVisibility: 'private',
      profile_visibility: 'private',
      allowTeamInvites: false,
      allow_team_invites: false,
      allow_challenge_invites: false,
    });
  });

  it('keeps an existing unitSystem in step with display.units', async () => {
    state.preferences = { unitSystem: 'metric', units: { weight: 'kg', height: 'cm' } };
    await put({ display: { units: 'imperial' } });
    expect(state.preferences.unitSystem).toBe('imperial');
    expect(state.preferences.units).toEqual({ weight: 'lbs', height: 'inches' });
    expect(state.preferences.display).toEqual({ units: 'imperial' });

    state.preferences = {};
    await put({ display: { units: 'imperial' } });
    expect('unitSystem' in state.preferences).toBe(false);
    expect('units' in state.preferences).toBe(false);
  });

  it('null tolerance: null fields and null sections mean "not sent"', async () => {
    state.preferences = { privacy: { show_weight: false } };
    const res = await put({
      notifications: null,
      display: null,
      security: null,
      privacy: { allow_team_invites: false, allow_challenge_invites: null, show_weight: null },
    });
    expect(res.status).toBe(200);
    expect(state.preferences.privacy).toEqual({ show_weight: false, allow_team_invites: false });
  });

  it('validation error keeps its keys and carries a readable message', async () => {
    const res = await put({ privacy: { allow_team_invites: 'yes' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.message).toMatch(/^privacy\.allow_team_invites: /);
    expect(state.writes).toHaveLength(0);
  });

  it('401 is unchanged', async () => {
    state.authed = false;
    const res = await put({ privacy: {} });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /api/mobile/settings/preferences', () => {
  it('returns the two keys under privacy, default true', async () => {
    const body = await (await get()).json();
    expect(body.data.privacy).toEqual({
      profile_visibility: 'public',
      show_weight: true,
      show_progress: true,
      allow_team_invites: true,
      allow_challenge_invites: true,
    });
    // Everything that was returned before is still there.
    expect(body.data.notifications).toEqual({ push: true, email: true, challenge_invite: true, check_in_reminder: true });
    expect(body.data.display).toEqual({ theme: 'dark', language: 'en', units: 'metric' });
    expect(body.data.security).toEqual({ biometric_auth_enabled: false });
  });

  it('returns what PUT stored', async () => {
    await put({ privacy: { allow_team_invites: false, allow_challenge_invites: false } });
    const body = await (await get()).json();
    expect(body.data.privacy.allow_team_invites).toBe(false);
    expect(body.data.privacy.allow_challenge_invites).toBe(false);
  });
});
