/**
 * PromoStyleService — system promo looks (button style + card surface, docs/PROMO_BUTTON_STYLE_SPEC.md).
 *
 * Feed side: readPublishedStyles() + a per-instance SWR cache; only read for clients that declared
 * promo_style@1 (zero cost for every shipped app).
 *
 * Admin side (Admin Tools → Home feed → Promo looks):
 *   GET  /api/admin/home-feed/promo-styles           published config, version, presets, promos + their creatives
 *   POST /api/admin/home-feed/promo-styles/preview   draft → every creative as 1.1.3+ draws it (per variant) and as today's apps do
 *   POST /api/admin/home-feed/promo-styles/publish   draft → feature_flags row (compare-and-set), audited
 *   GET  /api/admin/home-feed/promo-styles/changes   publish history
 * Same publish contract as the Pro lifecycle editor: baseVersion → 409 STALE_DRAFT; audit row in
 * experiment_audit_log (key config:promo_styles). No stored procedures, no new table.
 */
import { z } from 'zod';

import { type AdminCaller } from '@/lib/campaigns/admin-auth';
import { HomeFeedError } from '@/lib/home-feed/http';
import {
  BUTTON_PRESETS,
  DEFAULT_APPEARANCE,
  DEFAULT_PROMO_STYLES,
  LOOK_PRESETS,
  PRESETS,
  PROMO_STYLES_AUDIT_KEY,
  PROMO_STYLES_FLAG,
  STYLE_THRESHOLDS,
  SYSTEM_PROMOS,
  SYSTEM_PROMO_LABELS,
  DARK_SURFACE,
  BRAND_EYEBROW,
  applyAppearance,
  buildPromoProps,
  checkAppearance,
  diffPromoStyles,
  parsePromoClient,
  promoStylesEnabled,
  promoStylesVersion,
  promosConfig,
  sampleMatchInput,
  systemPromoCreatives,
  validatePromoStyles,
  type PromoProps,
  type PromoStylesConfig,
} from '@/lib/promos';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { defaultClientDeclaration } from './home-feed-admin-service';
import { promoStylesCache, readPublishedStyles } from './promo-style-store';

export { promoStylesCache, readPublishedStyles };

const appVersion = z.string().regex(/^\d+(\.\d+){0,3}$/);

export const stylesPreviewBodySchema = z
  .object({
    config: z.unknown().optional(),
    platform: z.enum(['ios', 'android']).default('ios'),
    /** The "new apps" version (declares promo_style@1). */
    version: appVersion.default('1.1.3'),
    /** The "today's apps" version. */
    legacyVersion: appVersion.default('1.1.2'),
  })
  .strict();

export const stylesPublishBodySchema = z
  .object({
    baseVersion: z.string().min(1).max(64),
    config: z.unknown(),
    summary: z.string().trim().min(1).max(500),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

interface AuditRow {
  id: string;
  actor: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}

export interface StylesChange {
  id: string;
  at: string;
  actorEmail: string | null;
  action: 'publish';
  summary: string;
  note: string | null;
  versionBefore: string | null;
  versionAfter: string;
  before: PromoStylesConfig | null;
  after: PromoStylesConfig;
  diff: Array<{ path: string; before: unknown; after: unknown }>;
}

function toChange(r: AuditRow): StylesChange {
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
    before: (b?.config as PromoStylesConfig) ?? null,
    after: a.config as PromoStylesConfig,
    diff: Array.isArray(a.diff) ? a.diff : [],
  };
}

function promoClientFor(platform: 'ios' | 'android', version: string) {
  const d = defaultClientDeclaration(platform, version);
  return parsePromoClient({ cardsSupportPromo: d.promoLayouts !== null, actions: d.actions, promoLayouts: d.promoLayouts, features: [d.features] });
}

export class PromoStyleService {
  static async state() {
    const [pub, last] = await Promise.all([readPublishedStyles(), this.changes(1)]);
    const input = sampleMatchInput();
    return {
      config: pub.config,
      version: pub.version,
      source: pub.source,
      invalidStored: pub.invalidStored,
      defaults: DEFAULT_PROMO_STYLES,
      killSwitch: { stylesEnabled: promoStylesEnabled(), promosEnabled: promosConfig().enabled },
      presets: BUTTON_PRESETS.map((id) => ({ id, label: PRESETS[id].label, style: PRESETS[id].style })),
      looks: Object.entries(LOOK_PRESETS).map(([id, l]) => ({ id, label: l.label, appearance: l.appearance })),
      defaultAppearance: DEFAULT_APPEARANCE,
      tokens: { darkSurface: DARK_SURFACE, brandEyebrow: BRAND_EYEBROW },
      thresholds: STYLE_THRESHOLDS,
      promos: SYSTEM_PROMOS.map((d) => ({
        key: d.key,
        ...(SYSTEM_PROMO_LABELS[d.key] ?? { label: d.key, description: '' }),
        creatives: systemPromoCreatives(d, input).map((c) => ({ id: c.id, layout: c.layout, theme: c.theme })),
      })),
      capability: { feature: 'promo_style@1', firstVersion: '1.1.3' },
      lastChange: last.changes[0] ?? null,
      propagation: { server: 'within ~30 s (per-instance config cache)', apps: 'on the next home feed fetch, 1.1.3+ only (older apps always draw today’s look)' },
    };
  }

  static validate(raw: unknown) {
    return validatePromoStyles(raw);
  }

  /**
   * POST preview: for each system promo creative, the props today's apps get (`legacy`) and, per look
   * variant, the props a promo_style@1 app gets plus that variant's issues. Pure apart from the
   * published-config read.
   */
  static async preview(body: unknown) {
    const input = stylesPreviewBodySchema.parse(body ?? {});
    const pub = await readPublishedStyles();
    const v = this.validate(input.config === undefined ? pub.config : input.config);
    // Render even an invalid draft (per-variant issues show what's wrong); use its raw promos when parseable.
    const draft: PromoStylesConfig = v.config ?? ((input.config as PromoStylesConfig | undefined)?.promos ? (input.config as PromoStylesConfig) : pub.config);
    const legacyClient = promoClientFor(input.platform, input.legacyVersion);
    const sample = sampleMatchInput();
    const promos = SYSTEM_PROMOS.map((def) => {
      const setting = draft.promos?.[def.key];
      const variants = setting?.variants?.length ? setting.variants : [{ id: 'a', weight: 100, ...DEFAULT_APPEARANCE }];
      return {
        key: def.key,
        ...(SYSTEM_PROMO_LABELS[def.key] ?? { label: def.key, description: '' }),
        configured: !!setting,
        creatives: systemPromoCreatives(def, sample).map((c) => {
          const legacy = buildPromoProps(def.key, c, legacyClient.actions);
          return {
            id: c.id,
            layout: c.layout,
            legacy,
            variants: variants.map((variant) => {
              const issues = checkAppearance(variant, { theme: c.theme, layout: c.layout });
              const ok = !issues.some((i) => i.level === 'error');
              const props: PromoProps | null = legacy ? applyAppearance(legacy, ok ? variant : DEFAULT_APPEARANCE) : null;
              return { id: variant.id, weight: variant.weight, props, issues, fellBack: !ok };
            }),
          };
        }),
      };
    });
    return {
      request: { platform: input.platform, version: input.version, legacyVersion: input.legacyVersion },
      draft: {
        valid: v.issues.length === 0,
        issues: v.issues,
        warnings: v.warnings,
        baseVersion: pub.version,
        afterVersion: v.config ? promoStylesVersion(v.config) : null,
        changes: v.config ? diffPromoStyles(pub.config, v.config) : [],
      },
      killSwitch: { stylesEnabled: promoStylesEnabled(), promosEnabled: promosConfig().enabled },
      promos,
    };
  }

  static async publish(body: unknown, caller: AdminCaller, opts: { now?: Date } = {}) {
    if (!caller.actorEmail) throw new HomeFeedError(400, 'missing_actor', 'X-Admin-Actor (admin email) is required for promo look changes made with the API secret');
    const input = stylesPublishBodySchema.parse(body ?? {});
    const v = this.validate(input.config);
    if (!v.config) throw new HomeFeedError(400, 'VALIDATION_ERROR', `Draft does not validate — ${v.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; ')}`, { issues: v.issues });
    const now = (opts.now ?? new Date()).toISOString();
    const pub = await readPublishedStyles();
    const stale = () => new HomeFeedError(409, 'STALE_DRAFT', 'The published promo looks changed since this draft was opened. Reload to see them, then re-apply your change.', { currentVersion: pub.version });
    if (pub.version !== input.baseVersion) throw stale();
    const versionAfter = promoStylesVersion(v.config);
    if (versionAfter === pub.version) throw new HomeFeedError(400, 'NO_CHANGES', 'The draft is identical to the published looks');

    const supabase = createAdminSupabase();
    const row = {
      name: PROMO_STYLES_FLAG,
      description: 'Promo card looks for 1.1.3+ apps (button style + card surface per system promo). metadata = config. Edited in Admin Tools → Home feed → Promo looks.',
      is_enabled: true,
      rollout_percentage: 0,
      metadata: v.config,
      updated_at: now,
    };
    if (pub.source === 'database' || pub.invalidStored) {
      let q = supabase.from('feature_flags').update(row).eq('name', PROMO_STYLES_FLAG);
      q = pub.updatedAt ? q.eq('updated_at', pub.updatedAt) : q.is('updated_at', null);
      const { data, error } = await q.select('name');
      if (error) throw error;
      if (!data || data.length !== 1) throw stale();
    } else {
      const { error } = await supabase.from('feature_flags').insert(row);
      if (error) {
        if ((error as { code?: string }).code === '23505') throw stale();
        throw error;
      }
    }
    promoStylesCache.clear();

    const diff = diffPromoStyles(pub.config, v.config);
    const { data: auditRow, error: auditError } = await supabase
      .from('experiment_audit_log')
      .insert({
        experiment_key: PROMO_STYLES_AUDIT_KEY,
        actor: caller.actorEmail,
        action: 'config_publish',
        before: { version: pub.version, source: pub.source, config: pub.config },
        after: { version: versionAfter, config: v.config, summary: input.summary, note: input.note ?? null, diff },
        at: now,
      })
      .select('*')
      .single();
    if (auditError) console.error('[promo-styles] audit insert failed (config IS published):', auditError.message);
    return { config: v.config, version: versionAfter, change: auditRow ? toChange(auditRow as AuditRow) : null };
  }

  static async changes(limit = 50): Promise<{ changes: StylesChange[] }> {
    const { data, error } = await createAdminSupabase()
      .from('experiment_audit_log')
      .select('*')
      .eq('experiment_key', PROMO_STYLES_AUDIT_KEY)
      .order('at', { ascending: false })
      .limit(Math.min(100, Math.max(1, limit)));
    if (error) {
      console.warn('[promo-styles] change log read failed:', error.message);
      return { changes: [] };
    }
    return { changes: ((data ?? []) as AuditRow[]).map(toChange) };
  }
}
