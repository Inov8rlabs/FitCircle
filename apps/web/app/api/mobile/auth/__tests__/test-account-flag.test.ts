/**
 * `test_account` / `test_account_kind` + `X-Test-Account: 1` on every mobile
 * user payload (docs/TEST_ACCOUNT_CONTRACT.md): login, register, google, apple,
 * session, GET/PUT profile. Real routes over one in-memory Supabase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: null as any,
  jwt: new Map<string, Record<string, unknown>>(),
  sessionUser: null as null | { id: string; email: string },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const client = h.db.client();
    return {
      ...client,
      auth: {
        ...client.auth,
        signInWithPassword: async ({ email }: { email: string }) => {
          const p = h.db.rows('profiles').find((r: any) => r.email === email);
          return p
            ? { data: { user: { id: p.id, email }, session: {} }, error: null }
            : { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
        },
      },
    };
  },
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => h.db.client() }));
vi.mock('@/lib/services/welcome-email-service', () => ({ triggerWelcomeEmail: () => {} }));
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
vi.mock('@/lib/middleware/mobile-auth', () => ({ verifyMobileAuth: async () => h.sessionUser }));
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string) => {
    const payload = h.jwt.get(token);
    if (!payload) throw new Error('bad token');
    return { payload };
  },
}));

import { WelcomeFakeDb } from '../../../../lib/services/__tests__/welcome-fake-db';
import { POST as applePOST } from '../apple/route';
import { POST as googlePOST } from '../google/route';
import { POST as loginPOST } from '../login/route';
import { POST as registerPOST } from '../register/route';
import { GET as sessionGET } from '../session/route';

const req = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/mobile/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  }) as any;

const db = (): WelcomeFakeDb => h.db;

function google(email: string, headers: Record<string, string> = {}) {
  const token = `g-${email}`;
  h.jwt.set(token, { iss: 'https://accounts.google.com', sub: `sub-${email}`, aud: 'x', email, given_name: 'Sam', family_name: 'Lee' });
  return googlePOST(req('google', { idToken: token }, { 'x-app-platform': 'android', ...headers }));
}
function apple(email: string, headers: Record<string, string> = {}) {
  const token = `a-${email}`;
  h.jwt.set(token, { iss: 'https://appleid.apple.com', sub: `apple-${email}`, aud: 'x', email });
  return applePOST(req('apple', { identityToken: token, userIdentifier: `apple-${email}`, fullName: { givenName: 'Ana', familyName: 'Diaz' } }, headers));
}
const register = (email: string, headers: Record<string, string> = {}) =>
  registerPOST(req('register', { email, password: 'password123', displayName: 'Maya Rao' }, headers));
const login = (email: string, headers: Record<string, string> = {}) => loginPOST(req('login', { email, password: 'password123' }, headers));

async function flag(res: Response, path: (b: any) => any = (b) => b.data.user) {
  const body = await res.json();
  const user = path(body);
  return { test_account: user.test_account, kind: user.test_account_kind, header: res.headers.get('x-test-account') };
}

const REAL = { test_account: false, kind: null, header: null };

beforeEach(() => {
  h.db = new WelcomeFakeDb();
  h.jwt.clear();
  h.sessionUser = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  delete process.env.ADS_TEST_EMAILS;
  delete process.env.ADS_TEST_EMAIL_DOMAINS;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('POST /api/mobile/auth/google', () => {
  it('real user: test_account false, no header', async () => {
    expect(await flag(await google('maya.rao@gmail.com'))).toEqual(REAL);
  });

  it('Play pre-launch robot address (firstnamelastname.12345@gmail.com)', async () => {
    expect(await flag(await google('jordanbaker.48213@gmail.com'))).toEqual({ test_account: true, kind: 'play_testers', header: '1' });
  });

  it('a robot that only sends X-Test-Device: 1 (no tell-tale address)', async () => {
    expect(await flag(await google('sam.lee@gmail.com', { 'x-test-device': '1' }))).toEqual({ test_account: true, kind: 'test_device', header: '1' });
  });

  it('returning account already flagged by an earlier X-Test-Device sign-in', async () => {
    db().addUser('sam.lee@gmail.com', { profile: { metadata: { test_device: { at: '2026-11-01T00:00:00Z', source: 'header' } } } });
    expect(await flag(await google('sam.lee@gmail.com'))).toEqual({ test_account: true, kind: 'test_device', header: '1' });
  });
});

describe('POST /api/mobile/auth/apple', () => {
  it('real user vs internal team', async () => {
    expect(await flag(await apple('ana.diaz@icloud.com'))).toEqual(REAL);
    expect(await flag(await apple('ani@fitcircle.ai'))).toEqual({ test_account: true, kind: 'internal', header: '1' });
  });
});

describe('POST /api/mobile/auth/register', () => {
  it('real user vs QA and Test Lab domains', async () => {
    expect(await flag(await register('maya.rao@gmail.com'))).toEqual(REAL);
    expect(await flag(await register('qa1@example.com'))).toEqual({ test_account: true, kind: 'qa', header: '1' });
    expect(await flag(await register('robot@cloudtestlabaccounts.com'))).toEqual({ test_account: true, kind: 'test_lab', header: '1' });
  });
});

describe('POST /api/mobile/auth/login', () => {
  it('real user; the App Review demo account; an admin', async () => {
    db().addUser('maya.rao@gmail.com');
    db().addUser('fitcircle.user@gmail.com');
    db().addUser('boss@gmail.com', { profile: { is_admin: true } });
    expect(await flag(await login('maya.rao@gmail.com'))).toEqual(REAL);
    expect(await flag(await login('fitcircle.user@gmail.com'))).toEqual({ test_account: true, kind: 'review', header: '1' });
    expect(await flag(await login('boss@gmail.com'))).toEqual({ test_account: true, kind: 'internal', header: '1' });
  });

  it('response keys unchanged: the flag is inside user, never a new data key', async () => {
    db().addUser('maya.rao@gmail.com');
    const body = await (await login('maya.rao@gmail.com')).json();
    expect(Object.keys(body.data).sort()).toEqual(['access_token', 'expires_in', 'refresh_token', 'user']);
  });
});

describe('GET /api/mobile/auth/session', () => {
  it('flags from the stored row and from the request header', async () => {
    const real = db().addUser('maya.rao@gmail.com');
    h.sessionUser = { id: real, email: 'maya.rao@gmail.com' };
    expect(await flag(await sessionGET(req('session', undefined)), (b) => b.data)).toEqual(REAL);
    expect(await flag(await sessionGET(req('session', undefined, { 'x-test-device': '1' })), (b) => b.data)).toEqual({
      test_account: true,
      kind: 'test_device',
      header: '1',
    });

    const robot = db().addUser('caseyjones.10293@gmail.com');
    h.sessionUser = { id: robot, email: 'caseyjones.10293@gmail.com' };
    expect(await flag(await sessionGET(req('session', undefined)), (b) => b.data)).toEqual({ test_account: true, kind: 'play_testers', header: '1' });
  });
});
