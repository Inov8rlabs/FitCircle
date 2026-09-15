import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeDb, getDb, setDb } from './fake-supabase-admin';

vi.mock('../../supabase-admin', async () => {
  const { getDb } = await import('./fake-supabase-admin');
  return { createAdminSupabase: () => getDb().client() };
});

import { ComplimentaryGrantService, GrantError } from '../complimentary-grant-service';
import { SubscriptionService, type RevenueCatEvent } from '../subscription-service';

const USER = '11111111-2222-3333-4444-555555555555';
const T0 = Date.UTC(2026, 8, 15, 12, 0, 0);

function freeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: USER,
    email: 'friend@example.com',
    subscription_tier: 'free',
    subscription_status: null,
    subscription_platform: null,
    subscription_product_id: null,
    subscription_expires_at: null,
    subscription_will_renew: false,
    subscription_synced_at: null,
    ...overrides,
  };
}
const profile = () => getDb().profiles.get(USER)!;

beforeEach(() => {
  const db = new FakeDb();
  db.profiles.set(USER, freeProfile());
  setDb(db);
});
afterEach(() => vi.unstubAllGlobals());

describe('ComplimentaryGrantService', () => {
  it('grant by email pins the profile to premium/promotional', async () => {
    const { userId } = await ComplimentaryGrantService.grant({ email: 'Friend@Example.com', grantedBy: 'ani', note: 'beta' });
    expect(userId).toBe(USER);
    expect(profile()).toMatchObject({ subscription_tier: 'premium', subscription_platform: 'promotional', subscription_product_id: 'complimentary', subscription_expires_at: null });
  });

  it('a second active grant is rejected; unknown users 404', async () => {
    await ComplimentaryGrantService.grant({ userId: USER, grantedBy: 'ani' });
    await expect(ComplimentaryGrantService.grant({ userId: USER, grantedBy: 'ani' })).rejects.toMatchObject({ code: 'ALREADY_ACTIVE' });
    await expect(ComplimentaryGrantService.grant({ email: 'nobody@example.com', grantedBy: 'ani' })).rejects.toBeInstanceOf(GrantError);
  });

  it('revoke drops a granted user back to free', async () => {
    await ComplimentaryGrantService.grant({ userId: USER, grantedBy: 'ani' });
    await ComplimentaryGrantService.revoke({ userId: USER, revokedBy: 'ani' });
    expect(profile().subscription_tier).toBe('free');
    expect(await ComplimentaryGrantService.activeGrant(USER)).toBeNull();
  });

  it('does not touch a live App Store subscription; revoke leaves it alone too', async () => {
    getDb().profiles.set(USER, freeProfile({ subscription_tier: 'premium', subscription_platform: 'app_store', subscription_product_id: 'pro.annual', subscription_expires_at: new Date(T0 + 30 * 86_400_000).toISOString() }));
    await ComplimentaryGrantService.grant({ userId: USER, grantedBy: 'ani' });
    expect(profile().subscription_platform).toBe('app_store');
    await ComplimentaryGrantService.revoke({ userId: USER, revokedBy: 'ani' });
    expect(profile().subscription_tier).toBe('premium');
  });

  it('an expired grant no longer holds', async () => {
    getDb().complimentary_grants.push({ id: 'g', user_id: USER, granted_by: 'ani', note: null, expires_at: new Date(Date.now() - 1000).toISOString(), revoked_at: null, created_at: new Date().toISOString() });
    expect(await ComplimentaryGrantService.holdIfGranted(USER)).toBe(false);
  });
});

describe('grants outrank store downgrades', () => {
  beforeEach(async () => {
    await ComplimentaryGrantService.grant({ userId: USER, grantedBy: 'ani' });
  });

  it('an EXPIRATION webhook keeps a granted user premium', async () => {
    const event: RevenueCatEvent = {
      id: 'evt_exp', type: 'EXPIRATION', app_user_id: USER, product_id: 'pro.monthly', period_type: 'NORMAL',
      event_timestamp_ms: Date.now() + 60_000, purchased_at_ms: T0, expiration_at_ms: Date.now(), store: 'APP_STORE', environment: 'PRODUCTION', price: 0, currency: 'USD',
    } as RevenueCatEvent;
    expect(await SubscriptionService.processRevenueCatEvent(event)).toBe('applied');
    expect(profile()).toMatchObject({ subscription_tier: 'premium', subscription_platform: 'promotional' });
  });

  it('the reconcile sync with no RevenueCat subscription keeps a granted user premium', async () => {
    vi.stubEnv('REVENUECAT_SECRET_API_KEY', 'sk');
    vi.stubEnv('REVENUECAT_PROJECT_ID', 'proj');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/entitlements')) return { ok: true, status: 200, json: async () => ({ items: [{ id: 'e1', lookup_key: 'fitcircle_pro' }] }) } as any;
      return { ok: false, status: 404, json: async () => ({}) } as any; // unknown customer
    }));
    await SubscriptionService.syncFromRevenueCat(USER);
    expect(profile().subscription_tier).toBe('premium');
    vi.unstubAllEnvs();
  });
});
