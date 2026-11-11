/**
 * GET /api/admin/ads/revenue (docs/ADS_METRICS_METHODOLOGY.md §9): AdMob ad
 * revenue (estimated) with match / show rate, CTR and eCPM by platform, ad
 * unit, country and format; ads ARPDAU; revenue vs spend per day; and returns
 * on ad spend per paid channel, from data we already hold:
 *
 *  - ad_revenue_daily (AdMob sync, Pacific days)
 *  - home_feed_decisions → daily active signed-in users (every 1.0.8+ app
 *    loads the Home feed on launch; retention 90 days), Pacific days
 *  - ad_metrics_daily / the sign-up cohort (overview) for spend, funnel costs
 *    and subscription revenue by channel
 *  - subscription_events (PRODUCTION, real users) for cash-basis revenue per day
 *
 * Read-only. Never calls AdMob (the sync does).
 */
import { CampaignError } from '@/lib/campaigns/http';

import {
  type AdRevenueMetrics,
  type AdRevenueRow,
  type AdRevenueSlice,
  allocateAdRevenue,
  arpdauByDay,
  dauByDay,
  groupRevenue,
  rangeArpdau,
  revenueDays,
  type RevenueDayPoint,
  sumRevenue,
  type UserDay,
} from '../ad-revenue';
import { ADMOB_REPORT_TIME_ZONE } from '../admob/client';
import { addDays, todayInTz, ymdInTz } from '../dates';
import { classifyEvent, dedupeEvents, ratio, type RevenueEvent } from '../metrics';
import { buildRows, buildTotals, effectiveAttribution, type SliceInput } from '../report';
import { AD_CHANNELS, type AdChannel, type AdsMetrics, CHANNEL_LABEL, type ExcludedUsers } from '../types';

import { AdRevenueSyncService, type AdRevenueSyncStatus } from './ad-revenue-sync-service';
import { chunk, db, selectAll } from './db';
import { AdsReportService, type RangeQuery } from './report-service';

export type RevenuePlatform = 'ios' | 'android';

export interface ChannelReturn {
  channel: AdChannel | 'total';
  label: string;
  spend: number;
  impressions: number;
  taps: number;
  installs: number;
  /** Taps ÷ impressions. */
  ttr: number | null;
  /** Installs ÷ taps. */
  conversionRate: number | null;
  cpi: number | null;
  users: number;
  activated: number;
  trials: number;
  payers: number;
  costPerSignUp: number | null;
  costPerActivated: number | null;
  costPerTrial: number | null;
  costPerPayer: number | null;
  /** Net subscription revenue of the channel's sign-up cohort, to date. */
  subscriptionRevenue: number;
  /** ESTIMATE: AdMob earnings allocated to the cohort by active days × platform ARPDAU, to date. Null when AdMob is not connected. */
  adRevenue: number | null;
  /** subscriptionRevenue + (adRevenue ?? 0). */
  totalRevenue: number;
  /** subscriptionRevenue ÷ spend. */
  roasSubscriptions: number | null;
  /** totalRevenue ÷ spend (includes the ad revenue estimate). */
  roas: number | null;
}

export interface BlendedReturn {
  /** All paid spend on days in the range. */
  spend: number;
  /** AdMob estimated earnings on days in the range (Pacific); null when AdMob is not connected. */
  adRevenue: number | null;
  /** Net subscription revenue from events in the range, all real users (cash basis). */
  subscriptionRevenue: number;
  /** What subscribers paid (before store commission and tax), refunds subtracted. */
  subscriptionGross: number;
  /** Paid subscription charges (purchases and renewals) in the range. */
  subscriptionCharges: number;
  totalRevenue: number;
  /** totalRevenue ÷ spend (subscriptions only while AdMob is not connected). */
  roas: number | null;
}

export interface AdsRevenueReport {
  range: { start: string; end: string; timeZone: string };
  /** AdMob reports Pacific days only. */
  adRevenueTimeZone: string;
  platform: RevenuePlatform | null;
  source: AdRevenueSyncStatus & { rowsInRange: number; firstDate: string | null; lastDate: string | null };
  /** AdMob earnings are estimates until AdMob finalises the month. */
  estimated: true;
  totals: AdRevenueMetrics & { avgDau: number | null; arpdau: number | null; userDays: number };
  byPlatform: AdRevenueSlice[];
  byAdUnit: AdRevenueSlice[];
  byCountry: AdRevenueSlice[];
  byFormat: AdRevenueSlice[];
  days: RevenueDayPoint[];
  returns: { rows: ChannelReturn[]; paid: ChannelReturn; blended: BlendedReturn };
  excludedUsers: ExcludedUsers;
  notes: string[];
  definitions: Record<string, string>;
}

export const REVENUE_DEFINITIONS: Record<string, string> = {
  earnings: 'AdMob estimated earnings (ESTIMATED_EARNINGS, USD). AdMob revises estimates; finalised amounts appear in AdMob → Payments after the month closes.',
  adRequests: 'Ad requests the apps sent to AdMob.',
  matchedRequests: 'Requests AdMob answered with an ad.',
  matchRate: 'Match (fill) rate = matched requests ÷ ad requests.',
  showRate: 'Show rate = impressions ÷ matched requests (ads that loaded and were shown).',
  impressions: 'Ads shown, as AdMob counts them.',
  clicks: 'Ad clicks.',
  ctr: 'Click-through rate = clicks ÷ impressions.',
  ecpm: 'eCPM = estimated earnings ÷ impressions × 1,000.',
  avgDau: 'Daily active users = distinct signed-in, non-test users whose app loaded the Home feed that day (home_feed_decisions, Pacific day), averaged over days with data.',
  arpdau: 'Ad ARPDAU = Σ AdMob earnings ÷ Σ daily active users, over days with a DAU measurement.',
  ttr: 'Tap-through rate = taps (Apple) / clicks (Google) ÷ impressions.',
  conversionRate: 'Install conversion rate = network-reported installs ÷ taps.',
  costPerSignUp: 'Spend ÷ sign-ups attributed to the channel.',
  costPerActivated: 'Spend ÷ attributed users who logged food or checked in within 7 days.',
  costPerTrial: 'Spend ÷ attributed users who started a free trial.',
  costPerPayer: 'Spend ÷ attributed paying users (to date).',
  subscriptionRevenue: 'Net subscription revenue (after store fees and tax, refunds subtracted) of the channel’s sign-up cohort, to date.',
  adRevenue: 'ESTIMATE. AdMob does not report revenue per user: each day’s platform ARPDAU is credited to every user active that day, then summed over the channel’s cohort (sign-up → today).',
  roas: '(Subscription revenue + estimated ad revenue) ÷ spend, cohort basis.',
  roasSubscriptions: 'Subscription revenue ÷ spend (the console’s ROAS to date).',
  totalRevenueRange: 'Net subscription revenue + AdMob estimated earnings booked on days in the range, all real users (paid and organic).',
  subscriptionRevenueRange: 'Subscription revenue booked on days in the range from RevenueCat production events (App Store, Google Play, web), all real users. Net is after store commission and tax with refunds subtracted; gross is what customers paid.',
  blendedRoas: 'Cash basis, all users: (AdMob earnings + net subscription revenue booked on days in the range) ÷ paid spend on days in the range.',
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const PLATFORMS: RevenuePlatform[] = ['ios', 'android'];

export function parseRevenuePlatform(v: string | null): RevenuePlatform | null {
  if (!v) return null;
  if (!(PLATFORMS as string[]).includes(v)) throw new CampaignError(400, 'VALIDATION_ERROR', `platform must be one of ${PLATFORMS.join(', ')}`);
  return v as RevenuePlatform;
}

const normPlatform = (v: unknown): UserDay['platform'] => {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('ios') || s.includes('iphone') || s.includes('ipad')) return 'ios';
  if (s.includes('android')) return 'android';
  return 'unknown';
};

/** One day of subscription revenue (USD). */
export interface SubscriptionDay {
  net: number;
  gross: number;
  /** Paid charges (purchases and renewals), refunds not counted. */
  charges: number;
}

export class AdRevenueReportService {
  static async loadRevenue(start: string, end: string): Promise<AdRevenueRow[]> {
    try {
      return await selectAll<AdRevenueRow>(() =>
        db()
          .from('ad_revenue_daily')
          .select('source, date, app_id, app_name, platform, ad_unit_id, ad_unit_name, format, country, currency, estimated_earnings, ad_requests, matched_requests, impressions, clicks')
          .gte('date', start)
          .lte('date', end)
          .order('date', { ascending: true })
          .order('source', { ascending: true })
          .order('ad_unit_id', { ascending: true })
          .order('country', { ascending: true })
      );
    } catch (e: any) {
      // Before migration 126 is applied the tab shows "no data" instead of a 500.
      console.warn('[ads/revenue] ad_revenue_daily unavailable:', e?.message ?? e);
      return [];
    }
  }

  /**
   * Distinct (user, Pacific day, platform) from home_feed_decisions in [start, end],
   * test / internal users removed. `userIds` narrows to those users.
   */
  static async loadUserDays(start: string, end: string, opts: { userIds?: string[]; includeTest?: boolean } = {}): Promise<UserDay[]> {
    const tz = ADMOB_REPORT_TIME_ZONE;
    const from = new Date(Date.parse(`${start}T00:00:00Z`) - 14 * 3600_000).toISOString();
    const to = new Date(Date.parse(`${addDays(end, 1)}T00:00:00Z`) + 14 * 3600_000).toISOString();
    type Row = { id: string; user_id: string; platform: string | null; created_at: string };
    const read = (ids?: string[]) =>
      selectAll<Row>(() => {
        let q = db().from('home_feed_decisions').select('id, user_id, platform, created_at').gte('created_at', from).lt('created_at', to);
        if (ids) q = q.in('user_id', ids);
        return q.order('created_at', { ascending: true }).order('id', { ascending: true });
      });
    let rows: Row[] = [];
    try {
      if (opts.userIds) {
        for (const part of chunk([...new Set(opts.userIds)], 150)) rows.push(...(await read(part)));
      } else rows = await read();
    } catch (e: any) {
      console.warn('[ads/revenue] home_feed_decisions unavailable:', e?.message ?? e);
      return [];
    }
    const seen = new Set<string>();
    const out: UserDay[] = [];
    for (const r of rows) {
      const date = ymdInTz(r.created_at, tz);
      if (date < start || date > end) continue;
      const platform = normPlatform(r.platform);
      const k = `${r.user_id}|${date}|${platform}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ userId: r.user_id, date, platform });
    }
    if (opts.includeTest) return out;
    const verdicts = await AdsReportService.classifyUsers(out.map((u) => u.userId));
    return out.filter((u) => verdicts.has(u.userId) && !verdicts.get(u.userId)!.testReason);
  }

  /** Net subscription revenue per report-time-zone day from PRODUCTION events in [start, end], real users only. */
  static async subscriptionByDay(start: string, end: string, timeZone: string, includeTest = false): Promise<Map<string, number>> {
    const both = await this.subscriptionRevenueByDay(start, end, timeZone, includeTest);
    return new Map([...both].map(([day, v]) => [day, v.net]));
  }

  /**
   * Subscription revenue per report-time-zone day from PRODUCTION events in [start, end], real users only:
   * net = after store commission and tax (what we keep), gross = what customers paid. Refunds subtract from both.
   */
  static async subscriptionRevenueByDay(start: string, end: string, timeZone: string, includeTest = false): Promise<Map<string, SubscriptionDay>> {
    const from = new Date(Date.parse(`${start}T00:00:00Z`) - 14 * 3600_000).toISOString();
    const to = new Date(Date.parse(`${addDays(end, 1)}T00:00:00Z`) + 14 * 3600_000).toISOString();
    const events = await selectAll<RevenueEvent>(() =>
      db()
        .from('subscription_events')
        .select('id, user_id, type, store, environment, event_timestamp, raw')
        .eq('environment', 'PRODUCTION')
        .gte('event_timestamp', from)
        .lt('event_timestamp', to)
        .order('id', { ascending: true })
    );
    const verdicts = includeTest ? null : await AdsReportService.classifyUsers(events.map((e) => e.user_id).filter((v): v is string => !!v));
    const out = new Map<string, SubscriptionDay>();
    for (const e of dedupeEvents(events).events) {
      if (verdicts && e.user_id && verdicts.get(e.user_id)?.testReason) continue;
      const c = classifyEvent(e);
      if (!c.net || !e.event_timestamp) continue;
      const day = ymdInTz(e.event_timestamp, timeZone);
      if (day < start || day > end) continue;
      const gross = c.kind === 'refund' ? -c.grossUsd : c.grossUsd;
      const prev = out.get(day) ?? { net: 0, gross: 0, charges: 0 };
      out.set(day, { net: round2(prev.net + c.net), gross: round2(prev.gross + gross), charges: prev.charges + (c.kind === 'charge' ? 1 : 0) });
    }
    return out;
  }

  static async report(range: RangeQuery, platform: RevenuePlatform | null = null): Promise<AdsRevenueReport> {
    const todayPt = todayInTz(ADMOB_REPORT_TIME_ZONE, range.now ?? new Date());
    // Ad revenue and DAU are read through today so the per-channel allocation
    // covers the same "to date" window as subscription revenue to date.
    const windowEnd = todayPt > range.end ? todayPt : range.end;

    const [revenueAll, userDaysAll, status, metricRows, entities, cohortResult, conversionRows, subsDetail] = await Promise.all([
      this.loadRevenue(range.start, windowEnd),
      this.loadUserDays(range.start, windowEnd, { includeTest: range.includeTest }),
      AdRevenueSyncService.status(),
      AdsReportService.loadMetrics(range.start, range.end),
      AdsReportService.loadEntities(),
      AdsReportService.reportCohort(range),
      AdsReportService.loadConversions(range.start, range.end),
      this.subscriptionRevenueByDay(range.start, range.end, range.timeZone, range.includeTest),
    ]);
    const subsByDay = new Map([...subsDetail].map(([day, v]) => [day, v.net]));

    const byPlatformFilter = <T extends { platform: string }>(rows: T[]) => (platform ? rows.filter((r) => r.platform === platform) : rows);
    const revenueWindow = byPlatformFilter(revenueAll);
    const userDaysWindow = byPlatformFilter(userDaysAll);
    const inRange = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date >= range.start && r.date <= range.end);
    const revenue = inRange(revenueWindow);
    const userDays = inRange(userDaysWindow);
    const dau = dauByDay(userDays);

    // Totals and breakdowns (range only).
    const totalsRange = rangeArpdau(revenue, dau);
    const totals = { ...sumRevenue(revenue), avgDau: totalsRange.avgDau, arpdau: totalsRange.arpdau, userDays: totalsRange.userDays };
    const byPlatform = groupRevenue(revenue, 'platform').map((s) => {
      const r = rangeArpdau(revenue, dau, s.key);
      return { ...s, avgDau: r.avgDau, arpdau: r.arpdau };
    });

    const adConnected = status.configured || revenueAll.length > 0;

    // Revenue vs spend per day.
    const spendByDay = new Map<string, number>();
    for (const r of metricRows) if (r.level === 'campaign') spendByDay.set(r.date, round2((spendByDay.get(r.date) ?? 0) + (Number(r.spend) || 0)));
    const days = revenueDays(range.start, range.end, { revenueRows: revenue, dau, subscriptionByDay: platform ? new Map() : subsByDay, spendByDay: platform ? new Map() : spendByDay, adConnected });

    // Returns per paid channel (cohort basis).
    const { cohort, excluded } = cohortResult;
    const input: SliceInput = { metricRows, entities, cohort, conversionRows, rangeEnd: range.end, today: range.today };
    const channelRows = buildRows('channel', input);
    // Channel returns are never platform-filtered: allocate over every platform.
    const arpdauWindow = arpdauByDay(revenueAll, dauByDay(userDaysAll));

    const cohortByChannel = new Map<string, string[]>();
    for (const u of cohort) {
      const ch = effectiveAttribution(u)?.channel;
      if (!ch || !(AD_CHANNELS as string[]).includes(ch)) continue;
      cohortByChannel.set(ch, [...(cohortByChannel.get(ch) ?? []), u.userId]);
    }
    const paidIds = new Set([...cohortByChannel.values()].flat());
    const signupDay = new Map(cohort.map((u) => [u.userId, ymdInTz(u.signupAt, ADMOB_REPORT_TIME_ZONE)]));
    // Active days of paid cohort users from their sign-up day through today.
    const allocation = allocateAdRevenue(
      userDaysAll.filter((d) => paidIds.has(d.userId) && d.date >= (signupDay.get(d.userId) ?? '9999')),
      arpdauWindow
    );

    const toReturn = (channel: AdChannel | 'total', label: string, m: AdsMetrics, ids: string[]): ChannelReturn => {
      const ad = adConnected ? round2(ids.reduce((s, id) => s + (allocation.get(id) ?? 0), 0)) : null;
      const total = round2(m.revenueToDate + (ad ?? 0));
      return {
        channel,
        label,
        spend: m.spend,
        impressions: m.impressions,
        taps: m.taps,
        installs: m.installs,
        ttr: m.ttr,
        conversionRate: m.conversionRate,
        cpi: m.cpi,
        users: m.users,
        activated: m.activated,
        trials: m.trials,
        payers: m.payers,
        costPerSignUp: m.costPerUser,
        costPerActivated: m.costPerActivated,
        costPerTrial: m.costPerTrial,
        costPerPayer: m.costPerPayer,
        subscriptionRevenue: m.revenueToDate,
        adRevenue: ad,
        totalRevenue: total,
        roasSubscriptions: m.roasToDate,
        roas: ratio(total, m.spend),
      };
    };
    const rows = channelRows
      .filter((r) => r.channel && (AD_CHANNELS as string[]).includes(r.channel) && (r.metrics.spend > 0 || r.metrics.users > 0))
      .map((r) => toReturn(r.channel as AdChannel, CHANNEL_LABEL[r.channel as AdChannel], r.metrics, cohortByChannel.get(r.channel as string) ?? []))
      .sort((a, b) => b.spend - a.spend);
    const paid = toReturn('total', 'All paid channels', buildTotals(input).metrics, [...paidIds]);

    const spendRange = round2([...spendByDay.values()].reduce((s, v) => s + v, 0));
    const subsRange = round2([...subsByDay.values()].reduce((s, v) => s + v, 0));
    const subsGrossRange = round2([...subsDetail.values()].reduce((s, v) => s + v.gross, 0));
    const subsCharges = [...subsDetail.values()].reduce((s, v) => s + v.charges, 0);
    const adRange = round2(sumRevenue(inRange(revenueAll)).earnings);
    const blended: BlendedReturn = {
      spend: spendRange,
      adRevenue: adConnected ? adRange : null,
      subscriptionRevenue: subsRange,
      subscriptionGross: subsGrossRange,
      subscriptionCharges: subsCharges,
      totalRevenue: round2(adRange + subsRange),
      roas: ratio(adRange + subsRange, spendRange),
    };

    const dates = revenue.map((r) => r.date).sort();
    const notes: string[] = [
      'AdMob earnings are estimates; AdMob revises them for a few days and finalises the month after it closes (AdMob → Payments).',
      `AdMob days are Pacific (${ADMOB_REPORT_TIME_ZONE}) — the only report time zone its API accepts. Spend, sign-ups and subscription revenue use ${range.timeZone}, so a day's ad revenue and spend are offset by 3 hours.`,
      'DAU counts signed-in, non-test users whose app loaded the Home feed (home_feed_decisions, kept 90 days). Ads show only on Home, so this is the audience that can see them.',
      'Per-channel ad revenue is an allocation (active days × platform ARPDAU), not a measurement: AdMob does not report revenue per user.',
    ];
    if (!status.configured) notes.unshift('AdMob is not connected yet (ADMOB_OAUTH_* env vars missing). Ad revenue shows as — until the first sync.');
    if (platform) notes.push(`Filtered to ${platform === 'ios' ? 'iOS' : 'Android'}: ad revenue, DAU and breakdowns are for that platform only; spend and subscription revenue are hidden from the daily chart, and channel returns stay all-platform.`);

    return {
      range: { start: range.start, end: range.end, timeZone: range.timeZone },
      adRevenueTimeZone: ADMOB_REPORT_TIME_ZONE,
      platform,
      source: { ...status, rowsInRange: revenue.length, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null },
      estimated: true,
      totals,
      byPlatform,
      byAdUnit: groupRevenue(revenue, 'ad_unit'),
      byCountry: groupRevenue(revenue, 'country'),
      byFormat: groupRevenue(revenue, 'format'),
      days,
      returns: { rows, paid, blended },
      excludedUsers: excluded,
      notes,
      definitions: REVENUE_DEFINITIONS,
    };
  }
}
