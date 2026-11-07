import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Supabase stub: profiles lookup + auth.admin.createUser + profiles insert -------
const state = {
  taken: new Set<string>(),
  inserted: [] as any[],
  created: [] as any[],
  updates: [] as any[],
  createError: null as null | { code?: string; message: string; status?: number },
  links: [] as any[],
  resends: [] as any[],
};
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
    update: (row: any) => ({ eq: async (_c: string, id: string) => (state.updates.push({ table, row, id }), { error: null }) }),
  }),
  auth: {
    signUp: async () => {
      throw new Error('register must not call the public signUp endpoint');
    },
    resend: async (args: any) => (state.resends.push(args), { error: null }),
    admin: {
      deleteUser: async () => ({}),
      createUser: async (args: any) => {
        state.created.push(args);
        if (state.createError) return { data: { user: null }, error: state.createError };
        return { data: { user: { id: 'user-1', email: args.email } }, error: null };
      },
      generateLink: async (args: any) => (
        state.links.push(args),
        { data: { properties: { action_link: 'https://auth.example.test/verify?token=t&type=signup' }, user: { id: 'user-1' } }, error: null }
      ),
    },
  },
};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => stub }));
// Welcome email is covered in app/api/__tests__/signup-welcome-email.test.ts; keep these tests offline.
vi.mock('@/lib/services/welcome-email-service', () => ({ triggerWelcomeEmail: () => {} }));
const sent: any[] = [];
vi.mock('@/lib/email/email-service', () => ({ sendEmail: async (m: any) => (sent.push(m), { success: true, id: 're_1' }) }));
vi.mock('@/lib/middleware/rate-limit', () => ({
  createRateLimiter: () => ({}),
  applyRateLimit: async () => null,
}));
vi.mock('@/lib/integrity/enforcement', () => ({
  checkIntegrity: async () => ({ allowed: true, mode: 'legacy', deviceId: null, attestedDeviceId: null }),
  recordSessionAttestation: async () => {},
}));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: { generateTokens: async () => ({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() / 1000 + 900 }) },
}));

import { POST } from '../route';

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/mobile/auth/register', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as any);

describe('POST /api/mobile/auth/register', () => {
  beforeEach(() => {
    state.taken = new Set();
    state.inserted = [];
    state.created = [];
    state.updates = [];
    state.createError = null;
    state.links = [];
    state.resends = [];
    sent.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    delete process.env.AUTH_SIGNUP_CONFIRM_EMAIL;
  });

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
    expect(state.created.map((c) => c.email)).toEqual(['abajirao.apps@gmail.com']);
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

describe('register via the Auth admin API (contract)', () => {
  beforeEach(() => {
    state.inserted = [];
    state.created = [];
    state.updates = [];
    state.createError = null;
    state.links = [];
    state.resends = [];
    sent.length = 0;
    delete process.env.AUTH_SIGNUP_CONFIRM_EMAIL;
  });

  it('creates the account with admin.createUser (confirmed, as autoconfirm signUp did) and sends no confirmation', async () => {
    const res = await post({ email: 'new.user@example.com', password: 'password123', displayName: 'New User' });
    expect(res.status).toBe(201);
    expect(state.created).toEqual([expect.objectContaining({ email: 'new.user@example.com', password: 'password123', email_confirm: true })]);
    expect(state.links).toHaveLength(0);
    expect(sent).toHaveLength(0);
    const body = await res.json();
    // Response shape unchanged: {success, data: {access_token, refresh_token, expires_in, user}}.
    expect(body).toMatchObject({ success: true, data: { access_token: 'a', refresh_token: 'r', user: expect.objectContaining({ id: 'user-1' }) } });
    expect(typeof body.data.expires_in).toBe('number');
  });

  it('stores the canonical mailbox (separate write)', async () => {
    await post({ email: 'Jane.Doe+fit@googlemail.com', password: 'password123', displayName: 'J' });
    expect(state.updates).toContainEqual({ table: 'profiles', row: { email_canonical: 'janedoe@gmail.com' }, id: 'user-1' });
  });

  it('AUTH_SIGNUP_CONFIRM_EMAIL=true: unconfirmed account + our confirmation email with the generated link', async () => {
    process.env.AUTH_SIGNUP_CONFIRM_EMAIL = 'true';
    const res = await post({ email: 'confirm.me@example.com', password: 'password123', displayName: 'C' });
    expect(res.status).toBe(201);
    expect(state.created[0].email_confirm).toBe(false);
    expect(state.links).toEqual([expect.objectContaining({ type: 'signup', email: 'confirm.me@example.com' })]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'confirm.me@example.com', subject: 'Confirm your FitCircle email', category: 'auth' });
    expect(sent[0].html).toContain('https://auth.example.test/verify?token=t&amp;type=signup');
    expect(sent[0].html).not.toContain('{{ .ConfirmationURL }}');
    expect(state.resends).toHaveLength(0);
  });

  it('an existing email answers 400 SIGNUP_FAILED (same error code as before)', async () => {
    state.createError = { code: 'email_exists', message: 'A user with this email address has already been registered', status: 422 };
    const res = await post({ email: 'taken@example.com', password: 'password123', displayName: 'T' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'SIGNUP_FAILED', message: expect.stringMatching(/already exists/) });
    expect(state.inserted).toHaveLength(0);
  });

  it('a GoTrue validation failure answers 400 SIGNUP_FAILED with its message', async () => {
    state.createError = { code: 'weak_password', message: 'Password is known to be weak', status: 422 };
    const res = await post({ email: 'weak@example.com', password: 'password123', displayName: 'W' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'SIGNUP_FAILED', message: 'Password is known to be weak', error: 'Password is known to be weak' });
  });

  it('an Auth outage answers 500 SIGNUP_FAILED', async () => {
    state.createError = { message: 'upstream timeout', status: 504 };
    const res = await post({ email: 'x@example.com', password: 'password123', displayName: 'X' });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'SIGNUP_FAILED', error: 'Registration failed' });
  });

  it('refuses a disposable inbox before creating anything', async () => {
    const res = await post({ email: 'burner@mailinator.com', password: 'password123', displayName: 'B' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/permanent email/) });
    expect(state.created).toHaveLength(0);
  });
});
