import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Supabase stub: profiles lookup + auth.signUp + profiles insert -------------
const state = { taken: new Set<string>(), inserted: [] as any[], signUpEmails: [] as string[] };
const stub = {
  from: (table: string) => ({
    select: () => ({
      ilike: (_col: string, value: string) => ({
        limit: () => ({ maybeSingle: async () => ({ data: state.taken.has(value.toLowerCase()) ? { id: 'x' } : null }) }),
      }),
    }),
    insert: (row: any) => {
      state.inserted.push({ table, row });
      return { select: () => ({ single: async () => ({ data: { id: row.id, ...row }, error: null }) }) };
    },
  }),
  auth: {
    signUp: async ({ email }: { email: string }) => (state.signUpEmails.push(email), { data: { user: { id: 'user-1', email } }, error: null }),
    admin: { deleteUser: async () => ({}) },
  },
};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => stub }));
// Welcome email is covered in app/api/__tests__/signup-welcome-email.test.ts; keep these tests offline.
vi.mock('@/lib/services/welcome-email-service', () => ({ triggerWelcomeEmail: () => {} }));
vi.mock('@/lib/middleware/rate-limit', () => ({
  registerRateLimiter: {},
  getIdentifier: () => 'ip',
  applyRateLimit: async () => null,
}));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: { generateTokens: async () => ({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }) },
}));

import { POST } from '../route';

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/mobile/auth/register', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as any);

describe('POST /api/mobile/auth/register', () => {
  beforeEach(() => { state.taken = new Set(); state.inserted = []; state.signUpEmails = []; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; });

  it('derives a valid username from a dotted email when none is sent (the production bug)', async () => {
    const res = await post({ email: 'fitcircle.user@gmail.com', password: 'password123', displayName: 'Fitcircle User' });
    expect(res.status).toBe(201);
    const profile = state.inserted.find((i) => i.table === 'profiles')?.row;
    expect(profile.username).toBe('fitcircle.user');
  });

  it('appends a suffix when the derived username is taken', async () => {
    state.taken.add('fitcircle.user');
    const res = await post({ email: 'fitcircle.user@gmail.com', password: 'password123', displayName: 'F' });
    expect(res.status).toBe(201);
    expect(state.inserted.find((i) => i.table === 'profiles')?.row.username).toBe('fitcircle.user2');
  });

  it('returns a decodable VALIDATION_ERROR with the real reason for a bad explicit username', async () => {
    const res = await post({ email: 'a@b.com', password: 'password123', displayName: 'A', username: 'bad+name' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toMatch(/letters, numbers, underscores or periods/);
  });

  it('honours an explicit valid username and rejects a taken one with 409', async () => {
    state.taken.add('anki');
    const res = await post({ email: 'a@b.com', password: 'password123', displayName: 'A', username: 'Anki' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('USERNAME_EXISTS');
  });

  it('accepts an address with keyboard artefacts and stores it cleaned and lower-cased', async () => {
    const res = await post({ email: ' Abajirao.Apps@Gmail com\n', password: 'password123', displayName: 'A' });
    expect(res.status).toBe(201);
    expect(state.signUpEmails).toEqual(['abajirao.apps@gmail.com']);
    const profile = state.inserted.find((i) => i.table === 'profiles')?.row;
    expect(profile.email).toBe('abajirao.apps@gmail.com');
    expect(profile.username).toBe('abajirao.apps');
  });

  it('still rejects an address that is not well-formed', async () => {
    const res = await post({ email: 'john smith@gmail', password: 'password123', displayName: 'A' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });
});
