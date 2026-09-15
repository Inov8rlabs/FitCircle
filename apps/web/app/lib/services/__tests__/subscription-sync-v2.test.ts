import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { SubscriptionService } from '../subscription-service';

const ENT = { items: [{ id: 'entl1', lookup_key: 'fitcircle_pro' }, { id: 'entl2', lookup_key: 'other' }] };
function mockFetch(routes: Record<string, { status: number; body?: unknown }>) {
  return vi.fn(async (url: string) => {
    const path = url.replace(/^https:\/\/api\.revenuecat\.com\/v2\/projects\/[^/]+/, '').split('?')[0];
    const r = routes[path] ?? { status: 404 };
    return { ok: r.status < 300, status: r.status, json: async () => r.body ?? {} } as any;
  });
}

describe('SubscriptionService.fetchRevenueCatState (API v2)', () => {
  beforeEach(() => {
    vi.stubEnv('REVENUECAT_SECRET_API_KEY', 'sk_v2');
    vi.stubEnv('REVENUECAT_PROJECT_ID', 'projx');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('unknown customer is free', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/entitlements': { status: 200, body: ENT } }));
    const s = await SubscriptionService.fetchRevenueCatState('u1');
    expect(s.active).toBe(false);
  });

  it('active App Store subscription on the pro entitlement is premium and will renew', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/entitlements': { status: 200, body: ENT },
      '/customers/u1/subscriptions': { status: 200, body: { items: [{
        product_id: 'com.inov8rlabs.fitcircle.pro.annual', store: 'app_store', status: 'active',
        current_period_ends_at: Date.parse('2027-01-01T00:00:00Z'), auto_renewal_status: 'will_renew',
        gives_access: true, entitlements: { items: [{ id: 'entl1' }] } }] } },
      '/customers/u1/purchases': { status: 200, body: { items: [] } },
    }));
    const s = await SubscriptionService.fetchRevenueCatState('u1');
    expect(s).toMatchObject({ active: true, trialing: false, willRenew: true, platform: 'app_store', productId: 'com.inov8rlabs.fitcircle.pro.annual' });
    expect(s.expiresAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('ignores subscriptions on other entitlements and expired ones', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/entitlements': { status: 200, body: ENT },
      '/customers/u1/subscriptions': { status: 200, body: { items: [
        { product_id: 'x', store: 'app_store', status: 'active', gives_access: true, entitlements: { items: [{ id: 'entl2' }] } },
        { product_id: 'y', store: 'app_store', status: 'expired', gives_access: false, entitlements: { items: [{ id: 'entl1' }] } },
      ] } },
      '/customers/u1/purchases': { status: 200, body: { items: [] } },
    }));
    expect((await SubscriptionService.fetchRevenueCatState('u1')).active).toBe(false);
  });

  it('an unrevoked lifetime purchase wins with no expiry', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/entitlements': { status: 200, body: ENT },
      '/customers/u1/subscriptions': { status: 200, body: { items: [] } },
      '/customers/u1/purchases': { status: 200, body: { items: [{ product_id: 'com.inov8rlabs.fitcircle.pro.lifetime', store: 'app_store', revoked_at: null, entitlements: { items: [{ id: 'entl1' }] } }] } },
    }));
    const s = await SubscriptionService.fetchRevenueCatState('u1');
    expect(s).toMatchObject({ active: true, expiresAt: null, willRenew: false, productId: 'com.inov8rlabs.fitcircle.pro.lifetime' });
  });

  it('grace period still grants access; cancelled-but-running does not renew', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/entitlements': { status: 200, body: ENT },
      '/customers/u1/subscriptions': { status: 200, body: { items: [{ product_id: 'p', store: 'play_store', status: 'in_grace_period', current_period_ends_at: Date.now() + 86400000, auto_renewal_status: 'will_not_renew', entitlements: { items: [{ id: 'entl1' }] } }] } },
      '/customers/u1/purchases': { status: 200, body: { items: [] } },
    }));
    const s = await SubscriptionService.fetchRevenueCatState('u1');
    expect(s.active).toBe(true); expect(s.willRenew).toBe(false); expect(s.platform).toBe('play_store');
  });

  it('fails loudly when the project id is missing', async () => {
    vi.stubEnv('REVENUECAT_PROJECT_ID', '');
    await expect(SubscriptionService.fetchRevenueCatState('u1')).rejects.toThrow(/REVENUECAT_PROJECT_ID/);
  });
});
