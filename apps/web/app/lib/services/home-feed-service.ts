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
import { buildFeedContext, readRequestInfo, softly, type ContextLoaders, type FeedProfile, type FeedRequestInfo } from '@/lib/home-feed/context';
import { HomeFeedError } from '@/lib/home-feed/http';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { runAfterResponse } from '@/lib/utils/after-response';

const RULES_CACHE_MS = 60_000;
const RULES_LOAD_TIMEOUT_MS = 800;

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

let rulesCache: { at: number; rules: FeedRule[] } | null = null;

export class HomeFeedService {
  /** Test hook / admin writes: drop this instance's rules cache. */
  static clearRulesCache(): void {
    rulesCache = null;
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

  /** Valid rules for ranking (invalid rows are skipped + logged). Cached per instance for 60 s. */
  static async loadRules(opts: { includeDisabled?: boolean; fresh?: boolean } = {}): Promise<FeedRule[]> {
    if (!opts.fresh && !opts.includeDisabled && rulesCache && Date.now() - rulesCache.at < RULES_CACHE_MS) return rulesCache.rules;
    const rows = await this.fetchRuleRows();
    const rules: FeedRule[] = [];
    for (const row of rows) {
      const parsed = parseRuleRow(row);
      if (parsed.rule) rules.push(parsed.rule);
      else console.warn(`[home-feed] rule "${row.key}" skipped (invalid): ${parsed.issues.join('; ')}`);
    }
    const result = opts.includeDisabled ? rules : rules.filter((r) => r.enabled);
    if (!opts.includeDisabled) rulesCache = { at: Date.now(), rules: result };
    return result;
  }

  /**
   * GET /api/mobile/home-feed. Never throws for context/rules trouble: the
   * worst case is the default layout. Records the decision after responding.
   */
  static async getFeed(
    profile: FeedProfile,
    info: FeedRequestInfo,
    support: ClientCardSupport,
    opts: { loaders?: ContextLoaders; now?: Date; record?: boolean } = {}
  ): Promise<HomeFeedResponse> {
    const now = opts.now ?? new Date();
    if (!isFeedEnabled(info.platform)) {
      return composeFeed({ support, ctx: null, now }).response;
    }
    const [ctx, rules] = await Promise.all([
      buildFeedContext(profile, info, { loaders: opts.loaders, now }),
      areRulesEnabled() ? softly(() => this.loadRules(), RULES_LOAD_TIMEOUT_MS) : Promise.resolve([] as FeedRule[]),
    ]);
    const result = composeFeed({ support, ctx, rules: rules ?? [], now });
    if (opts.record !== false) {
      runAfterResponse(() => this.recordDecision(profile.id, info, ctx, result), 'home-feed decision');
    }
    return result.response;
  }

  static async recordDecision(userId: string, info: FeedRequestInfo, ctx: FeedContext | null, result: ComposeResult): Promise<void> {
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
        created_at: response.generated_at,
      });
    if (error) throw error;
  }

  /** POST /api/mobile/home-feed/events — validated by the route; inserted after responding. */
  static recordEvents(userId: string, body: FeedEventsBody, now = new Date()): number {
    const rows = body.events.map((e) => ({
      decision_id: body.decision_id,
      user_id: userId,
      card_id: e.card_id,
      card_type: e.card_type,
      position: e.position,
      event: e.event,
      occurred_at: occurredAt(e.at, now),
    }));
    runAfterResponse(async () => {
      const { error } = await createAdminSupabase().from('home_feed_events').insert(rows);
      if (error) throw error;
    }, 'home-feed events');
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
  static async preview(params: URLSearchParams, opts: { loaders?: ContextLoaders; now?: Date } = {}) {
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
    const live = enabled ? composeFeed({ support, ctx, rules, includeDisabledRules: includeDisabled, now }) : composeFeed({ support, ctx: null, now });
    return {
      feed: live.response,
      killSwitch: { feedEnabled: enabled, rulesEnabled: areRulesEnabled() },
      context: { ...ctx, now: ctx.now.toISOString() },
      trace: live.trace,
      rulesEvaluated: rules.map((r) => ({ key: r.key, enabled: r.enabled, priority: r.priority, applied: live.trace.appliedRules.includes(r.key) })),
    };
  }
}
