/**
 * Ad revenue (AdMob) math for the Ads Console revenue tab and the email
 * (docs/ADS_METRICS_METHODOLOGY.md §9). Pure: no I/O, no clock reads.
 *
 * Every ratio is null when its denominator is 0. Rates are derived from summed
 * counts (never averaged), so any grouping gives the same answer AdMob would.
 */
import { eachDay } from './dates';
import { ratio } from './metrics';

const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/** Row shape of ad_revenue_daily as read. */
export interface AdRevenueRow {
  source: string;
  date: string;
  app_id: string;
  app_name: string | null;
  platform: 'ios' | 'android' | 'unknown';
  ad_unit_id: string;
  ad_unit_name: string | null;
  format: string | null;
  country: string;
  currency: string;
  estimated_earnings: number | string;
  ad_requests: number;
  matched_requests: number;
  impressions: number;
  clicks: number;
}

export interface AdRevenueMetrics {
  /** AdMob ESTIMATED_EARNINGS (estimates until AdMob finalises the month). */
  earnings: number;
  currency: string;
  mixedCurrency: boolean;
  adRequests: number;
  matchedRequests: number;
  impressions: number;
  clicks: number;
  /** Fill / match rate = matched requests ÷ ad requests. */
  matchRate: number | null;
  /** Show rate = impressions ÷ matched requests. */
  showRate: number | null;
  /** Clicks ÷ impressions. */
  ctr: number | null;
  /** Earnings per 1,000 impressions. */
  ecpm: number | null;
}

export function sumRevenue(rows: AdRevenueRow[]): AdRevenueMetrics {
  let micros = 0;
  let adRequests = 0;
  let matchedRequests = 0;
  let impressions = 0;
  let clicks = 0;
  const currencies = new Set<string>();
  for (const r of rows) {
    // Sum in micros so totals never depend on grouping order.
    micros += Math.round((Number(r.estimated_earnings) || 0) * 1_000_000);
    adRequests += Number(r.ad_requests) || 0;
    matchedRequests += Number(r.matched_requests) || 0;
    impressions += Number(r.impressions) || 0;
    clicks += Number(r.clicks) || 0;
    if ((Number(r.estimated_earnings) || 0) !== 0) currencies.add((r.currency || 'USD').toUpperCase());
  }
  const earnings = round6(micros / 1_000_000);
  return {
    earnings,
    currency: currencies.size === 1 ? [...currencies][0] : 'USD',
    mixedCurrency: currencies.size > 1,
    adRequests,
    matchedRequests,
    impressions,
    clicks,
    matchRate: ratio(matchedRequests, adRequests),
    showRate: ratio(impressions, matchedRequests),
    ctr: ratio(clicks, impressions),
    ecpm: impressions > 0 ? (earnings / impressions) * 1000 : null,
  };
}

export type RevenueGroupBy = 'platform' | 'ad_unit' | 'country' | 'format';
export const REVENUE_GROUP_BYS: RevenueGroupBy[] = ['platform', 'ad_unit', 'country', 'format'];

export interface AdRevenueSlice {
  key: string;
  label: string;
  sublabel: string | null;
  metrics: AdRevenueMetrics;
  /** Share of total earnings (0–1); null when total earnings are 0. */
  share: number | null;
  /** Platform slices only: mean daily active users and ad ARPDAU over the range. */
  avgDau?: number | null;
  arpdau?: number | null;
}

const PLATFORM_LABEL: Record<string, string> = { ios: 'iOS', android: 'Android', unknown: 'Unknown platform' };

export function groupRevenue(rows: AdRevenueRow[], by: RevenueGroupBy): AdRevenueSlice[] {
  const groups = new Map<string, AdRevenueRow[]>();
  for (const r of rows) {
    const k = by === 'platform' ? r.platform : by === 'ad_unit' ? r.ad_unit_id : by === 'country' ? r.country : (r.format ?? 'UNKNOWN');
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  const total = sumRevenue(rows).earnings;
  return [...groups.entries()]
    .map(([key, list]) => {
      const metrics = sumRevenue(list);
      const first = list[0];
      let label = key;
      let sublabel: string | null = null;
      if (by === 'platform') label = PLATFORM_LABEL[key] ?? key;
      if (by === 'ad_unit') {
        label = first.ad_unit_name || key;
        sublabel = [PLATFORM_LABEL[first.platform] ?? first.platform, first.format ? first.format.toLowerCase() : null, key].filter(Boolean).join(' · ');
      }
      if (by === 'country') label = key === 'ZZ' ? 'Unknown country' : key;
      if (by === 'format') label = key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ');
      return { key, label, sublabel, metrics, share: ratio(metrics.earnings, total) };
    })
    .sort((a, b) => b.metrics.earnings - a.metrics.earnings || b.metrics.impressions - a.metrics.impressions || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Daily active users and ARPDAU
// ---------------------------------------------------------------------------

/** One signed-in user active on one day (from home_feed_decisions, ad report time zone). */
export interface UserDay {
  userId: string;
  date: string;
  platform: 'ios' | 'android' | 'unknown';
}

/** Distinct users per (date, platform). */
export function dauByDay(userDays: UserDay[]): Map<string, number> {
  const seen = new Set<string>();
  const out = new Map<string, number>();
  for (const u of userDays) {
    const k = `${u.userId}|${u.date}|${u.platform}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const key = `${u.date}|${u.platform}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** Earnings per (date, platform). */
export function earningsByDay(rows: AdRevenueRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.date}|${r.platform}`;
    out.set(key, round6((out.get(key) ?? 0) + (Number(r.estimated_earnings) || 0)));
  }
  return out;
}

/**
 * ARPDAU per (date, platform) = that day's earnings ÷ that day's active users
 * on the platform. Absent when there were no active users that day.
 */
export function arpdauByDay(rows: AdRevenueRow[], dau: Map<string, number>): Map<string, number> {
  const earnings = earningsByDay(rows);
  const out = new Map<string, number>();
  for (const [key, e] of earnings) {
    const d = dau.get(key) ?? 0;
    if (d > 0) out.set(key, e / d);
  }
  return out;
}

/**
 * Range ARPDAU = Σ earnings ÷ Σ daily active users (user-days), for days that
 * had at least one active user (earnings on a day with no measured DAU are
 * left out of both sides). Null without user-days.
 */
export function rangeArpdau(rows: AdRevenueRow[], dau: Map<string, number>, platform?: string | null): { arpdau: number | null; avgDau: number | null; userDays: number; days: number } {
  const earnings = earningsByDay(rows);
  let num = 0;
  let userDays = 0;
  const days = new Set<string>();
  for (const [key, d] of dau) {
    const [date, p] = key.split('|');
    if (platform && p !== platform) continue;
    userDays += d;
    days.add(date);
    num += earnings.get(key) ?? 0;
  }
  return { arpdau: userDays > 0 ? num / userDays : null, avgDau: days.size ? round2(userDays / days.size) : null, userDays, days: days.size };
}

/**
 * ESTIMATE: a user's share of ad revenue = Σ over the days they were active of
 * that day's platform ARPDAU. AdMob does not report revenue per user; this
 * spreads each day's real earnings evenly over that day's active users.
 */
export function allocateAdRevenue(userDays: UserDay[], arpdau: Map<string, number>): Map<string, number> {
  const seen = new Set<string>();
  const out = new Map<string, number>();
  for (const u of userDays) {
    const k = `${u.userId}|${u.date}|${u.platform}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const v = arpdau.get(`${u.date}|${u.platform}`) ?? 0;
    if (v) out.set(u.userId, (out.get(u.userId) ?? 0) + v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Revenue vs spend by day
// ---------------------------------------------------------------------------

export interface RevenueDayPoint {
  date: string;
  /** AdMob estimated earnings (Pacific day); null when AdMob is not connected. */
  adRevenue: number | null;
  impressions: number;
  /** Active users that day (all platforms), null when not measured. */
  dau: number | null;
  /** adRevenue ÷ dau. */
  arpdau: number | null;
  /** Net subscription revenue of real users by event day (report time zone, cash basis). */
  subscriptionRevenue: number;
  /** Paid-ad spend (campaign level, network report day). */
  spend: number;
  /** (adRevenue + subscriptionRevenue) ÷ spend for the day; null without spend (ad revenue counts as 0 only in this sum when unknown). */
  roas: number | null;
}

export function revenueDays(
  start: string,
  end: string,
  input: { revenueRows: AdRevenueRow[]; dau: Map<string, number>; subscriptionByDay: Map<string, number>; spendByDay: Map<string, number>; adConnected?: boolean }
): RevenueDayPoint[] {
  const connected = input.adConnected !== false;
  const ad = new Map<string, { e: number; i: number }>();
  for (const r of input.revenueRows) {
    const v = ad.get(r.date) ?? { e: 0, i: 0 };
    v.e = round6(v.e + (Number(r.estimated_earnings) || 0));
    v.i += Number(r.impressions) || 0;
    ad.set(r.date, v);
  }
  const dauDay = new Map<string, number>();
  for (const [key, n] of input.dau) {
    const date = key.split('|')[0];
    dauDay.set(date, (dauDay.get(date) ?? 0) + n);
  }
  return eachDay(start, end).map((date) => {
    const a = ad.get(date) ?? { e: 0, i: 0 };
    const dau = dauDay.has(date) ? dauDay.get(date)! : null;
    const subs = round2(input.subscriptionByDay.get(date) ?? 0);
    const spend = round2(input.spendByDay.get(date) ?? 0);
    return {
      date,
      adRevenue: connected ? round6(a.e) : null,
      impressions: a.i,
      dau,
      arpdau: connected && dau ? a.e / dau : null,
      subscriptionRevenue: subs,
      spend,
      roas: ratio(a.e + subs, spend),
    };
  });
}
