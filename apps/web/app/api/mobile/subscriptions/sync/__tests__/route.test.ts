import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireMobileAuth = vi.fn();
const syncFromRevenueCat = vi.fn();
const getEntitlements = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: (...a: unknown[]) => requireMobileAuth(...a) }));
vi.mock('@/lib/services/subscription-service', () => ({
  SubscriptionService: { syncFromRevenueCat: (...a: unknown[]) => syncFromRevenueCat(...a) },
}));
vi.mock('@/lib/services/entitlement-service', () => ({
  EntitlementService: { getEntitlements: (...a: unknown[]) => getEntitlements(...a) },
}));

import { POST } from '../route';

const req = () => new Request('http://localhost/api/mobile/subscriptions/sync', { method: 'POST' }) as any;

describe('POST /api/mobile/subscriptions/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireMobileAuth.mockResolvedValue({ id: 'user-1' });
    getEntitlements.mockResolvedValue({ tier: 'premium', features: {}, subscriptionsEnabled: true });
  });

  it('syncs from RevenueCat and returns fresh entitlements', async () => {
    vi.stubEnv('REVENUECAT_SECRET_API_KEY', 'sk_test');
    syncFromRevenueCat.mockResolvedValue(undefined);
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(syncFromRevenueCat).toHaveBeenCalledWith('user-1');
    expect(body.meta.synced).toBe(true);
    expect(body.data.tier).toBe('premium');
    vi.unstubAllEnvs();
  });

  it('reports synced=false but still returns entitlements without a secret key', async () => {
    vi.stubEnv('REVENUECAT_SECRET_API_KEY', '');
    const res = await POST(req());
    const body = await res.json();
    expect(syncFromRevenueCat).not.toHaveBeenCalled();
    expect(body.meta.synced).toBe(false);
    expect(body.data.tier).toBe('premium');
    vi.unstubAllEnvs();
  });

  it('does not fail the request when RevenueCat is unreachable', async () => {
    vi.stubEnv('REVENUECAT_SECRET_API_KEY', 'sk_test');
    syncFromRevenueCat.mockRejectedValue(new Error('RevenueCat subscriber fetch failed: 503'));
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.meta.synced).toBe(false);
    vi.unstubAllEnvs();
  });

  it('returns 401 when unauthenticated', async () => {
    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    const res = await POST(req());
    expect(res.status).toBe(401);
  });
});
