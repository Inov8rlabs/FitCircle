/**
 * Read side of the ads console (docs/ADS_CONSOLE_SPEC.md §5, §7): loads
 * delivery, entities and the sign-up cohort (profiles.created_at in range,
 * report time zone), joins attribution, activation (food_log_entries /
 * daily_tracking within 7 days) and PRODUCTION subscription_events, then
 * slices with lib/ads/report.ts.
 */
import { CampaignError } from '@/lib/campaigns/http';

import { reportTimeZone, TARGETS, writeEnabled } from '../config';
import { getConnector } from '../connectors';
import { addDays, diffDays, isYmd, todayInTz, ymdInTz } from '../dates';
import { editability } from '../guardrails';
import type { CohortUser, RevenueEvent } from '../metrics';
import { computeMetrics, defaultRange, emptyDelivery } from '../metrics';
import { buildRows, buildTimeseries, buildTotals, entityView, type SliceInput } from '../report';
import type {
  AdChannel,
  AdEntityRow,
  AdMetricRow,
  AdsOverview,
  AdsTimeseries,
  AttributionRow,
  CampaignDetail,
  CampaignDetailEntity,
  GroupBy,
} from '../types';
import { AD_CHANNELS, GROUP_BYS } from '../types';

import { chunk, db, selectAll } from './db';
import { AdsSyncService } from './sync-service';

const MAX_RANGE_DAYS = 400;
const DAY_MS = 86_400_000;

export interface RangeQuery {
  start: string;
  end: string;
  today: string;
  timeZone: string;
}

export function parseRange(params: URLSearchParams, now = new Date()): RangeQuery {
  const timeZone = reportTimeZone();
  const today = todayInTz(timeZone, now);
  const def = defaultRange(today);
  const start = params.get('start') ?? def.start;
  const end = params.get('end') ?? def.end;
  if (!isYmd(start) || !isYmd(end)) throw new CampaignError(400, 'VALIDATION_ERROR', 'start and end must be YYYY-MM-DD');
  if (start > end) throw new CampaignError(400, 'VALIDATION_ERROR', 'start must be on or before end');
  if (diffDays(start, end) > MAX_RANGE_DAYS) throw new CampaignError(400, 'VALIDATION_ERROR', `Range is limited to ${MAX_RANGE_DAYS} days`);
  return { start, end, today, timeZone };
}

export function parseGroupBy(v: string | null): GroupBy {
  if (!v) return 'channel';
  if (!(GROUP_BYS as string[]).includes(v)) throw new CampaignError(400, 'VALIDATION_ERROR', `groupBy must be one of ${GROUP_BYS.join(', ')}`);
  return v as GroupBy;
}

export function parseChannel(v: string | null): AdChannel | null {
  if (!v) return null;
  if (!(AD_CHANNELS as string[]).includes(v)) throw new CampaignError(400, 'VALIDATION_ERROR', `channel must be one of ${AD_CHANNELS.join(', ')}`);
  return v as AdChannel;
}

export class AdsReportService {
  static async loadMetrics(start: string, end: string): Promise<AdMetricRow[]> {
    return selectAll<AdMetricRow>(() =>
      db()
        .from('ad_metrics_daily')
        .select('channel, level, external_id, campaign_external_id, date, spend, currency, impressions, taps, installs')
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true })
    );
  }

  static async loadEntities(filter?: { channel?: string; campaignExternalId?: string }): Promise<AdEntityRow[]> {
    return selectAll<AdEntityRow>(() => {
      let q = db().from('ad_entities').select('*');
      if (filter?.channel) q = q.eq('channel', filter.channel);
      if (filter?.campaignExternalId) q = q.eq('campaign_external_id', filter.campaignExternalId);
      return q.order('external_id', { ascending: true });
    });
  }

  /** Users who signed up in [start, end] (report time zone) with attribution, activation and revenue. */
  static async loadCohort(range: Pick<RangeQuery, 'start' | 'end' | 'timeZone'>): Promise<CohortUser[]> {
    // Pad by 14 h either side so any zone's day boundaries are covered, then filter by local date.
    const from = new Date(Date.parse(`${range.start}T00:00:00Z`) - 14 * 3600_000).toISOString();
    const to = new Date(Date.parse(`${addDays(range.end, 1)}T00:00:00Z`) + 14 * 3600_000).toISOString();
    const profiles = (
      await selectAll<{ id: string; created_at: string }>(() =>
        db().from('profiles').select('id, created_at').gte('created_at', from).lt('created_at', to).order('created_at', { ascending: true })
      )
    )
      .map((p) => ({ ...p, day: ymdInTz(p.created_at, range.timeZone) }))
      .filter((p) => p.day >= range.start && p.day <= range.end);
    if (!profiles.length) return [];

    const ids = profiles.map((p) => p.id);
    const attribution = new Map<string, AttributionRow>();
    const firstActivity = new Map<string, number>();
    const events = new Map<string, RevenueEvent[]>();
    const signupMs = new Map(profiles.map((p) => [p.id, Date.parse(p.created_at)]));
    const activityTo = new Date(Date.parse(to) + 8 * DAY_MS).toISOString();

    const noteActivity = (userId: string, at: string) => {
      const t = Date.parse(at);
      const s = signupMs.get(userId);
      if (!Number.isFinite(t) || s === undefined || t < s - 60_000) return;
      const prev = firstActivity.get(userId);
      if (prev === undefined || t < prev) firstActivity.set(userId, t);
    };

    for (const part of chunk(ids, 150)) {
      const [attr, food, checkins, subs] = await Promise.all([
        selectAll<AttributionRow>(() => db().from('user_attribution').select('*').in('user_id', part)),
        selectAll<{ user_id: string; created_at: string }>(() =>
          db().from('food_log_entries').select('user_id, created_at').in('user_id', part).gte('created_at', from).lt('created_at', activityTo)
        ),
        selectAll<{ user_id: string; created_at: string }>(() =>
          db().from('daily_tracking').select('user_id, created_at').in('user_id', part).gte('created_at', from).lt('created_at', activityTo)
        ),
        selectAll<RevenueEvent>(() =>
          db().from('subscription_events').select('id, user_id, type, store, environment, event_timestamp, raw').in('user_id', part).eq('environment', 'PRODUCTION')
        ),
      ]);
      for (const a of attr) attribution.set(a.user_id, a);
      for (const r of food) noteActivity(r.user_id, r.created_at);
      for (const r of checkins) noteActivity(r.user_id, r.created_at);
      for (const e of subs) {
        if (!e.user_id) continue;
        const list = events.get(e.user_id) ?? [];
        list.push(e);
        events.set(e.user_id, list);
      }
    }

    return profiles.map((p) => ({
      userId: p.id,
      signupAt: p.created_at,
      signupDate: p.day,
      attribution: attribution.get(p.id) ?? null,
      firstActivityAt: firstActivity.has(p.id) ? new Date(firstActivity.get(p.id)!).toISOString() : null,
      events: events.get(p.id) ?? [],
    }));
  }

  static async overview(range: RangeQuery, groupBy: GroupBy): Promise<AdsOverview> {
    const [metricRows, entities, cohort, lastSync] = await Promise.all([
      this.loadMetrics(range.start, range.end),
      this.loadEntities(),
      this.loadCohort(range),
      AdsSyncService.status(),
    ]);
    const input: SliceInput = { metricRows, entities, cohort, rangeEnd: range.end, today: range.today };
    return {
      range: { start: range.start, end: range.end, timeZone: range.timeZone },
      groupBy,
      rows: buildRows(groupBy, input),
      totals: buildTotals(input),
      lastSync,
      testUsers: cohort.filter((u) => u.attribution?.is_test).length,
      targets: TARGETS,
    };
  }

  static async timeseries(range: RangeQuery, filter: { channel: AdChannel | null; campaignExternalId: string | null }): Promise<AdsTimeseries> {
    const [metricRows, cohort] = await Promise.all([this.loadMetrics(range.start, range.end), this.loadCohort(range)]);
    const points = buildTimeseries(range.start, range.end, {
      metricRows,
      entities: [],
      cohort,
      rangeEnd: range.end,
      today: range.today,
      filter: { channel: filter.channel, campaignExternalId: filter.campaignExternalId },
    });
    return { range: { start: range.start, end: range.end, timeZone: range.timeZone }, points, targets: TARGETS };
  }

  static async campaign(range: RangeQuery, channel: AdChannel, externalId: string): Promise<CampaignDetail> {
    const entities = await this.loadEntities({ channel, campaignExternalId: externalId });
    const campaignRow = entities.find((e) => e.level === 'campaign' && e.external_id === externalId);
    if (!campaignRow) throw new CampaignError(404, 'NOT_FOUND', 'Campaign not found (sync first?)');

    const [metricsAll, todayRows, cohort, status] = await Promise.all([
      this.loadMetrics(range.start, range.end),
      this.loadMetrics(range.today, range.today),
      this.loadCohort(range),
      AdsSyncService.status(),
    ]);
    const metricRows = metricsAll.filter((r) => r.channel === channel && r.campaign_external_id === externalId);
    const input: SliceInput = { metricRows, entities, cohort, rangeEnd: range.end, today: range.today, filter: { channel, campaignExternalId: externalId } };
    const sync = status.find((s) => s.channel === channel) ?? { channel, configured: false, writeEnabled: writeEnabled(channel), finishedAt: null, startedAt: null, ok: null, error: null };
    const access = { configured: getConnector(channel)?.isConfigured() ?? false, writeEnabled: writeEnabled(channel) };
    const todaySpend = (level: string, id: string) =>
      Math.round(todayRows.filter((r) => r.channel === channel && r.level === level && r.external_id === id).reduce((s, r) => s + (Number(r.spend) || 0), 0) * 100) / 100;

    const withMetrics = (groupBy: 'campaign' | 'ad_group' | 'keyword' | 'ad'): { list: CampaignDetailEntity[]; unplaced: CampaignDetail['unplaced']['adGroup'] } => {
      const rows = buildRows(groupBy, input);
      const level = groupBy;
      const list = entities
        .filter((e) => e.level === level)
        .map((e) => {
          const row = rows.find((r) => r.externalId === e.external_id && r.level === level);
          return {
            ...entityView(e),
            editability: editability(e, access),
            metrics: row?.metrics ?? computeMetrics(emptyDelivery(), [], { rangeEnd: range.end, today: range.today }),
            todaySpend: todaySpend(level, e.external_id),
          } as CampaignDetailEntity;
        })
        .sort((a, b) => b.metrics.spend - a.metrics.spend || (a.name ?? '').localeCompare(b.name ?? ''));
      const unplaced = rows.find((r) => r.key.endsWith(':none'))?.metrics ?? null;
      return { list, unplaced };
    };

    const camp = withMetrics('campaign');
    const groups = withMetrics('ad_group');
    const keywords = withMetrics('keyword');
    const ads = withMetrics('ad');
    return {
      range: { start: range.start, end: range.end, timeZone: range.timeZone },
      campaign: camp.list[0] ?? { ...entityView(campaignRow), editability: editability(campaignRow, access), metrics: buildTotals(input).metrics, todaySpend: todaySpend('campaign', externalId) },
      adGroups: groups.list,
      keywords: keywords.list,
      ads: ads.list,
      unplaced: { adGroup: groups.unplaced, keyword: keywords.unplaced },
      sync,
      targets: TARGETS,
    };
  }
}
