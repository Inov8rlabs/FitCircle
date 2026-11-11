/**
 * Twice-daily ads performance email (cron /api/cron/ads/report). Pure: takes
 * already-loaded ad delivery, sync state and the sign-up funnel, returns the
 * report model, the alert list and the rendered subject / text / HTML.
 *
 * Data sources, stated in the email itself:
 *  - Delivery (spend, impressions, taps, installs) — ad_metrics_daily, written
 *    by the hourly Ads Console sync from the ad networks (campaign level).
 *  - Funnel — our database: profiles (sign-ups, onboarding), food_log_entries
 *    (first meal), subscription_events (trials / paid, PRODUCTION only) and
 *    user_attribution (which ad brought the user; only app 1.0.9+ reports it).
 * Test / internal / reviewer / Play pre-launch sign-ups are excluded with the
 * Ads Console classifier (lib/ads/test-users.ts).
 */
import { emailBrandHeader } from '../email/brand-shell';

import { type AdRevenueMetrics, type AdRevenueRow, sumRevenue } from './ad-revenue';
import { addDays, ymdInTz } from './dates';
import { ratio, sumDelivery } from './metrics';
import type { TestUserReason } from './test-users';
import { AD_CHANNELS, type AdChannel, type AdEntityRow, type AdMetricRow, type AttributionChannel, CHANNEL_LABEL } from './types';

export type WindowKey = 'today' | 'yesterday' | 'launch';
export const WINDOW_KEYS: WindowKey[] = ['today', 'yesterday', 'launch'];

export interface ReportWindow {
  key: WindowKey;
  label: string;
  /** Inclusive YYYY-MM-DD bounds in the report time zone. */
  start: string;
  end: string;
}

export interface DeliveryStats {
  spend: number;
  impressions: number;
  taps: number;
  installs: number;
  /** Spend ÷ installs. */
  cpi: number | null;
  /** Taps ÷ impressions. */
  ttr: number | null;
  /** Installs ÷ taps. */
  conversionRate: number | null;
}

export interface CampaignReport {
  channel: AdChannel;
  externalId: string;
  name: string;
  platform: string;
  status: string;
  live: boolean;
  startDate: string | null;
  /** Current daily budget from the network (USD), null when unknown. */
  dailyBudget: number | null;
  windows: Record<WindowKey, DeliveryStats>;
}

export interface ChannelNotice {
  channel: AdChannel;
  text: string;
}

/** One real-or-test sign-up with what happened after (as of now). */
export interface FunnelUser {
  userId: string;
  /** Sign-up day in the report time zone. */
  signupDate: string;
  testReason: TestUserReason | null;
  /** ios | android | web | unknown (attribution → push token → home feed request). */
  platform: string;
  onboarded: boolean;
  firstMeal: boolean;
  trial: boolean;
  payer: boolean;
  /** Paid-ad channel from user_attribution (non-test), else null. */
  paidChannel: AttributionChannel | null;
  campaignExternalId: string | null;
}

export interface FunnelStats {
  signups: number;
  byPlatform: Record<string, number>;
  onboarded: number;
  firstMeal: number;
  trials: number;
  payers: number;
  /** Sign-ups whose user_attribution names a paid channel. */
  attributedPaid: number;
  excludedTest: number;
}

export interface SyncState {
  channel: AdChannel;
  configured: boolean;
  lastSuccessAt: string | null;
  lastFinishedAt: string | null;
  lastFinishedOk: boolean | null;
  lastError: string | null;
}

export interface ReportAlert {
  kind: 'no_spend' | 'cpi_spike' | 'sync_stale' | 'sync_error';
  message: string;
}

export interface AdsEmailReport {
  generatedAt: string;
  timeZone: string;
  slot: 'AM' | 'PM';
  /** e.g. "Tue Oct 27". */
  dayLabel: string;
  windows: ReportWindow[];
  campaigns: CampaignReport[];
  notConnected: ChannelNotice[];
  totals: Record<WindowKey, DeliveryStats>;
  funnel: Record<WindowKey, FunnelStats>;
  sync: SyncState[];
  /** Latest successful sync across channels (ISO), i.e. "ad data as of". */
  adDataAsOf: string | null;
  alerts: ReportAlert[];
  consoleUrl: string;
  /** AdMob estimated earnings per window; null when AdMob is not connected and has no rows. */
  adRevenue: AdRevenueEmail | null;
  /** Subscription + ad revenue against paid spend per window; null when subscription revenue was not loaded. */
  revenue: Record<WindowKey, RevenueVsSpend> | null;
  /** Recurring run-rate as of now (lib/finance/recurring.ts, same as the P&L); null when not loaded. */
  recurring: RecurringEmail | null;
}

/** Run-rate (not cash): normalized MRR / ARR from active paid subscriptions. */
export interface RecurringEmail {
  mrr: { gross: number; net: number };
  arr: { gross: number; net: number };
  annualCommitted: { gross: number; net: number };
  activePaidSubs: { monthly: number; annual_upfront: number; annual_installments: number; other: number; total: number };
  trialsActive: number;
}

/** Subscription day totals (USD, report time zone): net = after store commission and tax. */
export interface SubscriptionDayTotals {
  net: number;
  gross: number;
  charges: number;
}

export interface RevenueVsSpend {
  /** What we keep after store commission and tax, refunds subtracted (all real users, not only ad users). */
  subscriptionNet: number;
  /** What subscribers paid. */
  subscriptionGross: number;
  /** Paid charges (purchases + renewals). */
  subscriptionCharges: number;
  /** AdMob estimated earnings; null when AdMob is not connected. */
  adRevenue: number | null;
  /** subscriptionNet + adRevenue. */
  totalNet: number;
  spend: number;
  /** totalNet ÷ spend. */
  returnOnSpend: number | null;
}

export interface AdRevenueEmail {
  windows: Record<WindowKey, AdRevenueMetrics>;
  lastSuccessAt: string | null;
}

export interface BuildReportInput {
  now: Date;
  timeZone: string;
  consoleUrl: string;
  /** Campaign-level ad_entities rows. */
  entities: AdEntityRow[];
  /** ad_metrics_daily rows (any level; only campaign level is used) covering launch … today. */
  metricRows: AdMetricRow[];
  sync: SyncState[];
  /** Everyone who signed up launch … today (test users included; they are counted separately). */
  users: FunnelUser[];
  launchDate: string;
  /** ad_revenue_daily rows launch … today (Pacific days); omit/null when AdMob is not connected. */
  adRevenue?: { rows: AdRevenueRow[]; lastSuccessAt: string | null } | null;
  /** Subscription revenue per report-time-zone day (PRODUCTION, real users) launch … today; omit when not loaded. */
  subscriptionByDay?: Map<string, SubscriptionDayTotals> | null;
  recurring?: RecurringEmail | null;
}

export const STALE_SYNC_MS = 3 * 3600_000;
const CPI_SPIKE_FACTOR = 2;
const LIVE_STATUSES = new Set(['ENABLED', 'ACTIVE']);
const SERVING_OK = new Set(['RUNNING', 'ACTIVE', 'SERVING']); // Apple, Meta, Google

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** Today (so far), yesterday, and launch … today, as report-time-zone dates. */
export function reportWindows(now: Date, timeZone: string, launchDate: string): ReportWindow[] {
  const today = ymdInTz(now, timeZone);
  const yesterday = addDays(today, -1);
  const launch = launchDate <= today ? launchDate : today;
  return [
    { key: 'today', label: 'Today (so far)', start: today, end: today },
    { key: 'yesterday', label: 'Yesterday', start: yesterday, end: yesterday },
    { key: 'launch', label: `Since launch (${launch})`, start: launch, end: today },
  ];
}

/** Hour of `now` in the time zone (0–23). */
export function hourInTz(now: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now);
  return Number(h) % 24;
}

/**
 * Program launch: the earliest start day of a paid campaign that is live or
 * has spent, else the first day with spend, else today.
 */
export function launchDateFrom(entities: AdEntityRow[], metricRows: AdMetricRow[], timeZone: string, today: string, now: Date = new Date()): string {
  const spent = new Set(metricRows.filter((r) => r.level === 'campaign' && Number(r.spend) > 0).map((r) => `${r.channel}:${r.external_id}`));
  const starts = entities
    .filter((e) => e.level === 'campaign' && e.start_at && (isLive(e, now) || spent.has(`${e.channel}:${e.external_id}`)))
    .map((e) => ymdInTz(e.start_at!, timeZone));
  const firstSpend = metricRows.filter((r) => r.level === 'campaign' && Number(r.spend) > 0).map((r) => r.date);
  const candidates = [...starts, ...firstSpend].filter((d) => d <= today).sort();
  return candidates[0] ?? today;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function isLive(e: Pick<AdEntityRow, 'status' | 'serving_status' | 'end_at'>, now: Date): boolean {
  if (!LIVE_STATUSES.has(String(e.status ?? '').toUpperCase())) return false;
  if (e.serving_status && !SERVING_OK.has(String(e.serving_status).toUpperCase())) return false;
  if (e.end_at && Date.parse(e.end_at) <= now.getTime()) return false;
  return true;
}

export function deliveryStats(rows: Array<Pick<AdMetricRow, 'spend' | 'currency' | 'impressions' | 'taps' | 'installs'>>): DeliveryStats {
  const d = sumDelivery(rows);
  return {
    spend: d.spend,
    impressions: d.impressions,
    taps: d.taps,
    installs: d.installs,
    cpi: ratio(d.spend, d.installs),
    ttr: ratio(d.taps, d.impressions),
    conversionRate: ratio(d.installs, d.taps),
  };
}

const inWindow = (date: string, w: ReportWindow) => date >= w.start && date <= w.end;

export function funnelStats(users: FunnelUser[], w: ReportWindow): FunnelStats {
  const inRange = users.filter((u) => inWindow(u.signupDate, w));
  const real = inRange.filter((u) => !u.testReason);
  const byPlatform: Record<string, number> = {};
  for (const u of real) byPlatform[u.platform] = (byPlatform[u.platform] ?? 0) + 1;
  return {
    signups: real.length,
    byPlatform,
    onboarded: real.filter((u) => u.onboarded).length,
    firstMeal: real.filter((u) => u.firstMeal).length,
    trials: real.filter((u) => u.trial).length,
    payers: real.filter((u) => u.payer).length,
    attributedPaid: real.filter((u) => u.paidChannel && (AD_CHANNELS as string[]).includes(u.paidChannel)).length,
    excludedTest: inRange.length - real.length,
  };
}

export function buildAdsEmailReport(input: BuildReportInput): AdsEmailReport {
  const { now, timeZone } = input;
  const windows = reportWindows(now, timeZone, input.launchDate);
  const byKey = Object.fromEntries(windows.map((w) => [w.key, w])) as Record<WindowKey, ReportWindow>;
  const campaignRows = input.metricRows.filter((r) => r.level === 'campaign');

  // Every campaign that is live or delivered anything since launch.
  const keys = new Map<string, { channel: AdChannel; externalId: string; entity: AdEntityRow | null }>();
  for (const e of input.entities) {
    if (e.level !== 'campaign') continue;
    const delivered = campaignRows.some((r) => r.channel === e.channel && r.external_id === e.external_id && inWindow(r.date, byKey.launch) && (Number(r.spend) > 0 || Number(r.installs) > 0));
    if (isLive(e, now) || delivered) keys.set(`${e.channel}:${e.external_id}`, { channel: e.channel, externalId: e.external_id, entity: e });
  }
  for (const r of campaignRows) {
    const k = `${r.channel}:${r.external_id}`;
    if (!keys.has(k) && inWindow(r.date, byKey.launch) && Number(r.spend) > 0) keys.set(k, { channel: r.channel, externalId: r.external_id, entity: null });
  }

  const campaigns: CampaignReport[] = [...keys.values()].map(({ channel, externalId, entity }) => {
    const rows = campaignRows.filter((r) => r.channel === channel && r.external_id === externalId);
    const statsFor = (w: ReportWindow) => deliveryStats(rows.filter((r) => inWindow(r.date, w)));
    return {
      channel,
      externalId,
      name: entity?.name ?? `#${externalId}`,
      platform: entity?.platform ?? (channel === 'apple_ads' ? 'ios' : 'android'),
      status: entity ? [entity.status, entity.serving_status].filter(Boolean).join(' / ') || 'unknown' : 'not in entities',
      live: entity ? isLive(entity, now) : false,
      startDate: entity?.start_at ? ymdInTz(entity.start_at, timeZone) : null,
      dailyBudget: entity && entity.daily_budget !== null && entity.daily_budget !== '' && Number.isFinite(Number(entity.daily_budget)) ? Number(entity.daily_budget) : null,
      windows: { today: statsFor(byKey.today), yesterday: statsFor(byKey.yesterday), launch: statsFor(byKey.launch) },
    };
  });
  campaigns.sort((a, b) => b.windows.launch.spend - a.windows.launch.spend || a.name.localeCompare(b.name));

  const campaignKeys = new Set(campaigns.map((c) => `${c.channel}:${c.externalId}`));
  const totalRows = (w: ReportWindow) => campaignRows.filter((r) => campaignKeys.has(`${r.channel}:${r.external_id}`) && inWindow(r.date, w));
  const totals = { today: deliveryStats(totalRows(byKey.today)), yesterday: deliveryStats(totalRows(byKey.yesterday)), launch: deliveryStats(totalRows(byKey.launch)) };

  const notConnected: ChannelNotice[] = [];
  for (const channel of AD_CHANNELS) {
    if (campaigns.some((c) => c.channel === channel)) continue;
    const s = input.sync.find((x) => x.channel === channel);
    if (channel === 'google_ads') {
      if (!s?.configured) notConnected.push({ channel, text: 'Google Ads (Android): not configured (GOOGLE_ADS_SA_KEY missing)' });
      else if (!s.lastSuccessAt) notConnected.push({ channel, text: 'Google Ads (Android): connected, awaiting first successful sync' });
      else notConnected.push({ channel, text: 'Google Ads (Android): connected, awaiting data (no live campaigns or spend since launch)' });
    } else if (!s?.configured) notConnected.push({ channel, text: `${CHANNEL_LABEL[channel]}: not connected (no API credentials configured)` });
    else notConnected.push({ channel, text: `${CHANNEL_LABEL[channel]}: connected, no live campaigns or spend since launch` });
  }

  const funnel = { today: funnelStats(input.users, byKey.today), yesterday: funnelStats(input.users, byKey.yesterday), launch: funnelStats(input.users, byKey.launch) };
  const successes = input.sync.map((s) => s.lastSuccessAt).filter((v): v is string => !!v).sort();

  const report: AdsEmailReport = {
    generatedAt: now.toISOString(),
    timeZone,
    slot: hourInTz(now, timeZone) < 12 ? 'AM' : 'PM',
    dayLabel: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(now).replace(',', ''),
    windows,
    campaigns,
    notConnected,
    totals,
    funnel,
    sync: input.sync,
    adDataAsOf: successes[successes.length - 1] ?? null,
    alerts: [],
    consoleUrl: input.consoleUrl,
    adRevenue: input.adRevenue
      ? {
          // AdMob days are Pacific; the windows use the same calendar dates.
          windows: {
            today: sumRevenue(input.adRevenue.rows.filter((r) => inWindow(r.date, byKey.today))),
            yesterday: sumRevenue(input.adRevenue.rows.filter((r) => inWindow(r.date, byKey.yesterday))),
            launch: sumRevenue(input.adRevenue.rows.filter((r) => inWindow(r.date, byKey.launch))),
          },
          lastSuccessAt: input.adRevenue.lastSuccessAt,
        }
      : null,
    revenue: null,
    recurring: input.recurring ?? null,
  };
  if (input.subscriptionByDay) {
    const subs = input.subscriptionByDay;
    const revenueFor = (key: WindowKey): RevenueVsSpend => {
      const w = byKey[key];
      let net = 0;
      let gross = 0;
      let charges = 0;
      for (const [day, v] of subs) {
        if (!inWindow(day, w)) continue;
        net += v.net;
        gross += v.gross;
        charges += v.charges;
      }
      const ad = report.adRevenue ? report.adRevenue.windows[key].earnings : null;
      const totalNet = round2(net + (ad ?? 0));
      return {
        subscriptionNet: round2(net),
        subscriptionGross: round2(gross),
        subscriptionCharges: charges,
        adRevenue: ad,
        totalNet,
        spend: totals[key].spend,
        returnOnSpend: ratio(totalNet, totals[key].spend),
      };
    };
    report.revenue = { today: revenueFor('today'), yesterday: revenueFor('yesterday'), launch: revenueFor('launch') };
  }
  report.alerts = buildAlerts(report, input.entities, now);
  return report;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export function buildAlerts(report: Pick<AdsEmailReport, 'campaigns' | 'sync' | 'timeZone'>, entities: AdEntityRow[], now: Date): ReportAlert[] {
  const alerts: ReportAlert[] = [];
  const label = (c: CampaignReport) => `${CHANNEL_LABEL[c.channel]} · ${c.name}`;

  for (const s of report.sync) {
    if (!s.configured) continue;
    if (s.lastFinishedOk === false) {
      alerts.push({ kind: 'sync_error', message: `${CHANNEL_LABEL[s.channel]} sync is failing: ${(s.lastError ?? 'unknown error').slice(0, 200)}` });
    }
    const last = s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : NaN;
    if (!Number.isFinite(last)) {
      alerts.push({ kind: 'sync_stale', message: `${CHANNEL_LABEL[s.channel]} has never synced successfully — ad numbers below are missing` });
    } else if (now.getTime() - last > STALE_SYNC_MS) {
      const hours = Math.floor((now.getTime() - last) / 3600_000);
      alerts.push({ kind: 'sync_stale', message: `${CHANNEL_LABEL[s.channel]} data is stale: last successful sync ${hours} h ago (${fmtTime(s.lastSuccessAt!, report.timeZone)})` });
    }
  }

  for (const c of report.campaigns) {
    // Day-granular data: "no spend yesterday or today so far" means no spend for ≥ 24 h.
    const entity = entities.find((e) => e.level === 'campaign' && e.channel === c.channel && e.external_id === c.externalId);
    const startedMs = entity?.start_at ? Date.parse(entity.start_at) : NaN;
    const runningLongEnough = !Number.isFinite(startedMs) || now.getTime() - startedMs >= 24 * 3600_000;
    if (c.live && runningLongEnough && c.windows.yesterday.spend === 0 && c.windows.today.spend === 0) {
      alerts.push({ kind: 'no_spend', message: `${label(c)} is live but spent $0 yesterday and today so far (no spend in the last 24 h+) — check budget, bids and serving status` });
    }

    const base = c.windows.launch.cpi;
    const y = c.windows.yesterday;
    if (base !== null && y.spend > 0) {
      if (y.cpi !== null && y.cpi > CPI_SPIKE_FACTOR * base) {
        alerts.push({ kind: 'cpi_spike', message: `${label(c)}: yesterday's CPI ${money(y.cpi)} is more than 2× the since-launch CPI ${money(base)}` });
      } else if (y.cpi === null && y.spend > CPI_SPIKE_FACTOR * base) {
        alerts.push({ kind: 'cpi_spike', message: `${label(c)}: spent ${money(y.spend)} yesterday with 0 installs (since-launch CPI ${money(base)})` });
      }
    }
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

export const money = (n: number | null) => (n === null ? '—' : `$${n.toFixed(2)}`);
export const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
const int = (n: number) => n.toLocaleString('en-US');

function fmtTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}

const PLATFORM_LABEL: Record<string, string> = { ios: 'iOS', android: 'Android', web: 'Web', unknown: 'unknown' };
const PLATFORM_ORDER = ['ios', 'android', 'web', 'unknown'];

function platformSplit(f: FunnelStats): string {
  const keys = Object.keys(f.byPlatform).sort((a, b) => (PLATFORM_ORDER.indexOf(a) + 99) % 99 - ((PLATFORM_ORDER.indexOf(b) + 99) % 99) || a.localeCompare(b));
  if (!keys.length) return '—';
  return keys.map((k) => `${PLATFORM_LABEL[k] ?? k} ${f.byPlatform[k]}`).join(', ');
}

/** The subject's headline window: AM → yesterday (a full day), PM → today so far. */
function headline(r: AdsEmailReport): { key: WindowKey; word: string } {
  return r.slot === 'AM' ? { key: 'yesterday', word: 'yesterday' } : { key: 'today', word: 'today' };
}

export function renderSubject(r: AdsEmailReport): string {
  const h = headline(r);
  const t = r.totals[h.key];
  const alerts = r.alerts.length ? ` [${r.alerts.length} alert${r.alerts.length === 1 ? '' : 's'}]` : '';
  const rev = r.revenue ? `, ${money(r.revenue[h.key].totalNet)} revenue` : '';
  return `FitCircle ads — ${r.dayLabel} ${r.slot}: ${money(t.spend)} spend, ${int(t.installs)} install${t.installs === 1 ? '' : 's'}${rev} ${h.word}${alerts}`;
}

const DELIVERY_ROWS: Array<[string, (s: DeliveryStats) => string]> = [
  ['Spend', (s) => money(s.spend)],
  ['Impressions', (s) => int(s.impressions)],
  ['Taps', (s) => int(s.taps)],
  ['Installs', (s) => int(s.installs)],
  ['CPI', (s) => money(s.cpi)],
  ['TTR (taps/impr.)', (s) => pct(s.ttr)],
  ['Conv. (installs/taps)', (s) => pct(s.conversionRate)],
];

const FUNNEL_ROWS: Array<[string, (f: FunnelStats) => string]> = [
  ['New real sign-ups (all sources)', (f) => int(f.signups)],
  ['  by platform', platformSplit],
  ['Onboarded', (f) => int(f.onboarded)],
  ['Logged a first meal', (f) => int(f.firstMeal)],
  ['Started a trial', (f) => int(f.trials)],
  ['Paid subscribers', (f) => int(f.payers)],
  ['Attributed to a paid ad (partial)', (f) => int(f.attributedPaid)],
  ['Test/internal sign-ups excluded', (f) => int(f.excludedTest)],
];

const REVENUE_ROWS: Array<[string, (v: RevenueVsSpend) => string]> = [
  ['Subscriptions — net (we keep)', (v) => money(v.subscriptionNet)],
  ['Subscriptions — gross (paid)', (v) => `${money(v.subscriptionGross)} (${int(v.subscriptionCharges)} charge${v.subscriptionCharges === 1 ? '' : 's'})`],
  ['Ads — AdMob (est.)', (v) => money4(v.adRevenue)],
  ['Total revenue (net)', (v) => money4(v.totalNet)],
  ['Paid ad spend', (v) => money(v.spend)],
  ['Revenue ÷ spend', (v) => (v.returnOnSpend === null ? '—' : `${v.returnOnSpend < 0.1 ? v.returnOnSpend.toFixed(4) : v.returnOnSpend.toFixed(2)}×`)],
];

export function recurringLine(r: RecurringEmail): string {
  const s = r.activePaidSubs;
  const plans = [s.monthly ? `${s.monthly} monthly` : '', s.annual_upfront ? `${s.annual_upfront} annual (upfront)` : '', s.annual_installments ? `${s.annual_installments} annual (paid monthly)` : '', s.other ? `${s.other} other` : '']
    .filter(Boolean)
    .join(', ');
  return [
    `MRR ${money(r.mrr.gross)} gross / ${money(r.mrr.net)} net`,
    `ARR ${money(r.arr.gross)} / ${money(r.arr.net)}`,
    `annual committed ${money(r.annualCommitted.gross)} / ${money(r.annualCommitted.net)}`,
    `${int(s.total)} active paid sub${s.total === 1 ? '' : 's'}${plans ? ` (${plans})` : ''}`,
    `${int(r.trialsActive)} active trial${r.trialsActive === 1 ? '' : 's'}`,
  ].join(' · ');
}

const RECURRING_NOTE = 'Run-rate, not cash: MRR = monthly price, annual ÷ 12 (also when paid monthly); ARR = MRR × 12; annual committed = contracted annual value even when paid monthly. Lifetime purchases and trials excluded.';

const REVENUE_NOTE =
  'Subscriptions: RevenueCat production events (App Store, Google Play, web), real users from every source — not only ad users; net is after store commission and tax, refunds subtracted. Spend: all connected ad networks.';

const AD_REVENUE_ROWS: Array<[string, (m: AdRevenueMetrics) => string]> = [
  ['Estimated earnings', (m) => money4(m.earnings)],
  ['Impressions', (m) => int(m.impressions)],
  ['eCPM', (m) => money(m.ecpm)],
  ['Match rate', (m) => pct(m.matchRate)],
  ['Show rate', (m) => pct(m.showRate)],
  ['Clicks (CTR)', (m) => `${int(m.clicks)} (${pct(m.ctr)})`],
];

/** Sub-dollar ad earnings need more than 2 decimals to be readable. */
const money4 = (n: number | null) => (n === null ? '—' : Math.abs(n) < 1 && n !== 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

const AD_REVENUE_NOTE = 'AdMob estimated earnings (not final until AdMob closes the month); AdMob days are Pacific time.';

export const DATA_NOTES = [
  'Ad delivery: ad network reports (Apple Ads and Google Ads APIs) synced hourly into the Ads Console; networks restate the last few days, so today and yesterday can still move.',
  'Funnel: FitCircle database. Sign-ups = new profiles in the window (report time zone), all sources (paid + organic), excluding internal, App Review, Firebase Test Lab, Play pre-launch and Apple mock-attribution accounts. Onboarded / first meal / trial / paid are what those sign-ups have done as of now.',
  'Platform = the platform the user reported attribution from, else their first push token, else their first home-feed request; "unknown" = none yet.',
  '"Attributed to a paid ad" counts user_attribution rows, which only app 1.0.9+ reports — it undercounts. For iOS paid attribution today, Amplitude (user property asa_campaign_id) is the reference; it is not queried here.',
  'Installs are the network\'s count and are not de-duplicated against our sign-ups.',
];

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function textTable<T>(rows: Array<[string, (v: T) => string]>, cols: Array<{ head: string; value: T }>): string {
  const lw = Math.max(...rows.map((r) => r[0].length), 6) + 2;
  const cells = rows.map(([, f]) => cols.map((c) => f(c.value)));
  const cw = cols.map((c, i) => Math.max(c.head.length, ...cells.map((r) => r[i].length)) + 2);
  const head = pad('', lw) + cols.map((c, i) => pad(c.head, cw[i])).join('');
  const body = rows.map(([label], ri) => pad(label, lw) + cells[ri].map((v, i) => pad(v, cw[i])).join(''));
  return [head, ...body].map((l) => l.trimEnd()).join('\n');
}

const budgetLabel = (c: CampaignReport) => (c.dailyBudget === null ? '' : `, budget ${money(c.dailyBudget)}/day`);

const windowCols = <T>(r: AdsEmailReport, pick: (k: WindowKey) => T) => r.windows.map((w) => ({ head: w.key === 'launch' ? `Since ${w.start}` : w.label, value: pick(w.key) }));

export function renderText(r: AdsEmailReport): string {
  const out: string[] = [];
  out.push(`FitCircle ads report — ${r.dayLabel} ${r.slot}`);
  out.push(`Time zone: ${r.timeZone}. Generated ${fmtTime(r.generatedAt, r.timeZone)}. Ad data as of last sync: ${r.adDataAsOf ? fmtTime(r.adDataAsOf, r.timeZone) : 'never'}.`);
  out.push('');
  if (r.alerts.length) {
    out.push('ALERTS');
    for (const a of r.alerts) out.push(`  ! ${a.message}`);
    out.push('');
  }
  if (r.revenue) {
    out.push('REVENUE vs SPEND');
    out.push(textTable(REVENUE_ROWS, windowCols(r, (k) => r.revenue![k])));
    out.push(`  ${REVENUE_NOTE}`);
    if (r.recurring) {
      out.push(`  Run-rate now: ${recurringLine(r.recurring)}`);
      out.push(`  ${RECURRING_NOTE}`);
    }
    out.push('');
  }
  out.push('SPEND — all connected paid channels');
  out.push(textTable(DELIVERY_ROWS, windowCols(r, (k) => r.totals[k])));
  out.push('');
  for (const c of r.campaigns) {
    out.push(`${CHANNEL_LABEL[c.channel]} (${PLATFORM_LABEL[c.platform] ?? c.platform}) — ${c.name} [${c.externalId}] — ${c.live ? 'live' : 'not live'} (${c.status})${budgetLabel(c)}${c.startDate ? `, started ${c.startDate}` : ''}`);
    out.push(textTable(DELIVERY_ROWS, windowCols(r, (k) => c.windows[k])));
    out.push('');
  }
  if (!r.campaigns.length) out.push('No live campaigns and no spend since launch.\n');
  for (const n of r.notConnected) out.push(`- ${n.text}`);
  if (r.notConnected.length) out.push('');
  if (r.adRevenue) {
    out.push('AD REVENUE — AdMob (estimated)');
    out.push(textTable(AD_REVENUE_ROWS, windowCols(r, (k) => r.adRevenue!.windows[k])));
    out.push(`  ${AD_REVENUE_NOTE}`);
    out.push('');
  } else {
    out.push('- AdMob ad revenue: not connected (ADMOB_OAUTH_* missing)');
    out.push('');
  }
  out.push('FUNNEL — FitCircle database (all sources, not only ads)');
  out.push(textTable(FUNNEL_ROWS, windowCols(r, (k) => r.funnel[k])));
  out.push('');
  out.push(`Ads Console: ${r.consoleUrl}`);
  out.push('');
  out.push('Data notes:');
  for (const n of DATA_NOTES) out.push(`- ${n}`);
  return out.join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function htmlTable<T>(rows: Array<[string, (v: T) => string]>, cols: Array<{ head: string; value: T }>): string {
  const th = (s: string, left = false) => `<th style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:${left ? 'left' : 'right'};font-weight:600;color:#374151;white-space:nowrap">${esc(s)}</th>`;
  const td = (s: string, left = false) => `<td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:${left ? 'left' : 'right'};color:#111827;white-space:nowrap">${esc(s)}</td>`;
  const head = `<tr>${th('', true)}${cols.map((c) => th(c.head)).join('')}</tr>`;
  const body = rows.map(([label, f]) => `<tr>${td(label.trim(), true)}${cols.map((c) => td(f(c.value))).join('')}</tr>`).join('');
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin:6px 0 18px">${head}${body}</table>`;
}

export function renderHtml(r: AdsEmailReport): string {
  const h2 = (s: string, sub?: string) =>
    `<h2 style="font-size:15px;margin:18px 0 2px;color:#111827">${esc(s)}</h2>${sub ? `<div style="font-size:12px;color:#6b7280">${esc(sub)}</div>` : ''}`;
  const parts: string[] = [];
  // Brand mark: the real app icon + wordmark (lib/email/brand-shell.ts), dark text on this white data layout.
  parts.push(`<div style="margin:0 0 14px">${emailBrandHeader({ onLight: true })}</div>`);
  parts.push(`<h1 style="font-size:18px;margin:0 0 4px;color:#111827">FitCircle ads — ${esc(r.dayLabel)} ${r.slot}</h1>`);
  parts.push(
    `<div style="font-size:12px;color:#6b7280">Time zone ${esc(r.timeZone)} · generated ${esc(fmtTime(r.generatedAt, r.timeZone))} · ad data as of last sync ${esc(r.adDataAsOf ? fmtTime(r.adDataAsOf, r.timeZone) : 'never')}</div>`
  );
  if (r.alerts.length) {
    parts.push(
      `<div style="margin:14px 0;padding:10px 14px;border:1px solid #fca5a5;background:#fef2f2;border-radius:8px"><div style="font-weight:600;color:#b91c1c;margin-bottom:4px">Alerts</div><ul style="margin:0;padding-left:18px;color:#7f1d1d;font-size:13px">${r.alerts
        .map((a) => `<li>${esc(a.message)}</li>`)
        .join('')}</ul></div>`
    );
  }
  if (r.revenue) {
    parts.push(h2('Revenue vs spend', REVENUE_NOTE));
    parts.push(htmlTable(REVENUE_ROWS, windowCols(r, (k) => r.revenue![k])));
    if (r.recurring) {
      parts.push(
        `<div style="font-size:13px;color:#111827;margin:-8px 0 4px"><span style="font-weight:600">Run-rate now:</span> ${esc(recurringLine(r.recurring))}</div><div style="font-size:12px;color:#6b7280;margin:0 0 18px">${esc(RECURRING_NOTE)}</div>`
      );
    }
  }
  parts.push(h2('Spend — all connected paid channels', 'Source: ad network reports (Ads Console sync)'));
  parts.push(htmlTable(DELIVERY_ROWS, windowCols(r, (k) => r.totals[k])));
  for (const c of r.campaigns) {
    parts.push(
      h2(
        `${CHANNEL_LABEL[c.channel]} (${PLATFORM_LABEL[c.platform] ?? c.platform}) — ${c.name}`,
        `Campaign ${c.externalId} · ${c.live ? 'live' : 'not live'} (${c.status})${c.dailyBudget === null ? '' : ` · budget ${money(c.dailyBudget)}/day`}${c.startDate ? ` · started ${c.startDate}` : ''}`
      )
    );
    parts.push(htmlTable(DELIVERY_ROWS, windowCols(r, (k) => c.windows[k])));
  }
  if (!r.campaigns.length) parts.push('<p style="font-size:13px;color:#374151">No live campaigns and no spend since launch.</p>');
  if (r.notConnected.length) parts.push(`<ul style="font-size:13px;color:#6b7280;padding-left:18px">${r.notConnected.map((n) => `<li>${esc(n.text)}</li>`).join('')}</ul>`);
  if (r.adRevenue) {
    parts.push(h2('Ad revenue — AdMob (estimated)', AD_REVENUE_NOTE));
    parts.push(htmlTable(AD_REVENUE_ROWS, windowCols(r, (k) => r.adRevenue!.windows[k])));
  } else {
    parts.push('<p style="font-size:13px;color:#6b7280">AdMob ad revenue: not connected yet.</p>');
  }
  parts.push(h2('Funnel — FitCircle database', 'All sources (paid + organic), real users only; outcomes as of now'));
  parts.push(htmlTable(FUNNEL_ROWS, windowCols(r, (k) => r.funnel[k])));
  parts.push(
    `<p style="margin:16px 0"><a href="${esc(r.consoleUrl)}" style="display:inline-block;padding:10px 16px;border:2px solid #6D28D9;color:#5B21B6;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Open the Ads Console</a></p>`
  );
  parts.push(`<div style="font-size:11px;color:#6b7280"><div style="font-weight:600;margin-bottom:2px">Data notes</div><ul style="margin:0;padding-left:16px">${DATA_NOTES.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"></head><body style="margin:0;padding:20px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><div style="max-width:720px">${parts.join('')}</div></body></html>`;
}
