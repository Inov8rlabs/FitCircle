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
import { buildDataHealth } from '../data-health';
import { addDays, diffDays, isYmd, todayInTz, ymdInTz } from '../dates';
import { METRIC_DEFINITIONS } from '../definitions';
import { editability } from '../guardrails';
import type { CohortUser, RevenueEvent } from '../metrics';
import { ACTIVATION_DAYS, computeMetrics, dedupeEvents, defaultRange, emptyDelivery } from '../metrics';
import { buildRows, buildTimeseries, buildTotals, entityView, type SliceInput } from '../report';
import { classifyTestUser, type TestUserReason } from '../test-users';
import type {
  AdChannel,
  AdEntityRow,
  AdMetricRow,
  AdsOverview,
  AdsTimeseries,
  AttributionRow,
  CampaignDetail,
  CampaignDetailEntity,
  ExcludedUsers,
  GroupBy,
} from '../types';
import { AD_CHANNELS, GROUP_BYS } from '../types';

import { chunk, db, selectAll } from './db';
import { AdsSyncService } from './sync-service';

const MAX_RANGE_DAYS = 400;
const DAY_MS = 86_400_000;
const PASSIVE_STEPS_SOURCES = new Set(['healthkit', 'google_fit']);


export interface RangeQuery {
  start: string;
  end: string;
  today: string;
  timeZone: string;
  /** Count internal / review / test-lab / Play-tester sign-ups too (default: excluded). */
  includeTest?: boolean;
  /** Clock for freshness checks (tests). */
  now?: Date;
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
  const inc = (params.get('includeTest') ?? '').toLowerCase();
  return { includeTest: inc === '1' || inc === 'true', start, end, today, timeZone, now };
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
    // Unique order (the table's PK) so offset pagination never skips or repeats a row.
    return selectAll<AdMetricRow>(() =>
      db()
        .from('ad_metrics_daily')
        .select('channel, level, external_id, campaign_external_id, date, spend, currency, impressions, taps, installs')
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true })
        .order('channel', { ascending: true })
        .order('level', { ascending: true })
        .order('external_id', { ascending: true })
    );
  }

  static async loadEntities(filter?: { channel?: string; campaignExternalId?: string }): Promise<AdEntityRow[]> {
    return selectAll<AdEntityRow>(() => {
      let q = db().from('ad_entities').select('*');
      if (filter?.channel) q = q.eq('channel', filter.channel);
      if (filter?.campaignExternalId) q = q.eq('campaign_external_id', filter.campaignExternalId);
      return q.order('channel', { ascending: true }).order('level', { ascending: true }).order('external_id', { ascending: true });
    });
  }

  /** Users who signed up in [start, end] (report time zone) with attribution, activation and revenue. */
  static async loadCohort(range: Pick<RangeQuery, 'start' | 'end' | 'timeZone'>): Promise<CohortUser[]> {
    return (await this.loadCohortWithStats(range)).cohort;
  }

  static async loadCohortWithStats(range: Pick<RangeQuery, 'start' | 'end' | 'timeZone'>): Promise<{ cohort: CohortUser[]; duplicatesDropped: number }> {
    // Pad by 14 h either side so any zone's day boundaries are covered, then filter by local date.
    const from = new Date(Date.parse(`${range.start}T00:00:00Z`) - 14 * 3600_000).toISOString();
    const to = new Date(Date.parse(`${addDays(range.end, 1)}T00:00:00Z`) + 14 * 3600_000).toISOString();
    const profiles = (
      await selectAll<{ id: string; created_at: string; email: string | null; is_admin: boolean | null }>(() =>
        db()
          .from('profiles')
          .select('id, created_at, email, is_admin')
          .gte('created_at', from)
          .lt('created_at', to)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
      )
    )
      .map((p) => ({ ...p, day: ymdInTz(p.created_at, range.timeZone) }))
      .filter((p) => p.day >= range.start && p.day <= range.end);
    if (!profiles.length) return { cohort: [], duplicatesDropped: 0 };

    const attribution = new Map<string, AttributionRow>();
    const firstActivity = new Map<string, number>();
    const allEvents: RevenueEvent[] = [];
    const signupMs = new Map(profiles.map((p) => [p.id, Date.parse(p.created_at)]));

    const noteActivity = (userId: string, at: string) => {
      const t = Date.parse(at);
      const s = signupMs.get(userId);
      // Small grace for clock skew; activity after the 7-day window is irrelevant.
      if (!Number.isFinite(t) || s === undefined || t < s - 60_000 || t - s >= ACTIVATION_DAYS * DAY_MS) return;
      const prev = firstActivity.get(userId);
      if (prev === undefined || t < prev) firstActivity.set(userId, t);
    };

    // Profiles are sorted by created_at, so each chunk spans a contiguous sign-up
    // window; activity is read only for [first sign-up − 1 min, last sign-up + 7 d).
    for (const part of chunk(profiles, 150)) {
      const ids = part.map((p) => p.id);
      const actFrom = new Date(Date.parse(part[0].created_at) - 60_000).toISOString();
      const actTo = new Date(Date.parse(part[part.length - 1].created_at) + ACTIVATION_DAYS * DAY_MS).toISOString();
      const [attr, food, checkins, subs] = await Promise.all([
        selectAll<AttributionRow>(() => db().from('user_attribution').select('*').in('user_id', ids).order('user_id', { ascending: true })),
        selectAll<{ id: string; user_id: string; created_at: string; input_method: string | null }>(() =>
          db()
            .from('food_log_entries')
            .select('id, user_id, created_at, input_method')
            .in('user_id', ids)
            .gte('created_at', actFrom)
            .lt('created_at', actTo)
            .order('id', { ascending: true })
        ),
        selectAll<{ id: string; user_id: string; created_at: string; steps_source: string | null }>(() =>
          db()
            .from('daily_tracking')
            .select('id, user_id, created_at, steps_source')
            .in('user_id', ids)
            .gte('created_at', actFrom)
            .lt('created_at', actTo)
            .order('id', { ascending: true })
        ),
        selectAll<RevenueEvent>(() =>
          db()
            .from('subscription_events')
            .select('id, user_id, type, store, environment, event_timestamp, raw')
            .in('user_id', ids)
            .eq('environment', 'PRODUCTION')
            .order('id', { ascending: true })
        ),
      ]);
      for (const a of attr) attribution.set(a.user_id, a);
      // Passive imports are not activation: HealthKit / Health Connect nutrition
      // imports (input_method 'imported') and step auto-syncs (steps_source
      // healthkit / google_fit) arrive without the user doing anything.
      for (const r of food) if (r.input_method !== 'imported') noteActivity(r.user_id, r.created_at);
      for (const r of checkins) if (!PASSIVE_STEPS_SOURCES.has(String(r.steps_source ?? ''))) noteActivity(r.user_id, r.created_at);
      allEvents.push(...subs.filter((e) => e.user_id));
    }

    // A store transaction counts once even if it was delivered twice or reached two users (transfer / alias).
    const { events: unique, dropped } = dedupeEvents(allEvents);
    const events = new Map<string, RevenueEvent[]>();
    for (const e of unique) {
      const list = events.get(e.user_id!) ?? [];
      list.push(e);
      events.set(e.user_id!, list);
    }
    const cohort = profiles.map((p) => ({
      testReason: classifyTestUser({ email: p.email, isAdmin: p.is_admin, mockAttribution: attribution.get(p.id)?.is_test === true }),
      userId: p.id,
      signupAt: p.created_at,
      signupDate: p.day,
      attribution: attribution.get(p.id) ?? null,
      firstActivityAt: firstActivity.has(p.id) ? new Date(firstActivity.get(p.id)!).toISOString() : null,
      events: events.get(p.id) ?? [],
    }));
    return { cohort, duplicatesDropped: dropped };
  }

  /**
   * Sign-up time and test-user verdict for arbitrary users (invitees, circle
   * co-members): the same classifyTestUser rules as the cohort. Ids with no
   * profile are absent from the map.
   */
  static async classifyUsers(ids: string[]): Promise<Map<string, { createdAt: string; testReason: TestUserReason | null }>> {
    const out = new Map<string, { createdAt: string; testReason: TestUserReason | null }>();
    for (const part of chunk([...new Set(ids)], 150)) {
      const [profiles, attr] = await Promise.all([
        selectAll<{ id: string; created_at: string; email: string | null; is_admin: boolean | null }>(() =>
          db().from('profiles').select('id, created_at, email, is_admin').in('id', part).order('id', { ascending: true })
        ),
        selectAll<{ user_id: string; is_test: boolean | null }>(() =>
          db().from('user_attribution').select('user_id, is_test').in('user_id', part).order('user_id', { ascending: true })
        ),
      ]);
      const mock = new Set(attr.filter((a) => a.is_test === true).map((a) => a.user_id));
      for (const p of profiles) {
        out.set(p.id, { createdAt: p.created_at, testReason: classifyTestUser({ email: p.email, isAdmin: p.is_admin, mockAttribution: mock.has(p.id) }) });
      }
    }
    return out;
  }

  /** The cohort the report counts, plus what was left out as test / internal sign-ups. */
  static async reportCohort(range: RangeQuery): Promise<{ cohort: CohortUser[]; excluded: ExcludedUsers; duplicatesDropped: number }> {
    const { cohort: all, duplicatesDropped } = await this.loadCohortWithStats(range);
    const byReason: Partial<Record<TestUserReason, number>> = {};
    for (const u of all) if (u.testReason) byReason[u.testReason] = (byReason[u.testReason] ?? 0) + 1;
    const total = all.filter((u) => u.testReason).length;
    return {
      cohort: range.includeTest ? all : all.filter((u) => !u.testReason),
      excluded: { total, byReason, included: range.includeTest === true },
      duplicatesDropped,
    };
  }

  static async overview(range: RangeQuery, groupBy: GroupBy): Promise<AdsOverview> {
    const [metricRows, entities, cohortResult, lastSync, lastSuccess] = await Promise.all([
      this.loadMetrics(range.start, range.end),
      this.loadEntities(),
      this.reportCohort(range),
      AdsSyncService.status(),
      AdsSyncService.lastSuccess(),
    ]);
    const { cohort, excluded } = cohortResult;
    const input: SliceInput = { metricRows, entities, cohort, rangeEnd: range.end, today: range.today };
    const dataHealth = buildDataHealth({
      now: range.now ?? new Date(),
      metricRows,
      cohort,
      duplicatesDroppedAtLoad: cohortResult.duplicatesDropped,
      sync: lastSync.map((s) => ({
        channel: s.channel,
        configured: s.configured,
        lastSuccessAt: lastSuccess[s.channel] ?? null,
        lastFinishedOk: s.finishedAt ? s.ok : null,
        lastError: s.error,
      })),
    });
    return {
      range: { start: range.start, end: range.end, timeZone: range.timeZone },
      groupBy,
      rows: buildRows(groupBy, input),
      totals: buildTotals(input),
      lastSync,
      testUsers: excluded.total,
      excludedUsers: excluded,
      targets: TARGETS,
      dataHealth,
      definitions: METRIC_DEFINITIONS,
    };
  }

  static async timeseries(range: RangeQuery, filter: { channel: AdChannel | null; campaignExternalId: string | null }): Promise<AdsTimeseries> {
    const [metricRows, cohortResult] = await Promise.all([this.loadMetrics(range.start, range.end), this.reportCohort(range)]);
    const { cohort } = cohortResult;
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

    const [metricsAll, todayRows, { cohort }, status] = await Promise.all([
      this.loadMetrics(range.start, range.end),
      this.loadMetrics(range.today, range.today),
      this.reportCohort(range),
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
