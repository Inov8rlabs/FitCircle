/**
 * ProLifecycleAdminService — backs the Admin Tools "Pro lifecycle" editor
 * (Home feed module, docs/PRO_LIFECYCLE_PROMPTS.md §6):
 *
 *   GET  /api/admin/home-feed/pro-lifecycle            published config, version, defaults, switches, last change
 *   GET  /api/admin/home-feed/pro-lifecycle/audience   who is in each state now (read-only)
 *   POST /api/admin/home-feed/pro-lifecycle/preview    draft → each state's card in the real feed + push (before / after)
 *   POST /api/admin/home-feed/pro-lifecycle/publish    draft → feature_flags row, audited
 *   GET  /api/admin/home-feed/pro-lifecycle/changes    publish history
 *
 * Publish = compare-and-set on the content version (pl1-<sha>): the editor
 * sends the version it started from; a different current version → 409
 * STALE_DRAFT. The write itself is a single-row upsert / conditional update
 * of feature_flags; the audit row (experiment_audit_log, key
 * 'config:pro_lifecycle_prompts', the same table experiment layers share) is
 * written right after. No stored procedures, no new table.
 */
import { z } from 'zod';

import { type AdminCaller } from '@/lib/campaigns/admin-auth';
import { composeFeed, parseClientCards, type FeedCard } from '@/lib/home-feed';
import { buildFeedContext, readRequestInfo } from '@/lib/home-feed/context';
import { HomeFeedError } from '@/lib/home-feed/http';
import {
  CONFIG_AUDIT_KEY,
  CONFIG_FLAG_NAME,
  COPY_LIMITS,
  DEFAULT_CONFIG,
  DEFAULT_SAMPLE,
  PLACEHOLDERS,
  PRO_LIFECYCLE_PAYWALL_SOURCES,
  PRO_LIFECYCLE_PROMO_KEYS,
  PRO_LIFECYCLE_PUSH_TYPES,
  PRO_LIFECYCLE_STATES,
  STATE_LABELS,
  TIMING_LIMITS,
  configVersion,
  diffConfigs,
  personaLifecycle,
  promptsEnabled,
  pushDryRunForced,
  renderPushCopy,
  unknownPlaceholders,
  validateConfig,
  lifecycleStyleIssues,
  STATE_STYLE,
  type ProLifecycleConfig,
  type ProLifecycleState,
} from '@/lib/pro-lifecycle';
import {
  BRAND_EYEBROW,
  BUTTON_PRESETS,
  DARK_SURFACE,
  DEFAULT_APPEARANCE,
  LOOK_PRESETS,
  PRESETS,
  PROMO_CARD_TYPE,
  PROMO_CARD_VERSION,
  PROMO_STYLE_FEATURE,
  PROMO_STYLE_VERSION,
  STYLE_THRESHOLDS,
  parsePromoClient,
  promoCardId,
  promoStylesEnabled,
  promosConfig,
} from '@/lib/promos';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { defaultClientDeclaration, lifecyclePersonaSubject, personaPromoRound } from './home-feed-admin-service';
import { HomeFeedService } from './home-feed-service';
import { ProLifecycleService, lifecycleConfigCache, readPublishedConfig, type PublishedConfig } from './pro-lifecycle-service';

const appVersion = z.string().regex(/^\d+(\.\d+){0,3}$/);

export const previewBodySchema = z
  .object({
    /** The draft (full config). Omit → preview the published config. */
    config: z.unknown().optional(),
    /** Draft master switch. Omit → the published one. */
    enabled: z.boolean().optional(),
    platform: z.enum(['ios', 'android']).default('ios'),
    version: appVersion.default('1.1.0'),
    timezone: z.string().min(1).max(64).optional(),
    sample: z.object({ trialAvailable: z.boolean(), usage: z.enum(['sample', 'none']) }).strict().optional(),
    /** Preview this look variant id (A/B) instead of the user's bucket; states without it keep their looks. */
    styleVariant: z.string().regex(/^[a-z][a-z0-9]{0,7}$/).optional(),
  })
  .strict();

/** The config with each state's style narrowed to `variantId` (weight 100) when that state has it. */
export function forceStyleVariant(config: ProLifecycleConfig, variantId: string | undefined): ProLifecycleConfig {
  if (!variantId) return config;
  const states = { ...config.states };
  for (const state of PRO_LIFECYCLE_STATES) {
    const v = states[state].style?.variants.find((x) => x.id === variantId);
    if (v) states[state] = { ...states[state], style: { variants: [{ ...v, weight: 100 }] } };
  }
  return { ...config, states };
}

export const publishBodySchema = z
  .object({
    baseVersion: z.string().min(1).max(64),
    config: z.unknown(),
    enabled: z.boolean(),
    summary: z.string().trim().min(1).max(500),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export interface ConfigChange {
  id: string;
  at: string;
  actorEmail: string | null;
  action: 'publish';
  summary: string;
  note: string | null;
  versionBefore: string | null;
  versionAfter: string;
  enabledBefore: boolean | null;
  enabledAfter: boolean;
  before: ProLifecycleConfig | null;
  after: ProLifecycleConfig;
  diff: Array<{ path: string; before: unknown; after: unknown }>;
}

interface AuditRow {
  id: string;
  experiment_key: string;
  actor: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}

function toChange(r: AuditRow): ConfigChange {
  const a = (r.after ?? {}) as Record<string, any>;
  const b = (r.before ?? null) as Record<string, any> | null;
  return {
    id: r.id,
    at: r.at,
    actorEmail: r.actor,
    action: 'publish',
    summary: String(a.summary ?? ''),
    note: (a.note as string | null) ?? null,
    versionBefore: (b?.version as string) ?? null,
    versionAfter: String(a.version ?? ''),
    enabledBefore: typeof b?.enabled === 'boolean' ? b.enabled : null,
    enabledAfter: a.enabled !== false,
    before: (b?.config as ProLifecycleConfig) ?? null,
    after: a.config as ProLifecycleConfig,
    diff: Array.isArray(a.diff) ? a.diff : [],
  };
}

function actorOf(caller: AdminCaller): string {
  if (!caller.actorEmail) throw new HomeFeedError(400, 'missing_actor', 'X-Admin-Actor (admin email) is required for Pro lifecycle changes made with the API secret');
  return caller.actorEmail;
}

/** Placeholders the copy may not use, per field (editor issues; schema can't see them). */
function placeholderIssues(config: ProLifecycleConfig): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  for (const state of PRO_LIFECYCLE_STATES) {
    const sc = config.states[state];
    const fields: Array<[string, string]> = [
      ...Object.entries(sc.copy).map(([k, v]) => [`states.${state}.copy.${k}`, v] as [string, string]),
      [`states.${state}.push.title`, sc.push.title],
      [`states.${state}.push.body`, sc.push.body],
      [`states.${state}.push.bodyNoTrial`, sc.push.bodyNoTrial],
    ];
    for (const [path, text] of fields) {
      const bad = unknownPlaceholders(text);
      if (bad.length) out.push({ path, message: `unknown placeholder ${bad.map((b) => `{{${b}}}`).join(', ')}` });
      if (!path.endsWith('usageBody') && /\{\{\s*usage\s*\}\}/.test(text)) out.push({ path, message: '{{usage}} only works in the usage body' });
    }
  }
  return out;
}

export class ProLifecycleAdminService {
  /** GET: published state + everything the editor needs to open a draft. */
  static async state() {
    const [pub, last] = await Promise.all([readPublishedConfig(), this.changes(1)]);
    return {
      config: pub.config,
      enabled: pub.enabled,
      version: pub.version,
      source: pub.source,
      invalidStored: pub.invalidStored,
      defaults: DEFAULT_CONFIG,
      killSwitch: { promptsEnabled: promptsEnabled(), promosEnabled: promosConfig().enabled, pushDryRun: pushDryRunForced() },
      limits: { copy: COPY_LIMITS, timing: TIMING_LIMITS },
      placeholders: PLACEHOLDERS,
      states: PRO_LIFECYCLE_STATES.map((s) => ({
        state: s,
        ...STATE_LABELS[s],
        /** The fixed card colours (what button styles are checked against). */
        theme: STATE_STYLE[s].theme,
        promoKey: PRO_LIFECYCLE_PROMO_KEYS[s],
        paywallSource: PRO_LIFECYCLE_PAYWALL_SOURCES[s],
        pushType: s === 'trial_expiring' ? null : PRO_LIFECYCLE_PUSH_TYPES[s],
      })),
      lastChange: last.changes[0] ?? null,
      /** Card looks for 1.1.3+ (docs/PROMO_BUTTON_STYLE_SPEC.md): presets + thresholds for the editor's live checks. */
      styles: {
        enabled: promoStylesEnabled(),
        capability: { feature: `${PROMO_STYLE_FEATURE}@${PROMO_STYLE_VERSION}`, firstVersion: '1.1.3' },
        presets: BUTTON_PRESETS.map((id) => ({ id, label: PRESETS[id].label, style: PRESETS[id].style })),
        looks: Object.entries(LOOK_PRESETS).map(([id, l]) => ({ id, label: l.label, appearance: l.appearance })),
        defaultAppearance: DEFAULT_APPEARANCE,
        tokens: { darkSurface: DARK_SURFACE, brandEyebrow: BRAND_EYEBROW },
        thresholds: STYLE_THRESHOLDS,
      },
      propagation: {
        server: 'within ~30 s (per-instance config cache)',
        apps: 'on the next home feed fetch (apps reuse a layout for up to 15 min)',
        pushes: 'the next hourly run of /api/cron/pro-lifecycle (and the downgrade cron for "Pro ended")',
      },
    };
  }

  static audience(now = new Date()) {
    return ProLifecycleService.audience(now);
  }

  /** Validate a draft config (schema + placeholders). */
  static validate(raw: unknown): { config: ProLifecycleConfig | null; issues: Array<{ path: string; message: string }> } {
    const v = validateConfig(raw);
    if (!v.config) return v;
    const issues = placeholderIssues(v.config);
    return issues.length ? { config: null, issues } : v;
  }

  /**
   * POST preview: for each state, the full Home feed of the persona in that
   * state (the client declaration of platform/version, real ranking +
   * guardrails), the lifecycle card exactly as that client receives it, and
   * the push. `before` = the published config, `after` = the draft.
   */
  static async preview(body: unknown, opts: { now?: Date } = {}) {
    const input = previewBodySchema.parse(body ?? {});
    const now = opts.now ?? new Date();
    const pubRaw = await readPublishedConfig();
    const pub: PublishedConfig = { ...pubRaw, config: forceStyleVariant(pubRaw.config, input.styleVariant) };
    const draftRaw = input.config === undefined ? pubRaw.config : input.config;
    const validated = this.validate(draftRaw);
    const draftEnabled = input.enabled ?? pub.enabled;
    const sample = input.sample ?? DEFAULT_SAMPLE;
    const declared = defaultClientDeclaration(input.platform, input.version);
    const support = parseClientCards(declared.cards);
    const promoClient = parsePromoClient({ cardsSupportPromo: (support.get(PROMO_CARD_TYPE) ?? 0) >= PROMO_CARD_VERSION, actions: declared.actions, promoLayouts: declared.promoLayouts, features: [declared.features] });
    const headers = new Headers({ 'x-app-platform': input.platform, 'x-app-version': input.version });
    if (input.timezone) headers.set('x-client-timezone', input.timezone);
    const info = readRequestInfo({ headers });

    const side = async (p: PublishedConfig) => {
      const out = {} as Record<ProLifecycleState, Awaited<ReturnType<typeof stateSide>>>;
      for (const state of PRO_LIFECYCLE_STATES) out[state] = await stateSide(state, p);
      return out;
    };
    const stateSide = async (state: ProLifecycleState, p: PublishedConfig) => {
      const subject = lifecyclePersonaSubject(state, now, input.timezone, p, undefined, sample);
      const ctx = await buildFeedContext(subject.profile, info, { loaders: subject.loaders, now, wantChat: support.has('circle_chat'), wantProfileCompletion: support.has('profile_completion') });
      const data = promoClient.promoCard ? await personaPromoRound(subject, ctx) : null;
      const promos = HomeFeedService.selectPromosFor(subject.profile, ctx, promoClient, data);
      const feed = composeFeed({ support, ctx, rules: [], now, ...promos.compose }).response;
      const id = promoCardId(PRO_LIFECYCLE_PROMO_KEYS[state]);
      const card: FeedCard | null = feed.cards.find((c) => c.id === id) ?? null;
      const why = promos.trace?.find((t) => t.key === PRO_LIFECYCLE_PROMO_KEYS[state]);
      const lc = personaLifecycle(state, now, ctx.timezone, p.config, sample);
      const sc = p.config.states[state];
      const pushRender =
        state === 'trial_expiring'
          ? null
          : renderPushCopy(sc.push, {
              state,
              // The expiring push goes out ~10:00 the day before: render "ends" as the user reads it then.
              now: state === 'pro_expiring' ? new Date(Math.min(now.getTime(), Date.parse(lc.input.result.endsAt!) - 14 * 3_600_000)) : now,
              timezone: ctx.timezone,
              endsAt: new Date(lc.input.result.endsAt!),
              source: lc.input.result.source,
              periodDays: lc.input.result.periodDays,
              trialAvailable: lc.input.result.trialAvailable,
              usage: lc.input.usage,
              firstName: lc.input.firstName,
            });
      return {
        feed,
        card,
        position: card ? feed.cards.filter((c) => c.type !== 'offline_banner').findIndex((c) => c.id === id) + 1 : null,
        outcome: card ? 'shown' : (why?.outcome ?? (promoClient.promoCard ? 'not_selected' : 'client_no_promo')),
        endsAt: lc.input.result.endsAt,
        push:
          pushRender === null
            ? null
            : 'error' in pushRender
              ? { enabled: sc.push.enabled && sc.enabled && p.enabled, type: PRO_LIFECYCLE_PUSH_TYPES[state as 'pro_expiring' | 'pro_expired'], title: null, body: null, error: pushRender.error }
              : { enabled: sc.push.enabled && sc.enabled && p.enabled, type: PRO_LIFECYCLE_PUSH_TYPES[state as 'pro_expiring' | 'pro_expired'], title: pushRender.title, body: pushRender.body, error: null },
      };
    };

    const before = await side(pub);
    const afterPub: PublishedConfig = validated.config ? { ...pub, enabled: draftEnabled, config: forceStyleVariant(validated.config, input.styleVariant), version: configVersion(draftEnabled, validated.config) } : pub;
    const after = validated.config ? await side(afterPub) : before;
    return {
      request: { platform: input.platform, version: input.version, timezone: info.clientTimezone ?? 'America/Los_Angeles', sample },
      draft: {
        valid: validated.issues.length === 0,
        issues: validated.issues,
        /** Style warnings (hue-only separation, styles a layout doesn't draw): shown, never blocking. */
        warnings: validated.config
          ? lifecycleStyleIssues(validated.config)
              .filter((i) => i.level === 'warning')
              .map(({ path, message }) => ({ path, message }))
          : [],
        baseVersion: pub.version,
        afterVersion: validated.config ? configVersion(draftEnabled, validated.config) : null,
        changes: validated.config ? diffConfigs(pubRaw.config, validated.config).concat(draftEnabled !== pub.enabled ? [{ path: 'enabled', before: pub.enabled, after: draftEnabled }] : []) : [],
      },
      killSwitch: { promptsEnabled: promptsEnabled(), promosEnabled: promosConfig().enabled },
      before,
      after,
      render: { user: { displayName: 'Alex', firstName: 'Alex', isPro: null, daysSinceSignup: 60, hasCircle: true }, campaign: null },
    };
  }

  /** POST publish. */
  static async publish(body: unknown, caller: AdminCaller, opts: { now?: Date } = {}) {
    const actor = actorOf(caller);
    const input = publishBodySchema.parse(body ?? {});
    const v = this.validate(input.config);
    if (!v.config) throw new HomeFeedError(400, 'VALIDATION_ERROR', `Draft does not validate — ${v.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; ')}`, { issues: v.issues });
    const now = (opts.now ?? new Date()).toISOString();
    const pub = await readPublishedConfig();
    if (pub.version !== input.baseVersion) {
      throw new HomeFeedError(409, 'STALE_DRAFT', 'The published Pro lifecycle settings changed since this draft was opened. Reload to see them, then re-apply your change.', { currentVersion: pub.version });
    }
    const versionAfter = configVersion(input.enabled, v.config);
    if (versionAfter === pub.version && pub.source === 'database') throw new HomeFeedError(400, 'NO_CHANGES', 'The draft is identical to the published settings');

    const supabase = createAdminSupabase();
    const row = {
      name: CONFIG_FLAG_NAME,
      description: 'Pro lifecycle prompts ("Pro is ending / Pro ended" home card + pushes). is_enabled = admin master switch; metadata = config. Edited in Admin Tools → Home feed → Pro lifecycle.',
      is_enabled: input.enabled,
      rollout_percentage: 0,
      metadata: v.config,
      updated_at: now,
    };
    if (pub.source === 'database' || pub.invalidStored) {
      // Compare-and-set on updated_at: a concurrent publish since our read updates 0 rows.
      let q = supabase.from('feature_flags').update(row).eq('name', CONFIG_FLAG_NAME);
      q = pub.updatedAt ? q.eq('updated_at', pub.updatedAt) : q.is('updated_at', null);
      const { data, error } = await q.select('name');
      if (error) throw error;
      if (!data || data.length !== 1) throw new HomeFeedError(409, 'STALE_DRAFT', 'Someone published Pro lifecycle settings at the same moment. Reload to see them, then re-apply your change.');
    } else {
      const { error } = await supabase.from('feature_flags').insert(row);
      if (error) {
        if ((error as { code?: string }).code === '23505') throw new HomeFeedError(409, 'STALE_DRAFT', 'Someone published Pro lifecycle settings at the same moment. Reload to see them, then re-apply your change.');
        throw error;
      }
    }
    lifecycleConfigCache.clear();

    const diff = diffConfigs(pub.config, v.config).concat(input.enabled !== pub.enabled ? [{ path: 'enabled', before: pub.enabled, after: input.enabled }] : []);
    const audit = {
      experiment_key: CONFIG_AUDIT_KEY,
      actor,
      action: 'config_publish',
      before: { version: pub.version, enabled: pub.enabled, source: pub.source, config: pub.config },
      after: { version: versionAfter, enabled: input.enabled, config: v.config, summary: input.summary, note: input.note ?? null, diff },
      at: now,
    };
    const { data: auditRow, error: auditError } = await supabase.from('experiment_audit_log').insert(audit).select('*').single();
    if (auditError) console.error('[pro-lifecycle-admin] audit insert failed (config IS published):', auditError.message);

    return {
      config: v.config,
      enabled: input.enabled,
      version: versionAfter,
      change: auditRow ? toChange(auditRow as AuditRow) : null,
      propagation: (await this.state()).propagation,
    };
  }

  /** GET changes: newest first. */
  static async changes(limit = 50): Promise<{ changes: ConfigChange[] }> {
    const { data, error } = await createAdminSupabase()
      .from('experiment_audit_log')
      .select('*')
      .eq('experiment_key', CONFIG_AUDIT_KEY)
      .order('at', { ascending: false })
      .limit(Math.min(100, Math.max(1, limit)));
    if (error) {
      console.warn('[pro-lifecycle-admin] change log read failed:', error.message);
      return { changes: [] };
    }
    return { changes: ((data ?? []) as AuditRow[]).map(toChange) };
  }
}
