import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeDb, getDb, setDb } from './fake-supabase-admin';

vi.mock('../../supabase-admin', async () => {
  const { getDb } = await import('./fake-supabase-admin');
  return { createAdminSupabase: () => getDb().client() };
});

import { SubscriptionService, type RevenueCatEvent } from '../subscription-service';

const USER = '11111111-2222-3333-4444-555555555555';
const T0 = Date.UTC(2026, 7, 1, 12, 0, 0); // event_timestamp base

let eventSeq = 0;
function rcEvent(overrides: Partial<RevenueCatEvent>): RevenueCatEvent {
  eventSeq += 1;
  return {
    id: `evt_${eventSeq}`,
    type: 'INITIAL_PURCHASE',
    app_user_id: USER,
    product_id: 'pro_annual_5999',
    period_type: 'NORMAL',
    event_timestamp_ms: T0 + eventSeq * 60_000, // strictly increasing unless overridden
    purchased_at_ms: T0,
    expiration_at_ms: T0 + 365 * 24 * 3600 * 1000,
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    price: 59.99,
    currency: 'USD',
    ...overrides,
  };
}

function profile() {
  return getDb().profiles.get(USER)!;
}

beforeEach(() => {
  const db = new FakeDb();
  db.profiles.set(USER, {
    id: USER,
    subscription_tier: 'free',
    subscription_status: null,
    subscription_expires_at: null,
    subscription_will_renew: false,
    subscription_synced_at: null,
  });
  setDb(db);
  eventSeq = 0;
});

describe('SubscriptionService.processRevenueCatEvent — event mapping', () => {
  it('INITIAL_PURCHASE with trial → premium/trialing, will_renew, $0 payment row', async () => {
    const outcome = await SubscriptionService.processRevenueCatEvent(
      rcEvent({ period_type: 'TRIAL', price: 0 })
    );
    expect(outcome).toBe('applied');
    expect(profile().subscription_tier).toBe('premium');
    expect(profile().subscription_status).toBe('trialing');
    expect(profile().subscription_will_renew).toBe(true);
    expect(profile().subscription_platform).toBe('app_store');
    expect(getDb().payments).toHaveLength(1);
    expect(getDb().payments[0].amount).toBe(0);
    expect(getDb().payments[0].type).toBe('subscription');
  });

  it('INITIAL_PURCHASE at a launch-discount price records the discounted amount', async () => {
    await SubscriptionService.processRevenueCatEvent(rcEvent({ price: 39.99 }));
    expect(getDb().payments[0].amount).toBe(39.99);
    expect(profile().subscription_status).toBe('active');
  });

  it('RENEWAL after intro period records full price and stays active', async () => {
    await SubscriptionService.processRevenueCatEvent(rcEvent({ price: 39.99 }));
    await SubscriptionService.processRevenueCatEvent(rcEvent({ type: 'RENEWAL', price: 59.99 }));
    expect(profile().subscription_status).toBe('active');
    expect(profile().subscription_will_renew).toBe(true);
    expect(getDb().payments).toHaveLength(2);
    expect(getDb().payments[1].amount).toBe(59.99);
  });

  it('CANCELLATION(UNSUBSCRIBE) keeps premium access, only flips will_renew', async () => {
    await SubscriptionService.processRevenueCatEvent(rcEvent({}));
    await SubscriptionService.processRevenueCatEvent(
      rcEvent({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' })
    );
    expect(profile().subscription_tier).toBe('premium');
    expect(profile().subscription_will_renew).toBe(false);
    expect(getDb().payments).toHaveLength(1); // no refund row
  });

  it('CANCELLATION(CUSTOMER_SUPPORT) downgrades immediately with a refund row', async () => {
    await SubscriptionService.processRevenueCatEvent(rcEvent({}));
    await SubscriptionService.processRevenueCatEvent(
      rcEvent({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' })
    );
    expect(profile().subscription_tier).toBe('free');
    expect(profile().subscription_status).toBe('cancelled');
    expect(getDb().payments).toHaveLength(2);
    expect(getDb().payments[1].type).toBe('refund');
    expect(getDb().payments[1].status).toBe('refunded');
  });

  it('UNCANCELLATION restores will_renew', async () => {
    await SubscriptionService.processRevenueCatEvent(rcEvent({}));
    await SubscriptionService.processRevenueCatEvent(
      rcEvent({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' })
    );
    await SubscriptionService.processRevenueCatEvent(rcEvent({ type: 'UNCANCELLATION' }));
    expect(profile().subscription_will_renew).toBe(true);
    expect(profile().subscription_tier).toBe('premium');
  });

  it('EXPIRATION downgrades to free/cancelled', async () => {
    await SubscriptionService.processRevenueCatEvent(rcEvent({}));
    await SubscriptionService.processRevenueCatEvent(rcEvent({ type: 'EXPIRATION' }));
    expect(profile().subscription_tier).toBe('free');
    expect(profile().subscription_status).toBe('cancelled');
    expect(profile().subscription_will_renew).toBe(false);
  });

  it('BILLING_ISSUE → past_due with the grace-period expiry, access retained', async () => {
    await SubscriptionService.processRevenueCatEvent(rcEvent({}));
    const grace = T0 + 16 * 24 * 3600 * 1000;
    await SubscriptionService.processRevenueCatEvent(
      rcEvent({ type: 'BILLING_ISSUE', grace_period_expiration_at_ms: grace })
    );
    expect(profile().subscription_tier).toBe('premium'); // unchanged
    expect(profile().subscription_status).toBe('past_due');
    expect(profile().subscription_expires_at).toBe(new Date(grace).toISOString());
  });

  it('NON_RENEWING_PURCHASE (lifetime) → premium forever, expires_at NULL', async () => {
    await SubscriptionService.processRevenueCatEvent(
      rcEvent({ type: 'NON_RENEWING_PURCHASE', product_id: 'pro_lifetime_149', price: 149.99, expiration_at_ms: null })
    );
    expect(profile().subscription_tier).toBe('premium');
    expect(profile().subscription_expires_at).toBeNull();
    expect(profile().subscription_will_renew).toBe(false);
    expect(getDb().payments[0].amount).toBe(149.99);
  });

  it('PRODUCT_CHANGE records the pending product without a payment row', async () => {
    await SubscriptionService.processRevenueCatEvent(rcEvent({}));
    await SubscriptionService.processRevenueCatEvent(
      rcEvent({ type: 'PRODUCT_CHANGE', new_product_id: 'pro_monthly_999' })
    );
    expect(profile().subscription_product_id).toBe('pro_monthly_999');
    expect(getDb().payments).toHaveLength(1);
  });

  it('TRANSFER downgrades the losing account', async () => {
    getDb().profiles.get(USER)!.subscription_tier = 'premium';
    const outcome = await SubscriptionService.processRevenueCatEvent(
      rcEvent({ type: 'TRANSFER', app_user_id: '$RCAnonymousID:abc', transferred_from: [USER], transferred_to: [] })
    );
    expect(outcome).toBe('applied');
    expect(profile().subscription_tier).toBe('free');
    expect(profile().subscription_status).toBe('cancelled');
  });
});

describe('SubscriptionService.processRevenueCatEvent — safety guarantees', () => {
  it('is idempotent: the same event id applied twice is a no-op with one payment row', async () => {
    const event = rcEvent({});
    expect(await SubscriptionService.processRevenueCatEvent(event)).toBe('applied');
    expect(await SubscriptionService.processRevenueCatEvent(event)).toBe('already_processed');
    expect(getDb().payments).toHaveLength(1);
  });

  it('skips stale out-of-order events (RENEWAL@t2 then CANCELLATION@t1)', async () => {
    await SubscriptionService.processRevenueCatEvent(
      rcEvent({ type: 'RENEWAL', event_timestamp_ms: T0 + 2_000_000 })
    );
    const outcome = await SubscriptionService.processRevenueCatEvent(
      rcEvent({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', event_timestamp_ms: T0 + 1_000_000 })
    );
    expect(outcome).toBe('stale_event');
    expect(profile().subscription_will_renew).toBe(true); // cancellation NOT applied
  });

  it('records but skips events for unknown / anonymous app_user_ids', async () => {
    const outcome = await SubscriptionService.processRevenueCatEvent(
      rcEvent({ app_user_id: '$RCAnonymousID:xyz' })
    );
    expect(outcome).toBe('unknown_user');
    expect(profile().subscription_tier).toBe('free');
    expect(getDb().subscription_events.size).toBe(1); // audit row still written
  });

  it('records but skips events for UUIDs with no profile', async () => {
    const outcome = await SubscriptionService.processRevenueCatEvent(
      rcEvent({ app_user_id: '99999999-9999-9999-9999-999999999999' })
    );
    expect(outcome).toBe('unknown_user');
  });

  it('with apply:false (sandbox-in-prod) records the event but changes nothing', async () => {
    const outcome = await SubscriptionService.processRevenueCatEvent(
      rcEvent({ environment: 'SANDBOX' }),
      { apply: false }
    );
    expect(outcome).toBe('ignored');
    expect(profile().subscription_tier).toBe('free');
    expect(getDb().subscription_events.size).toBe(1);
  });

  it('ignores TEST events', async () => {
    expect(await SubscriptionService.processRevenueCatEvent(rcEvent({ type: 'TEST' }))).toBe('ignored');
    expect(profile().subscription_tier).toBe('free');
  });

  it('ignores unrecognized event types without touching the profile', async () => {
    expect(
      await SubscriptionService.processRevenueCatEvent(rcEvent({ type: 'SOME_FUTURE_EVENT' }))
    ).toBe('ignored');
    expect(profile().subscription_tier).toBe('free');
  });
});
