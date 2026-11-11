/**
 * AI Gateway spend sync (GET /api/cron/ai-costs/sync, daily): pulls the gateway's Custom Reporting
 * API into ai_cost_daily so the finance reports never query the gateway (each report query is
 * billed: $5 / 1,000).
 *
 * Daily run: 1 query for daily totals over the window (group_by=day) + 1 query per day for model
 * (default window 3 UTC days → 4 queries ≈ $0.02/day ≈ $0.60/month). Attribution by user / feature
 * comes from the ai_usage_events ledger (gateway reporting tags are off: they are billed per write).
 * A backfill (?start&end, or ?dimensions=all) also pulls user + tag per day for the pre-ledger
 * history (1 + 3 × days queries).
 * plus /v1/credits (free). Auth: the AI SDK `gateway` provider — Vercel OIDC on Vercel,
 * AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN locally.
 */
import { gateway } from 'ai';

import { addDays, diffDays, eachDay, isYmd, todayInTz } from '../../ads/dates';
import { db } from '../../ads/services/db';
import type { GatewayDailyRow } from '../types';

export const SYNC_DEFAULT_DAYS = 3;
export const SYNC_MAX_DAYS = 120;

type Dimension = GatewayDailyRow['dimension'];

export interface SpendReportRow {
  day?: string;
  user?: string;
  tag?: string;
  model?: string;
  totalCost: number;
  marketCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
  requestCount?: number;
}

export interface GatewayReportClient {
  getSpendReport(p: { startDate: string; endDate: string; groupBy: 'day' | 'user' | 'tag' | 'model' }): Promise<{ results: SpendReportRow[] }>;
  getCredits(): Promise<{ balance: string; totalUsed: string }>;
}

/** Gateway report rows → ai_cost_daily rows (pure). `day` is required for user/tag/model. */
export function reportRows(results: SpendReportRow[], dimension: Dimension, day?: string): GatewayDailyRow[] {
  return results.map((r) => {
    const d = dimension === 'total' ? String(r.day ?? '').slice(0, 10) : day!;
    const key = dimension === 'total' ? '' : String((dimension === 'user' ? r.user : dimension === 'tag' ? r.tag : r.model) ?? '');
    return {
      day: d,
      dimension,
      key,
      totalCost: Number(r.totalCost) || 0,
      marketCost: r.marketCost === undefined ? null : Number(r.marketCost) || 0,
      inputTokens: Number(r.inputTokens) || 0,
      outputTokens: Number(r.outputTokens) || 0,
      cachedInputTokens: Number(r.cachedInputTokens) || 0,
      reasoningTokens: Number(r.reasoningTokens) || 0,
      requestCount: Number(r.requestCount) || 0,
    };
  });
}

export interface SyncWindow {
  start: string;
  end: string;
}

/** The UTC window to sync: the last `days` days through today, or an explicit start/end (≤ 120 days). */
export function syncWindow(params: { start?: string | null; end?: string | null; days?: number }, now = new Date()): SyncWindow {
  const today = todayInTz('UTC', now);
  if (params.start || params.end) {
    const start = params.start ?? params.end!;
    const end = params.end ?? today;
    if (!isYmd(start) || !isYmd(end)) throw new Error('start and end must be YYYY-MM-DD');
    if (start > end) throw new Error('start must be on or before end');
    if (diffDays(start, end) + 1 > SYNC_MAX_DAYS) throw new Error(`backfill is limited to ${SYNC_MAX_DAYS} days`);
    return { start, end };
  }
  const days = Math.min(SYNC_MAX_DAYS, Math.max(1, Math.floor(params.days ?? SYNC_DEFAULT_DAYS)));
  return { start: addDays(today, -(days - 1)), end: today };
}

/** Pulls the window from the gateway (pure apart from `client`). */
export async function pullGatewayWindow(
  client: GatewayReportClient,
  w: SyncWindow,
  dims: ReadonlyArray<'user' | 'tag' | 'model'> = ['model'],
): Promise<{ rows: GatewayDailyRow[]; queries: number }> {
  let queries = 0;
  const rows: GatewayDailyRow[] = [];
  queries += 1;
  rows.push(...reportRows((await client.getSpendReport({ startDate: w.start, endDate: w.end, groupBy: 'day' })).results, 'total'));
  for (const day of eachDay(w.start, w.end)) {
    for (const dim of dims) {
      queries += 1;
      rows.push(...reportRows((await client.getSpendReport({ startDate: day, endDate: day, groupBy: dim })).results, dim, day));
    }
  }
  return { rows, queries };
}

export interface AiCostSyncResult {
  window: SyncWindow;
  queries: number;
  rows: number;
  totalCost: number;
  credits: { balance: number; totalUsed: number } | null;
}

export class AiCostSyncService {
  static client(): GatewayReportClient {
    return gateway as unknown as GatewayReportClient;
  }

  static async sync(
    params: { start?: string | null; end?: string | null; days?: number; allDimensions?: boolean } = {},
    client: GatewayReportClient = this.client(),
    now = new Date(),
  ): Promise<AiCostSyncResult> {
    const w = syncWindow(params, now);
    // Explicit backfills pull user + tag too (pre-ledger history); the daily run pulls model only.
    const backfill = !!(params.start || params.end || params.allDimensions);
    const dims = backfill ? (['user', 'tag', 'model'] as const) : (['model'] as const);
    const { rows, queries } = await pullGatewayWindow(client, w, dims);
    const syncedAt = now.toISOString();
    const supabase = db();
    const payload = rows.map((r) => ({
      day: r.day,
      dimension: r.dimension,
      key: r.key,
      total_cost: r.totalCost,
      market_cost: r.marketCost,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      cached_input_tokens: r.cachedInputTokens,
      reasoning_tokens: r.reasoningTokens,
      request_count: r.requestCount,
      synced_at: syncedAt,
    }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase.from('ai_cost_daily').upsert(payload.slice(i, i + 500), { onConflict: 'day,dimension,key' });
      if (error) throw new Error(`ai_cost_daily upsert failed: ${error.message}`);
    }
    // Keys that no longer appear for a synced day/dimension (rare: gateway re-attribution) are removed —
    // only for the dimensions this run pulled (a daily run must not wipe backfilled user/tag history).
    for (const day of eachDay(w.start, w.end)) {
      for (const dim of ['total', ...dims] as const) {
        const { error } = await supabase.from('ai_cost_daily').delete().eq('day', day).eq('dimension', dim).lt('synced_at', syncedAt);
        if (error) throw new Error(`ai_cost_daily cleanup failed: ${error.message}`);
      }
    }

    let credits: AiCostSyncResult['credits'] = null;
    try {
      const c = await client.getCredits();
      credits = { balance: Number(c.balance) || 0, totalUsed: Number(c.totalUsed) || 0 };
      const { error } = await supabase.from('ai_gateway_credits').insert({ captured_at: syncedAt, balance: credits.balance, total_used: credits.totalUsed });
      if (error) console.warn('[ai-costs/sync] credits insert failed:', error.message);
    } catch (e: any) {
      console.warn('[ai-costs/sync] credits unavailable:', e?.message ?? e);
    }
    const totalCost = rows.filter((r) => r.dimension === 'total').reduce((s, r) => s + r.totalCost, 0);
    console.log(`[ai-costs/sync] ${w.start}..${w.end}: ${queries} report queries, ${rows.length} rows, $${totalCost.toFixed(4)}`);
    return { window: w, queries, rows: rows.length, totalCost: Math.round(totalCost * 1e6) / 1e6, credits };
  }
}
