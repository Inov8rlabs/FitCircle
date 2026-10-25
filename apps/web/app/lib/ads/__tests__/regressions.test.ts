/**
 * Regression tests for the 2026-10-24 ads-console metrics audit. One block per
 * bug; each asserts the corrected rule (docs/ADS_METRICS_METHODOLOGY.md) and
 * would fail on the previous implementation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('./fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { mapAppleTotals, totalsReportBody } from '../connectors/apple-ads';
import { classifyEvent, netRevenue, takehomeRate, userOutcome, type CohortUser, type RevenueEvent } from '../metrics';
import { buildRows, buildTotals, type SliceInput } from '../report';
import { selectAll } from '../services/db';
import { AdsReportService } from '../services/report-service';
import type { AdMetricRow, AttributionRow } from '../types';

import { AdsFakeDb, setAdsDb } from './fake-db';

const ev = (over: Partial<RevenueEvent> & { raw?: Record<string, any> } = {}): RevenueEvent => ({
  id: over.id ?? `e-${Math.random()}`,
  user_id: 'u1',
  type: 'INITIAL_PURCHASE',
  store: 'APP_STORE',
  environment: 'PRODUCTION',
  event_timestamp: '2026-10-02T12:00:00Z',
  ...over,
  raw: { price: 10, period_type: 'NORMAL', ...(over.raw ?? {}) },
});

const user = (events: RevenueEvent[], over: Partial<CohortUser> = {}): CohortUser => ({
  userId: 'u1',
  signupAt: '2026-10-01T12:00:00Z',
  signupDate: '2026-10-01',
  attribution: null,
  firstActivityAt: null,
  events,
  ...over,
});

describe('BUG 1 (high): tax was ignored — takehome must come from tax_percentage + commission_percentage', () => {
  it("uses RevenueCat's proceeds formula price × (1 − tax − commission) (docs example: $10, 20%, 15% → $6.50)", () => {
    // Old code: no takehome_percentage → 0.85 fallback → $8.50 (overstated by 31%).
    expect(netRevenue(ev({ raw: { price: 10, tax_percentage: 0.2, commission_percentage: 0.15 } }))).toBe(6.5);
  });
  it('tax/commission win over the deprecated takehome_percentage; takehome is the next fallback; store default last', () => {
    expect(takehomeRate({ tax_percentage: 0.1, commission_percentage: 0.15, takehome_percentage: 0.85 }, 'APP_STORE')).toEqual({ rate: 0.75, source: 'tax_commission' });
    expect(takehomeRate({ takehome_percentage: 0.7 }, 'APP_STORE')).toEqual({ rate: 0.7, source: 'takehome' });
    expect(takehomeRate({}, 'APP_STORE')).toEqual({ rate: 0.85, source: 'fallback' });
    // Commission without tax (tax unknown) → commission only.
    expect(takehomeRate({ commission_percentage: 0.15, tax_percentage: null }, 'APP_STORE')).toEqual({ rate: 0.85, source: 'tax_commission' });
  });
});

describe('BUG 2 (high): Family Sharing copies counted as revenue and payers', () => {
  it('is_family_share purchases are worth $0 and do not make a payer', () => {
    const shared = ev({ raw: { price: 29.99, is_family_share: true, takehome_percentage: 0.85 } });
    expect(netRevenue(shared)).toBe(0);
    expect(classifyEvent(shared).excluded).toBe('family_share');
    expect(userOutcome(user([shared]))).toMatchObject({ payer: false, revenueToDate: 0 });
  });
});

describe('BUG 3 (high): the same store transaction under two event ids was counted twice', () => {
  it('dedupes by (kind, store, transaction_id); a refund of that transaction is still applied', () => {
    const a = ev({ id: 'a', raw: { price: 10, takehome_percentage: 1, transaction_id: 'T1' } });
    const b = ev({ id: 'b', event_timestamp: '2026-10-02T12:05:00Z', raw: { price: 10, takehome_percentage: 1, transaction_id: 'T1' } });
    expect(userOutcome(user([a, b])).revenueToDate).toBe(10);
    const refund = ev({ id: 'r', type: 'CANCELLATION', event_timestamp: '2026-10-03T00:00:00Z', raw: { price: -10, cancel_reason: 'CUSTOMER_SUPPORT', takehome_percentage: 1, transaction_id: 'T1' } });
    const refundAgain = ev({ id: 'r2', type: 'CANCELLATION', event_timestamp: '2026-10-03T00:01:00Z', raw: { price: -10, cancel_reason: 'CUSTOMER_SUPPORT', takehome_percentage: 1, transaction_id: 'T1' } });
    expect(userOutcome(user([a, b, refund, refundAgain])).revenueToDate).toBe(0);
  });
  it('the same event id twice counts once', () => {
    const a = ev({ id: 'same', raw: { price: 10, takehome_percentage: 1 } });
    expect(userOutcome(user([a, { ...a }])).revenueToDate).toBe(10);
  });
});

describe('BUG 4 (medium): a fully refunded buyer stayed a payer', () => {
  it('purchase + refund → not a payer; a later refund reversal restores payer and revenue', () => {
    const buy = ev({ raw: { price: 9.99, takehome_percentage: 0.85, transaction_id: 'T9' } });
    const refund = ev({ type: 'CANCELLATION', event_timestamp: '2026-10-05T00:00:00Z', raw: { price: -9.99, cancel_reason: 'CUSTOMER_SUPPORT', takehome_percentage: 0.85, transaction_id: 'T9' } });
    expect(userOutcome(user([buy, refund]))).toMatchObject({ payer: false, revenueToDate: 0 });
    // BUG 5: REFUND_REVERSED was ignored (revenue stayed subtracted).
    const reversed = ev({ type: 'REFUND_REVERSED', event_timestamp: '2026-10-09T00:00:00Z', raw: { price: 9.99, takehome_percentage: 0.85, transaction_id: 'T9' } });
    expect(userOutcome(user([buy, refund, reversed]))).toMatchObject({ payer: true, revenueToDate: 8.49 });
  });
  it('renewal refunded but first period kept → still a payer', () => {
    const buy = ev({ raw: { price: 9.99, takehome_percentage: 1, transaction_id: 'A' } });
    const renew = ev({ type: 'RENEWAL', event_timestamp: '2026-11-01T12:00:00Z', raw: { price: 9.99, takehome_percentage: 1, transaction_id: 'B' } });
    const refund = ev({ type: 'CANCELLATION', event_timestamp: '2026-11-02T12:00:00Z', raw: { price: -9.99, cancel_reason: 'CUSTOMER_SUPPORT', takehome_percentage: 1, transaction_id: 'B' } });
    expect(userOutcome(user([buy, renew, refund]))).toMatchObject({ payer: true, revenueToDate: 9.99 });
  });
});

describe('BUG 6 (medium): refunds were only recognised with cancel_reason CUSTOMER_SUPPORT', () => {
  it('any CANCELLATION with a negative price is a refund (RevenueCat: price is negative for refunds)', () => {
    expect(netRevenue(ev({ type: 'CANCELLATION', raw: { price: -9.99, cancel_reason: 'UNKNOWN', takehome_percentage: 1 } }))).toBe(-9.99);
    // A plain unsubscribe (positive or null price) is still not a refund.
    expect(netRevenue(ev({ type: 'CANCELLATION', raw: { price: 9.99, cancel_reason: 'UNSUBSCRIBE' } }))).toBe(0);
  });
});

describe('BUG 7 (medium): Stripe-native webhook rows would double count RevenueCat STRIPE events', () => {
  it('stripe:* rows are audit-only', () => {
    expect(netRevenue(ev({ id: 'stripe:evt_1', type: 'charge.refunded', store: 'STRIPE', raw: { object: 'event', amount_refunded: 999 } }))).toBe(0);
  });
});

describe('Hardening: trials, promotional grants, missing prices', () => {
  it('a TRIAL INITIAL_PURCHASE is $0 even if a price was sent', () => {
    expect(netRevenue(ev({ raw: { price: 29.99, period_type: 'TRIAL' } }))).toBe(0);
    expect(userOutcome(user([ev({ raw: { price: 29.99, period_type: 'TRIAL' } })]))).toMatchObject({ trial: true, payer: false });
  });
  it('PROMOTIONAL store grants are $0', () => {
    expect(netRevenue(ev({ store: 'PROMOTIONAL', raw: { price: 9.99 } }))).toBe(0);
  });
  it('a charge with no USD price is $0 but flagged (and still a payer — money changed hands)', () => {
    const e = ev({ raw: { price: null, currency: 'EUR', price_in_purchased_currency: 9.99 } });
    expect(classifyEvent(e)).toMatchObject({ kind: 'charge', net: 0, missingPrice: true });
    expect(userOutcome(user([e])).payer).toBe(true);
  });
  it('non-USD with a USD price uses price (RevenueCat converts); price_in_purchased_currency only when it is USD', () => {
    expect(netRevenue(ev({ raw: { price: 10.5, currency: 'EUR', price_in_purchased_currency: 9.99, takehome_percentage: 1 } }))).toBe(10.5);
    expect(netRevenue(ev({ raw: { price: null, currency: 'USD', price_in_purchased_currency: 9.99, takehome_percentage: 1 } }))).toBe(9.99);
  });
  it('PRODUCT_CHANGE carries no revenue (the charge arrives as its own RENEWAL / INITIAL_PURCHASE)', () => {
    expect(netRevenue(ev({ type: 'PRODUCT_CHANGE', raw: { price: 29.99, takehome_percentage: 1 } }))).toBe(0);
  });
});

describe('BUG 8 (low): activation used ≤ 7 days while revenue D7 used < 7 days', () => {
  it('both windows are [signup, signup + 7 × 24 h)', () => {
    const exactly7d = '2026-10-08T12:00:00Z';
    expect(userOutcome(user([], { firstActivityAt: exactly7d })).activated).toBe(false);
    expect(userOutcome(user([ev({ event_timestamp: exactly7d, raw: { price: 10, takehome_percentage: 1 } })])).revenueD7).toBe(0);
    expect(userOutcome(user([], { firstActivityAt: '2026-10-08T11:59:59Z' })).activated).toBe(true);
  });
});

describe('BUG 9 (medium): keyword / ad-group breakdowns did not add up to totals (Search Match spend dropped)', () => {
  const m = (level: AdMetricRow['level'], id: string, spend: number, installs: number): AdMetricRow => ({
    channel: 'apple_ads',
    level,
    external_id: id,
    campaign_external_id: 'C1',
    date: '2026-10-01',
    spend,
    currency: 'USD',
    impressions: 100,
    taps: 10,
    installs,
  });
  const input: SliceInput = {
    metricRows: [m('campaign', 'C1', 30, 6), m('ad_group', 'G1', 30, 6), m('keyword', 'K1', 18, 4)],
    entities: [],
    cohort: [],
    rangeEnd: '2026-10-01',
    today: '2026-10-24',
  };
  it('the Search Match remainder lands in the channel (none) row', () => {
    const rows = buildRows('keyword', input);
    expect(rows.find((r) => r.key === 'apple_ads:none')!.metrics).toMatchObject({ spend: 12, installs: 2, impressions: 0, taps: 0 });
    const sum = rows.reduce((s, r) => s + Math.round(r.metrics.spend * 100), 0) / 100;
    expect(sum).toBe(buildTotals(input).metrics.spend);
  });
});

describe('Service-level regressions (Supabase loaders)', () => {
  let db: AdsFakeDb;
  beforeEach(() => {
    db = new AdsFakeDb();
    setAdsDb(db);
  });
  afterEach(() => {
    db.unstableTies = false;
  });

  it('BUG 10 (high): metric rows were paginated ordered by date only → rows skipped / repeated past 1000 rows', async () => {
    db.unstableTies = true;
    let cents = 0;
    for (let i = 0; i < 2500; i++) {
      const spend = ((i % 97) + 1) / 100;
      cents += Math.round(spend * 100);
      db.rows('ad_metrics_daily').push({ channel: 'apple_ads', level: 'keyword', external_id: `K${i}`, campaign_external_id: 'C1', date: '2026-10-01', spend, currency: 'USD', impressions: 1, taps: 0, installs: 0 });
    }
    const rows = await AdsReportService.loadMetrics('2026-10-01', '2026-10-01');
    expect(rows).toHaveLength(2500);
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(2500);
    expect(rows.reduce((s, r) => s + Math.round(Number(r.spend) * 100), 0)).toBe(cents);
  });

  it('BUG 11 (medium): selectAll silently truncated at 100k rows; now it throws', async () => {
    const fake = { range: (from: number, to: number) => Promise.resolve({ data: Array.from({ length: to - from + 1 }, () => ({})), error: null }) };
    await expect(selectAll(() => fake, 3000)).rejects.toThrow(/more than 3000 rows/);
  });

  const seedUser = (id: string, createdAt: string, attr?: Partial<AttributionRow>) => {
    db.rows('profiles').push({ id, created_at: createdAt, email: `${id}@gmail.com`, is_admin: false });
    if (attr) db.rows('user_attribution').push({ user_id: id, channel: 'apple_ads', platform: 'ios', source: 'apple_search_ads', campaign_external_id: 'C1', ad_group_external_id: null, keyword_external_id: null, ad_external_id: null, is_test: false, ...attr });
  };

  it('BUG 12 (medium): passive HealthKit / Health Connect imports counted as activation', async () => {
    seedUser('passive', '2026-10-01T14:00:00Z');
    seedUser('manual', '2026-10-01T15:00:00Z');
    db.rows('daily_tracking').push({ id: 'd1', user_id: 'passive', created_at: '2026-10-01T14:05:00Z', steps_source: 'healthkit' });
    db.rows('food_log_entries').push({ id: 'f1', user_id: 'passive', created_at: '2026-10-01T14:06:00Z', input_method: 'imported' });
    db.rows('daily_tracking').push({ id: 'd2', user_id: 'manual', created_at: '2026-10-02T15:00:00Z', steps_source: 'manual' });
    const cohort = await AdsReportService.loadCohort({ start: '2026-10-01', end: '2026-10-01', timeZone: 'America/New_York' });
    const by = Object.fromEntries(cohort.map((u) => [u.userId, u]));
    expect(by.passive.firstActivityAt).toBeNull();
    expect(by.manual.firstActivityAt).toBe('2026-10-02T15:00:00.000Z');
  });

  it('BUG 13 (medium): one transaction delivered to two users (transfer / alias) counted for both', async () => {
    seedUser('a1', '2026-10-01T14:00:00Z', {});
    seedUser('a2', '2026-10-01T15:00:00Z', {});
    const raw = { price: 29.99, takehome_percentage: 0.85, transaction_id: 'TX', environment: 'PRODUCTION' };
    db.rows('subscription_events').push(
      { id: 'x1', user_id: 'a1', type: 'INITIAL_PURCHASE', store: 'APP_STORE', environment: 'PRODUCTION', event_timestamp: '2026-10-01T16:00:00Z', raw },
      { id: 'x2', user_id: 'a2', type: 'INITIAL_PURCHASE', store: 'APP_STORE', environment: 'PRODUCTION', event_timestamp: '2026-10-01T17:00:00Z', raw }
    );
    const { cohort, duplicatesDropped } = await AdsReportService.loadCohortWithStats({ start: '2026-10-01', end: '2026-10-01', timeZone: 'America/New_York' });
    expect(duplicatesDropped).toBe(1);
    const total = cohort.reduce((s, u) => s + userOutcome(u).revenueToDate, 0);
    expect(total).toBe(25.49);
    expect(cohort.find((u) => u.userId === 'a1')!.events).toHaveLength(1); // the earliest delivery keeps it
  });

  it('cohort day boundaries follow the report time zone (America/New_York, EDT = UTC−4)', async () => {
    seedUser('late', '2026-10-02T03:59:59Z'); // 23:59:59 Oct 1 in New York
    seedUser('next', '2026-10-02T04:00:00Z'); // 00:00 Oct 2 in New York
    seedUser('early', '2026-10-01T04:00:00Z'); // 00:00 Oct 1 in New York
    seedUser('before', '2026-10-01T03:59:59Z'); // Sep 30 in New York
    const cohort = await AdsReportService.loadCohort({ start: '2026-10-01', end: '2026-10-01', timeZone: 'America/New_York' });
    expect(cohort.map((u) => u.userId).sort()).toEqual(['early', 'late']);
  });
});

describe('Apple totals mapping (verify endpoint)', () => {
  it('requests totals without granularity (Apple: returnRowTotals required, returnGrandTotals allowed)', () => {
    const b = totalsReportBody('2026-10-01', '2026-10-07');
    expect(b).toMatchObject({ startTime: '2026-10-01', endTime: '2026-10-07', timeZone: 'ORTZ', returnRowTotals: true, returnGrandTotals: true });
    expect('granularity' in b).toBe(false);
  });
  it('maps the same install basis the sync stores (totalInstalls)', () => {
    expect(mapAppleTotals({ localSpend: { amount: '12.34', currency: 'USD' }, impressions: 1000, taps: 40, tapInstalls: 8, viewInstalls: 2, totalInstalls: 10 })).toEqual({
      spend: 12.34,
      currency: 'USD',
      impressions: 1000,
      taps: 40,
      installs: 10,
    });
  });
});
