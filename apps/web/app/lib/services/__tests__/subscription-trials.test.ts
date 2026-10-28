/** Trial bookkeeping (ONBOARDING_V2_EXPERIMENT_SPEC §3.2): SubscriptionService.mapEvent + trialPatchFor. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeDb, getDb, setDb } from './fake-supabase-admin';

vi.mock('../../supabase-admin', async () => {
  const { getDb } = await import('./fake-supabase-admin');
  return { createAdminSupabase: () => getDb().client() };
});

import { SubscriptionService, trialPatchFor, type RevenueCatEvent } from '../subscription-service';

const USER = '11111111-2222-3333-4444-555555555555';
const T0 = Date.UTC(2026, 10, 1, 14, 0, 0);
const DAY = 86_400_000;
let seq = 0;
const ev = (o: Partial<RevenueCatEvent>): RevenueCatEvent => {
  seq++;
  return {
    id: `evt_${seq}`,
    type: 'INITIAL_PURCHASE',
    app_user_id: USER,
    product_id: 'com.inov8rlabs.fitcircle.pro.annual',
    period_type: 'NORMAL',
    event_timestamp_ms: T0 + seq * 1000,
    purchased_at_ms: T0,
    expiration_at_ms: T0 + 3 * DAY,
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    price: 29.99,
    currency: 'USD',
    ...o,
  };
};
const profile = () => getDb().profiles.get(USER)!;

beforeEach(() => {
  const db = new FakeDb();
  db.profiles.set(USER, { id: USER, subscription_tier: 'free', subscription_status: null, subscription_synced_at: null, trial_started_at: null, trial_ends_at: null, trial_converted_at: null, trial_reminder_sent_at: null });
  setDb(db);
  seq = 0;
});

describe('trialPatchFor (pure)', () => {
  it('INITIAL_PURCHASE TRIAL → started/ends set, converted + reminder cleared', () => {
    expect(trialPatchFor(ev({ period_type: 'TRIAL', price: 0 }), null)).toEqual({
      trial_started_at: new Date(T0).toISOString(),
      trial_ends_at: new Date(T0 + 3 * DAY).toISOString(),
      trial_converted_at: null,
      trial_reminder_sent_at: null,
    });
  });

  it('INTRO and NORMAL purchases are not trials', () => {
    expect(trialPatchFor(ev({ period_type: 'INTRO', price: 14.99 }), null)).toBeNull();
    expect(trialPatchFor(ev({}), null)).toBeNull();
  });

  it('first RENEWAL after a trial → converted; later renewals no-op', () => {
    const started = { trial_started_at: new Date(T0).toISOString(), trial_ends_at: new Date(T0 + 3 * DAY).toISOString(), trial_converted_at: null };
    const renewal = ev({ type: 'RENEWAL', event_timestamp_ms: T0 + 3 * DAY + 60_000 });
    expect(trialPatchFor(renewal, started)).toEqual({ trial_converted_at: new Date(T0 + 3 * DAY + 60_000).toISOString() });
    expect(trialPatchFor(renewal, { ...started, trial_converted_at: '2026-11-04T00:00:00Z' })).toBeNull();
  });

  it('a RENEWAL long after an unconverted trial is not its conversion; is_trial_conversion always is', () => {
    const lapsed = { trial_started_at: new Date(T0).toISOString(), trial_ends_at: new Date(T0 + 3 * DAY).toISOString(), trial_converted_at: null };
    expect(trialPatchFor(ev({ type: 'RENEWAL', event_timestamp_ms: T0 + 90 * DAY }), lapsed)).toBeNull();
    expect(trialPatchFor(ev({ type: 'RENEWAL', is_trial_conversion: true }), null)).toMatchObject({ trial_converted_at: expect.any(String) });
    expect(trialPatchFor(ev({ type: 'RENEWAL' }), null)).toBeNull();
  });
});

describe('processRevenueCatEvent writes the trial columns', () => {
  it('trial start → trialing + trial dates; conversion → active + trial_converted_at', async () => {
    await SubscriptionService.processRevenueCatEvent(ev({ period_type: 'TRIAL', price: 0 }));
    expect(profile()).toMatchObject({
      subscription_status: 'trialing',
      trial_started_at: new Date(T0).toISOString(),
      trial_ends_at: new Date(T0 + 3 * DAY).toISOString(),
      trial_converted_at: null,
    });
    await SubscriptionService.processRevenueCatEvent(ev({ type: 'RENEWAL', event_timestamp_ms: T0 + 3 * DAY + 5000, expiration_at_ms: T0 + 368 * DAY }));
    expect(profile().subscription_status).toBe('active');
    expect(profile().trial_converted_at).toBe(new Date(T0 + 3 * DAY + 5000).toISOString());
    // A second renewal a year later doesn't move it.
    await SubscriptionService.processRevenueCatEvent(ev({ type: 'RENEWAL', event_timestamp_ms: T0 + 368 * DAY }));
    expect(profile().trial_converted_at).toBe(new Date(T0 + 3 * DAY + 5000).toISOString());
  });

  it('INTRO purchase: active (not trialing), paid amount recorded, no trial dates', async () => {
    await SubscriptionService.processRevenueCatEvent(ev({ period_type: 'INTRO', price: 14.99 }));
    expect(profile()).toMatchObject({ subscription_status: 'active', subscription_tier: 'premium', trial_started_at: null });
    expect(getDb().payments[0]).toMatchObject({ amount: 14.99, description: 'Pro subscription started (intro offer)' });
  });

  it('a new trial clears an old reminder stamp', async () => {
    profile().trial_reminder_sent_at = '2026-01-01T00:00:00Z';
    await SubscriptionService.processRevenueCatEvent(ev({ period_type: 'TRIAL', price: 0 }));
    expect(profile().trial_reminder_sent_at).toBeNull();
  });
});
