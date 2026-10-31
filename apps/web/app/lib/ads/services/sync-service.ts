/**
 * Ad network sync (docs/ADS_CONSOLE_SPEC.md §6): per configured connector,
 * entities then daily metrics for today-3 … today (networks restate), upserted
 * into ad_entities / ad_metrics_daily, one ad_sync_runs row per channel. One
 * failing channel never blocks another.
 */
import { writeEnabled, reportTimeZone } from '../config';
import { getConnector, allConnectors } from '../connectors';
import { addDays, todayInTz, ymdInTz } from '../dates';
import { externalChangeRows } from '../external-changes';
import type { AdChannel, AdConversionDailyInput, AdDailyMetricInput, AdEntityInput, AdEntityRow, ChannelSyncStatus } from '../types';
import { AD_CHANNELS } from '../types';

import { chunk, db } from './db';

export interface SyncChannelResult {
  channel: AdChannel;
  ok: boolean;
  skipped?: 'not_configured' | 'debounced';
  rowsEntities: number;
  rowsMetrics: number;
  /** ad_conversions_daily rows written (networks with fetchConversions only). */
  rowsConversions?: number;
  /** Conversion pull failure: logged, never fails the run (delivery is what the console depends on). */
  conversionsError?: string | null;
  error: string | null;
  runId: string | null;
}

export function entityToRow(e: AdEntityInput, syncedAt: string) {
  return {
    channel: e.channel,
    platform: e.platform,
    level: e.level,
    external_id: e.externalId,
    parent_external_id: e.parentExternalId,
    campaign_external_id: e.campaignExternalId,
    name: e.name,
    status: e.status,
    serving_status: e.servingStatus,
    bid_strategy: e.bidStrategy,
    bid_amount: e.bidAmount,
    bid_currency: e.bidCurrency,
    daily_budget: e.dailyBudget,
    total_budget: e.totalBudget,
    match_type: e.matchType,
    countries: e.countries,
    start_at: e.startAt,
    end_at: e.endAt,
    creative: e.creative,
    raw: e.raw ?? null,
    synced_at: syncedAt,
  };
}

export function metricToRow(m: AdDailyMetricInput, syncedAt: string) {
  return {
    channel: m.channel,
    level: m.level,
    external_id: m.externalId,
    campaign_external_id: m.campaignExternalId,
    date: m.date,
    spend: m.spend,
    currency: m.currency,
    impressions: m.impressions,
    taps: m.taps,
    installs: m.installs,
    new_downloads: m.newDownloads,
    redownloads: m.redownloads,
    synced_at: syncedAt,
  };
}

export function conversionToRow(c: AdConversionDailyInput, syncedAt: string) {
  return {
    channel: c.channel,
    level: c.level,
    external_id: c.externalId,
    campaign_external_id: c.campaignExternalId,
    date: c.date,
    conversion_action_id: c.conversionActionId,
    conversion_action_name: c.conversionActionName,
    category: c.category,
    kind: c.kind,
    conversions: c.conversions,
    all_conversions: c.allConversions,
    synced_at: syncedAt,
  };
}

const DEBOUNCE_MS = 2 * 60 * 1000;
/** First-run backfill cap (days before today). */
const FIRST_RUN_MAX_DAYS = 90;

export class AdsSyncService {
  /**
   * `detectExternal: false` when the console itself just wrote the change
   * (it is already in ad_change_log; logging it again as external would double it).
   */
  static async upsertEntities(entities: AdEntityInput[], syncedAt = new Date().toISOString(), opts: { detectExternal?: boolean } = {}): Promise<number> {
    const supabase = db();
    // Dedupe (same object can appear twice, e.g. across report pages).
    const uniq = new Map(entities.map((e) => [`${e.channel}|${e.level}|${e.externalId}`, e]));
    if (opts.detectExternal !== false) await this.logExternalChanges([...uniq.values()]);
    for (const part of chunk([...uniq.values()], 500)) {
      const { error } = await supabase.from('ad_entities').upsert(part.map((e) => entityToRow(e, syncedAt)), { onConflict: 'channel,level,external_id' });
      if (error) throw new Error(`ad_entities upsert: ${error.message}`);
    }
    return uniq.size;
  }

  /** Log bid / budget / status changes made outside the console (lib/ads/external-changes.ts). Never fails the sync. */
  static async logExternalChanges(fetched: AdEntityInput[]): Promise<number> {
    try {
      const channels = [...new Set(fetched.map((e) => e.channel))];
      if (!channels.length) return 0;
      const { data, error } = await db().from('ad_entities').select('channel, level, external_id, bid_amount, daily_budget, status').in('channel', channels);
      if (error) throw new Error(error.message);
      const rows = externalChangeRows((data ?? []) as AdEntityRow[], fetched);
      if (rows.length) {
        const { error: insertError } = await db().from('ad_change_log').insert(rows);
        if (insertError) throw new Error(insertError.message);
      }
      return rows.length;
    } catch (e) {
      console.error('[ads/sync] external change detection failed:', e instanceof Error ? e.message : e);
      return 0;
    }
  }

  static async upsertMetrics(rows: AdDailyMetricInput[], syncedAt = new Date().toISOString()): Promise<number> {
    const supabase = db();
    const uniq = new Map(rows.map((m) => [`${m.channel}|${m.level}|${m.externalId}|${m.date}`, m]));
    for (const part of chunk([...uniq.values()], 500)) {
      const { error } = await supabase.from('ad_metrics_daily').upsert(part.map((m) => metricToRow(m, syncedAt)), { onConflict: 'channel,level,external_id,date' });
      if (error) throw new Error(`ad_metrics_daily upsert: ${error.message}`);
    }
    return uniq.size;
  }

  /** Upsert network conversion rows. Days in [start, end] are replaced per channel so a restated-to-zero action disappears. */
  static async upsertConversions(channel: AdChannel, rows: AdConversionDailyInput[], start: string, end: string, syncedAt = new Date().toISOString()): Promise<number> {
    const supabase = db();
    const uniq = new Map(rows.map((c) => [`${c.channel}|${c.level}|${c.externalId}|${c.date}|${c.conversionActionId}`, c]));
    // Google omits zero rows: clear the window first so a conversion Google later removes doesn't linger.
    const { error: delError } = await supabase.from('ad_conversions_daily').delete().eq('channel', channel).gte('date', start).lte('date', end);
    if (delError) throw new Error(`ad_conversions_daily delete: ${delError.message}`);
    for (const part of chunk([...uniq.values()], 500)) {
      const { error } = await supabase
        .from('ad_conversions_daily')
        .upsert(part.map((c) => conversionToRow(c, syncedAt)), { onConflict: 'channel,level,external_id,date,conversion_action_id' });
      if (error) throw new Error(`ad_conversions_daily upsert: ${error.message}`);
    }
    return uniq.size;
  }

  /**
   * Sync every configured connector (or `channels`). `start`/`end` backfill a
   * range; default is today-3 … today in the report time zone.
   */
  static async run(
    opts: { channels?: AdChannel[]; start?: string; end?: string; trigger?: 'cron' | 'manual' | 'backfill'; debounce?: boolean; now?: Date } = {}
  ): Promise<SyncChannelResult[]> {
    const now = opts.now ?? new Date();
    const today = todayInTz(reportTimeZone(), now);
    const end = opts.end ?? today;
    const start = opts.start ?? addDays(end, -3);
    const connectors = opts.channels ? opts.channels.map((c) => getConnector(c)).filter((c): c is NonNullable<typeof c> => !!c) : allConnectors();
    const results: SyncChannelResult[] = [];
    const supabase = db();

    for (const connector of connectors) {
      const channel = connector.channel;
      const base = { channel, rowsEntities: 0, rowsMetrics: 0, error: null, runId: null };
      if (!connector.isConfigured()) {
        results.push({ ...base, ok: false, skipped: 'not_configured' });
        continue;
      }
      if (opts.debounce) {
        const { data: last } = await supabase
          .from('ad_sync_runs')
          .select('finished_at')
          .eq('channel', channel)
          .not('finished_at', 'is', null)
          .order('finished_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const at = last?.finished_at ? Date.parse(last.finished_at) : NaN;
        if (Number.isFinite(at) && now.getTime() - at < DEBOUNCE_MS) {
          results.push({ ...base, ok: true, skipped: 'debounced' });
          continue;
        }
      }

      const { data: run } = await supabase
        .from('ad_sync_runs')
        .insert({ channel, trigger: opts.trigger ?? 'cron', range_start: start, range_end: end, started_at: now.toISOString() })
        .select('id')
        .maybeSingle();
      const runId: string | null = run?.id ?? null;
      let rowsEntities = 0;
      let rowsMetrics = 0;
      let rowsConversions: number | undefined;
      let conversionsError: string | null = null;
      let error: string | null = null;
      let rangeStart = start;
      try {
        const syncedAt = new Date().toISOString();
        const entities = await connector.fetchEntities();
        rowsEntities = await this.upsertEntities(entities, syncedAt);
        // First successful run for a channel (e.g. Google Ads just connected): pull
        // since the earliest campaign start instead of only the last 3 days.
        if (!opts.start) rangeStart = await this.firstRunStart(channel, entities, start, end);
        rowsMetrics = await this.upsertMetrics(await connector.fetchDailyMetrics(rangeStart, end), syncedAt);
        if (connector.fetchConversions) {
          try {
            rowsConversions = await this.upsertConversions(channel, await connector.fetchConversions(rangeStart, end), rangeStart, end, syncedAt);
          } catch (e: any) {
            conversionsError = String(e?.message ?? e).slice(0, 500);
            console.warn(`[ads/sync] ${channel} conversions failed (delivery still synced):`, conversionsError);
          }
        }
      } catch (e: any) {
        error = String(e?.message ?? e).slice(0, 1000);
        console.error(`[ads/sync] ${channel} failed:`, error);
      }
      const patch = { finished_at: new Date().toISOString(), ok: !error, rows_entities: rowsEntities, rows_metrics: rowsMetrics, error, ...(rangeStart !== start ? { range_start: rangeStart } : {}) };
      if (runId) await supabase.from('ad_sync_runs').update(patch).eq('id', runId);
      results.push({ channel, ok: !error, rowsEntities, rowsMetrics, ...(rowsConversions !== undefined || conversionsError ? { rowsConversions: rowsConversions ?? 0, conversionsError } : {}), error, runId });
    }
    return results;
  }

  /**
   * Start of the metrics window: `start`, or — when the channel has never synced
   * successfully — the earliest campaign start date (report time zone), capped
   * at FIRST_RUN_MAX_DAYS before `end`.
   */
  static async firstRunStart(channel: AdChannel, entities: AdEntityInput[], start: string, end: string): Promise<string> {
    const { data, error } = await db().from('ad_sync_runs').select('id').eq('channel', channel).eq('ok', true).limit(1).maybeSingle();
    if (error || data) return start;
    const starts = entities
      .filter((e) => e.level === 'campaign' && e.startAt)
      .map((e) => ymdInTz(e.startAt!, reportTimeZone()))
      .sort();
    const floor = addDays(end, -FIRST_RUN_MAX_DAYS);
    const earliest = starts[0];
    if (!earliest || earliest >= start) return start;
    return earliest < floor ? floor : earliest;
  }

  /** finished_at of the latest successful run per channel (absent = never succeeded). */
  static async lastSuccess(): Promise<Partial<Record<AdChannel, string>>> {
    const out: Partial<Record<AdChannel, string>> = {};
    await Promise.all(
      AD_CHANNELS.map(async (channel) => {
        const { data } = await db()
          .from('ad_sync_runs')
          .select('finished_at')
          .eq('channel', channel)
          .eq('ok', true)
          .not('finished_at', 'is', null)
          .order('finished_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.finished_at) out[channel] = data.finished_at;
      })
    );
    return out;
  }

  /** Latest finished run per channel + configuration state. */
  static async status(): Promise<ChannelSyncStatus[]> {
    const supabase = db();
    const { data } = await supabase
      .from('ad_sync_runs')
      .select('channel, started_at, finished_at, ok, error')
      .order('started_at', { ascending: false })
      .limit(50);
    const rows = (data ?? []) as Array<{ channel: AdChannel; started_at: string; finished_at: string | null; ok: boolean | null; error: string | null }>;
    return AD_CHANNELS.map((channel) => {
      const connector = getConnector(channel);
      const last = rows.find((r) => r.channel === channel && r.finished_at) ?? rows.find((r) => r.channel === channel) ?? null;
      return {
        channel,
        configured: connector?.isConfigured() ?? false,
        writeEnabled: writeEnabled(channel),
        startedAt: last?.started_at ?? null,
        finishedAt: last?.finished_at ?? null,
        ok: last?.ok ?? null,
        error: last?.error ?? null,
      };
    });
  }
}
