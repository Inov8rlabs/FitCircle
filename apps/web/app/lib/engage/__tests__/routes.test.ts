import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { signAdminRequest } from '@inov8r/engage-adapters';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  mobileAuth: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  on: vi.fn(),
}));
vi.mock('../../supabase-admin', () => ({
  createAdminSupabase: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('../../services/mobile-api-service', () => ({
  MobileAPIService: { authenticateWithToken: mocks.mobileAuth },
}));
vi.mock('../../db', () => ({
  getPgPool: () => ({ connect: mocks.connect, query: mocks.query, on: mocks.on }),
}));
const secret = 'test-only-engage-admin-assertion-key-at-least-32-bytes';
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('ENGAGE_ENABLED', 'true');
  vi.stubEnv('ENGAGE_ENVIRONMENT', 'test');
  vi.stubEnv('ENGAGE_ADMIN_SECRET', secret);
  vi.stubEnv('ENGAGE_SERVICE_ORIGIN','https://engage.test');
  vi.stubEnv('ENGAGE_INTEGRATION_SECRET','integration-'+secret);
  vi.stubEnv('ENGAGE_AUTHORIZATION_SECRET','authorization-'+secret);
  vi.stubEnv('ENGAGE_CONNECTOR_CRON_SECRET','connector-cron-'+secret);
  vi.stubEnv('ENGAGE_CONNECTOR_ENCRYPTION_KEY','a'.repeat(64));
  vi.stubEnv('ENGAGE_SENDS_ENABLED', 'false');
  vi.stubEnv('ENGAGE_LEGACY_BRIDGE_ENABLED', 'false');
  mocks.getUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'expired' },
  });
  mocks.mobileAuth.mockResolvedValue(null);
  mocks.connect.mockRejectedValue(
    new Error('Database must not be reached by unauthenticated requests'),
  );
});
afterEach(() => vi.unstubAllEnvs());
const route = () => import('@/api/engage/[...path]/route');
it('fails closed when disabled, unscoped or missing standalone service configuration', async () => {
  for (const [name, value] of [
    ['ENGAGE_ENABLED', 'false'],
    ['ENGAGE_ENVIRONMENT', ''],
    ['ENGAGE_SERVICE_ORIGIN', ''],
  ]) {
    vi.resetModules();
    vi.stubEnv('ENGAGE_ENABLED', 'true');
    vi.stubEnv('ENGAGE_ENVIRONMENT', 'test');
    vi.stubEnv('ENGAGE_SENDS_ENABLED', 'false');
    vi.stubEnv(name!, value!);
    const response = await (
      await route()
    ).GET(new Request('https://fitcircle.test/api/engage/admin/health'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toContain(secret);
  }
  expect(mocks.connect).not.toHaveBeenCalled();
});
it('rejects forged browser roles, wrong-app admin assertions, cookies and invalid bearer sessions before querying data', async () => {
  const { GET } = await route();
  const assertion = signAdminRequest({
    actor: {
      actor: 'test-admin',
      tenant: { app_id: 'second_app', environment: 'test' },
      role: 'admin',
    },
    secret,
    method: 'GET',
    path: '/api/engage/admin/health',
  });
  const requests = [
    new Request('https://fitcircle.test/api/engage/admin/health', {
      headers: {
        'x-admin-role': 'admin',
        'x-user-id': crypto.randomUUID(),
        'x-app-id': 'fitcircle',
      },
    }),
    new Request('https://fitcircle.test/api/engage/admin/health', {
      headers: { authorization: `Bearer ${assertion}` },
    }),
    new Request('https://fitcircle.test/api/engage/client/export', {
      headers: { cookie: 'user_id=forged' },
    }),
    new Request('https://fitcircle.test/api/engage/client/export', {
      headers: { authorization: 'Bearer expired-token' },
    }),
    new Request('https://fitcircle.test/api/engage/cron/dispatch', {
      method: 'POST',
    }),
  ];
  for (const request of requests) expect((await GET(request)).status).toBe(new URL(request.url).pathname.startsWith('/api/engage/client/')?401:404);
  expect(mocks.getUser).toHaveBeenCalledTimes(1);
  expect(mocks.getUser).toHaveBeenCalledWith('expired-token');
  expect(mocks.connect).not.toHaveBeenCalled();
});

it('constructs a thin fixed-app connector without a local campaign engine or database access', async()=>{
  vi.stubEnv('ENGAGE_SENDS_ENABLED','true');
  vi.stubEnv('ENGAGE_LEGACY_BRIDGE_ENABLED','true');
  const {getFitCircleEngage}=await import('../server');
  const host=getFitCircleEngage();
  expect(host?.connector.origin).toBe('https://engage.test');
  expect(host?.tenant).toEqual({app_id:'fitcircle',environment:'test'});
  expect(host).not.toHaveProperty('campaigns');
  expect(mocks.connect).not.toHaveBeenCalled();
  expect((await (await route()).GET(new Request('https://fitcircle.test/api/engage/admin/health'))).status).toBe(404);
});
