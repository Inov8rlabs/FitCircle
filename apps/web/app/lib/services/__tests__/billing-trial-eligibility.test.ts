/** Web checkout gives a free trial only to people who never trialed or subscribed on any store. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { BillingService, setStripeClientForTest } from '../billing-service';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
let db: FakeSupabase;
let stripeSubs: Record<string, unknown[]>;
let stripe: any;

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  vi.stubEnv('STRIPE_TRIAL_DAYS', '3');
  vi.stubEnv('STRIPE_PRICE_PRO_MONTHLY', 'price_m');
  vi.stubEnv('STRIPE_PRICE_PRO_ANNUAL', 'price_a');
  vi.stubEnv('STRIPE_PRICE_PRO_LIFETIME', 'price_l');
  db = new FakeSupabase({
    profiles: { uniqueKey: ['id'], rows: [{ id: USER, email: 'a@b.co', stripe_customer_id: null, trial_started_at: null }] },
    subscription_events: { uniqueKey: ['id'] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  stripeSubs = {};
  stripe = {
    customers: { create: vi.fn(async () => ({ id: 'cus_new' })) },
    subscriptions: { list: vi.fn(async ({ customer }: { customer: string }) => ({ data: stripeSubs[customer] ?? [] })) },
    checkout: { sessions: { create: vi.fn(async () => ({ url: 'https://checkout.stripe.test/s' })) } },
  };
  setStripeClientForTest(stripe);
});
afterEach(() => {
  setStripeClientForTest(null);
  vi.unstubAllEnvs();
});

const checkout = (plan: 'monthly' | 'annual' | 'lifetime' = 'annual') =>
  BillingService.createCheckoutSession({ userId: USER, email: 'a@b.co', plan, origin: 'https://fitcircle.ai' });
const trialDaysSent = () => stripe.checkout.sessions.create.mock.calls.at(-1)[0].subscription_data?.trial_period_days;
const profile = () => db.getRows('profiles')[0];

describe('web checkout trial eligibility', () => {
  it('a brand-new customer gets STRIPE_TRIAL_DAYS on monthly and annual; no Stripe history lookup for a fresh customer', async () => {
    await checkout('annual');
    expect(trialDaysSent()).toBe(3);
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    await checkout('monthly');
    expect(trialDaysSent()).toBe(3);
  });

  it('lifetime never has a trial', async () => {
    await checkout('lifetime');
    expect(stripe.checkout.sessions.create.mock.calls.at(-1)[0].subscription_data).toBeUndefined();
  });

  it('no trial when profiles.trial_started_at is set (trial on any store)', async () => {
    profile().trial_started_at = '2026-10-01T00:00:00Z';
    await checkout();
    expect(trialDaysSent()).toBeUndefined();
  });

  it('no trial when there is any real subscription_events row (past purchase or trial)', async () => {
    db.seed('subscription_events', [{ id: 'e1', user_id: USER, type: 'EXPIRATION', environment: 'PRODUCTION' }]);
    await checkout();
    expect(trialDaysSent()).toBeUndefined();
  });

  it("RevenueCat TEST and SANDBOX events don't count", async () => {
    db.seed('subscription_events', [
      { id: 't', user_id: USER, type: 'TEST', environment: 'PRODUCTION' },
      { id: 's', user_id: USER, type: 'INITIAL_PURCHASE', environment: 'SANDBOX' },
    ]);
    await checkout();
    expect(trialDaysSent()).toBe(3);
  });

  it('no trial when the existing Stripe customer has any past subscription (any status)', async () => {
    profile().stripe_customer_id = 'cus_old';
    stripeSubs.cus_old = [{ id: 'sub_1', status: 'canceled' }];
    await checkout();
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({ customer: 'cus_old', status: 'all', limit: 1 });
    expect(trialDaysSent()).toBeUndefined();
  });

  it('an existing customer with no subscriptions is still eligible', async () => {
    profile().stripe_customer_id = 'cus_empty';
    await checkout();
    expect(trialDaysSent()).toBe(3);
  });

  it('fails closed: a Stripe or database error means no trial (checkout still works)', async () => {
    profile().stripe_customer_id = 'cus_old';
    stripe.subscriptions.list.mockRejectedValueOnce(new Error('stripe down'));
    const res = await checkout();
    expect(res.url).toContain('checkout.stripe.test');
    expect(trialDaysSent()).toBeUndefined();
    expect(await BillingService.isWebTrialEligible(USER, null)).toBe(true);
    vi.mocked(createAdminSupabase).mockReturnValueOnce({ from: () => { throw new Error('db down'); } } as any);
    expect(await BillingService.isWebTrialEligible(USER, null)).toBe(false);
  });

  it('before migration 112 (no trial_started_at column) the other checks still decide', async () => {
    const real = db.from.bind(db);
    vi.mocked(createAdminSupabase).mockReturnValue({
      from: (t: string) => {
        const q: any = real(t);
        if (t !== 'profiles') return q;
        const select = q.select.bind(q);
        q.select = (cols: string) => {
          if (!cols.includes('trial_started_at')) return select(cols);
          const err = { data: null, error: { code: '42703', message: 'column does not exist' } };
          const f: any = { eq: () => f, maybeSingle: async () => err };
          return f;
        };
        return q;
      },
    } as any);
    expect(await BillingService.isWebTrialEligible(USER, null)).toBe(true);
    db.seed('subscription_events', [{ id: 'e1', user_id: USER, type: 'INITIAL_PURCHASE', environment: 'PRODUCTION' }]);
    expect(await BillingService.isWebTrialEligible(USER, null)).toBe(false);
  });

  it('STRIPE_TRIAL_DAYS unset → no trial and no eligibility work', async () => {
    vi.stubEnv('STRIPE_TRIAL_DAYS', '');
    const spy = vi.spyOn(BillingService, 'isWebTrialEligible');
    await checkout();
    expect(trialDaysSent()).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
