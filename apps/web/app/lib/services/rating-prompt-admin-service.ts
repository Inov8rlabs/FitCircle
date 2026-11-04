/**
 * RatingPromptAdminService — backs the Admin Tools "Rating prompt" page
 * (docs/RATING_PROMPT.md §5):
 *
 *   GET  /api/admin/rating-prompt            published config, version, defaults, switches, last change
 *   POST /api/admin/rating-prompt/publish    draft → feature_flags row, audited
 *   GET  /api/admin/rating-prompt/changes    publish history
 *   GET  /api/admin/rating-prompt/audience   how many users are eligible right now (and why not)
 *   GET  /api/admin/rating-prompt/requests   recent prompt requests (profiles.metadata.rating_prompt)
 *
 * Publish = compare-and-set on the content version (rp1-<sha>), same as the
 * Pro lifecycle editor: a different current version → 409 STALE_DRAFT. Audit
 * rows go to experiment_audit_log (key 'config:rating_prompt').
 */
import { z } from 'zod';

import { type AdminCaller } from '@/lib/campaigns/admin-auth';
import { CampaignError } from '@/lib/campaigns/http';
import {
  CONFIG_AUDIT_KEY,
  CONFIG_FLAG_NAME,
  DEFAULT_CONFIG,
  KNOWN_TRIGGERS,
  LIMITS,
  TRIGGER_LABELS,
  configVersion,
  diffConfigs,
  envEnabled,
  validateConfig,
  type RatingPromptConfig,
} from '@/lib/rating-prompt/config';
import { decideRatingPrompt, type IneligibleReason, type RatingPromptPlatform } from '@/lib/rating-prompt/eligibility';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { ledgerOf, localDay, ratingConfigCache, readPublishedConfig } from './rating-prompt-service';

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
  summary: string;
  note: string | null;
  versionBefore: string | null;
  versionAfter: string;
  enabledBefore: boolean | null;
  enabledAfter: boolean;
  diff: Array<{ path: string; before: unknown; after: unknown }>;
}

interface AuditRow {
  id: string;
  actor: string | null;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  at: string;
}

function toChange(r: AuditRow): ConfigChange {
  const a = r.after ?? {};
  const b = r.before ?? null;
  return {
    id: r.id,
    at: r.at,
    actorEmail: r.actor,
    summary: String(a.summary ?? ''),
    note: (a.note as string | null) ?? null,
    versionBefore: (b?.version as string) ?? null,
    versionAfter: String(a.version ?? ''),
    enabledBefore: typeof b?.enabled === 'boolean' ? b.enabled : null,
    enabledAfter: a.enabled !== false,
    diff: Array.isArray(a.diff) ? a.diff : [],
  };
}

function actorOf(caller: AdminCaller): string {
  if (!caller.actorEmail) throw new CampaignError(400, 'missing_actor', 'X-Admin-Actor (admin email) is required for rating prompt changes made with the API secret');
  return caller.actorEmail;
}

/** Bounded reads for the audience count: plenty for today's user base, flagged when hit. */
const AUDIENCE_PROFILE_LIMIT = 5000;
const AUDIENCE_FOOD_ROW_LIMIT = 50_000;

type ProfileRow = { id: string; email: string | null; is_admin?: boolean | null; created_at: string | null; timezone: string | null; metadata: unknown; display_name?: string | null };

export interface RecentRequest {
  userId: string;
  displayName: string | null;
  at: string;
  trigger: string | null;
  platform: string | null;
  appVersion: string | null;
  promptCount: number;
}

/** Pure: per-user distinct food days before each user's today, capped. */
export function mealDaysByUser(
  rows: Array<{ user_id: string; entry_date: string }>,
  todayByUser: Map<string, string>,
  cap: number
): Map<string, number> {
  const days = new Map<string, Set<string>>();
  for (const r of rows) {
    const today = todayByUser.get(r.user_id);
    if (!today || r.entry_date >= today) continue;
    let s = days.get(r.user_id);
    if (!s) days.set(r.user_id, (s = new Set()));
    s.add(r.entry_date);
  }
  const out = new Map<string, number>();
  for (const [u, s] of days) out.set(u, Math.min(cap, s.size));
  return out;
}

/** Pure: newest prompt requests from profiles' ledgers. */
export function recentRequestsFrom(profiles: ProfileRow[], limit: number): RecentRequest[] {
  const out: RecentRequest[] = [];
  for (const p of profiles) {
    const l = ledgerOf(p.metadata);
    if (!l.last_prompt_at) continue;
    out.push({
      userId: p.id,
      displayName: p.display_name ?? null,
      at: l.last_prompt_at,
      trigger: l.last_trigger ?? null,
      platform: l.last_platform ?? null,
      appVersion: l.last_app_version ?? null,
      promptCount: typeof l.prompt_count === 'number' ? l.prompt_count : 0,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

export class RatingPromptAdminService {
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
      killSwitch: { envEnabled: envEnabled(), envVar: 'RATING_PROMPT_ENABLED' },
      limits: LIMITS,
      triggers: KNOWN_TRIGGERS.map((key) => ({ key, ...TRIGGER_LABELS[key] })),
      lastChange: last.changes[0] ?? null,
      propagation: {
        server: 'within ~30 s (per-instance config cache)',
        apps: 'at the start of the next app session (the apps fetch eligibility once per session)',
      },
    };
  }

  static validate(raw: unknown) {
    return validateConfig(raw);
  }

  /**
   * GET audience: users eligible right now if they open a supported build
   * (each enabled platform at its min version; the country rule applies at
   * request time and is not counted here), and why the rest are not.
   */
  static async audience(now = new Date(), env: Record<string, string | undefined> = process.env) {
    const pub = await readPublishedConfig();
    const supabase = createAdminSupabase();
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, is_admin, created_at, timezone, metadata')
      .limit(AUDIENCE_PROFILE_LIMIT);
    if (error) throw error;
    const rows = (profiles ?? []) as ProfileRow[];
    const todayByUser = new Map(rows.map((p) => [p.id, localDay(now, p.timezone)]));
    const since = new Date(now.getTime() - 400 * 86_400_000).toISOString().slice(0, 10);
    const { data: food, error: foodError } = await supabase
      .from('food_log_entries')
      .select('user_id, entry_date')
      .eq('entry_type', 'food')
      .is('deleted_at', null)
      .gte('entry_date', since)
      .limit(AUDIENCE_FOOD_ROW_LIMIT);
    if (foodError) throw foodError;
    const foodRows = (food ?? []) as Array<{ user_id: string; entry_date: string }>;
    const mealDays = mealDaysByUser(foodRows, todayByUser, Math.max(0, pub.config.minMealDays - 1));
    const platforms = (['ios', 'android'] as RatingPromptPlatform[]).filter((p) => pub.config.platforms[p].enabled);

    const byReason: Partial<Record<IneligibleReason, number>> = {};
    const byTrigger: Record<string, number> = {};
    let eligible = 0;
    for (const p of rows) {
      const ledger = ledgerOf(p.metadata);
      const facts = {
        userId: p.id,
        email: p.email ?? null,
        isAdmin: p.is_admin === true,
        signupAt: p.created_at ?? null,
        mealDaysBeforeToday: mealDays.get(p.id) ?? 0,
        lastPromptAt: ledger.last_prompt_at ?? null,
        promptCount: typeof ledger.prompt_count === 'number' ? ledger.prompt_count : 0,
      };
      const decisions = (platforms.length ? platforms : (['ios'] as RatingPromptPlatform[])).map((platform) =>
        decideRatingPrompt({
          config: pub.config,
          enabled: pub.enabled,
          envEnabled: envEnabled(env),
          configVersion: pub.version,
          facts,
          request: { platform, appVersion: pub.config.platforms[platform].minAppVersion, country: null },
          now,
          env,
        })
      );
      const yes = decisions.find((d) => d.eligible);
      if (yes) {
        eligible += 1;
        for (const t of yes.triggers) byTrigger[t.key] = (byTrigger[t.key] ?? 0) + 1;
      } else {
        const reason = decisions[0].reason ?? 'disabled';
        byReason[reason] = (byReason[reason] ?? 0) + 1;
      }
    }
    return {
      eligible,
      total: rows.length,
      byReason,
      byTrigger,
      computedAt: now.toISOString(),
      truncated: rows.length >= AUDIENCE_PROFILE_LIMIT || foodRows.length >= AUDIENCE_FOOD_ROW_LIMIT,
      note: 'Counts users who would be eligible on a supported app build now; the country rule applies per request and is not counted.',
    };
  }

  /** GET requests: newest prompt requests (one row per user: their latest). */
  static async requests(limit = 50): Promise<{ requests: RecentRequest[] }> {
    const { data, error } = await createAdminSupabase()
      .from('profiles')
      .select('id, display_name, metadata')
      .not('metadata->rating_prompt', 'is', null)
      .limit(AUDIENCE_PROFILE_LIMIT);
    if (error) throw error;
    return { requests: recentRequestsFrom((data ?? []) as ProfileRow[], Math.min(200, Math.max(1, limit))) };
  }

  /** POST publish. */
  static async publish(body: unknown, caller: AdminCaller, opts: { now?: Date } = {}) {
    const actor = actorOf(caller);
    const input = publishBodySchema.parse(body ?? {});
    const v = validateConfig(input.config);
    if (!v.config) {
      throw new CampaignError(400, 'VALIDATION_ERROR', `Draft does not validate — ${v.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; ')}`, { issues: v.issues });
    }
    const config: RatingPromptConfig = v.config;
    const now = (opts.now ?? new Date()).toISOString();
    const pub = await readPublishedConfig();
    if (pub.version !== input.baseVersion) {
      throw new CampaignError(409, 'STALE_DRAFT', 'The published rating prompt settings changed since this draft was opened. Reload to see them, then re-apply your change.', { currentVersion: pub.version });
    }
    const versionAfter = configVersion(input.enabled, config);
    if (versionAfter === pub.version && pub.source === 'database') throw new CampaignError(400, 'NO_CHANGES', 'The draft is identical to the published settings');

    const supabase = createAdminSupabase();
    const row = {
      name: CONFIG_FLAG_NAME,
      description: 'Store rating prompt (server-driven eligibility for the iOS / Play rating sheet). is_enabled = admin master switch; metadata = config. Edited in Admin Tools → FitCircle → Rating prompt.',
      is_enabled: input.enabled,
      rollout_percentage: 0,
      metadata: config,
      updated_at: now,
    };
    const stale = () => new CampaignError(409, 'STALE_DRAFT', 'Someone published rating prompt settings at the same moment. Reload to see them, then re-apply your change.');
    if (pub.source === 'database' || pub.invalidStored) {
      let q = supabase.from('feature_flags').update(row).eq('name', CONFIG_FLAG_NAME);
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
    ratingConfigCache.clear();

    const diff = diffConfigs(pub.config, config).concat(input.enabled !== pub.enabled ? [{ path: 'enabled', before: pub.enabled, after: input.enabled }] : []);
    const audit = {
      experiment_key: CONFIG_AUDIT_KEY,
      actor,
      action: 'config_publish',
      before: { version: pub.version, enabled: pub.enabled, source: pub.source, config: pub.config },
      after: { version: versionAfter, enabled: input.enabled, config, summary: input.summary, note: input.note ?? null, diff },
      at: now,
    };
    const { data: auditRow, error: auditError } = await supabase.from('experiment_audit_log').insert(audit).select('*').single();
    if (auditError) console.error('[rating-prompt-admin] audit insert failed (config IS published):', auditError.message);

    return { config, enabled: input.enabled, version: versionAfter, change: auditRow ? toChange(auditRow as AuditRow) : null };
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
      console.warn('[rating-prompt-admin] change log read failed:', error.message);
      return { changes: [] };
    }
    return { changes: ((data ?? []) as AuditRow[]).map(toChange) };
  }
}
