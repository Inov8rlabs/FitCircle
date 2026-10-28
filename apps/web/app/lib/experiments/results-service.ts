/**
 * GET /api/admin/experiments/{key}/results — loads the facts for every
 * analysed user from our database (never Amplitude) and hands them to the pure
 * computation in results.ts (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.6).
 *
 * Sources: experiment_assignments ⨝ profiles (onboarding, paywall, trial) ⨝
 * user_attribution (channel, country) ⨝ subscription_events (purchases,
 * renewals, cancellations, refunds — USD `price`, SANDBOX excluded) ⨝ activity
 * (food_log_entries, streak_claims).
 *
 * Cached per (experiment, segment) for 15 minutes in the function instance;
 * `fresh` bypasses it.
 */
import { isProductionDeployment } from '../analytics/amplitude-server';
import { createAdminSupabase } from '../supabase-admin';

import { amplitudeReadout } from './analytics';
import { computeResults, segmentValue, type ResultsBlock, type SegmentDimension, type UserFacts } from './results';
import { ExperimentService, notFoundExperiment, selectAllPages, type AssignmentRow } from './service';

export const RESULTS_CACHE_TTL_MS = 15 * 60_000;
const CHUNK = 200;

export interface ExperimentResults extends ResultsBlock {
  experimentKey: string;
  status: string;
  arms: string[];
  control: string;
  computedAt: string;
  cached: boolean;
  /** Mutual-exclusion layer (null = non-layered). */
  layer: { key: string; name: string | null; start: number; end: number } | null;
  /** Assignment rows left out of the analysis. */
  excluded: { unexposed: number; overrides: number; fallback: number; winner: number; layer: number; layerConflict: number };
  segment: SegmentDimension | null;
  segments: Array<{ value: string } & ResultsBlock> | null;
  /** Link-only Amplitude readout (user property exp_<key>). */
  amplitude: ReturnType<typeof amplitudeReadout>;
}

const cache = new Map<string, { at: number; value: ExperimentResults }>();

/** Test hook. */
export function clearResultsCache(): void {
  cache.clear();
}

const ms = (v: unknown): number | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

async function inChunks<T>(ids: readonly string[], load: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await load(ids.slice(i, i + CHUNK))));
  return out;
}

function group<T extends { user_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.user_id);
    if (list) list.push(r);
    else m.set(r.user_id, [r]);
  }
  return m;
}

const REVENUE_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE']);

/** RevenueCat event → its facts (time, USD price, kind). */
function eventFacts(e: Record<string, any>) {
  const raw = (e.raw ?? {}) as Record<string, any>;
  const at = ms(e.event_timestamp) ?? ms(raw.event_timestamp_ms) ?? ms(e.processed_at);
  const price = typeof raw.price === 'number' && Number.isFinite(raw.price) ? raw.price : 0;
  return { at, price, type: String(e.type ?? raw.type ?? ''), periodType: raw.period_type as string | undefined, cancelReason: raw.cancel_reason as string | undefined };
}

export async function loadUserFacts(rows: readonly AssignmentRow[]): Promise<UserFacts[]> {
  const ids = rows.map((r) => r.user_id);
  if (!ids.length) return [];
  const supabase = createAdminSupabase();
  const since = new Date(Math.min(...rows.map((r) => Date.parse(r.assigned_at))) - 3_600_000).toISOString();

  const [profiles, attribution, events, meals, claims] = await Promise.all([
    inChunks(ids, async (part) => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, onboarding_completed_at, onboarding_paywall_at, paywall_aha_shown_at, paywall_auto_last_at, trial_started_at, trial_ends_at, trial_converted_at, country_code')
        .in('id', part);
      if (error) throw new Error(`profiles read failed: ${error.message}`);
      return (data ?? []) as Record<string, any>[];
    }),
    inChunks(ids, async (part) => {
      const { data } = await supabase.from('user_attribution').select('user_id, channel, country, is_test').in('user_id', part);
      return (data ?? []) as Record<string, any>[];
    }),
    inChunks(ids, (part) =>
      selectAllPages<Record<string, any>>(() =>
        supabase.from('subscription_events').select('id, user_id, type, environment, event_timestamp, processed_at, raw').in('user_id', part).order('id', { ascending: true })
      )
    ),
    inChunks(ids, (part) =>
      selectAllPages<Record<string, any>>(() =>
        supabase
          .from('food_log_entries')
          .select('id, user_id, entry_type, created_at, deleted_at')
          .in('user_id', part)
          .gte('created_at', since)
          .order('id', { ascending: true })
      )
    ),
    inChunks(ids, (part) =>
      selectAllPages<Record<string, any>>(() =>
        supabase.from('streak_claims').select('id, user_id, claim_date').in('user_id', part).gte('claim_date', since.slice(0, 10)).order('id', { ascending: true })
      )
    ),
  ]);

  const profileBy = new Map(profiles.map((p) => [p.id as string, p]));
  const attributionBy = new Map(attribution.map((a) => [a.user_id as string, a]));
  const eventsBy = group(events.filter((e) => e.environment !== 'SANDBOX') as { user_id: string }[]);
  const mealsBy = group(meals.filter((m) => !m.deleted_at) as { user_id: string }[]);
  const claimsBy = group(claims as { user_id: string }[]);

  return rows.map((r) => {
    const p = profileBy.get(r.user_id) ?? {};
    const a = attributionBy.get(r.user_id);
    const trialStartedAt = ms(p.trial_started_at);
    const trialEndsAt = ms(p.trial_ends_at);
    const evs = ((eventsBy.get(r.user_id) ?? []) as Record<string, any>[]).map(eventFacts).filter((e) => e.at !== null) as Array<ReturnType<typeof eventFacts> & { at: number }>;
    evs.sort((x, y) => x.at - y.at);

    const revenue: UserFacts['revenue'] = [];
    let directPurchaseAt: number | null = null;
    let refundAt: number | null = null;
    let trialCancelledAt: number | null = null;
    for (const e of evs) {
      const isRefund = e.type === 'CANCELLATION' && (e.cancelReason === 'CUSTOMER_SUPPORT' || e.price < 0);
      if (REVENUE_TYPES.has(e.type) && !(e.type === 'INITIAL_PURCHASE' && e.periodType === 'TRIAL')) {
        if (e.price > 0) revenue.push({ at: e.at, usd: e.price });
        if ((e.type === 'INITIAL_PURCHASE' || e.type === 'NON_RENEWING_PURCHASE') && directPurchaseAt === null) directPurchaseAt = e.at;
      }
      if (isRefund) {
        if (e.price !== 0) revenue.push({ at: e.at, usd: -Math.abs(e.price) });
        refundAt ??= e.at;
      } else if (e.type === 'CANCELLATION' && trialStartedAt !== null && trialCancelledAt === null && e.at >= trialStartedAt && e.at <= (trialEndsAt ?? trialStartedAt + 3 * 86_400_000)) {
        trialCancelledAt = e.at;
      }
    }

    const mealRows = (mealsBy.get(r.user_id) ?? []) as Record<string, any>[];
    const mealAt = mealRows.filter((m) => m.entry_type === 'food').map((m) => ms(m.created_at)).filter((t): t is number => t !== null);
    // A claim is a local calendar day; noon UTC sits inside it for every timezone within ±12 h.
    const claimAt = ((claimsBy.get(r.user_id) ?? []) as Record<string, any>[]).map((c) => ms(`${c.claim_date}T12:00:00Z`)).filter((t): t is number => t !== null);
    const loggedAt = mealRows.map((m) => ms(m.created_at)).filter((t): t is number => t !== null);
    const paywalls = [ms(p.onboarding_paywall_at), ms(p.paywall_aha_shown_at), ms(p.paywall_auto_last_at)].filter((t): t is number => t !== null);

    return {
      userId: r.user_id,
      arm: r.arm,
      assignedAt: Date.parse(r.assigned_at),
      platform: r.platform ?? null,
      channel: a && a.is_test !== true ? (a.channel ?? null) : null,
      country: r.country ?? (a?.country as string | null) ?? (p.country_code as string | null) ?? null,
      onboardingCompletedAt: ms(p.onboarding_completed_at),
      paywallViewedAt: paywalls.length ? Math.min(...paywalls) : null,
      trialStartedAt,
      trialEndsAt,
      trialConvertedAt: ms(p.trial_converted_at),
      directPurchaseAt,
      trialCancelledAt,
      refundAt,
      revenue,
      activityAt: [...loggedAt, ...claimAt],
      mealAt,
      deletedAt: ms(r.user_deleted_at),
    } satisfies UserFacts;
  });
}

export class ExperimentResultsService {
  static async results(key: string, opts: { segment?: SegmentDimension | null; fresh?: boolean; now?: Date } = {}): Promise<ExperimentResults> {
    const segment = opts.segment ?? null;
    const cacheKey = `${key}|${segment ?? ''}`;
    const nowMs = (opts.now ?? new Date()).getTime();
    const hit = cache.get(cacheKey);
    if (!opts.fresh && hit && nowMs - hit.at < RESULTS_CACHE_TTL_MS) return { ...hit.value, cached: true };

    const experiment = await ExperimentService.get(key);
    if (!experiment) throw notFoundExperiment(key);
    const arms = experiment.arms.map((a) => a.key);
    const control = arms.includes('control') ? 'control' : experiment.fallbackArm;

    const rows = await ExperimentService.listAssignments(key);
    const excluded = { unexposed: 0, overrides: 0, fallback: 0, winner: 0, layer: 0, layerConflict: 0 };
    const analysed: AssignmentRow[] = [];
    for (const r of rows) {
      if (r.reason === 'override') excluded.overrides++;
      else if (r.reason === 'fallback') excluded.fallback++;
      else if (r.reason === 'winner') excluded.winner++;
      else if (r.reason === 'layer') excluded.layer++;
      else if (r.reason === 'layer_conflict') excluded.layerConflict++;
      else if (!r.first_exposed_at) excluded.unexposed++;
      else analysed.push(r);
    }

    const layerRow = experiment.layer ? await ExperimentService.getLayer(experiment.layer.key) : null;
    const layer = experiment.layer ? { key: experiment.layer.key, name: layerRow?.name ?? null, start: experiment.layer.start, end: experiment.layer.end } : null;

    const facts = await loadUserFacts(analysed);
    const seed = `${key}|${experiment.salt}`;
    const overall = computeResults(facts, arms, control, nowMs, seed);

    let segments: ExperimentResults['segments'] = null;
    if (segment) {
      const byValue = new Map<string, UserFacts[]>();
      for (const u of facts) {
        const v = segmentValue(u, segment);
        const list = byValue.get(v);
        if (list) list.push(u);
        else byValue.set(v, [u]);
      }
      segments = [...byValue.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([value, users]) => ({ value, ...computeResults(users, arms, control, nowMs, `${seed}|${segment}:${value}`) }));
    }

    const value: ExperimentResults = {
      experimentKey: key,
      status: experiment.status,
      arms,
      control,
      computedAt: new Date(nowMs).toISOString(),
      cached: false,
      layer,
      excluded,
      segment,
      ...overall,
      segments,
      amplitude: amplitudeReadout(key, isProductionDeployment()),
    };
    cache.set(cacheKey, { at: nowMs, value });
    return value;
  }
}
