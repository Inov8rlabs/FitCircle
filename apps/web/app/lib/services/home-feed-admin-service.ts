/**
 * HomeFeedAdminService — backs the Admin Tools "Home feed" editor
 * (docs/HOME_FEED_SPEC.md §9 "Editor"): draft previews (before/after),
 * atomic publish with optimistic concurrency, durable history
 * (home_feed_rule_changes, migration 125) and revert.
 *
 * Publish is "transaction-equivalent" without stored procedures:
 *   1. claim the next ruleset revision by inserting a `pending` change row
 *      (UNIQUE seq → two concurrent publishes can't both claim it),
 *   2. one multi-row upsert (creates / updates / enable / disable — a single
 *      INSERT … ON CONFLICT statement, atomic in Postgres),
 *   3. one delete … where key in (…) (atomic),
 *   4. on failure in 2–3: compensate in TS (restore every touched key to its
 *      before-state, delete created keys) and mark the row `rolled_back`;
 *      on success mark it `applied` with the read-back ruleset.
 * Only step 3 can leave step 2 to undo, so the compensation window is one
 * statement wide.
 */
import { randomUUID } from 'node:crypto';

import { type AdminCaller } from '@/lib/campaigns/admin-auth';
import {
  CATALOG,
  DEFAULT_ORDER,
  EXTRA_CARDS,
  areRulesEnabled,
  composeFeed,
  isFeedEnabled,
  isPublishEnabled,
  parseClientCards,
  type ClientCardSupport,
  type ComposeResult,
  type FeedCard,
  type FeedContext,
} from '@/lib/home-feed';
import {
  applyChanges,
  diffRulesets,
  draftPreviewBodySchema,
  flatDefinition,
  publishBodySchema,
  resolveDraftRuleset,
  revertBodySchema,
  rowToFlat,
  rulesetVersion,
  toFeedRules,
  type ChangeIssue,
  type FlatRule,
  type RuleChange,
} from '@/lib/home-feed/admin/ruleset';
import { activeCampaignsCache, buildFeedContext, defaultContextLoaders, readRequestInfo, type ContextLoaders, type FeedProfile, type FeedRequestInfo } from '@/lib/home-feed/context';
import { HomeFeedError } from '@/lib/home-feed/http';
import { DEFAULT_SAMPLE, personaLifecycle, type PersonaSample, type ProLifecycleState } from '@/lib/pro-lifecycle';
import { completionView } from '@/lib/profile-completion/model';
import { PROMO_CARD_TYPE, PROMO_CARD_VERSION, parsePromoClient, type PromoClientSupport } from '@/lib/promos';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { HomeFeedService, type PromoRoundData, type RuleRow } from './home-feed-service';
import { readPublishedConfig, type PublishedConfig } from './pro-lifecycle-service';
import { liveProFeaturesCache, type PromoLoaders } from './promo-service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** App version the before/after layout snapshots in the audit log are computed for (current store versions). */
export const SNAPSHOT_APP_VERSION = '1.1.0';
/** The synthetic "typical user" (never a real profile id: version-4 UUID with an all-zero body). */
export const PERSONA_USER_ID = '00000000-0000-4000-8000-000000000001';
/** A pending change row younger than this blocks other publishes (a publish in flight). */
export const PENDING_LOCK_MS = 120_000;
export const MAX_CHANGES_PAGE = 100;

/**
 * How a publish reaches users. The rules cache (home-feed-service.ts) is
 * fresh for 30 s per server instance and refreshes in the background, so
 * other instances serve the new rules within ~30 s (one more request may get
 * the old ones while the refresh runs). Apps reuse a layout for up to
 * ttl_seconds (900 s) and only apply a new one on the next Home appearance.
 */
export const PROPAGATION = {
  thisInstance: 'immediate (rules cache cleared)',
  otherInstances: 'within ~30 s (per-instance rules cache, refreshed in the background)',
  apps: 'on the next home feed fetch: apps reuse a layout for up to 15 min (ttl_seconds 900) and apply a new one on the next Home appearance',
} as const;

const CHANGE_COLUMNS =
  'id, seq, created_at, applied_at, actor_email, actor_user_id, action, status, summary, note, base_version, version_after, rules_before, rules_after, diff, layout_before, layout_after, reverts_change_id, request_id, error';

// ---------------------------------------------------------------------------
// Client declarations (what each app build sends as cards= / actions=)
// ---------------------------------------------------------------------------

const IOS_108_CARDS = DEFAULT_ORDER.filter((t) => t !== 'missing_days');
const WEB_CARDS = ['header', 'campaign', 'hydration', 'referral', 'pro_upsell', 'streak_warning', 'daily_goals', 'fitzy_focus', 'progress', 'vitals', 'body_comp', 'past_date_log', 'charts'];
/** iOS PromoActionRunner.supportedActions / Android PromoModels (ACTIVATION_JOURNEY_SPEC Appendix A.2). */
const PROMO_ACTIONS = 'open_screen@1,paywall@1,invite@1,start_circle@1,enable_notifications@1,open_url@1,dismiss@1';
const PROMO_LAYOUTS = 'hero,banner,compact';

const atLeast = (version: string, min: number[]) => {
  const v = version.split('.').map(Number);
  for (let i = 0; i < min.length; i++) {
    const d = (v[i] ?? 0) - min[i];
    if (d !== 0) return d > 0;
  }
  return true;
};

/**
 * The `cards=` / `actions=` / `promoLayouts=` a shipped build sends:
 * 1.0.8–1.0.9 = spec §2 lists (Android adds missing_days); 1.1.0+ also
 * declares promo@1 (+ actions/layouts) and circle_chat@1. Web: its own list.
 */
export function defaultClientDeclaration(platform: 'ios' | 'android' | 'web', version: string): { cards: string; actions: string | null; promoLayouts: string | null } {
  if (platform === 'web') return { cards: WEB_CARDS.map((t) => `${t}@1`).join(','), actions: null, promoLayouts: null };
  const types: string[] = platform === 'android' ? [...DEFAULT_ORDER] : [...IOS_108_CARDS];
  const v110 = atLeast(version, [1, 1, 0]);
  if (v110) types.push('promo', 'circle_chat');
  return {
    cards: types.map((t) => `${t}@${CATALOG[t]?.version ?? 1}`).join(','),
    actions: v110 ? PROMO_ACTIONS : null,
    promoLayouts: v110 ? PROMO_LAYOUTS : null,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangeRow {
  id: string;
  seq: number;
  created_at: string;
  applied_at: string | null;
  actor_email: string | null;
  actor_user_id: string | null;
  action: 'publish' | 'revert';
  status: 'pending' | 'applied' | 'rolled_back' | 'failed';
  summary: string;
  note: string | null;
  base_version: string;
  version_after: string | null;
  rules_before: FlatRule[];
  rules_after: FlatRule[] | null;
  diff: { changes: RuleChange[]; descriptions?: string[] } | null;
  layout_before: LayoutSnapshot | null;
  layout_after: LayoutSnapshot | null;
  reverts_change_id: string | null;
  request_id: string | null;
  error: string | null;
}

/** Card ids of the typical-user layout per platform at publish time. */
export interface LayoutSnapshot {
  appVersion: string;
  persona: 'typical';
  ios: string[];
  android: string[];
}

export interface ChangeEntry {
  id: string;
  seq: number;
  createdAt: string;
  appliedAt: string | null;
  actorEmail: string | null;
  action: 'publish' | 'revert';
  status: ChangeRow['status'];
  summary: string;
  note: string | null;
  baseVersion: string;
  versionAfter: string | null;
  changes: RuleChange[];
  descriptions: string[];
  rulesBefore: FlatRule[];
  rulesAfter: FlatRule[] | null;
  layoutBefore: LayoutSnapshot | null;
  layoutAfter: LayoutSnapshot | null;
  revertsChangeId: string | null;
  requestId: string | null;
  error: string | null;
}

export function toChangeEntry(row: ChangeRow): ChangeEntry {
  return {
    id: row.id,
    seq: Number(row.seq),
    createdAt: row.created_at,
    appliedAt: row.applied_at ?? null,
    actorEmail: row.actor_email ?? null,
    action: row.action,
    status: row.status,
    summary: row.summary,
    note: row.note ?? null,
    baseVersion: row.base_version,
    versionAfter: row.version_after ?? null,
    changes: row.diff?.changes ?? [],
    descriptions: row.diff?.descriptions ?? [],
    rulesBefore: row.rules_before ?? [],
    rulesAfter: row.rules_after ?? null,
    layoutBefore: row.layout_before ?? null,
    layoutAfter: row.layout_after ?? null,
    revertsChangeId: row.reverts_change_id ?? null,
    requestId: row.request_id ?? null,
    error: row.error ?? null,
  };
}

export interface Subject {
  kind: 'user' | 'actor' | 'persona';
  profile: FeedProfile;
  loaders?: ContextLoaders;
  /** Persona in a Pro lifecycle state: promos are evaluated with this synthetic input. */
  lifecycle?: { state: ProLifecycleState; pub: PublishedConfig; sample: PersonaSample };
}

/** Preview personas: the typical member, and the same member while free Pro is ending / has ended. */
export const PREVIEW_PERSONAS = ['typical', 'pro_expiring', 'pro_expired'] as const;
export type PreviewPersona = (typeof PREVIEW_PERSONAS)[number];

export interface PreviewSide {
  feed: ComposeResult['response'];
  trace: ComposeResult['trace'];
  /** Card ids in final order. */
  order: string[];
}

export interface ServiceOpts {
  loaders?: ContextLoaders;
  promoLoaders?: PromoLoaders;
  now?: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const db = () => createAdminSupabase();

/** Never show another member's name or message in the admin preview (circle_chat props carry them). */
function redactCard(card: FeedCard): FeedCard {
  if (card.type !== 'circle_chat' || !card.props) return card;
  const { unread_count, total_unread, circles_with_unread } = card.props;
  return { ...card, props: { unread_count, total_unread, circles_with_unread } };
}

function redactContext(ctx: FeedContext): Record<string, unknown> {
  const { chatUnread, now, ...rest } = ctx;
  return {
    ...rest,
    now: now.toISOString(),
    ...(chatUnread !== undefined ? { chatUnread: chatUnread ? { total_unread: chatUnread.total_unread, circles_with_unread: chatUnread.circles_with_unread, unread_count: chatUnread.unread_count } : null } : {}),
  };
}

function side(result: ComposeResult): PreviewSide {
  const feed = { ...result.response, cards: result.response.cards.map(redactCard) };
  return { feed, trace: result.trace, order: feed.cards.map((c) => c.id) };
}

export function personaProfile(now: Date, timezone: string | undefined): FeedProfile {
  return {
    id: PERSONA_USER_ID,
    display_name: 'Alex',
    timezone: timezone ?? 'America/Los_Angeles',
    subscription_tier: 'free',
    created_at: new Date(now.getTime() - 60 * 86_400_000).toISOString(),
  };
}

/**
 * The typical member's profile answers (profile_completion@1): onboarded through v3, which saved height, weight
 * and sex to the profile but never goal / activity — so goal, goal weight, birth year and activity are still open.
 */
const PERSONA_COMPLETION_PROFILE = { onboarding_completed: true, height_cm: 170, weight_kg: 75, gender: 'prefer_not_to_say', goals: [], preferences: {} };

/**
 * A representative member: free, 60 days in, one circle, not checked in yet, no water yet, a couple of unread chats,
 * a partly answered profile (shows profile_completion@1 when the preview declares it). Campaign + flags are the real global state.
 */
/**
 * A Pro lifecycle persona's subject: the typical member with free Pro ending
 * tomorrow / ended yesterday (referral week, sample usage), so the editor can
 * see the whole feed with the lifecycle card in place. `pub` = the config to
 * render with (published, or the lifecycle editor's draft).
 */
export function lifecyclePersonaSubject(state: ProLifecycleState, now: Date, timezone: string | undefined, pub: PublishedConfig, loaders?: ContextLoaders, sample: PersonaSample = DEFAULT_SAMPLE): Subject {
  const base = personaProfile(now, timezone);
  const { profile } = personaLifecycle(state, now, String(base.timezone), pub.config, sample);
  return { kind: 'persona', profile: { ...base, ...profile } as FeedProfile, loaders: personaLoaders(loaders), lifecycle: { state, pub, sample } };
}

/** The promo round for a persona: one logged meal, no promo history, the live Pro gates, and its lifecycle input. */
export async function personaPromoRound(subject: Subject, ctx: FeedContext): Promise<PromoRoundData | null> {
  if (!subject.lifecycle) return null;
  const { state, pub, sample } = subject.lifecycle;
  const { input } = personaLifecycle(state, ctx.now, ctx.timezone, pub.config, sample);
  let live: Set<string> | null = null;
  try {
    live = await liveProFeaturesCache.get();
  } catch {
    live = null;
  }
  return {
    facts: { lastMeal: { title: 'Grilled chicken salad', meal_type: 'lunch', logged_at: new Date(ctx.now.getTime() - 86_400_000).toISOString() }, recentEntries: [] },
    state: new Map(),
    liveProFeatures: live,
    timezone: ctx.timezone,
    localDate: ctx.localDate,
    lifecycle: { pub, input },
  };
}

export function personaLoaders(base: ContextLoaders = defaultContextLoaders): ContextLoaders {
  return {
    campaign: base.campaign,
    referralProgramEnabled: base.referralProgramEnabled,
    subscriptionsEnabled: base.subscriptionsEnabled,
    activeCircleCount: async () => 1,
    checkedIn: async () => false,
    waterTodayMl: async () => 0,
    chatUnread: async () => ({ total_unread: 2, circles_with_unread: 1, circle_id: null, circle_name: null, unread_count: 2, sender_display_name: null, preview: null }),
    profileCompletion: async () => ({
      onboardingCompleted: true,
      snoozed: false,
      view: completionView({ profile: PERSONA_COMPLETION_PROFILE, onboardingData: null, latestWeightKg: null }),
    }),
  };
}

function displayName(profile: FeedProfile): string {
  for (const k of ['display_name', 'full_name', 'name', 'username']) {
    const v = profile[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 60);
  }
  return 'there';
}

function issuesMessage(issues: ChangeIssue[]): string {
  const head = issues.slice(0, 5).map((i) => `${i.key}${i.path && i.path !== '(root)' ? ` (${i.path})` : ''}: ${i.message}`);
  return `Draft does not validate — ${head.join('; ')}${issues.length > 5 ? `; +${issues.length - 5} more` : ''}`;
}

/** Mutating calls need a person to attribute them to (ads console convention). */
function actorOf(caller: AdminCaller): { email: string; userId: string | null } {
  if (!caller.actorEmail) {
    throw new HomeFeedError(400, 'missing_actor', 'X-Admin-Actor (admin email) is required for home feed changes made with the API secret');
  }
  return { email: caller.actorEmail, userId: caller.userId };
}

const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === '23505';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class HomeFeedAdminService {
  /** Every rule row in the flat form + the ruleset version. */
  static async currentRuleset(): Promise<{ rows: RuleRow[]; flat: FlatRule[]; version: string }> {
    const rows = await HomeFeedService.fetchRuleRows();
    const flat = rows.map(rowToFlat);
    return { rows, flat, version: rulesetVersion(flat) };
  }

  /** GET /api/admin/home-feed/rules: rules + what the editor needs to open a draft. */
  static async state() {
    const [{ rows, version }, last] = await Promise.all([this.currentRuleset(), this.latestChange()]);
    return {
      rules: rows.map((r) => HomeFeedService.toAdmin(r)),
      version,
      lastChange: last ? toChangeEntry(last) : null,
      killSwitch: { feedEnabled: isFeedEnabled(null) || isFeedEnabled('ios') || isFeedEnabled('android'), feedEnabledIos: isFeedEnabled('ios'), feedEnabledAndroid: isFeedEnabled('android'), rulesEnabled: areRulesEnabled(), publishEnabled: isPublishEnabled() },
      catalog: {
        defaultOrder: [...DEFAULT_ORDER],
        extraCards: EXTRA_CARDS.map((e) => ({ ...e })),
        cards: Object.values(CATALOG).map((e) => ({ type: e.type, version: e.version, kind: e.kind, dismissible: e.dismissible })),
      },
      propagation: PROPAGATION,
    };
  }

  static async latestChange(): Promise<ChangeRow | null> {
    const { data, error } = await db().from('home_feed_rule_changes').select(CHANGE_COLUMNS).order('seq', { ascending: false }).limit(1);
    if (error) {
      // Migration 125 not applied yet: the editor still opens (history empty), publish will refuse.
      if (/home_feed_rule_changes/.test(error.message ?? '') || (error as { code?: string }).code === '42P01') return null;
      throw error;
    }
    return ((data ?? [])[0] as ChangeRow | undefined) ?? null;
  }

  // -------------------------------------------------------------------------
  // Draft preview
  // -------------------------------------------------------------------------

  private static async resolveSubject(body: { userId?: string; persona?: PreviewPersona; timezone?: string }, caller: AdminCaller, now: Date, opts: ServiceOpts): Promise<Subject> {
    if (body.persona === 'pro_expiring' || body.persona === 'pro_expired') return lifecyclePersonaSubject(body.persona, now, body.timezone, await readPublishedConfig(), opts.loaders);
    if (body.persona) return { kind: 'persona', profile: personaProfile(now, body.timezone), loaders: personaLoaders(opts.loaders) };
    if (body.userId) {
      const { data, error } = await db().from('profiles').select('*').eq('id', body.userId).maybeSingle();
      if (error) throw error;
      if (!data) throw new HomeFeedError(404, 'NOT_FOUND', 'No FitCircle user with that id');
      return { kind: 'user', profile: data as FeedProfile, loaders: opts.loaders };
    }
    if (caller.profile && caller.userId) return { kind: 'actor', profile: caller.profile as FeedProfile, loaders: opts.loaders };
    throw new HomeFeedError(
      400,
      'USER_REQUIRED',
      `No FitCircle admin account matches ${caller.actorEmail ?? 'the caller'} — preview as a test user id or as the typical user instead`
    );
  }

  /** Both sides from one context: before = the published rules, after = the draft. */
  static async composeBoth(
    subject: Subject,
    info: FeedRequestInfo,
    support: ClientCardSupport,
    promoClient: PromoClientSupport,
    beforeRules: FlatRule[],
    afterRules: FlatRule[],
    opts: ServiceOpts
  ): Promise<{ ctx: FeedContext; before: ComposeResult; after: ComposeResult; feedEnabled: boolean; rulesEnabled: boolean }> {
    const now = opts.now ?? new Date();
    const feedEnabled = isFeedEnabled(info.platform);
    const rulesEnabled = areRulesEnabled();
    // Same context flags as HomeFeedService.getFeed, so the preview matches what the client would be served.
    const ctx = await buildFeedContext(subject.profile, info, {
      loaders: subject.loaders,
      now,
      wantChat: support.has('circle_chat'),
      wantProfileCompletion: support.has('profile_completion'),
    });
    if (!feedEnabled) {
      // Kill switch: production serves the static default (no context, no rules) — so does the preview.
      const r = composeFeed({ support, ctx: null, now, traceRanked: true });
      return { ctx, before: r, after: r, feedEnabled, rulesEnabled };
    }
    const promoData =
      subject.kind === 'persona'
        ? promoClient.promoCard
          ? await personaPromoRound(subject, ctx)
          : null
        : await HomeFeedService.promoRound(subject.profile, info, promoClient, now, opts.promoLoaders);
    const promos = HomeFeedService.selectPromosFor(subject.profile, ctx, promoClient, promoData);
    const run = (rules: FlatRule[]) => {
      const r = composeFeed({ support, ctx, rules: rulesEnabled ? toFeedRules(rules) : [], now, traceRanked: true, ...promos.compose });
      if (promos.trace) r.trace.promos = promos.trace;
      return r;
    };
    return { ctx, before: run(beforeRules), after: run(afterRules), feedEnabled, rulesEnabled };
  }

  /** POST /api/admin/home-feed/preview. Read-only. */
  static async previewDraft(body: unknown, caller: AdminCaller, opts: ServiceOpts = {}) {
    const input = draftPreviewBodySchema.parse(body ?? {});
    const now = opts.now ?? new Date();
    const current = await this.currentRuleset();

    let afterRules: FlatRule[] = current.flat;
    let changes: RuleChange[] = [];
    let issues: ChangeIssue[] = [];
    let revertOf: ChangeEntry | null = null;
    if (input.draft?.rules) {
      ({ rules: afterRules, changes, issues } = resolveDraftRuleset(current.flat, input.draft.rules));
    } else if (input.draft?.changes) {
      const applied = applyChanges(current.flat, input.draft.changes);
      issues = applied.issues;
      afterRules = issues.length ? current.flat : applied.rules;
      changes = issues.length ? [] : diffRulesets(current.flat, applied.rules);
    } else if (input.draft?.revertOf) {
      const row = await this.getChangeRow(input.draft.revertOf);
      revertOf = toChangeEntry(row);
      ({ rules: afterRules, changes, issues } = resolveDraftRuleset(current.flat, row.rules_before ?? []));
    }

    const subject = await this.resolveSubject(input, caller, now, opts);
    const declared = defaultClientDeclaration(input.platform, input.version);
    const cards = input.cards ?? declared.cards;
    const actions = input.actions ?? declared.actions;
    const promoLayouts = input.promoLayouts ?? declared.promoLayouts;
    const headers = new Headers({ 'x-app-platform': input.platform, 'x-app-version': input.version });
    if (input.build !== undefined) headers.set('x-app-build', String(input.build));
    if (input.timezone) headers.set('x-client-timezone', input.timezone);
    const info = readRequestInfo({ headers });
    const support = parseClientCards(cards);
    const promoClient = parsePromoClient({ cardsSupportPromo: (support.get(PROMO_CARD_TYPE) ?? 0) >= PROMO_CARD_VERSION, actions, promoLayouts });

    const { ctx, before, after, feedEnabled, rulesEnabled } = await this.composeBoth(subject, info, support, promoClient, current.flat, afterRules, { ...opts, now });

    const keys = [...new Set([...current.flat.map((r) => r.key), ...afterRules.map((r) => r.key)])].sort();
    const beforeByKey = new Map(current.flat.map((r) => [r.key, r]));
    const afterByKey = new Map(afterRules.map((r) => [r.key, r]));

    return {
      subject: { kind: subject.kind, userId: subject.kind === 'persona' ? null : subject.profile.id, displayName: displayName(subject.profile) },
      request: { platform: input.platform, version: input.version, build: input.build ?? null, timezone: ctx.timezone, cards, actions, promoLayouts },
      killSwitch: { feedEnabled, rulesEnabled, publishEnabled: isPublishEnabled() },
      context: redactContext(ctx),
      before: side(before),
      after: side(after),
      draft: {
        baseVersion: current.version,
        afterVersion: rulesetVersion(afterRules),
        valid: issues.length === 0,
        issues,
        changes,
        revertOf,
        rules: keys.map((key) => ({
          key,
          enabledBefore: beforeByKey.get(key)?.enabled ?? null,
          enabledAfter: afterByKey.get(key)?.enabled ?? null,
          appliedBefore: before.trace.appliedRules.includes(key),
          appliedAfter: after.trace.appliedRules.includes(key),
        })),
      },
      render: await this.renderData(subject, ctx),
    };
  }

  /** Cheap, read-only display data for realistic card mockups (the previewed user's own bits only). */
  static async renderData(subject: Subject, ctx: FeedContext) {
    let campaign: Record<string, unknown> | null = null;
    if (ctx.campaign?.present && ctx.campaign.slug) {
      try {
        const row = (await activeCampaignsCache.get()).find((r) => r.slug === ctx.campaign?.slug);
        if (row) {
          campaign = {
            slug: row.slug,
            title: row.title,
            tagline: row.tagline,
            emoji: row.emoji,
            icon: row.icon ?? null,
            accent: row.accent,
            palette: row.palette ?? [],
            phase: ctx.campaign.phase,
            template: row.template,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            ctaLabel: row.cta_label,
            heroUrl: row.art?.inAppHero?.url ?? null,
          };
        }
      } catch {
        campaign = null;
      }
    }
    const name = displayName(subject.profile);
    return {
      user: { displayName: name, firstName: name.split(/\s+/)[0], isPro: ctx.isPro, daysSinceSignup: ctx.daysSinceSignup, hasCircle: ctx.hasCircle },
      campaign,
    };
  }

  // -------------------------------------------------------------------------
  // Layout snapshots (audit)
  // -------------------------------------------------------------------------

  /** Typical-user layouts (iOS + Android) for two rulesets. Soft: null when anything fails. */
  static async snapshotLayouts(before: FlatRule[], after: FlatRule[], appVersion: string, opts: ServiceOpts = {}): Promise<{ before: LayoutSnapshot; after: LayoutSnapshot } | null> {
    try {
      const now = opts.now ?? new Date();
      const out = { before: { appVersion, persona: 'typical' as const, ios: [] as string[], android: [] as string[] }, after: { appVersion, persona: 'typical' as const, ios: [] as string[], android: [] as string[] } };
      for (const platform of ['ios', 'android'] as const) {
        const declared = defaultClientDeclaration(platform, appVersion);
        const support = parseClientCards(declared.cards);
        const promoClient = parsePromoClient({ cardsSupportPromo: (support.get(PROMO_CARD_TYPE) ?? 0) >= PROMO_CARD_VERSION, actions: declared.actions, promoLayouts: declared.promoLayouts });
        const info = readRequestInfo({ headers: new Headers({ 'x-app-platform': platform, 'x-app-version': appVersion }) });
        const subject: Subject = { kind: 'persona', profile: personaProfile(now, undefined), loaders: personaLoaders(opts.loaders) };
        const r = await this.composeBoth(subject, info, support, promoClient, before, after, { ...opts, now });
        out.before[platform] = r.before.response.cards.map((c) => c.id);
        out.after[platform] = r.after.response.cards.map((c) => c.id);
      }
      return out;
    } catch (e) {
      console.warn('[home-feed-admin] layout snapshot failed:', (e as Error)?.message);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Publish / revert
  // -------------------------------------------------------------------------

  /** POST /api/admin/home-feed/publish */
  static async publish(body: unknown, caller: AdminCaller, meta: { requestId?: string | null } = {}, opts: ServiceOpts = {}) {
    if (!isPublishEnabled()) throw new HomeFeedError(503, 'PUBLISH_DISABLED', 'Home feed publishing is turned off (HOME_FEED_PUBLISH_ENABLED)');
    const actor = actorOf(caller);
    const input = publishBodySchema.parse(body ?? {});
    return this.commit(
      { action: 'publish', baseVersion: input.baseVersion, changes: input.changes, summary: input.summary, note: input.note ?? null, descriptions: input.descriptions ?? [], snapshotVersion: input.snapshotVersion, revertsChangeId: null },
      actor,
      meta,
      opts
    );
  }

  /** POST /api/admin/home-feed/revert — publishes the change's rules_before as a new change. */
  static async revert(body: unknown, caller: AdminCaller, meta: { requestId?: string | null } = {}, opts: ServiceOpts = {}) {
    if (!isPublishEnabled()) throw new HomeFeedError(503, 'PUBLISH_DISABLED', 'Home feed publishing is turned off (HOME_FEED_PUBLISH_ENABLED)');
    const actor = actorOf(caller);
    const input = revertBodySchema.parse(body ?? {});
    const row = await this.getChangeRow(input.changeId);
    if (row.status !== 'applied') throw new HomeFeedError(400, 'NOT_REVERTIBLE', `Change #${row.seq} was ${row.status.replace('_', ' ')}, so there is nothing to revert`);
    const current = await this.currentRuleset();
    const changes = diffRulesets(current.flat, row.rules_before ?? []);
    if (changes.length === 0) throw new HomeFeedError(400, 'NOTHING_TO_REVERT', `The published rules already match the state before change #${row.seq}`);
    return this.commit(
      {
        action: 'revert',
        baseVersion: input.baseVersion,
        changes,
        summary: input.summary || `Revert change #${row.seq} (${row.summary.slice(0, 200)})`,
        note: input.note ?? null,
        descriptions: input.descriptions ?? [],
        snapshotVersion: input.snapshotVersion,
        revertsChangeId: row.id,
      },
      actor,
      meta,
      opts
    );
  }

  static async getChangeRow(id: string): Promise<ChangeRow> {
    const { data, error } = await db().from('home_feed_rule_changes').select(CHANGE_COLUMNS).eq('id', id).maybeSingle();
    if (error) {
      if (/home_feed_rule_changes/.test(error.message ?? '') || (error as { code?: string }).code === '42P01') {
        throw new HomeFeedError(404, 'NOT_FOUND', 'Home feed change not found (the change log table from migration 125 is not there yet)');
      }
      throw error;
    }
    if (!data) throw new HomeFeedError(404, 'NOT_FOUND', 'Home feed change not found');
    return data as ChangeRow;
  }

  private static async commit(
    input: {
      action: 'publish' | 'revert';
      baseVersion: string;
      changes: RuleChange[];
      summary: string;
      note: string | null;
      descriptions: string[];
      snapshotVersion?: string;
      revertsChangeId: string | null;
    },
    actor: { email: string; userId: string | null },
    meta: { requestId?: string | null },
    opts: ServiceOpts
  ) {
    const now = opts.now ?? new Date();

    // 1. Lock check: the latest change (also gives the next revision number).
    const last = await this.latestChangeStrict();
    if (last?.status === 'pending' && now.getTime() - Date.parse(last.created_at) < PENDING_LOCK_MS) {
      throw new HomeFeedError(409, 'PUBLISH_IN_PROGRESS', `${last.actor_email ?? 'Someone'} is publishing a home feed change right now — wait a few seconds and reload`);
    }

    // 2. Optimistic concurrency on the rule content.
    const current = await this.currentRuleset();
    if (current.version !== input.baseVersion) {
      const who = last?.status === 'applied' ? ` (last published by ${last.actor_email ?? 'unknown'} at ${last.applied_at ?? last.created_at})` : '';
      throw new HomeFeedError(
        409,
        'STALE_DRAFT',
        `The published home feed rules changed since this draft was opened${who}. Reload to see the current rules, then re-apply your change.`,
        { currentVersion: current.version }
      );
    }

    // 3. Validate the whole changeset with the production validator.
    const { rules: after, issues } = applyChanges(current.flat, input.changes);
    if (issues.length > 0) throw new HomeFeedError(400, 'VALIDATION_ERROR', issuesMessage(issues), { issues });
    const effective = diffRulesets(current.flat, after);
    if (effective.length === 0) throw new HomeFeedError(400, 'NO_CHANGES', 'The draft is identical to the published rules');

    // 4. Before/after typical-user layouts for the audit row (soft).
    const snap = await this.snapshotLayouts(current.flat, after, input.snapshotVersion ?? SNAPSHOT_APP_VERSION, { ...opts, now });

    // 5. Claim the next revision (UNIQUE seq).
    const seq = (last ? Number(last.seq) : 0) + 1;
    const claim = {
      id: randomUUID(),
      seq,
      actor_email: actor.email,
      actor_user_id: actor.userId,
      action: input.action,
      status: 'pending',
      summary: input.summary,
      note: input.note,
      base_version: current.version,
      version_after: rulesetVersion(after),
      rules_before: current.flat,
      rules_after: after,
      diff: { changes: effective, descriptions: input.descriptions },
      layout_before: snap?.before ?? null,
      layout_after: snap?.after ?? null,
      reverts_change_id: input.revertsChangeId,
      request_id: (meta.requestId ?? '').slice(0, 200) || randomUUID(),
    };
    {
      const { error } = await db().from('home_feed_rule_changes').insert(claim);
      if (error) {
        if (isUniqueViolation(error)) throw new HomeFeedError(409, 'STALE_DRAFT', 'Someone published a home feed change at the same moment. Reload to see it, then re-apply your change.');
        throw error;
      }
    }

    // 6. Write: one upsert batch + one delete batch; compensate on failure.
    const stamp = now.toISOString();
    const beforeByKey = new Map(current.rows.map((r) => [r.key, r]));
    const afterByKey = new Map(after.map((r) => [r.key, r]));
    const upserts = effective
      .filter((c) => c.op !== 'delete')
      .map((c) => {
        const key = c.op === 'create' ? c.rule.key : c.key;
        const r = afterByKey.get(key)!;
        return { key, enabled: r.enabled, priority: r.priority, definition: flatDefinition(r), updated_by: actor.userId, updated_at: stamp };
      });
    const deletes = effective.filter((c): c is Extract<RuleChange, { op: 'delete' }> => c.op === 'delete').map((c) => c.key);
    try {
      if (upserts.length) {
        const { error } = await db().from('home_feed_rules').upsert(upserts, { onConflict: 'key' });
        if (error) throw error;
      }
      if (deletes.length) {
        const { error } = await db().from('home_feed_rules').delete().in('key', deletes);
        if (error) throw error;
      }
    } catch (err) {
      const reason = (err as { message?: string })?.message ?? String(err);
      const restored = await this.compensate(
        upserts.map((u) => u.key),
        beforeByKey
      );
      HomeFeedService.clearRulesCache();
      await this.markChange(claim.id, { status: restored ? 'rolled_back' : 'failed', error: reason.slice(0, 1000) });
      throw new HomeFeedError(
        restored ? 502 : 500,
        restored ? 'PUBLISH_ROLLED_BACK' : 'PUBLISH_FAILED',
        restored
          ? `Publishing failed (${reason.slice(0, 200)}); nothing changed — every rule was restored. Try again.`
          : `Publishing failed (${reason.slice(0, 200)}) and the automatic rollback did not complete. Check the rules list before retrying.`
      );
    }

    // 7. Read back, record, invalidate.
    const final = await this.currentRuleset();
    if (final.version !== claim.version_after) {
      console.warn(`[home-feed-admin] publish #${seq}: read-back version ${final.version} != expected ${claim.version_after} (a concurrent legacy edit?)`);
    }
    await this.markChange(claim.id, { status: 'applied', applied_at: new Date().toISOString(), version_after: final.version, rules_after: final.flat });
    HomeFeedService.clearRulesCache();

    const row = await this.getChangeRow(claim.id);
    return {
      change: toChangeEntry(row),
      version: final.version,
      rules: final.rows.map((r) => HomeFeedService.toAdmin(r)),
      propagation: PROPAGATION,
    };
  }

  /** Restore `keys` to their before-state (delete the ones that didn't exist). True when every step succeeded. */
  private static async compensate(keys: string[], before: Map<string, RuleRow>): Promise<boolean> {
    let ok = true;
    const created = keys.filter((k) => !before.has(k));
    // Deleted keys only reach here if the delete batch failed (then nothing was deleted) — restore anyway, idempotent.
    const restore = [...before.values()].filter((r) => keys.includes(r.key));
    try {
      if (restore.length) {
        const { error } = await db()
          .from('home_feed_rules')
          .upsert(
            restore.map((r) => ({ id: r.id, key: r.key, enabled: r.enabled, priority: r.priority, definition: r.definition, updated_by: r.updated_by ?? null, updated_at: r.updated_at ?? new Date().toISOString() })),
            { onConflict: 'key' }
          );
        if (error) throw error;
      }
      if (created.length) {
        const { error } = await db().from('home_feed_rules').delete().in('key', created);
        if (error) throw error;
      }
    } catch (e) {
      console.error('[home-feed-admin] rollback failed:', (e as Error)?.message);
      ok = false;
    }
    return ok;
  }

  private static async markChange(id: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await db().from('home_feed_rule_changes').update(patch).eq('id', id);
    if (error) console.error(`[home-feed-admin] could not update change ${id}:`, error.message);
  }

  /** Like latestChange, but a missing table is an error (publishing needs the audit log). */
  private static async latestChangeStrict(): Promise<ChangeRow | null> {
    const { data, error } = await db().from('home_feed_rule_changes').select(CHANGE_COLUMNS).order('seq', { ascending: false }).limit(1);
    if (error) {
      if (/home_feed_rule_changes/.test(error.message ?? '') || (error as { code?: string }).code === '42P01') {
        throw new HomeFeedError(503, 'AUDIT_LOG_MISSING', 'The home feed change log table is missing (migration 125) — publishing is disabled until it is applied');
      }
      throw error;
    }
    return ((data ?? [])[0] as ChangeRow | undefined) ?? null;
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  /** GET /api/admin/home-feed/changes?limit=&before=<seq> → newest first. */
  static async listChanges(params: URLSearchParams): Promise<{ changes: ChangeEntry[]; nextBefore: number | null }> {
    const limit = Math.min(MAX_CHANGES_PAGE, Math.max(1, Number(params.get('limit')) || 50));
    const beforeRaw = params.get('before');
    const before = beforeRaw && /^\d{1,12}$/.test(beforeRaw) ? Number(beforeRaw) : null;
    let q = db().from('home_feed_rule_changes').select(CHANGE_COLUMNS);
    if (before !== null) q = q.lt('seq', before);
    const { data, error } = await q.order('seq', { ascending: false }).limit(limit + 1);
    if (error) {
      if (/home_feed_rule_changes/.test(error.message ?? '') || (error as { code?: string }).code === '42P01') return { changes: [], nextBefore: null };
      throw error;
    }
    const rows = (data ?? []) as ChangeRow[];
    const page = rows.slice(0, limit);
    return { changes: page.map(toChangeEntry), nextBefore: rows.length > limit ? Number(page[page.length - 1].seq) : null };
  }
}
