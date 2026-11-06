/**
 * Every sign-up path sends exactly ONE welcome email (docs/EMAIL_QUALITY.md §B):
 *   web /api/auth/register, web client sign-up → /api/auth/welcome,
 *   /api/mobile/auth/register, first /api/mobile/auth/apple, first /api/mobile/auth/google.
 *
 * Real routes + real welcome service + real once-only ledger (profiles.metadata)
 * over one in-memory Supabase; Resend is mocked (no real email is ever sent).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: null as any,
  after: [] as Array<() => unknown>,
  mail: { sent: [] as any[], failWith: null as null | { name: string; message: string }, throws: false },
  jwt: new Map<string, Record<string, unknown>>(),
  webUser: null as any,
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.db.client() }));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => h.db.client() }));
vi.mock('@/lib/utils/after-response', () => ({
  runAfterResponse: (task: () => unknown) => {
    h.after.push(task);
  },
}));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (msg: any, opts?: any) => {
        if (h.mail.throws) throw new Error('fetch failed');
        if (h.mail.failWith) return { data: null, error: h.mail.failWith };
        h.mail.sent.push({ ...msg, idempotencyKey: opts?.idempotencyKey });
        return { data: { id: `re_${h.mail.sent.length}` }, error: null };
      },
    };
  },
}));
vi.mock('@/lib/middleware/rate-limit', () => ({
  registerRateLimiter: {},
  authRateLimiter: {},
  createRateLimiter: () => ({}),
  getIdentifier: () => 'ip',
  applyRateLimit: async () => null,
}));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: { generateTokens: async () => ({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() / 1000 + 900 }) },
}));
vi.mock('@/lib/referrals/web-claim', () => ({
  CLEAR_FC_REF_COOKIE: { name: 'fc_ref', value: '', maxAge: 0 },
  resolveWebInvite: () => null,
  claimWebInvite: async () => null,
}));
vi.mock('@/lib/middleware/mobile-auth', () => ({ verifyMobileAuth: async () => h.webUser }));
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string) => {
    const payload = h.jwt.get(token);
    if (!payload) throw new Error('bad token');
    return { payload };
  },
}));

import { WelcomeFakeDb } from '../../lib/services/__tests__/welcome-fake-db';
import { POST as webRegisterPOST } from '../auth/register/route';
import { POST as welcomePOST } from '../auth/welcome/route';
import { POST as applePOST } from '../mobile/auth/apple/route';
import { POST as googlePOST } from '../mobile/auth/google/route';
import { POST as mobileRegisterPOST } from '../mobile/auth/register/route';

// The welcome email is lifecycle mail: sent only with a postal address (lib/email/compliance.ts).
process.env.EMAIL_POSTAL_ADDRESS = process.env.EMAIL_POSTAL_ADDRESS || '123 Test Street, Testville, CA 94000, USA';

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }) as any;

async function flushAfter() {
  while (h.after.length) await h.after.shift()!();
}

const db = (): WelcomeFakeDb => h.db;
const welcomes = () => h.mail.sent.filter((m) => m.tags?.some((t: any) => t.name === 'category' && t.value === 'welcome'));

const mobileRegister = (email: string, headers: Record<string, string> = {}) =>
  mobileRegisterPOST(json('http://localhost/api/mobile/auth/register', { email, password: 'password123', displayName: 'Maya Rao' }, { 'x-app-platform': 'ios', ...headers }));
const webRegister = (email: string) =>
  webRegisterPOST(json('http://localhost/api/auth/register', { email, password: 'password123', fullName: 'Maya Rao' }));
function google(email: string, headers: Record<string, string> = {}) {
  const token = `g-${email}`;
  h.jwt.set(token, { iss: 'https://accounts.google.com', sub: `sub-${email}`, aud: 'x', email, given_name: 'Sam', family_name: 'Lee' });
  return googlePOST(json('http://localhost/api/mobile/auth/google', { idToken: token }, { 'x-app-platform': 'android', ...headers }));
}
function apple(email: string, headers: Record<string, string> = {}) {
  const token = `a-${email}`;
  h.jwt.set(token, { iss: 'https://appleid.apple.com', sub: `apple-${email}`, aud: 'x', email });
  return applePOST(json('http://localhost/api/mobile/auth/apple', { identityToken: token, userIdentifier: `apple-${email}`, fullName: { givenName: 'Ana', familyName: 'Diaz' } }, { 'x-app-platform': 'ios', ...headers }));
}

beforeEach(() => {
  h.db = new WelcomeFakeDb();
  h.after.length = 0;
  h.mail.sent.length = 0;
  h.mail.failWith = null;
  h.mail.throws = false;
  h.jwt.clear();
  h.webUser = null;
  process.env.RESEND_API_KEY = 'test';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  delete process.env.WELCOME_EMAIL_ENABLED;
});

describe('mobile email register', () => {
  it('sends one welcome email after the response, records it, and a retried request sends nothing more', async () => {
    const res = await mobileRegister('maya@gmail.com');
    expect(res.status).toBe(201);
    expect(h.mail.sent).toHaveLength(0); // nothing before the response
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
    const msg = welcomes()[0];
    expect(msg).toMatchObject({ to: 'maya@gmail.com', from: 'FitCircle <team@fitcircle.ai>', subject: 'Welcome to FitCircle, Maya', idempotencyKey: expect.stringMatching(/^welcome\//) });
    expect(msg.headers['List-Unsubscribe']).toMatch(/\/api\/campaigns\/unsubscribe\?t=/);
    expect(msg.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(msg.text).toContain('Log your first meal');
    const userId = db().rows('profiles')[0].id;
    expect(db().profile(userId)!.metadata.welcome_email).toMatchObject({ status: 'sent', method: 'email', platform: 'ios', provider_id: 're_1' });

    // Same account, same hook again (double tap / retried after()): no second email.
    const { sendWelcomeOnce, ProfileWelcomeLedger } = await import('@/lib/services/welcome-email-service');
    const { sendEmail } = await import('@/lib/email/email-service');
    expect(await sendWelcomeOnce({ userId, email: 'maya@gmail.com', method: 'email', platform: 'ios' }, { ledger: new ProfileWelcomeLedger(), send: sendEmail })).toBe('already_sent');
    expect(welcomes()).toHaveLength(1);
  });

  it('Play pre-launch / Test Lab robot (X-Test-Device: 1) gets no welcome email', async () => {
    expect((await mobileRegister('robot.person@gmail.com', { 'x-test-device': '1' })).status).toBe(201);
    await flushAfter();
    expect(welcomes()).toHaveLength(0);
    expect(db().rows('profiles')[0].metadata.welcome_email).toMatchObject({ status: 'skipped', reason: 'test:test_device' });
  });

  it("Google's generated Play tester accounts and QA domains are excluded too", async () => {
    await mobileRegister('johnsmith.12345@gmail.com');
    await mobileRegister('qa@example.com');
    await flushAfter();
    expect(welcomes()).toHaveLength(0);
  });

  it('a provider failure never fails sign-up (logged, recorded as failed, not retried later)', async () => {
    h.mail.failWith = { name: 'validation_error', message: 'Invalid `to` field' };
    const res = await mobileRegister('maya@gmail.com');
    expect(res.status).toBe(201);
    await flushAfter();
    expect(welcomes()).toHaveLength(0);
    expect(db().rows('profiles')[0].metadata.welcome_email).toMatchObject({ status: 'failed', reason: 'validation_error' });
  });

  it('a thrown network error in Resend also leaves sign-up intact', async () => {
    h.mail.throws = true;
    const res = await mobileRegister('maya@gmail.com');
    expect(res.status).toBe(201);
    await expect(flushAfter()).resolves.toBeUndefined();
  });

  it('WELCOME_EMAIL_ENABLED=false turns it off', async () => {
    process.env.WELCOME_EMAIL_ENABLED = 'false';
    await mobileRegister('maya@gmail.com');
    await flushAfter();
    expect(welcomes()).toHaveLength(0);
  });
});

describe('Google sign-in', () => {
  it('first sign-in creates the account and sends one welcome; returning sign-in sends none', async () => {
    const first = await google('sam@gmail.com');
    expect((await first.json()).data.is_new_user).toBe(true);
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
    expect(welcomes()[0].subject).toBe('Welcome to FitCircle, Sam');

    const again = await google('sam@gmail.com');
    expect((await again.json()).data.is_new_user).toBe(false);
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
  });

  it('robot sign-in (X-Test-Device) is excluded', async () => {
    await google('sam@gmail.com', { 'x-test-device': '1' });
    await flushAfter();
    expect(welcomes()).toHaveLength(0);
  });
});

describe('Sign in with Apple', () => {
  it('first sign-in sends one welcome; returning sign-in sends none', async () => {
    await apple('abc123@privaterelay.appleid.com');
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
    expect(welcomes()[0].to).toBe('abc123@privaterelay.appleid.com');
    await apple('abc123@privaterelay.appleid.com');
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
  });
});

describe('web', () => {
  it('server register (/api/auth/register) sends one welcome with web links', async () => {
    const res = await webRegister('lee@outlook.com');
    expect(res.status).toBe(200);
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
    expect(welcomes()[0].html).toContain('https://www.fitcircle.ai/food-log?');
  });

  it('client sign-up asks /api/auth/welcome: new account → one email; asking again → none; old account → none', async () => {
    const id = db().addUser('nina@yahoo.com', { profile: { display_name: 'Nina K' } });
    h.webUser = { id, email: 'nina@yahoo.com', display_name: 'Nina K' };
    const first = await welcomePOST(json('http://localhost/api/auth/welcome', {}));
    expect(await first.json()).toMatchObject({ success: true, data: { queued: true } });
    await flushAfter();
    await welcomePOST(json('http://localhost/api/auth/welcome', {}));
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
    expect(welcomes()[0].subject).toBe('Welcome to FitCircle, Nina');

    const old = db().addUser('old@yahoo.com', { createdAt: new Date(Date.now() - 2 * 3600_000).toISOString() });
    h.webUser = { id: old, email: 'old@yahoo.com' };
    const late = await welcomePOST(json('http://localhost/api/auth/welcome', {}));
    expect((await late.json()).data.queued).toBe(false);
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
  });

  it('accepts a Supabase access token when the cookie is not there yet; 401 without any auth', async () => {
    const id = db().addUser('tok@yahoo.com');
    db().tokens.set('sb-token', id);
    const ok = await welcomePOST(json('http://localhost/api/auth/welcome', {}, { authorization: 'Bearer sb-token' }));
    expect((await ok.json()).data.queued).toBe(true);
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
    expect((await welcomePOST(json('http://localhost/api/auth/welcome', {}))).status).toBe(401);
  });
});

describe('cross-platform: sign up on web, then sign in on mobile', () => {
  it('web sign-up then Google sign-in with the same email → exactly one welcome', async () => {
    await webRegister('pat@gmail.com');
    await flushAfter();
    const res = await google('pat@gmail.com');
    expect((await res.json()).data.is_new_user).toBe(false);
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
  });

  it('even if a route wrongly reported a new account, the once-only record blocks a second email', async () => {
    await mobileRegister('pat@gmail.com');
    await flushAfter();
    const { triggerWelcomeEmail } = await import('@/lib/services/welcome-email-service');
    triggerWelcomeEmail({ userId: db().rows('profiles')[0].id, email: 'pat@gmail.com', method: 'google', platform: 'android' });
    await flushAfter();
    expect(welcomes()).toHaveLength(1);
  });
});
