import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Null tolerance + readable validation messages on the auth routes, and proof
 * that the requests the shipped clients send are still accepted.
 */
const state = {
  signIns: [] as Array<{ email: string; password: string }>,
  inserted: [] as Array<Record<string, any>>,
  refreshed: [] as string[],
  emails: [] as Array<{ kind: string; email: string }>,
};

const profileRow = {
  id: 'user-1',
  username: 'ani',
  display_name: 'Ani',
  email: 'a@b.com',
  preferences: {},
  goals: [],
  date_of_birth: '1984-09-26',
};

const supabaseStub = {
  from: () => ({
    select: () => ({
      eq: () => ({ single: async () => ({ data: profileRow, error: null }) }),
      ilike: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
    insert: (row: Record<string, any>) => {
      state.inserted.push(row);
      return { select: () => ({ single: async () => ({ data: { ...row }, error: null }) }) };
    },
  }),
  auth: {
    signInWithPassword: async (credentials: { email: string; password: string }) => {
      state.signIns.push(credentials);
      return {
        data: { user: { id: 'user-1', email: credentials.email, created_at: '2026-01-01T00:00:00Z' }, session: {} },
        error: null,
      };
    },
    signUp: async ({ email }: { email: string }) => ({ data: { user: { id: 'user-1', email } }, error: null }),
    admin: { deleteUser: async () => ({}) },
    resetPasswordForEmail: async (email: string) => {
      state.emails.push({ kind: 'reset', email });
      return { error: null };
    },
    resend: async ({ email }: { email: string }) => {
      state.emails.push({ kind: 'confirm', email });
      return { error: null };
    },
  },
};

vi.mock('@supabase/supabase-js', () => ({ createClient: () => supabaseStub }));
vi.mock('@/lib/middleware/rate-limit', () => ({
  authRateLimiter: {},
  registerRateLimiter: {},
  createRateLimiter: () => ({}),
  getIdentifier: () => 'ip',
  applyRateLimit: async () => null,
}));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: {
    generateTokens: async () => ({ access_token: 'a', refresh_token: 'r', expires_at: 2_000_000_000 }),
    refreshAccessToken: async (token: string) => {
      state.refreshed.push(token);
      return { access_token: 'a2', refresh_token: 'r2', expires_at: 2_000_000_000, token_type: 'Bearer' };
    },
  },
}));
vi.mock('@/lib/services/social-auth-service', () => ({
  SocialAuthError: class SocialAuthError extends Error {
    code = 'SOCIAL_AUTH_FAILED';
  },
  findOrCreateSocialUser: async () => {
    throw new Error('not reached in these tests');
  },
}));

import { parseAppleAuthRequest } from '../apple/apple-request';
import { POST as forgotPassword } from '../forgot-password/route';
import { POST as google } from '../google/route';
import { POST as login } from '../login/route';
import { POST as refresh } from '../refresh/route';
import { POST as register } from '../register/route';
import { POST as resendConfirmation } from '../resend-confirmation/route';

const post = (handler: (request: any) => Promise<Response>, path: string, body: unknown) =>
  handler(
    new Request(`http://localhost/api/mobile/auth/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  );

beforeEach(() => {
  state.signIns = [];
  state.inserted = [];
  state.refreshed = [];
  state.emails = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('POST /api/mobile/auth/login', () => {
  it('the request iOS and Android send (LoginRequest) is accepted, response shape unchanged', async () => {
    const res = await post(login, 'login', { email: 'a@b.com', password: 'secret12' });
    expect(res.status).toBe(200);
    expect(state.signIns).toEqual([{ email: 'a@b.com', password: 'secret12' }]);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(['access_token', 'expires_in', 'refresh_token', 'user']);
    expect(body.data.user.date_of_birth).toBe('1984-09-26T00:00:00.000Z');
    expect('gender' in body.data.user).toBe(false);
  });

  it('validation error: existing keys kept, message says what is wrong', async () => {
    const res = await post(login, 'login', { email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation error');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.message).toBe('email: Invalid email address');
    expect(state.signIns).toHaveLength(0);
  });

  it('a null required field is still a 400', async () => {
    const res = await post(login, 'login', { email: 'a@b.com', password: null });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/^password: /);
  });
});

describe('POST /api/mobile/auth/register', () => {
  it('the request iOS and Android send (no username) is accepted', async () => {
    const res = await post(register, 'register', { email: 'fit.user@gmail.com', password: 'password123', displayName: 'Fit User' });
    expect(res.status).toBe(201);
    expect(state.inserted[0]).toMatchObject({ username: 'fit.user', display_name: 'Fit User' });
  });

  it('username: null is the same as no username', async () => {
    const res = await post(register, 'register', {
      email: 'fit.user@gmail.com',
      password: 'password123',
      displayName: 'Fit User',
      username: null,
    });
    expect(res.status).toBe(201);
    expect(state.inserted[0].username).toBe('fit.user');
  });

  it('an explicit username is still honoured', async () => {
    const res = await post(register, 'register', {
      email: 'a@b.com',
      password: 'password123',
      displayName: 'A',
      username: 'Ani.B',
    });
    expect(res.status).toBe(201);
    expect(state.inserted[0].username).toBe('Ani.B');
  });

  it('validation error body is unchanged', async () => {
    const res = await post(register, 'register', { email: 'a@b.com', password: 'short', displayName: 'A' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      message: 'Password must be at least 8 characters',
    });
    expect(Array.isArray(body.details)).toBe(true);
  });
});

describe('POST /api/mobile/auth/refresh', () => {
  it('the request the clients send is accepted, response shape unchanged', async () => {
    const res = await post(refresh, 'refresh', { refresh_token: 'r1' });
    expect(res.status).toBe(200);
    expect(state.refreshed).toEqual(['r1']);
    expect(Object.keys(await res.json())).toEqual(['session']);
  });

  it('validation error: existing keys kept, message says what is wrong', async () => {
    const res = await post(refresh, 'refresh', { refresh_token: null });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation error');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.message).toMatch(/^refresh_token: /);
  });
});

describe('POST /api/mobile/auth/google', () => {
  it('a null alias next to the real token is tolerated (reaches token verification)', async () => {
    const res = await post(google, 'google', { idToken: 'not-a-real-token', googleIdToken: null });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('INVALID_GOOGLE_TOKEN');
  });

  it('validation error: envelope kept, message says what is wrong', async () => {
    const res = await post(google, 'google', {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.message).toBe('googleIdToken: googleIdToken is required');
  });
});

describe('POST /api/mobile/auth/forgot-password and /resend-confirmation', () => {
  it('the request the clients send is accepted, response shape unchanged', async () => {
    const reset = await post(forgotPassword, 'forgot-password', { email: 'a@b.com' });
    const confirm = await post(resendConfirmation, 'resend-confirmation', { email: 'a@b.com' });
    expect(reset.status).toBe(200);
    expect(confirm.status).toBe(200);
    expect(state.emails).toEqual([
      { kind: 'reset', email: 'a@b.com' },
      { kind: 'confirm', email: 'a@b.com' },
    ]);
    const body = await reset.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.message).toBe('string');
  });

  it('validation error body is unchanged', async () => {
    for (const [handler, path] of [
      [forgotPassword, 'forgot-password'],
      [resendConfirmation, 'resend-confirmation'],
    ] as const) {
      const res = await post(handler, path, { email: null });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Invalid email address');
      expect(Array.isArray(body.error.details)).toBe(true);
    }
    expect(state.emails).toHaveLength(0);
  });
});

describe('parseAppleAuthRequest', () => {
  it('the iOS body (AppleSignInRequest) with absent optionals sent as null', () => {
    expect(
      parseAppleAuthRequest({
        identity_token: 'tok',
        authorization_code: null,
        user_identifier: 'apple-user',
        full_name: null,
        email: null,
      })
    ).toEqual({ identityToken: 'tok', userIdentifier: 'apple-user', email: undefined, firstName: '', lastName: '' });
  });
});
