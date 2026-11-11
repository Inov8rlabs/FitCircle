/**
 * AI usage attribution + ledger (FitCircle Finance, migration 134).
 *
 * Every model call carries an AiUsageContext:
 *  - (only with AI_GATEWAY_REPORTING_TAGS=on — tag writes are billed) the gateway request is tagged (`user` = profile id, or `system:<job>` when there is no user;
 *    tags app:fitcircle, env:<VERCEL_ENV|development>, feature:<name>) so the gateway's Custom
 *    Reporting API (the billed source of truth) can be split by user / feature / environment;
 *  - after the call, one ai_usage_events row is written off the request path (runAfterResponse)
 *    with tokens and the per-call cost the gateway returns in providerMetadata.gateway.
 *
 * Verified live 2026-11-10: providerMetadata.gateway carries STRINGS
 *   cost, marketCost, inferenceCost, surchargeCost, gatewayCost (= inference + surcharge, what the
 *   report's total_cost counts), reportingTagWriteCost, generationId; routing.finalProvider.
 * Reporting-tag writes are billed ($0.075 / 1,000 writes; user + each tag = one write each).
 *
 * Never throws into the caller. A failed insert (e.g. before migration 134 is applied) is logged
 * at most once per instance per 10 minutes.
 */
import { createAdminSupabase } from '../supabase-admin';
import { runAfterResponse } from '../utils/after-response';

type Env = Record<string, string | undefined>;

/** Feature names (the `feature:` tag and ai_usage_events.feature). */
export type AiFeature =
  | 'food_photo'
  | 'food_text'
  | 'food_voice'
  | 'food_item'
  | 'food_grounding'
  | 'food_embedding'
  | 'food_embedding_index'
  | 'fitzy_chat'
  | 'fitzy_meta_recovery'
  | 'fitzy_memory'
  | 'fitzy_plan'
  | 'fitzy_plan_preview'
  | 'fitzy_daily_focus'
  | 'fitzy_weekly_recap'
  | 'fitzy_push'
  | 'nutrition_coach'
  | 'body_comp'
  | 'eval';

export interface AiUsageContext {
  /** profiles.id of the user the call serves; null for system work (crons, backfills). */
  userId: string | null;
  feature: AiFeature;
  /** Gateway user for userId=null calls: `system:<job>` (defaults to the feature name). */
  job?: string;
}

export const APP_TAG = 'app:fitcircle';

/** VERCEL_ENV (production | preview | development), else 'development' (local scripts, evals). */
export function aiEnvironment(env: Env = process.env): string {
  const v = (env.VERCEL_ENV ?? '').trim().toLowerCase();
  return v || 'development';
}

export function gatewayUserFor(ctx: AiUsageContext): string {
  return ctx.userId ?? `system:${ctx.job ?? ctx.feature}`;
}

export function usageTags(ctx: AiUsageContext, env: Env = process.env): string[] {
  return [APP_TAG, `env:${aiEnvironment(env)}`, `feature:${ctx.feature}`];
}

/**
 * Gateway reporting tags are BILLED per write ($0.075 / 1,000; `user` + each tag = one write each),
 * ~$0.0003 per call — 15–30% on top of FitCircle's real per-call model cost (measured 2026-11-10).
 * The ai_usage_events ledger already records user, feature, environment and the exact billed cost
 * per call, so tags are OFF by default. AI_GATEWAY_REPORTING_TAGS=on turns them back on (e.g. to
 * debug attribution in the gateway dashboard).
 */
export function gatewayReportingTagsEnabled(env: Env = process.env): boolean {
  return ['on', 'true', '1', 'yes'].includes((env.AI_GATEWAY_REPORTING_TAGS ?? '').trim().toLowerCase());
}

/**
 * `{ user, tags }` for providerOptions.gateway when reporting tags are enabled (existing tags kept,
 * union, order preserved); `{}` otherwise.
 */
export function usageGatewayFields(ctx: AiUsageContext, existingTags: unknown = undefined, env: Env = process.env): { user?: string; tags?: string[] } {
  if (!gatewayReportingTagsEnabled(env)) return {};
  const prior = Array.isArray(existingTags) ? existingTags.filter((t): t is string => typeof t === 'string') : [];
  return { user: gatewayUserFor(ctx), tags: [...new Set([...prior, ...usageTags(ctx, env)])] };
}

// ---------------------------------------------------------------------------
// Ledger row (pure)
// ---------------------------------------------------------------------------

export interface AiUsageEventRow {
  user_id: string | null;
  feature: string;
  model: string;
  provider: string | null;
  environment: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  market_cost_usd: number | null;
  generation_id: string | null;
  ok: boolean;
  duration_ms: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export interface UsageInput {
  model: string;
  /** LanguageModelUsage (generateText/streamText) or EmbeddingModelUsage ({ tokens }). */
  usage?: unknown;
  providerMetadata?: unknown;
  ok: boolean;
  durationMs?: number | null;
}

/** Builds the ai_usage_events row from an AI SDK result (pure; tolerant of missing fields). */
export function usageRow(ctx: AiUsageContext, input: UsageInput, env: Env = process.env): AiUsageEventRow {
  const u = (input.usage ?? {}) as Record<string, any>;
  const g = ((input.providerMetadata as any)?.gateway ?? {}) as Record<string, any>;
  const inputTokens = int(u.inputTokens ?? u.tokens);
  const cached = int(u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens);
  const reasoning = int(u.outputTokenDetails?.reasoningTokens ?? u.reasoningTokens);
  // gatewayCost = inference + gateway surcharges (tag writes): what the report bills. Older
  // responses may only carry `cost`.
  const cost = num(g.gatewayCost) ?? num(g.cost);
  const provider = typeof g.routing?.finalProvider === 'string' ? g.routing.finalProvider : input.model.includes('/') ? input.model.split('/')[0] : null;
  return {
    user_id: isUuid(ctx.userId) ? ctx.userId : null,
    feature: ctx.feature,
    model: input.model,
    provider,
    environment: aiEnvironment(env),
    input_tokens: inputTokens,
    output_tokens: int(u.outputTokens),
    cached_input_tokens: cached,
    reasoning_tokens: reasoning,
    cost_usd: cost,
    market_cost_usd: num(g.marketCost),
    generation_id: typeof g.generationId === 'string' ? g.generationId : null,
    ok: input.ok,
    duration_ms: input.durationMs === undefined || input.durationMs === null ? null : Math.max(0, Math.round(input.durationMs)),
  };
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

type Writer = (row: AiUsageEventRow) => Promise<void>;

const LOG_EVERY_MS = 10 * 60_000;
let lastFailureLog = 0;

const defaultWriter: Writer = async (row) => {
  const { error } = await createAdminSupabase().from('ai_usage_events').insert(row);
  if (error) throw new Error(error.message ?? String(error));
};

let writer: Writer | null = null;

/** Tests: replace (or with null restore) the ledger writer. */
export function setAiUsageWriter(w: Writer | null): void {
  writer = w;
}

function ledgerEnabled(env: Env = process.env): boolean {
  if (['off', 'false', '0', 'no'].includes((env.AI_USAGE_LEDGER ?? '').trim().toLowerCase())) return false;
  if (!writer && env.VITEST) return false; // unit tests never touch a real DB
  if (!writer && (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) return false;
  return true;
}

async function write(row: AiUsageEventRow): Promise<void> {
  try {
    await (writer ?? defaultWriter)(row);
  } catch (err: any) {
    const now = Date.now();
    if (now - lastFailureLog > LOG_EVERY_MS) {
      lastFailureLog = now;
      console.warn('[ai-usage] ledger insert failed (further failures muted 10 min):', err?.message ?? err);
    }
  }
}

/**
 * Records one model call (fire-and-forget, after the response). Safe to call with ctx undefined
 * (no-op): code paths without a context (ad-hoc scripts) are covered by the gateway report only.
 */
export function recordAiUsage(ctx: AiUsageContext | undefined | null, input: UsageInput): void {
  if (!ctx) return;
  try {
    if (!ledgerEnabled()) return;
    const row = usageRow(ctx, input);
    runAfterResponse(() => write(row), 'ai usage ledger');
  } catch (err: any) {
    console.warn('[ai-usage] record skipped:', err?.message ?? err);
  }
}

/** Usage/metadata an AI SDK error may carry (NoObjectGeneratedError has usage; most others none). */
export function usageFromError(err: unknown): Pick<UsageInput, 'usage' | 'providerMetadata'> {
  const e = err as any;
  return { usage: e?.usage, providerMetadata: e?.providerMetadata ?? e?.response?.providerMetadata };
}

/**
 * Runs one model call and records it: ok=true with the result's usage + gateway metadata, or
 * ok=false with whatever usage the error carries. Rethrows the original error.
 */
export async function trackAiCall<T extends { usage?: unknown; totalUsage?: unknown; providerMetadata?: unknown }>(
  ctx: AiUsageContext | undefined | null,
  model: string,
  fn: () => Promise<T>
): Promise<T> {
  const t0 = Date.now();
  try {
    const res = await fn();
    recordAiUsage(ctx, { model, usage: (res as any)?.totalUsage ?? res?.usage, providerMetadata: res?.providerMetadata, ok: true, durationMs: Date.now() - t0 });
    return res;
  } catch (err) {
    recordAiUsage(ctx, { model, ...usageFromError(err), ok: false, durationMs: Date.now() - t0 });
    throw err;
  }
}
