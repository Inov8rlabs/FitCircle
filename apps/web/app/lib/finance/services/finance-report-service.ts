/**
 * GET /api/admin/finance/ai-costs and /api/admin/finance/pnl: loads data (read-only) and hands it to
 * the pure builders in lib/finance (ai-costs.ts, pnl.ts).
 */
import { CampaignError } from '@/lib/campaigns/http';

import { reportTimeZone } from '../../ads/config';
import { diffDays, isYmd, todayInTz, ymdInTz } from '../../ads/dates';
import { AdRevenueReportService } from '../../ads/services/ad-revenue-report-service';
import { AdRevenueSyncService } from '../../ads/services/ad-revenue-sync-service';
import { AdsReportService } from '../../ads/services/report-service';
import { isUuid } from '../../ai/usage';
import { activeUsersByDay, buildAiCostsReport, isEvalUser } from '../ai-costs';
import { buildPnlReport, PNL_GRAINS } from '../pnl';
import { cashByDayAndPlan, netByUserAndPlan, recurringAsOf } from '../recurring';
import { eventsByUser, firstPaidAt, segmentFromEvents } from '../segments';
import type { AiCostsReport, GatewayDailyRow, PnlGrain, PnlReport, Segment } from '../types';

import { anyTzBounds, FinanceData, utcBounds } from './finance-data';

/** First day FitCircle was live with paid acquisition (default range start). */
export const FINANCE_LAUNCH_DATE = '2026-10-24';
const MAX_RANGE_DAYS = 400;

export interface FinanceRange {
  start: string;
  end: string;
  timeZone: string;
  includeTest: boolean;
  now: Date;
}

export function parseFinanceRange(params: URLSearchParams, now = new Date()): FinanceRange {
  const timeZone = reportTimeZone();
  const today = todayInTz(timeZone, now);
  const start = params.get('start') ?? FINANCE_LAUNCH_DATE;
  const end = params.get('end') ?? today;
  if (!isYmd(start) || !isYmd(end)) throw new CampaignError(400, 'VALIDATION_ERROR', 'start and end must be YYYY-MM-DD');
  if (start > end) throw new CampaignError(400, 'VALIDATION_ERROR', 'start must be on or before end');
  if (diffDays(start, end) > MAX_RANGE_DAYS) throw new CampaignError(400, 'VALIDATION_ERROR', `Range is limited to ${MAX_RANGE_DAYS} days`);
  const inc = (params.get('includeTest') ?? '').toLowerCase();
  return { start, end, timeZone, includeTest: inc === '1' || inc === 'true', now };
}

export function parseGrain(v: string | null): PnlGrain {
  if (!v) return 'day';
  if (!(PNL_GRAINS as string[]).includes(v)) throw new CampaignError(400, 'VALIDATION_ERROR', `grain must be one of ${PNL_GRAINS.join(', ')}`);
  return v as PnlGrain;
}

/** Replaces the synced gateway data (one-off checks before migration 134 is applied). */
export interface GatewayOverride {
  rows: GatewayDailyRow[];
  creditsBalance?: number | null;
  note?: string;
}

const EVAL_IDS_ENV = () =>
  (process.env.FINANCE_EVAL_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export class FinanceReportService {
  static async aiCosts(range: FinanceRange, override?: GatewayOverride): Promise<AiCostsReport> {
    const { from, to } = utcBounds(range.start, range.end);
    const [gateway, ledger, activity, meta, events] = await Promise.all([
      override ? Promise.resolve({ rows: override.rows, note: override.note ?? null }) : FinanceData.gatewayRows(range.start, range.end),
      FinanceData.ledger(range.start, range.end),
      FinanceData.activity(from, to),
      FinanceData.meta(),
      FinanceData.productionEvents(),
    ]);
    const byUser = eventsByUser(events);
    const ids = new Set<string>();
    for (const r of gateway.rows) if (r.dimension === 'user' && isUuid(r.key)) ids.add(r.key);
    for (const r of ledger.rows) if (r.userId) ids.add(r.userId);
    for (const a of activity.rows) ids.add(a.userId);
    for (const id of byUser.keys()) ids.add(id);
    const users = await FinanceData.users([...ids]);

    // Segment as of the end of the range (or now, if earlier).
    const asOf = Math.min(range.now.getTime(), Date.parse(to));
    const segments = new Map<string, Segment>();
    for (const [id, evs] of byUser) segments.set(id, segmentFromEvents(evs, asOf));

    // Net subscription revenue booked in the range (report time zone) per user and plan (the
    // builder drops test users unless includeTest).
    const revenueByUser = netByUserAndPlan(events, (iso) => ymdInTz(iso, range.timeZone), (d) => d >= range.start && d <= range.end);

    const notes = [gateway.note, ledger.note, activity.note].filter((n): n is string => !!n);
    return buildAiCostsReport({
      range: { start: range.start, end: range.end, timeZone: range.timeZone },
      includeTest: range.includeTest,
      now: range.now,
      gatewayRows: gateway.rows,
      ledger: ledger.rows,
      users,
      activity: activity.rows,
      segments,
      revenueByUser,
      lastSyncAt: override ? null : meta.lastSyncAt,
      creditsBalance: override ? override.creditsBalance ?? null : meta.creditsBalance,
      ledgerSince: meta.ledgerSince,
      notes,
      evalUserIds: EVAL_IDS_ENV(),
    });
  }

  static async pnl(range: FinanceRange, grain: PnlGrain, override?: GatewayOverride): Promise<PnlReport> {
    const wide = anyTzBounds(range.start, range.end);
    const [subs, adRows, adStatus, metricRows, aiReport, events, signups, activity] = await Promise.all([
      AdRevenueReportService.subscriptionRevenueByDay(range.start, range.end, range.timeZone, false),
      AdRevenueReportService.loadRevenue(range.start, range.end),
      AdRevenueSyncService.status(),
      AdsReportService.loadMetrics(range.start, range.end),
      this.aiCosts({ ...range, includeTest: false }, override),
      FinanceData.productionEvents(),
      FinanceData.signups(wide.from, wide.to),
      FinanceData.activity(wide.from, wide.to),
    ]);

    const adConnected = adStatus.configured || adRows.length > 0;
    const adRevenue = adConnected ? new Map<string, number>() : null;
    if (adRevenue) for (const r of adRows) adRevenue.set(r.date, (adRevenue.get(r.date) ?? 0) + (Number(r.estimated_earnings) || 0));

    const ua = metricRows.filter((r) => r.level === 'campaign').map((r) => ({ date: r.date, channel: r.channel, spend: Number(r.spend) || 0 }));

    const newUsers = new Map<string, number>();
    for (const u of signups) {
      if (u.testReason || !u.createdAt) continue;
      const day = ymdInTz(u.createdAt, range.timeZone);
      if (day < range.start || day > range.end) continue;
      newUsers.set(day, (newUsers.get(day) ?? 0) + 1);
    }

    const byUser = eventsByUser(events);
    const payerUsers = await FinanceData.users([...byUser.keys()]);
    const newPayers = new Map<string, number>();
    for (const [id, evs] of byUser) {
      if (payerUsers.get(id)?.testReason) continue;
      const t = firstPaidAt(evs);
      if (t === null) continue;
      const day = ymdInTz(new Date(t), range.timeZone);
      if (day < range.start || day > range.end) continue;
      newPayers.set(day, (newPayers.get(day) ?? 0) + 1);
    }

    const activityUsers = await FinanceData.users([...new Set(activity.rows.map((a) => a.userId))]);
    const evalIds = EVAL_IDS_ENV();
    const dauSets = activeUsersByDay(activity.rows, range.timeZone, (id) => !isEvalUser(id, evalIds) && !activityUsers.get(id)?.testReason);
    const dau = new Map([...dauSets].filter(([d]) => d >= range.start && d <= range.end).map(([d, s]) => [d, s.size]));

    // Same rule as subscriptionRevenueByDay: events without a user still count; test users do not.
    const includeReal = (id: string | null) => !id || (!payerUsers.get(id)?.testReason && !isEvalUser(id, evalIds));
    const cash = cashByDayAndPlan(events, (iso) => ymdInTz(iso, range.timeZone), includeReal);

    const notes: string[] = [];
    if (activity.note) notes.push(activity.note);
    // byPlan must add up to the subscription lines (same events, same rules); say so if not.
    let planNet = 0;
    for (const [d, v] of cash) if (d >= range.start && d <= range.end) for (const m of v.byPlan.values()) planNet += m.net;
    const subsNet = [...subs.values()].reduce((s, v) => s + v.net, 0);
    if (Math.abs(planNet - subsNet) > 0.005) notes.push(`Revenue by plan (${planNet.toFixed(2)}) differs from subscription net (${subsNet.toFixed(2)}); check duplicate or user-less events.`);
    for (const n of aiReport.notes) if (/not available|no synced gateway data|ledger/i.test(n)) notes.push(`AI: ${n}`);
    return buildPnlReport({
      range: { start: range.start, end: range.end, timeZone: range.timeZone },
      grain,
      now: range.now,
      subscriptions: subs,
      adRevenue,
      ua,
      ai: aiReport.byDay,
      newUsers,
      newPayers,
      dau,
      cash,
      recurringAt: (at) => recurringAsOf(byUser, at, (id) => includeReal(id)),
      notes,
    });
  }
}
