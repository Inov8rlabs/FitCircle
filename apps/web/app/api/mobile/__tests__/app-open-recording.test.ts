/**
 * Retention fixes 4 + 5 at the route level: the foreground requests both apps
 * already make record an app open, and any authenticated request backfills a
 * placeholder profile timezone from X-Client-Timezone.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const record = vi.hoisted(() => vi.fn(async () => {}));
const backfill = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/services/app-open-service', async (orig) => {
  const real: any = await orig();
  // Static methods aren't enumerable: patch the class itself.
  real.AppOpenService.record = record;
  real.AppOpenService.backfillTimezone = backfill;
  return real;
});
vi.mock('@/lib/utils/after-response', () => ({ runAfterResponse: (task: () => unknown) => void task() }));
vi.mock('@/lib/services/entitlement-service', () => ({ EntitlementService: { getEntitlements: vi.fn(async () => ({ tier: 'free', features: {} })) } }));
vi.mock('@/lib/services/user-targets-service', () => ({ UserTargetsService: { get: vi.fn(async () => ({ calories: 2000 })) } }));
const authUser = vi.hoisted(() => ({ current: { id: '11111111-1111-4111-8111-111111111111', timezone: 'UTC' } as any }));
vi.mock('@/lib/services/mobile-api-service', () => ({ MobileAPIService: { authenticateWithToken: vi.fn(async () => authUser.current) } }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabase: vi.fn() }));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));

import { GET as ENTITLEMENTS } from '../entitlements/route';
import { GET as TARGETS } from '../targets/route';

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://www.fitcircle.ai${path}`, { headers: { authorization: 'Bearer t', 'x-app-platform': 'android', 'x-client-timezone': 'America/Chicago', ...headers } });

beforeEach(() => {
  record.mockClear();
  backfill.mockClear();
  authUser.current = { id: '11111111-1111-4111-8111-111111111111', timezone: 'UTC' };
});

describe('foreground requests record an app open', () => {
  it('GET /api/mobile/entitlements', async () => {
    expect((await ENTITLEMENTS(req('/api/mobile/entitlements'))).status).toBe(200);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ id: authUser.current.id }), expect.anything(), 'entitlements');
  });
  it('GET /api/mobile/targets', async () => {
    expect((await TARGETS(req('/api/mobile/targets'))).status).toBe(200);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ id: authUser.current.id }), expect.anything(), 'targets');
  });
});

describe('timezone backfill on any authenticated request', () => {
  it('a UTC profile gets the device zone', async () => {
    await TARGETS(req('/api/mobile/targets'));
    expect(backfill).toHaveBeenCalledWith(authUser.current.id, 'America/Chicago');
  });
  it('a real stored zone is left alone; a UTC header is not a backfill', async () => {
    authUser.current = { id: '22222222-2222-4222-8222-222222222222', timezone: 'Europe/Paris' };
    await TARGETS(req('/api/mobile/targets'));
    authUser.current = { id: '33333333-3333-4333-8333-333333333333', timezone: 'UTC' };
    await TARGETS(req('/api/mobile/targets', { 'x-client-timezone': 'UTC' }));
    expect(backfill).not.toHaveBeenCalled();
  });
});
