/** Plan classifier + MRR / ARR math (lib/finance/recurring.ts). */
import { describe, expect, it } from 'vitest';

import type { RevenueEvent } from '../../ads/metrics';
import { billingPeriodDays, cashByDayAndPlan, planOf, recurringAsOf } from '../recurring';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T12:00:00Z');
let n = 0;

function ev(type: string, product: string, opts: { at: number; price?: number; periodMs?: number; periodType?: string; tx?: string; otx?: string; store?: string; env?: string; user?: string; cancelReason?: string }): RevenueEvent {
  n += 1;
  const tx = opts.tx ?? `tx${n}`;
  return {
    id: `e${n}`,
    user_id: opts.user ?? 'u1',
    type,
    store: opts.store ?? 'APP_STORE',
    environment: opts.env ?? 'PRODUCTION',
    event_timestamp: new Date(opts.at).toISOString(),
    raw: {
      product_id: product,
      price: opts.price ?? 0,
      currency: 'USD',
      period_type: opts.periodType ?? 'NORMAL',
      commission_percentage: 0.3,
      tax_percentage: 0,
      purchased_at_ms: opts.at,
      expiration_at_ms: opts.periodMs === undefined ? null : opts.at + opts.periodMs,
      transaction_id: tx,
      original_transaction_id: opts.otx ?? tx,
      environment: opts.env ?? 'PRODUCTION',
      ...(opts.cancelReason ? { cancel_reason: opts.cancelReason } : {}),
    },
  };
}

const byUser = (events: RevenueEvent[]) => {
  const m = new Map<string, RevenueEvent[]>();
  for (const e of events) m.set(e.user_id!, [...(m.get(e.user_id!) ?? []), e]);
  return m;
};

const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

describe('planOf', () => {
  it('classifies monthly, annual upfront, annual installments, lifetime, Stripe and other', () => {
    expect(planOf(ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 9.99, periodMs: MONTH }))).toBe('monthly');
    expect(planOf(ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.monthly:monthly', { at: T0, price: 9.99, periodMs: MONTH, store: 'PLAY_STORE' }))).toBe('monthly');
    expect(planOf(ev('INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.annual', { at: T0, price: 29.99, periodMs: YEAR }))).toBe('annual_upfront');
    expect(planOf(ev('INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.annual:annual', { at: T0, price: 29.99, periodMs: YEAR, store: 'PLAY_STORE' }))).toBe('annual_upfront');
    // App Store annual billing plan paid monthly: same product, one-month billing period.
    expect(planOf(ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.annual', { at: T0, price: 2.99, periodMs: MONTH }))).toBe('annual_installments');
    expect(planOf(ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.annual:annual-installments', { at: T0, price: 2.99, periodMs: YEAR, store: 'PLAY_STORE' }))).toBe('annual_installments');
    expect(planOf(ev('NON_RENEWING_PURCHASE', 'com.inov8rlabs.fitcircle.pro.lifetime', { at: T0, price: 179.99 }))).toBe('lifetime');
    expect(planOf(ev('INITIAL_PURCHASE', 'prod_VMJ9kSPmFHVHNn', { at: T0, price: 29.99, periodMs: YEAR, store: 'STRIPE' }))).toBe('annual_upfront');
    expect(planOf(ev('INITIAL_PURCHASE', 'prod_VMJ7HLtSdA2OB9', { at: T0, price: 9.99, periodMs: MONTH, store: 'STRIPE' }))).toBe('monthly');
    expect(planOf(ev('INITIAL_PURCHASE', 'something_else', { at: T0, price: 5 }))).toBe('other');
  });

  it('maps compressed sandbox periods back (Apple: 1 h = 1 year, 5 min = 1 month)', () => {
    expect(billingPeriodDays(ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.annual', { at: T0, price: 29.99, periodMs: 3_600_000, env: 'SANDBOX' }))).toBe(365);
    expect(planOf(ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.annual', { at: T0, price: 29.99, periodMs: 3_600_000, env: 'SANDBOX' }))).toBe('annual_upfront');
    expect(planOf(ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.annual', { at: T0, price: 2.99, periodMs: 300_000, env: 'SANDBOX' }))).toBe('annual_installments');
  });
});

describe('cash by plan', () => {
  it('splits gross / net / charges by plan and store; a refund takes its charge’s plan', () => {
    const charge = ev('INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.annual', { at: T0, price: 29.99, periodMs: YEAR, tx: 'A' });
    const refund = ev('CANCELLATION', 'com.inov8rlabs.fitcircle.pro.annual', { at: T0 + DAY, price: -29.99, tx: 'A', cancelReason: 'CUSTOMER_SUPPORT' });
    const monthly = ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 9.99, periodMs: MONTH, store: 'PLAY_STORE', user: 'u2' });
    const cash = cashByDayAndPlan([charge, refund, monthly], (iso) => iso.slice(0, 10));
    expect(cash.get('2026-10-01')!.byPlan.get('annual_upfront')).toEqual({ gross: 29.99, net: 20.99, charges: 1 });
    expect(cash.get('2026-10-01')!.byPlan.get('monthly')).toEqual({ gross: 9.99, net: 6.99, charges: 1 });
    expect(cash.get('2026-10-01')!.byStore.get('play_store')).toEqual({ gross: 9.99, net: 6.99, charges: 1 });
    expect(cash.get('2026-10-02')!.byPlan.get('annual_upfront')).toEqual({ gross: -29.99, net: -20.99, charges: 0 });
  });

  it('test users are dropped; trials are not cash', () => {
    const trial = ev('INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 0, periodMs: 3 * DAY, periodType: 'TRIAL' });
    const testCharge = ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 9.99, periodMs: MONTH, user: 'tester' });
    expect(cashByDayAndPlan([trial, testCharge], (iso) => iso.slice(0, 10), (u) => u !== 'tester').size).toBe(0);
  });
});

describe('MRR / ARR', () => {
  it('monthly: price; annual upfront: price ÷ 12; committed = annual price', () => {
    const s = recurringAsOf(
      byUser([
        ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 9.99, periodMs: MONTH, user: 'm' }),
        ev('INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.annual', { at: T0, price: 29.99, periodMs: YEAR, user: 'a' }),
      ]),
      T0 + 5 * DAY
    );
    expect(s.activePaidSubs).toEqual({ monthly: 1, annual_upfront: 1, annual_installments: 0, other: 0, total: 2 });
    expect(s.mrr).toEqual({ gross: 12.49, net: 8.74 }); // 9.99 + 2.4992 ; × 0.7
    expect(s.arr).toEqual({ gross: 149.88, net: 104.88 });
    expect(s.annualCommittedContractValue).toEqual({ gross: 29.99, net: 20.99 });
    expect(s.annualInstallmentsUnbilled).toEqual({ gross: 0, net: 0 });
  });

  it('annual installments mid-term: MRR = installment, committed = 12 × installment, unbilled = remaining installments', () => {
    const events = [0, 1, 2].map((i) => ev(i ? 'RENEWAL' : 'INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.annual', { at: T0 + i * MONTH, price: 2.99, periodMs: MONTH, otx: 'I1' }));
    const s = recurringAsOf(byUser(events), T0 + 2 * MONTH + DAY);
    expect(s.activePaidSubs.annual_installments).toBe(1);
    expect(s.mrr.gross).toBe(2.99);
    expect(s.annualCommittedContractValue.gross).toBe(35.88);
    expect(s.annualInstallmentsUnbilled.gross).toBe(26.91); // 9 of 12 left
  });

  it('a refunded charge is not active; cancelled-but-not-expired is active until expiration', () => {
    const refunded = [
      ev('INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 9.99, periodMs: MONTH, tx: 'R', user: 'r' }),
      ev('CANCELLATION', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0 + DAY, price: -9.99, tx: 'R', user: 'r', cancelReason: 'CUSTOMER_SUPPORT' }),
    ];
    const cancelled = [
      ev('INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 9.99, periodMs: MONTH, tx: 'C', user: 'c' }),
      ev('CANCELLATION', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0 + DAY, price: 0, tx: 'C', user: 'c', cancelReason: 'UNSUBSCRIBE' }),
    ];
    const during = recurringAsOf(byUser([...refunded, ...cancelled]), T0 + 10 * DAY);
    expect(during.activePaidSubs.total).toBe(1);
    expect(during.cancelledPendingExpiry).toBe(1);
    expect(during.mrr.gross).toBe(9.99);
    const after = recurringAsOf(byUser([...refunded, ...cancelled]), T0 + MONTH + DAY);
    expect(after.activePaidSubs.total).toBe(0);
    expect(after.mrr.gross).toBe(0);
  });

  it('lifetime and trials are excluded from MRR (counted separately); test users excluded; future events ignored', () => {
    const s = recurringAsOf(
      byUser([
        ev('NON_RENEWING_PURCHASE', 'com.inov8rlabs.fitcircle.pro.lifetime', { at: T0, price: 179.99, user: 'l' }),
        ev('INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 0, periodMs: 3 * DAY, periodType: 'TRIAL', user: 't' }),
        ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 9.99, periodMs: MONTH, user: 'tester' }),
        ev('INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0 + 5 * DAY, price: 9.99, periodMs: MONTH, user: 'later' }),
      ]),
      T0 + DAY,
      (u) => u !== 'tester'
    );
    expect(s.mrr.gross).toBe(0);
    expect(s.lifetimeOwners).toBe(1);
    expect(s.trialsActive).toBe(1);
    expect(s.activePaidSubs.total).toBe(0);
    // Trial over and converted → paying, trial no longer counted.
    const converted = recurringAsOf(
      byUser([
        ev('INITIAL_PURCHASE', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 0, periodMs: 3 * DAY, periodType: 'TRIAL', otx: 'T', user: 't' }),
        ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0 + 3 * DAY, price: 9.99, periodMs: MONTH, otx: 'T', user: 't' }),
      ]),
      T0 + 4 * DAY
    );
    expect(converted.trialsActive).toBe(0);
    expect(converted.activePaidSubs.monthly).toBe(1);
  });

  it('sandbox events never count', () => {
    const s = recurringAsOf(byUser([ev('RENEWAL', 'com.inov8rlabs.fitcircle.pro.monthly', { at: T0, price: 9.99, periodMs: MONTH, env: 'SANDBOX' })]), T0 + DAY);
    expect(s.activePaidSubs.total).toBe(0);
  });
});
