/**
 * AdMob → ad_revenue_daily (migration 126). Runs inside the hourly ads sync
 * (/api/cron/ads/sync) and the console's "Sync now"; one ad_sync_runs row per
 * run with channel = 'admob'. Read-only against AdMob.
 *
 * Window: today−3 … today in Pacific time (AdMob restates recent days). The
 * first successful run backfills FIRST_RUN_DAYS. A window is replaced as a
 * whole (delete, then upsert) so a row AdMob later drops does not linger.
 */
import { AdmobClient, ADMOB_REPORT_TIME_ZONE, type AdRevenueDailyInput } from '../admob/client';
import { addDays, todayInTz } from '../dates';

import { chunk, db } from './db';

export const ADMOB_CHANNEL = 'admob';
const DEBOUNCE_MS = 2 * 60 * 1000;
export const FIRST_RUN_DAYS = 90;

export interface AdRevenueSyncResult {
  channel: 'admob';
  ok: boolean;
  skipped?: 'not_configured' | 'debounced';
  range: { start: string; end: string } | null;
  rows: number;
  error: string | null;
  runId: string | null;
}

export interface AdRevenueSyncStatus {
  configured: boolean;
  publisherId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  error: string | null;
  /** finished_at of the latest ok run (null = never succeeded). */
  lastSuccessAt: string | null;
}

export function revenueToRow(r: AdRevenueDailyInput, syncedAt: string) {
  return {
    source: r.source,
    date: r.date,
    app_id: r.appId,
    app_name: r.appName,
    platform: r.platform,
    ad_unit_id: r.adUnitId,
    ad_unit_name: r.adUnitName,
    format: r.format,
    country: r.country,
    currency: r.currency,
    estimated_earnings: r.estimatedEarnings,
    ad_requests: r.adRequests,
    matched_requests: r.matchedRequests,
    impressions: r.impressions,
    clicks: r.clicks,
    synced_at: syncedAt,
  };
}

export class AdRevenueSyncService {
  static client: () => AdmobClient = () => new AdmobClient();

  static async run(opts: { start?: string; end?: string; trigger?: 'cron' | 'manual' | 'backfill'; debounce?: boolean; now?: Date; client?: AdmobClient } = {}): Promise<AdRevenueSyncResult> {
    const client = opts.client ?? this.client();
    const now = opts.now ?? new Date();
    const base = { channel: 'admob' as const, range: null, rows: 0, error: null, runId: null };
    if (!client.isConfigured()) return { ...base, ok: false, skipped: 'not_configured' };
    const supabase = db();

    if (opts.debounce) {
      const { data: last } = await supabase
        .from('ad_sync_runs')
        .select('finished_at')
        .eq('channel', ADMOB_CHANNEL)
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const at = last?.finished_at ? Date.parse(last.finished_at) : NaN;
      if (Number.isFinite(at) && now.getTime() - at < DEBOUNCE_MS) return { ...base, ok: true, skipped: 'debounced' };
    }

    const end = opts.end ?? todayInTz(ADMOB_REPORT_TIME_ZONE, now);
    let start = opts.start ?? addDays(end, -3);
    if (!opts.start) {
      const { data: okRun, error } = await supabase.from('ad_sync_runs').select('id').eq('channel', ADMOB_CHANNEL).eq('ok', true).limit(1).maybeSingle();
      if (!error && !okRun) start = addDays(end, -(FIRST_RUN_DAYS - 1));
    }

    const { data: run } = await supabase
      .from('ad_sync_runs')
      .insert({ channel: ADMOB_CHANNEL, trigger: opts.trigger ?? 'cron', range_start: start, range_end: end, started_at: now.toISOString() })
      .select('id')
      .maybeSingle();
    const runId: string | null = run?.id ?? null;

    let rows = 0;
    let error: string | null = null;
    try {
      const report = await client.networkReport(start, end);
      rows = await this.replaceWindow(report.rows, start, end);
    } catch (e: any) {
      error = String(e?.message ?? e).slice(0, 1000);
      console.error('[ads/admob] sync failed:', error);
    }
    if (runId) {
      await supabase.from('ad_sync_runs').update({ finished_at: new Date().toISOString(), ok: !error, rows_entities: 0, rows_metrics: rows, error }).eq('id', runId);
    }
    return { channel: 'admob', ok: !error, range: { start, end }, rows, error, runId };
  }

  /** Replace [start, end] with `rows`. */
  static async replaceWindow(rows: AdRevenueDailyInput[], start: string, end: string, syncedAt = new Date().toISOString()): Promise<number> {
    const supabase = db();
    const uniq = new Map(rows.map((r) => [`${r.source}|${r.date}|${r.adUnitId}|${r.country}`, r]));
    const { error: delError } = await supabase.from('ad_revenue_daily').delete().eq('source', 'admob').gte('date', start).lte('date', end);
    if (delError) throw new Error(`ad_revenue_daily delete: ${delError.message}`);
    for (const part of chunk([...uniq.values()], 500)) {
      const { error } = await supabase.from('ad_revenue_daily').upsert(part.map((r) => revenueToRow(r, syncedAt)), { onConflict: 'source,date,ad_unit_id,country' });
      if (error) throw new Error(`ad_revenue_daily upsert: ${error.message}`);
    }
    return uniq.size;
  }

  static async status(client: AdmobClient = this.client()): Promise<AdRevenueSyncStatus> {
    const supabase = db();
    const [{ data: last }, { data: lastOk }] = await Promise.all([
      supabase.from('ad_sync_runs').select('started_at, finished_at, ok, error').eq('channel', ADMOB_CHANNEL).order('started_at', { ascending: false }).limit(1).maybeSingle(),
      supabase
        .from('ad_sync_runs')
        .select('finished_at')
        .eq('channel', ADMOB_CHANNEL)
        .eq('ok', true)
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    return {
      configured: client.isConfigured(),
      publisherId: client.publisherId(),
      startedAt: last?.started_at ?? null,
      finishedAt: last?.finished_at ?? null,
      ok: last?.ok ?? null,
      error: last?.error ?? null,
      lastSuccessAt: lastOk?.finished_at ?? null,
    };
  }
}
