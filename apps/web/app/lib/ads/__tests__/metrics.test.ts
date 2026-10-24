import { describe, expect, it } from 'vitest';

import {
  computeMetrics,
  cumulativeRoas,
  emptyDelivery,
  fallbackTakehome,
  incompleteFlags,
  netRevenue,
  ratio,
  sumDelivery,
  userOutcome,
  type CohortUser,
  type RevenueEvent,
} from '../metrics';

const ev = (over: Partial<RevenueEvent> & { raw?: Record<string, any> }): RevenueEvent => ({
  user_id: 'u1',
  type: 'INITIAL_PURCHASE',
  store: 'APP_STORE',
  environment: 'PRODUCTION',
  event_timestamp: '2026-10-25T12:00:00Z',
  ...over,
  raw: { price: 9.99, period_type: 'NORMAL', ...(over.raw ?? {}) },
});

const user = (over: Partial<CohortUser> = {}): CohortUser => ({
  userId: 'u1',
  signupAt: '2026-10-24T12:00:00Z',
  signupDate: '2026-10-24',
  attribution: null,
  firstActivityAt: null,
  events: [],
  ...over,
});

describe('netRevenue', () => {
  it('uses takehome_percentage when present', () => {
    expect(netRevenue(ev({ raw: { price: 29.99, takehome_percentage: 0.7 } }))).toBeCloseTo(20.99, 2);
  });
  it('falls back to 0.85 for App Store / Play and 0.97 for Stripe', () => {
    expect(fallbackTakehome('APP_STORE')).toBe(0.85);
    expect(fallbackTakehome('PLAY_STORE')).toBe(0.85);
    expect(fallbackTakehome('STRIPE')).toBe(0.97);
    expect(netRevenue(ev({ raw: { price: 10 } }))).toBe(8.5);
    expect(netRevenue(ev({ store: 'STRIPE', raw: { price: 10 } }))).toBe(9.7);
  });
  it('ignores SANDBOX events and non-revenue types', () => {
    expect(netRevenue(ev({ environment: 'SANDBOX' }))).toBe(0);
    expect(netRevenue(ev({ type: 'EXPIRATION' }))).toBe(0);
    expect(netRevenue(ev({ type: 'PRODUCT_CHANGE', raw: { price: 29.99 } }))).toBe(0);
  });
  it('trial starts are worth 0; renewals count', () => {
    expect(netRevenue(ev({ raw: { price: 0, period_type: 'TRIAL' } }))).toBe(0);
    expect(netRevenue(ev({ type: 'RENEWAL', raw: { price: 9.99, takehome_percentage: 0.85 } }))).toBeCloseTo(8.49, 2);
  });
  it('refunds subtract (CANCELLATION + CUSTOMER_SUPPORT; RevenueCat sends a negative price)', () => {
    expect(netRevenue(ev({ type: 'CANCELLATION', raw: { price: -9.99, cancel_reason: 'CUSTOMER_SUPPORT' } }))).toBeCloseTo(-8.49, 2);
    expect(netRevenue(ev({ type: 'CANCELLATION', raw: { price: 9.99, cancel_reason: 'CUSTOMER_SUPPORT', takehome_percentage: 1 } }))).toBe(-9.99);
    // A plain unsubscribe is not a refund.
    expect(netRevenue(ev({ type: 'CANCELLATION', raw: { price: 9.99, cancel_reason: 'UNSUBSCRIBE' } }))).toBe(0);
  });
  it('Stripe charge.refunded subtracts', () => {
    expect(netRevenue(ev({ type: 'REFUND', store: 'STRIPE', raw: { type: 'charge.refunded', price: null, amount_refunded: 999 } }))).toBeCloseTo(-9.69, 2);
  });
});

describe('userOutcome', () => {
  it('activation is a food log / check-in within 7 days of sign-up', () => {
    expect(userOutcome(user({ firstActivityAt: '2026-10-24T13:00:00Z' })).activated).toBe(true);
    expect(userOutcome(user({ firstActivityAt: '2026-10-31T11:59:00Z' })).activated).toBe(true);
    expect(userOutcome(user({ firstActivityAt: '2026-11-01T12:00:01Z' })).activated).toBe(false);
    expect(userOutcome(user()).activated).toBe(false);
  });
  it('splits revenue into D7 / D30 / to date and nets refunds', () => {
    const o = userOutcome(
      user({
        events: [
          ev({ event_timestamp: '2026-10-26T00:00:00Z', raw: { price: 10, takehome_percentage: 1 } }), // D2
          ev({ type: 'RENEWAL', event_timestamp: '2026-11-10T00:00:00Z', raw: { price: 10, takehome_percentage: 1 } }), // D17
          ev({ type: 'RENEWAL', event_timestamp: '2026-12-10T00:00:00Z', raw: { price: 10, takehome_percentage: 1 } }), // D47
          ev({ type: 'CANCELLATION', event_timestamp: '2026-12-11T00:00:00Z', raw: { price: -10, cancel_reason: 'CUSTOMER_SUPPORT', takehome_percentage: 1 } }),
        ],
      })
    );
    expect(o).toMatchObject({ payer: true, revenueD7: 10, revenueD30: 20, revenueToDate: 20 });
  });
  it('a trial alone is not a payer; trial conversion (RENEWAL with price) is', () => {
    const trial = ev({ raw: { price: 0, period_type: 'TRIAL' } });
    expect(userOutcome(user({ events: [trial] }))).toMatchObject({ trial: true, payer: false, revenueToDate: 0 });
    expect(userOutcome(user({ events: [trial, ev({ type: 'RENEWAL', raw: { price: 29.99, takehome_percentage: 0.85 } })] })).payer).toBe(true);
  });
  it('sandbox purchases never make a payer', () => {
    expect(userOutcome(user({ events: [ev({ environment: 'SANDBOX' })] })).payer).toBe(false);
  });
});

describe('computeMetrics', () => {
  const today = '2026-10-24';
  it('every ratio is null when its denominator is 0', () => {
    const m = computeMetrics(emptyDelivery(), [], { rangeEnd: today, today });
    for (const k of ['cpt', 'ttr', 'cpi', 'costPerUser', 'costPerActivated', 'costPerPayer', 'roasD7', 'roasD30', 'roasToDate', 'installToUser', 'userToActivated', 'userToPayer'] as const) {
      expect(m[k]).toBeNull();
    }
    expect(m.spend).toBe(0);
  });
  it('spend with no users: cost ratios null, CPI defined', () => {
    const d = sumDelivery([{ spend: 20, currency: 'USD', impressions: 1000, taps: 10, installs: 4 }]);
    const m = computeMetrics(d, [], { rangeEnd: today, today });
    expect(m.cpi).toBe(5);
    expect(m.cpt).toBe(2);
    expect(m.ttr).toBeCloseTo(0.01);
    expect(m.costPerUser).toBeNull();
    expect(m.roasD7).toBe(0);
  });
  it('computes unit economics', () => {
    const d = sumDelivery([
      { spend: '30.00', currency: 'USD', impressions: 1000, taps: 20, installs: 6 },
      { spend: 10, currency: 'USD', impressions: 500, taps: 5, installs: 2 },
    ]);
    const outs = [
      { activated: true, trial: false, payer: true, revenueD7: 8, revenueD30: 16, revenueToDate: 24 },
      { activated: true, trial: true, payer: false, revenueD7: 0, revenueD30: 0, revenueToDate: 0 },
      { activated: false, trial: false, payer: false, revenueD7: 0, revenueD30: 0, revenueToDate: 0 },
      { activated: false, trial: false, payer: false, revenueD7: 0, revenueD30: 0, revenueToDate: 0 },
    ];
    const m = computeMetrics(d, outs, { rangeEnd: '2026-09-01', today });
    expect(m).toMatchObject({ spend: 40, installs: 8, users: 4, activated: 2, payers: 1, trials: 1, cpi: 5, costPerUser: 10, costPerActivated: 20, costPerPayer: 40 });
    expect(m.roasD7).toBeCloseTo(0.2);
    expect(m.roasD30).toBeCloseTo(0.4);
    expect(m.roasToDate).toBeCloseTo(0.6);
    expect(m.installToUser).toBe(0.5);
    expect(m.userToActivated).toBe(0.5);
    expect(m.userToPayer).toBe(0.25);
    expect(m.incomplete).toEqual({ activated: false, d7: false, d30: false });
  });
  it('flags non-USD spend', () => {
    expect(sumDelivery([{ spend: 1, currency: 'EUR', impressions: 0, taps: 0, installs: 0 }]).mixedCurrency).toBe(true);
    expect(sumDelivery([{ spend: 0, currency: 'EUR', impressions: 0, taps: 0, installs: 0 }]).mixedCurrency).toBe(false);
  });
});

describe('incomplete cohorts', () => {
  it('D7 / activation windows close 8 days after the last cohort day, D30 after 31', () => {
    expect(incompleteFlags('2026-10-24', '2026-10-24')).toEqual({ activated: true, d7: true, d30: true });
    expect(incompleteFlags('2026-10-16', '2026-10-24')).toEqual({ activated: false, d7: false, d30: true });
    expect(incompleteFlags('2026-10-17', '2026-10-24').d7).toBe(true);
    expect(incompleteFlags('2026-09-23', '2026-10-24').d30).toBe(false);
    expect(incompleteFlags('2026-09-24', '2026-10-24').d30).toBe(true);
  });
});

describe('helpers', () => {
  it('ratio', () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
  });
  it('cumulativeRoas', () => {
    expect(cumulativeRoas([{ spend: 0, revenue: 0 }, { spend: 10, revenue: 1 }, { spend: 10, revenue: 3 }])).toEqual([null, 0.1, 0.2]);
  });
});
