/**
 * HomeFeedService — the I/O side of the server-driven home feed
 * (docs/HOME_FEED_SPEC.md). Ranking/guardrails are pure in lib/home-feed;
 * this loads rules + context, records decisions/events, and backs the admin
 * routes. Tables: home_feed_rules, home_feed_decisions, home_feed_events
 * (migration 106, service role only).
 */
import { z } from 'zod';

import {
  CATALOG,
  DEFAULT_ORDER,
  areRulesEnabled,
  composeFeed,
  isFeedEnabled,
  parseClientCards,
  parseRuleRow,
  ruleDefinitionSchema,
  ruleInputSchema,
  ruleKeySchema,
  type ClientCardSupport,
  type ComposeResult,
  type FeedContext,
  type FeedRule,
  type HomeFeedResponse,
} from '@/lib/home-feed';
import { swrCache } from '@/lib/home-feed/cache';
import {
  activeCampaignsCache,
  buildFeedContext,
  feedFlagsCache,
  readRequestInfo,
  softly,
  type ContextLoaders,
  type FeedProfile,
  type FeedRequestInfo,
} from '@/lib/home-feed/context';
import { localParts, resolveTimezone } from '@/lib/home-feed/context';
import { HomeFeedError } from '@/lib/home-feed/http';
import {
  PROMO_CARD_TYPE,
  PROMO_CARD_VERSION,
  SYSTEM_PROMOS,
  buildJourneyContext,
  isPromoLive,
  parsePromoClient,
  promosConfig,
  selectPromos,
  type PromoClientSupport,
  type PromoTraceEntry,
} from '@/lib/promos';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { runAfterResponse } from '@/lib/utils/after-response';

import { PromoService, defaultPromoLoaders, liveProFeaturesCache, type PromoLoaders } from './promo-service';

/** Rules: fresh 30 s, then served stale (≤ 10 min) while one refresh runs — never blocks a warm request. */
const RULES_TTL_MS = 30_000;
const RULES_MAX_STALE_MS = 600_000;
/** Cold instance only: how long a request waits for the first rules load before ranking without rules. */
const RULES_LOAD_TIMEOUT_MS = 250;
/** Requests slower than this log a timing breakdown (Vercel runtime logs). */
export const SLOW_FEED_MS = 300;

/** Filled in by the route + getFeed; sent as Server-Timing and stored on the decision row. */
export interface FeedTiming {
  authMs?: number;
  contextMs?: number;
  totalMs?: number;
}

export interface RuleRow {
  id: string;
  key: string;
  enabled: boolean;
  priority: number;
  definition: unknown;
  created_at?: string;
  updated_at?: string;
  updated_by?: string | null;
}

/** Admin view: the row + whether its definition currently validates. */
export interface AdminRule extends RuleRow {
  valid: boolean;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Events API body (spec §5)
// ---------------------------------------------------------------------------

export const MAX_EVENTS_PER_BATCH = 50;

export const feedEventsBodySchema = z
  .object({
    decision_id: z.string().uuid(),
    events: z
      .array(
        z
          .object({
            card_id: z.string().min(1).max(120),
            card_type: z.string().min(1).max(40),
            position: z.number().int().min(0).max(500),
            event: z.enum(['impression', 'tap', 'dismiss', 'cta']),
            at: z.string().max(40).optional(),
            // promo@1 cards (PROMO_CARD_SPEC §6.3): all optional.
            promo_id: z.string().regex(/^[a-z0-9_]{3,60}$/).optional(),
            creative_id: z.string().regex(/^[a-z0-9_]{1,60}$/).optional(),
            button: z.enum(['primary', 'secondary']).optional(),
          })
          .passthrough()
      )
      .min(1)
      .max(MAX_EVENTS_PER_BATCH),
  })
  .passthrough();
export type FeedEventsBody = z.infer<typeof feedEventsBodySchema>;

const EVENT_PAST_WINDOW_MS = 7 * 86_400_000;
const EVENT_FUTURE_WINDOW_MS = 60 * 60_000;

/** Client `at` → stored occurred_at, or null when missing/garbage/out of window. */
export function occurredAt(at: string | undefined, now: Date): string | null {
  if (!at) return null;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  if (t < now.getTime() - EVENT_PAST_WINDOW_MS || t > now.getTime() + EVENT_FUTURE_WINDOW_MS) return null;
  return new Date(t).toISOString();
}

// ---------------------------------------------------------------------------
// Admin PATCH body
// ---------------------------------------------------------------------------

const rulePatchSchema = z
  .object({
    id: z.string().uuid().optional(),
    key: ruleKeySchema.optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(-10000).max(10000).optional(),
    definition: z.unknown().optional(),
  })
  .strict()
  .refine((v) => v.id || v.key, { message: 'id or key is required' })
  .refine((v) => v.enabled !== undefined || v.priority !== undefined || v.definition !== undefined, {
    message: 'nothing to update (enabled | priority | definition)',
  });

/** Coarse context snapshot stored with each decision (future model training). No health values. */
export function contextSnapshot(ctx: FeedContext | null): Record<string, unknown> | null {
  if (!ctx) return null;
  return {
    timezone: ctx.timezone,
    local_hour: ctx.localHour,
    local_weekday: ctx.localWeekday,
    days_since_signup: ctx.daysSinceSignup,
    is_pro: ctx.isPro,
    subscriptions_enabled: ctx.subscriptionsEnabled,
    has_circle: ctx.hasCircle,
    circle_count: ctx.circleCount,
    campaign_present: ctx.campaign?.present ?? null,
    campaign_phase: ctx.campaign?.phase ?? null,
    referral_program_enabled: ctx.referralProgramEnabled,
    checked_in_today: ctx.checkedInToday,
    streak_at_risk: ctx.streakAtRisk,
    water_logged_today: ctx.waterLoggedToday,
    app_build: ctx.appBuild,
  };
}


export class HomeFeedService {
  /** Test hook / admin writes: drop this instance's rules cache. */
  static clearRulesCache(): void {
    enabledRulesCache.clear();
  }

  /** Test hook: drop every per-instance feed cache (rules, campaigns, flags). */
  static clearCaches(): void {
    enabledRulesCache.clear();
    activeCampaignsCache.clear();
    feedFlagsCache.clear();
    liveProFeaturesCache.clear();
  }

  /**
   * Start loading the shared caches (rules, campaigns, flags) — the route calls
   * this before auth so a cold instance overlaps them with the auth round trip.
   */
  static prewarm(): void {
    const quiet = (p: Promise<unknown>) => p.catch(() => undefined);
    if (areRulesEnabled()) void quiet(enabledRulesCache.get());
    void quiet(activeCampaignsCache.get());
    void quiet(feedFlagsCache.get());
    if (promosConfig().enabled) void quiet(liveProFeaturesCache.get());
  }

  /** All rule rows (enabled or not), newest config first. */
  static async fetchRuleRows(): Promise<RuleRow[]> {
    const { data, error } = await createAdminSupabase()
      .from('home_feed_rules')
      .select('id, key, enabled, priority, definition, created_at, updated_at, updated_by')
      .order('priority', { ascending: true });
    if (error) throw error;
    return (data ?? []) as RuleRow[];
  }

  /** Valid rules for ranking (invalid rows are skipped + logged). Enabled rules are cached per instance (stale-while-revalidate). */
  static async loadRules(opts: { includeDisabled?: boolean; fresh?: boolean } = {}): Promise<FeedRule[]> {
    if (!opts.fresh && !opts.includeDisabled) return enabledRulesCache.get();
    return this.parseRules(await this.fetchRuleRows(), opts.includeDisabled === true);
  }

  static parseRules(rows: RuleRow[], includeDisabled: boolean): FeedRule[] {
    const rules: FeedRule[] = [];
    for (const row of rows) {
      const parsed = parseRuleRow(row);
      if (parsed.rule) rules.push(parsed.rule);
      else console.warn(`[home-feed] rule "${row.key}" skipped (invalid): ${parsed.issues.join('; ')}`);
    }
    return includeDisabled ? rules : rules.filter((r) => r.enabled);
  }

  /**
   * GET /api/mobile/home-feed. Never throws for context/rules trouble: the
   * worst case is the default layout. Records the decision after responding.
   */
  static async getFeed(
    profile: FeedProfile,
    info: FeedRequestInfo,
    support: ClientCardSupport,
    opts: {
      loaders?: ContextLoaders;
      promoLoaders?: PromoLoaders;
      /** promo@1 support (`actions=`, `promoLayouts=`). Default: derived from `cards=` with no actions → no promos. */
      promoClient?: PromoClientSupport;
      now?: Date;
      record?: boolean;
      timing?: FeedTiming;
    } = {}
  ): Promise<HomeFeedResponse> {
    const now = opts.now ?? new Date();
    const timing = opts.timing ?? {};
    const started = performance.now();
    if (!isFeedEnabled(info.platform)) {
      return composeFeed({ support, ctx: null, now }).response;
    }
    const promoClient = opts.promoClient ?? defaultPromoClient(support);
    const promoRound = this.promoRound(profile, info, promoClient, now, opts.promoLoaders);
    const [ctx, rules, promoData] = await Promise.all([
      buildFeedContext(profile, info, { loaders: opts.loaders, now }),
      areRulesEnabled() ? softly(() => this.loadRules(), RULES_LOAD_TIMEOUT_MS) : Promise.resolve([] as FeedRule[]),
      promoRound,
    ]);
    timing.contextMs = Math.round(performance.now() - started);
    const promos = this.selectPromosFor(profile, ctx, promoClient, promoData);
    const result = composeFeed({ support, ctx, rules: rules ?? [], now, ...promos.compose });
    if (promos.trace) result.trace.promos = promos.trace;
    if (opts.record !== false) {
      // Runs after the response, by which time the route has set timing.totalMs.
      runAfterResponse(() => this.recordDecision(profile.id, info, ctx, result, timing), 'home-feed decision');
    }
    return result.response;
  }

  /**
   * The promo reads (journey facts, promo_user_state, live Pro gates) — in the
   * SAME parallel round as the feed context, each capped at the 250 ms budget.
   * Skipped entirely (zero cost) unless PROMOS_ENABLED and the client declared promo@1.
   */
  static async promoRound(profile: FeedProfile, info: FeedRequestInfo, client: PromoClientSupport, now: Date, loaders: PromoLoaders = defaultPromoLoaders): Promise<PromoRoundData | null> {
    if (!promosConfig().enabled || !client.promoCard) return null;
    const timezone = resolveTimezone(info, profile);
    const localDate = localParts(now, timezone).date;
    const [facts, state, liveProFeatures] = await Promise.all([
      softly(() => loaders.journeyFacts(profile.id, localDate)),
      softly(() => loaders.promoState(profile.id)),
      softly(() => loaders.liveProFeatures()),
    ]);
    return { facts, state, liveProFeatures, timezone, localDate };
  }

  /** Pure-ish: promo candidates + what they replace, for composeFeed. */
  static selectPromosFor(
    profile: FeedProfile,
    ctx: FeedContext,
    client: PromoClientSupport,
    data: PromoRoundData | null
  ): { compose: { promos?: ReturnType<typeof selectPromos>['candidates']; replacedTypes?: Set<string>; promoV1: boolean }; trace: PromoTraceEntry[] | null } {
    const cfg = promosConfig();
    const promoV1 = client.promoCard;
    if (!cfg.enabled || !client.promoCard || !data) return { compose: { promoV1 }, trace: null };
    const journey = buildJourneyContext(profile, data.facts, { now: ctx.now, timezone: data.timezone, localDate: data.localDate });
    const { candidates, trace } = selectPromos({
      definitions: SYSTEM_PROMOS,
      ctx,
      journey,
      state: data.state,
      liveProFeatures: data.liveProFeatures,
      client,
      config: cfg,
    });
    // pro_value replaces the legacy pro_upsell card for promo@1 clients (while pro_value is live).
    const replacedTypes = new Set<string>(isPromoLive('pro_value', cfg) ? ['pro_upsell'] : []);
    return { compose: { promos: candidates, replacedTypes, promoV1 }, trace };
  }

  static async recordDecision(userId: string, info: FeedRequestInfo, ctx: FeedContext | null, result: ComposeResult, timing: FeedTiming = {}): Promise<void> {
    const { response, trace } = result;
    const { error } = await createAdminSupabase()
      .from('home_feed_decisions')
      .insert({
        id: response.decision_id,
        user_id: userId,
        layout_key: response.layout_key,
        experiment_key: response.experiment?.key ?? null,
        experiment_arm: response.experiment?.arm ?? null,
        cards: response.cards.map((c) => ({ id: c.id, type: c.type, version: c.version, ...(c.variant ? { variant: c.variant } : {}) })),
        applied_rules: trace.appliedRules,
        context: contextSnapshot(ctx),
        platform: info.platform,
        app_version: info.appVersion,
        server_ms: timing.totalMs ?? null,
        created_at: response.generated_at,
      });
    if (error) throw error;
  }

  /**
   * POST /api/mobile/home-feed/events — validated by the route; inserted after
   * responding. Promo events (card_id `promo:<key>` or promo_id) also update
   * promo_user_state (caps, dismissal, taps) in the viewer's local day.
   */
  static recordEvents(userId: string, body: FeedEventsBody, now = new Date(), timezone = 'UTC'): number {
    const rows = body.events.map((e) => {
      const promoKey = e.promo_id ?? (e.card_id.startsWith('promo:') ? e.card_id.slice('promo:'.length) : undefined);
      return {
        decision_id: body.decision_id,
        user_id: userId,
        card_id: e.card_id,
        card_type: e.card_type,
        position: e.position,
        event: e.event,
        occurred_at: occurredAt(e.at, now),
        // Promo columns (migration 110) only on promo events, so non-promo batches are unchanged.
        ...(promoKey ? { promo_key: promoKey, creative_id: e.creative_id ?? null, button: e.button ?? null } : {}),
      };
    });
    runAfterResponse(async () => {
      const { error } = await createAdminSupabase().from('home_feed_events').insert(rows);
      if (error) throw error;
    }, 'home-feed events');
    const promoEvents = body.events
      .map((e, i) => ({ card_id: e.card_id, event: e.event, promo_id: e.promo_id, creative_id: e.creative_id, button: e.button, occurredAt: rows[i].occurred_at }))
      .filter((e) => e.promo_id || e.card_id.startsWith('promo:'));
    if (promoEvents.length > 0) {
      runAfterResponse(() => PromoService.recordFeedEvents(userId, promoEvents, timezone, now), 'promo state');
    }
    return rows.length;
  }

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  static toAdmin(row: RuleRow): AdminRule {
    const parsed = parseRuleRow(row);
    return { ...row, valid: parsed.rule !== null, issues: parsed.issues ?? [] };
  }

  static async listRules(): Promise<AdminRule[]> {
    return (await this.fetchRuleRows()).map((r) => this.toAdmin(r));
  }

  /** POST: flat `{ key, enabled?, priority?, ...definition }` (new rules default to disabled). */
  static async createRule(body: unknown, updatedBy: string | null): Promise<AdminRule> {
    const input = ruleInputSchema.parse(body ?? {});
    const { data, error } = await createAdminSupabase()
      .from('home_feed_rules')
      .insert({ key: input.key, enabled: input.enabled, priority: input.priority, definition: input.definition, updated_by: updatedBy })
      .select('id, key, enabled, priority, definition, created_at, updated_at, updated_by')
      .single();
    if (error) {
      if ((error as any).code === '23505') throw new HomeFeedError(409, 'RULE_EXISTS', `A rule with key "${input.key}" already exists`);
      throw error;
    }
    this.clearRulesCache();
    return this.toAdmin(data as RuleRow);
  }

  /** PATCH: `{ id | key, enabled?, priority?, definition? }` — definition is fully replaced and re-validated. */
  static async patchRule(body: unknown, updatedBy: string | null): Promise<AdminRule> {
    const patch = rulePatchSchema.parse(body ?? {});
    const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: updatedBy };
    if (patch.enabled !== undefined) update.enabled = patch.enabled;
    if (patch.priority !== undefined) update.priority = patch.priority;
    if (patch.definition !== undefined) update.definition = ruleDefinitionSchema.parse(patch.definition);

    let q = createAdminSupabase().from('home_feed_rules').update(update);
    q = patch.id ? q.eq('id', patch.id) : q.eq('key', patch.key!);
    const { data, error } = await q.select('id, key, enabled, priority, definition, created_at, updated_at, updated_by').maybeSingle();
    if (error) throw error;
    if (!data) throw new HomeFeedError(404, 'NOT_FOUND', 'Rule not found');
    this.clearRulesCache();
    return this.toAdmin(data as RuleRow);
  }

  /**
   * GET /api/admin/home-feed/preview — the layout user X would get right now,
   * plus the context and a trace. Never records a decision.
   * Query: userId (required), cards (default: the full v1 catalog), platform,
   * version, build, timezone, includeDisabled=true (evaluate disabled rules too).
   */
  static async preview(params: URLSearchParams, opts: { loaders?: ContextLoaders; promoLoaders?: PromoLoaders; now?: Date } = {}) {
    const userId = params.get('userId');
    if (!userId || !z.string().uuid().safeParse(userId).success) throw new HomeFeedError(400, 'USER_ID_REQUIRED', 'userId (uuid) is required');
    const { data: profile, error } = await createAdminSupabase().from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!profile) throw new HomeFeedError(404, 'NOT_FOUND', 'User not found');

    const headers = new Headers();
    const map: Record<string, string> = { platform: 'x-app-platform', version: 'x-app-version', build: 'x-app-build', timezone: 'x-client-timezone' };
    for (const [param, header] of Object.entries(map)) {
      const v = params.get(param);
      if (v) headers.set(header, v);
    }
    const info = readRequestInfo({ headers });
    const support = parseClientCards(params.get('cards') ?? DEFAULT_ORDER.map((t) => `${t}@${CATALOG[t].version}`).join(','));
    const includeDisabled = params.get('includeDisabled') === 'true';
    const now = opts.now ?? new Date();
    const enabled = isFeedEnabled(info.platform);

    const ctx = await buildFeedContext(profile as FeedProfile, info, { loaders: opts.loaders, now });
    const rules = areRulesEnabled() ? await this.loadRules({ includeDisabled, fresh: true }) : [];
    // promo@1 preview: pass cards=…,promo@1&actions=…&promoLayouts=… like a client would.
    const promoClient = parsePromoClient({
      cardsSupportPromo: (support.get(PROMO_CARD_TYPE) ?? 0) >= PROMO_CARD_VERSION,
      actions: params.get('actions'),
      promoLayouts: params.get('promoLayouts'),
    });
    const promoData = enabled ? await this.promoRound(profile as FeedProfile, info, promoClient, now, opts.promoLoaders) : null;
    const promos = this.selectPromosFor(profile as FeedProfile, ctx, promoClient, promoData);
    const live = enabled
      ? composeFeed({ support, ctx, rules, includeDisabledRules: includeDisabled, now, ...promos.compose })
      : composeFeed({ support, ctx: null, now });
    if (enabled && promos.trace) live.trace.promos = promos.trace;
    return {
      feed: live.response,
      killSwitch: { feedEnabled: enabled, rulesEnabled: areRulesEnabled() },
      context: { ...ctx, now: ctx.now.toISOString() },
      trace: live.trace,
      rulesEvaluated: rules.map((r) => ({ key: r.key, enabled: r.enabled, priority: r.priority, applied: live.trace.appliedRules.includes(r.key) })),
    };
  }
}

/** What the promo read round returned (each part null = unknown). */
export interface PromoRoundData {
  facts: Awaited<ReturnType<PromoLoaders['journeyFacts']>> | null;
  state: Awaited<ReturnType<PromoLoaders['promoState']>> | null;
  liveProFeatures: Set<string> | null;
  timezone: string;
  localDate: string;
}

/** promo@1 support when the caller didn't parse `actions=` / `promoLayouts=` (e.g. admin preview default). */
export function defaultPromoClient(support: ClientCardSupport): PromoClientSupport {
  return {
    promoCard: (support.get(PROMO_CARD_TYPE) ?? 0) >= PROMO_CARD_VERSION,
    actions: new Map([['dismiss', 1]]),
    layouts: new Set(),
  };
}

const enabledRulesCache = swrCache<FeedRule[]>(async () => HomeFeedService.parseRules(await HomeFeedService.fetchRuleRows(), false), {
  ttlMs: RULES_TTL_MS,
  maxStaleMs: RULES_MAX_STALE_MS,
  label: 'rules',
});
