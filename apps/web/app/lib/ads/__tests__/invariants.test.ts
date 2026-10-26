/**
 * Property-style invariants over randomized (seeded, reproducible) fixtures:
 * the report must add up, never produce NaN / Infinity, never count SANDBOX
 * money, never count an event twice, and excluding test users must never
 * increase a count. 200 random worlds per property.
 */
import { describe, expect, it } from 'vitest';

import { eachDay } from '../dates';
import { type CohortUser, type RevenueEvent, userOutcome } from '../metrics';
import { buildRows, buildTimeseries, buildTotals, type SliceInput } from '../report';
import type { AdEntityRow, AdMetricRow, AdsMetrics, AttributionChannel, AttributionRow } from '../types';
import { GROUP_BYS } from '../types';

// Mulberry32: tiny seeded PRNG so failures are reproducible (seed is in the test name).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = '2026-09-01';
const END = '2026-09-10';
const TODAY = '2026-09-20';
const DAYS = eachDay(START, END);

interface World {
  input: SliceInput;
  testUserIds: Set<string>;
}

function world(seed: number): World {
  const r = rng(seed);
  const int = (n: number) => Math.floor(r() * n);
  const pick = <T,>(xs: T[]) => xs[int(xs.length)];
  const entities: AdEntityRow[] = [];
  const metricRows: AdMetricRow[] = [];
  const ent = (channel: 'apple_ads' | 'meta', level: AdEntityRow['level'], id: string, parent: string | null, campaign: string): AdEntityRow => ({
    channel,
    platform: channel === 'apple_ads' ? 'ios' : 'android',
    level,
    external_id: id,
    parent_external_id: parent,
    campaign_external_id: campaign,
    name: `${level} ${id}`,
    status: 'ENABLED',
    serving_status: null,
    bid_strategy: 'MANUAL_CPT',
    bid_amount: null,
    bid_currency: 'USD',
    daily_budget: null,
    total_budget: null,
    match_type: null,
    countries: null,
    start_at: null,
    end_at: null,
    creative: null,
    synced_at: '2026-09-20T00:00:00Z',
  });
  const tree: Array<{ channel: 'apple_ads' | 'meta'; campaign: string; groups: Array<{ id: string; keywords: string[]; ads: string[] }> }> = [];
  for (const channel of ['apple_ads', 'meta'] as const) {
    for (let c = 0; c < 1 + int(3); c++) {
      const campaign = `${channel}-C${c}`;
      entities.push(ent(channel, 'campaign', campaign, null, campaign));
      const groups = [];
      for (let g = 0; g < 1 + int(3); g++) {
        const id = `${campaign}-G${g}`;
        entities.push(ent(channel, 'ad_group', id, campaign, campaign));
        const keywords = channel === 'apple_ads' ? Array.from({ length: int(4) }, (_, k) => `${id}-K${k}`) : [];
        const ads = Array.from({ length: 1 + int(2) }, (_, a) => `${id}-A${a}`);
        for (const k of keywords) entities.push(ent(channel, 'keyword', k, id, campaign));
        for (const a of ads) entities.push(ent(channel, 'ad', a, id, campaign));
        groups.push({ id, keywords, ads });
      }
      tree.push({ channel, campaign, groups });
    }
  }
  const row = (channel: string, level: AdMetricRow['level'], id: string, campaign: string, date: string, d: { spend: number; impressions: number; taps: number; installs: number }): AdMetricRow => ({
    channel: channel as AdMetricRow['channel'],
    level,
    external_id: id,
    campaign_external_id: campaign,
    date,
    spend: d.spend / 100,
    currency: 'USD',
    impressions: d.impressions,
    taps: d.taps,
    installs: d.installs,
  });
  // Delivery generated bottom-up in cents so parents are exact sums of children
  // (keywords ≤ their ad group: the remainder is Search Match).
  for (const date of DAYS) {
    for (const t of tree) {
      const camp = { spend: 0, impressions: 0, taps: 0, installs: 0 };
      for (const g of t.groups) {
        const grp = { spend: 0, impressions: 0, taps: 0, installs: 0 };
        for (const a of g.ads) {
          const d = { spend: int(5000), impressions: int(2000), taps: int(80), installs: int(12) };
          metricRows.push(row(t.channel, 'ad', a, t.campaign, date, d));
          for (const k of Object.keys(grp) as Array<keyof typeof grp>) grp[k] += d[k];
        }
        let left = { ...grp };
        for (const kw of g.keywords) {
          const d = { spend: int(left.spend + 1), impressions: int(left.impressions + 1), taps: int(left.taps + 1), installs: int(left.installs + 1) };
          left = { spend: left.spend - d.spend, impressions: left.impressions - d.impressions, taps: left.taps - d.taps, installs: left.installs - d.installs };
          metricRows.push(row(t.channel, 'keyword', kw, t.campaign, date, d));
        }
        metricRows.push(row(t.channel, 'ad_group', g.id, t.campaign, date, grp));
        for (const k of Object.keys(camp) as Array<keyof typeof camp>) camp[k] += grp[k];
      }
      metricRows.push(row(t.channel, 'campaign', t.campaign, t.campaign, date, camp));
    }
  }

  const cohort: CohortUser[] = [];
  const testUserIds = new Set<string>();
  const nUsers = 5 + int(40);
  const channels: AttributionChannel[] = ['apple_ads', 'meta', 'organic', 'unknown'];
  let eventSeq = 0;
  for (let i = 0; i < nUsers; i++) {
    const userId = `u${i}`;
    const date = pick(DAYS);
    const signupAt = `${date}T${String(4 + int(19)).padStart(2, '0')}:${String(int(60)).padStart(2, '0')}:00Z`;
    const ch = pick(channels);
    let attribution: AttributionRow | null = null;
    if (ch !== 'unknown' || r() < 0.5) {
      const t = tree.filter((x) => x.channel === ch);
      const camp = t.length ? pick(t) : null;
      const g = camp && r() < 0.8 ? pick(camp.groups) : null;
      attribution = {
        user_id: userId,
        channel: ch,
        platform: ch === 'meta' ? 'android' : ch === 'apple_ads' ? 'ios' : pick(['ios', 'android', null] as const),
        source: ch === 'apple_ads' ? pick(['apple_search_ads', 'revenuecat']) : 'app',
        campaign_external_id: camp?.campaign ?? null,
        ad_group_external_id: g?.id ?? null,
        keyword_external_id: g && g.keywords.length && r() < 0.7 ? pick(g.keywords) : null,
        ad_external_id: g && r() < 0.5 ? pick(g.ads) : null,
        click_at: null,
        country: 'US',
        is_test: r() < 0.05,
        raw: null,
      };
    }
    const events: RevenueEvent[] = [];
    const ms = Date.parse(signupAt);
    const nEvents = int(5);
    for (let e = 0; e < nEvents; e++) {
      const type = pick(['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'CANCELLATION', 'EXPIRATION', 'PRODUCT_CHANGE', 'REFUND_REVERSED', 'BILLING_ISSUE']);
      const price = pick([9.99, 29.99, 179.99, 0, -9.99, -29.99, null]);
      events.push({
        id: `ev${eventSeq++}`,
        user_id: userId,
        type,
        store: pick(['APP_STORE', 'PLAY_STORE', 'STRIPE']),
        environment: r() < 0.15 ? 'SANDBOX' : 'PRODUCTION',
        event_timestamp: new Date(ms + int(40 * 86_400_000)).toISOString(),
        raw: {
          price,
          period_type: pick(['NORMAL', 'TRIAL', 'INTRO']),
          cancel_reason: type === 'CANCELLATION' ? pick(['CUSTOMER_SUPPORT', 'UNSUBSCRIBE']) : undefined,
          tax_percentage: r() < 0.5 ? pick([0, 0.07, 0.2]) : undefined,
          commission_percentage: r() < 0.5 ? pick([0.15, 0.3, 0.03]) : undefined,
          takehome_percentage: r() < 0.5 ? pick([0.85, 0.7]) : undefined,
          transaction_id: `tx${int(6)}-${userId}`,
          is_family_share: r() < 0.05,
        },
      });
    }
    const isTest = r() < 0.15;
    if (isTest) testUserIds.add(userId);
    cohort.push({
      userId,
      testReason: isTest ? 'internal' : null,
      signupAt,
      signupDate: date,
      attribution,
      firstActivityAt: r() < 0.6 ? new Date(ms + int(10 * 86_400_000)).toISOString() : null,
      events,
    });
  }
  return { input: { metricRows, entities, cohort, rangeEnd: END, today: TODAY }, testUserIds };
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const cents = (n: number) => Math.round(n * 100);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const COUNT_KEYS = ['users', 'activated', 'trials', 'payers'] as const;
const RATIOS: Array<[keyof AdsMetrics, keyof AdsMetrics]> = [
  ['cpt', 'taps'],
  ['ttr', 'impressions'],
  ['cpi', 'installs'],
  ['costPerUser', 'users'],
  ['costPerActivated', 'activated'],
  ['costPerPayer', 'payers'],
  ['roasD7', 'spend'],
  ['roasD30', 'spend'],
  ['roasToDate', 'spend'],
  ['installToUser', 'installs'],
  ['userToActivated', 'users'],
  ['userToPayer', 'users'],
];

function allMetrics(input: SliceInput): AdsMetrics[] {
  return [...GROUP_BYS.flatMap((g) => buildRows(g, input).map((r) => r.metrics)), buildTotals(input).metrics];
}

// CPU-heavy (200 worlds per property): generous timeout so a loaded full-suite run can't fail it spuriously.
describe('invariants (200 seeded random worlds each)', { timeout: 60_000 }, () => {
  it('the generator exercises the interesting cases (spend, payers, refunds, trials, test users)', () => {
    let payers = 0;
    let refunds = 0;
    let trials = 0;
    let tests = 0;
    for (const seed of SEEDS) {
      const { input, testUserIds } = world(seed);
      const t = buildTotals(input).metrics;
      payers += t.payers;
      trials += t.trials;
      tests += testUserIds.size;
      refunds += input.cohort.filter((u) => userOutcome(u).revenueToDate < 0).length;
      expect(t.spend).toBeGreaterThan(0);
    }
    expect(payers).toBeGreaterThan(100);
    expect(trials).toBeGreaterThan(20);
    expect(refunds).toBeGreaterThan(5);
    expect(tests).toBeGreaterThan(100);
  });

  it('totals == Σ rows for spend / impressions / taps / installs, for every groupBy', () => {
    for (const seed of SEEDS) {
      const { input } = world(seed);
      const t = buildTotals(input).metrics;
      for (const g of GROUP_BYS) {
        const rows = buildRows(g, input);
        expect(sum(rows.map((r) => cents(r.metrics.spend))), `seed ${seed} ${g} spend`).toBe(cents(t.spend));
        for (const k of ['impressions', 'taps', 'installs'] as const) expect(sum(rows.map((r) => r.metrics[k])), `seed ${seed} ${g} ${k}`).toBe(t[k]);
      }
    }
  });

  it('paid users / activated / payers / revenue in totals == Σ paid-channel rows; timeseries agrees with totals', () => {
    for (const seed of SEEDS) {
      const { input } = world(seed);
      const t = buildTotals(input).metrics;
      const paid = buildRows('channel', input).filter((r) => ['apple_ads', 'meta', 'google_ads'].includes(String(r.channel)));
      for (const k of [...COUNT_KEYS]) expect(sum(paid.map((r) => r.metrics[k])), `seed ${seed} ${k}`).toBe(t[k]);
      expect(sum(paid.map((r) => cents(r.metrics.revenueToDate))), `seed ${seed} revenue`).toBe(cents(t.revenueToDate));
      // All rows (incl. organic / unknown) cover every cohort user exactly once.
      expect(sum(buildRows('channel', input).map((r) => r.metrics.users))).toBe(input.cohort.length);
      const ts = buildTimeseries(START, END, input);
      expect(sum(ts.map((p) => cents(p.spend))), `seed ${seed} ts spend`).toBe(cents(t.spend));
      expect(sum(ts.map((p) => p.installs))).toBe(t.installs);
      expect(sum(ts.map((p) => p.users))).toBe(t.users);
      expect(sum(ts.map((p) => p.payers))).toBe(t.payers);
      expect(sum(ts.map((p) => p.activated))).toBe(t.activated);
      expect(sum(ts.map((p) => cents(p.revenue)))).toBe(cents(t.revenueToDate));
      const last = ts[ts.length - 1].cumulativeRoas;
      if (t.spend > 0) expect(last).toBeCloseTo(t.revenueToDate / t.spend, 9);
      else expect(last).toBeNull();
    }
  });

  it('no NaN / Infinity anywhere; ratios are null exactly when the denominator is 0', () => {
    for (const seed of SEEDS) {
      const { input } = world(seed);
      for (const m of allMetrics(input)) {
        for (const [k, v] of Object.entries(m)) {
          if (typeof v === 'number') expect(Number.isFinite(v), `seed ${seed} ${k}=${v}`).toBe(true);
        }
        for (const [ratio, denom] of RATIOS) {
          if (Number(m[denom]) === 0) expect(m[ratio], `seed ${seed} ${ratio}`).toBeNull();
          else expect(Number.isFinite(m[ratio] as number), `seed ${seed} ${ratio}`).toBe(true);
        }
      }
      for (const p of buildTimeseries(START, END, input)) for (const v of Object.values(p)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('excluding test users never increases any count (rows and totals)', () => {
    for (const seed of SEEDS) {
      const { input, testUserIds } = world(seed);
      const real = { ...input, cohort: input.cohort.filter((u) => !testUserIds.has(u.userId)) };
      for (const g of GROUP_BYS) {
        const all = new Map(buildRows(g, input).map((r) => [r.key, r.metrics]));
        for (const r of buildRows(g, real)) {
          const a = all.get(r.key)!;
          expect(a, `seed ${seed} ${g} ${r.key} missing`).toBeTruthy();
          for (const k of COUNT_KEYS) expect(r.metrics[k], `seed ${seed} ${g} ${r.key} ${k}`).toBeLessThanOrEqual(a[k]);
        }
      }
      for (const k of COUNT_KEYS) expect(buildTotals(real).metrics[k]).toBeLessThanOrEqual(buildTotals(input).metrics[k]);
    }
  });

  it('SANDBOX money is never counted: adding sandbox copies changes nothing; all-sandbox → $0 and 0 payers', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const { input } = world(seed);
      const withSandbox = {
        ...input,
        cohort: input.cohort.map((u) => ({ ...u, events: [...u.events, ...u.events.map((e) => ({ ...e, id: `sb-${e.id}`, environment: 'SANDBOX', raw: { ...e.raw, transaction_id: `sb-${e.raw?.transaction_id}` } }))] })),
      };
      expect(allMetrics(withSandbox)).toEqual(allMetrics(input));
      const allSandbox = { ...input, cohort: input.cohort.map((u) => ({ ...u, events: u.events.map((e) => ({ ...e, environment: 'SANDBOX' })) })) };
      for (const u of allSandbox.cohort) expect(userOutcome(u)).toMatchObject({ payer: false, trial: false, revenueD7: 0, revenueD30: 0, revenueToDate: 0 });
    }
  });

  it('each event is counted at most once: re-delivered events (same id, or new id + same transaction) change nothing', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const { input } = world(seed);
      const sameId = { ...input, cohort: input.cohort.map((u) => ({ ...u, events: [...u.events, ...u.events.map((e) => ({ ...e }))] })) };
      const sameTx = { ...input, cohort: input.cohort.map((u) => ({ ...u, events: [...u.events, ...u.events.map((e) => ({ ...e, id: `dup-${e.id}`, event_timestamp: new Date(Date.parse(e.event_timestamp!) + 60_000).toISOString() }))] })) };
      const base = allMetrics(input);
      expect(allMetrics(sameId)).toEqual(base);
      expect(allMetrics(sameTx)).toEqual(base);
    }
  });
});
