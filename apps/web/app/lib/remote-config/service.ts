/**
 * RemoteConfigService (docs/TRIAL_FIRST_SPEC.md §6): per-user resolution of registry keys
 * (free-tier limits) from Admin Tools rules / defaults, plus the admin CRUD + audit.
 *
 * Reads: rules + defaults are cached per instance (swrCache: fresh 30 s, served stale up to
 * 10 min while refreshing). Fail-safe: a failed load serves the last good snapshot, else the
 * code defaults — a config outage can never take down the quota checks. A missing table
 * (migration 129 not applied yet) is an empty snapshot, i.e. the code defaults.
 *
 * Context: built from what the request already has. Platform / app version / country come
 * from the current request's headers when called inside a route (next/headers); sign-up date
 * comes from the caller's profile when passed. Channel (user_attribution), sign-up date when
 * not passed, and experiment arms are read lazily ONLY when a candidate rule needs them.
 */
import { randomUUID } from 'node:crypto';

import { headers } from 'next/headers';

import { readExperimentRequestInfo } from '../experiments/request-info';
import { swrCache } from '../home-feed/cache';
import { createAdminSupabase } from '../supabase-admin';

import { audienceMismatch, audienceNeeds, audienceSchema, type AudienceFacts, type RcAudience, type RcPlatform } from './audience';
import {
  REMOTE_CONFIG_KEYS,
  REMOTE_CONFIG_REGISTRY,
  isRemoteConfigKey,
  keyDef,
  validValue,
  valueError,
  type RemoteConfigKey,
} from './registry';
import {
  EMPTY_SNAPSHOT,
  candidateRules,
  fallbackResolution,
  parseRules,
  ruleCreateSchema,
  rulePatchSchema,
  type ConfigSnapshot,
  type DefaultRow,
  type Resolution,
  type RuleRow,
} from './resolve';

export class RemoteConfigError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'RemoteConfigError';
  }
}

const UNDEFINED_TABLE = '42P01';

/** Per-request context. `undefined` = "not known by the caller" (filled from headers / lazily). */
export interface RemoteConfigContext {
  userId: string;
  now?: Date;
  platform?: RcPlatform | null;
  appVersion?: string | null;
  country?: string | null;
  /** profiles.created_at when the caller already has the profile. */
  signupAt?: string | null;
  /** user_attribution.channel when the caller already has it. */
  channel?: string | null;
}

async function loadSnapshot(): Promise<ConfigSnapshot> {
  const supabase = createAdminSupabase();
  const [rules, defaults] = await Promise.all([
    supabase.from('remote_config_rules').select('*'),
    supabase.from('remote_config_defaults').select('*'),
  ]);
  const missing = (e: any) => e?.code === UNDEFINED_TABLE;
  if (rules.error && !missing(rules.error)) throw new Error(`remote_config_rules: ${rules.error.message}`);
  if (defaults.error && !missing(defaults.error)) throw new Error(`remote_config_defaults: ${defaults.error.message}`);
  return {
    rules: parseRules(((rules.data ?? []) as RuleRow[]).filter((r) => isRemoteConfigKey(r.config_key))),
    defaults: new Map(((defaults.data ?? []) as DefaultRow[]).map((d) => [d.config_key, d])),
  };
}

let lastGood: ConfigSnapshot | null = null;

export const remoteConfigCache = swrCache<ConfigSnapshot>(
  async () => {
    const snap = await loadSnapshot();
    lastGood = snap;
    return snap;
  },
  { ttlMs: 30_000, maxStaleMs: 600_000, label: 'remote config' }
);

/** Test hook. */
export function resetRemoteConfigCache(): void {
  remoteConfigCache.clear();
  lastGood = null;
}

async function snapshot(): Promise<ConfigSnapshot> {
  try {
    return await remoteConfigCache.get();
  } catch (err: any) {
    console.warn('[remote-config] load failed; serving', lastGood ? 'last good snapshot' : 'code defaults', err?.message ?? err);
    return lastGood ?? EMPTY_SNAPSHOT;
  }
}

/** Platform / version / country of the CURRENT request, when there is one. Never throws. */
async function requestInfo(): Promise<{ platform: RcPlatform | null; appVersion: string | null; country: string | null } | null> {
  try {
    const h = await headers();
    const info = readExperimentRequestInfo({ headers: h });
    return { platform: info.platform, appVersion: info.appVersion, country: info.ipCountry };
  } catch {
    return null; // not inside a request (cron, after(), tests)
  }
}

/** Builds AudienceFacts lazily: each expensive fact is read at most once, only when a rule needs it. */
class FactLoader {
  private facts: AudienceFacts | null = null;
  private channelLoaded = false;
  private signupLoaded = false;
  private arms: Record<string, string | null> = {};

  constructor(private ctx: RemoteConfigContext) {}

  async base(): Promise<AudienceFacts> {
    if (this.facts) return this.facts;
    const needHeaders = this.ctx.platform === undefined || this.ctx.appVersion === undefined || this.ctx.country === undefined;
    const req = needHeaders ? await requestInfo() : null;
    this.facts = {
      userId: this.ctx.userId,
      now: this.ctx.now ?? new Date(),
      platform: this.ctx.platform !== undefined ? this.ctx.platform : (req?.platform ?? null),
      appVersion: this.ctx.appVersion !== undefined ? this.ctx.appVersion : (req?.appVersion ?? null),
      country: this.ctx.country !== undefined ? this.ctx.country : (req?.country ?? null),
      channel: this.ctx.channel,
      signupAt: this.ctx.signupAt,
      experimentArms: this.arms,
    };
    this.channelLoaded = this.ctx.channel !== undefined;
    this.signupLoaded = this.ctx.signupAt !== undefined;
    return this.facts;
  }

  async for(audience: RcAudience): Promise<AudienceFacts> {
    const f = await this.base();
    const needs = audienceNeeds(audience);
    const supabase = createAdminSupabase();
    const jobs: Promise<void>[] = [];
    if (needs.channel && !this.channelLoaded) {
      this.channelLoaded = true;
      jobs.push(
        (async () => {
          const { data, error } = await supabase.from('user_attribution').select('channel, country').eq('user_id', f.userId).maybeSingle();
          f.channel = error ? null : ((data?.channel as string | null) ?? null);
          if (!f.country && !error && typeof data?.country === 'string') f.country = data.country.toUpperCase();
        })().catch(() => {
          f.channel = null;
        })
      );
    }
    if (needs.signup && !this.signupLoaded) {
      this.signupLoaded = true;
      jobs.push(
        (async () => {
          const { data, error } = await supabase.from('profiles').select('created_at').eq('id', f.userId).maybeSingle();
          f.signupAt = error ? null : ((data?.created_at as string | null) ?? null);
        })().catch(() => {
          f.signupAt = null;
        })
      );
    }
    if (needs.experiment && !(needs.experiment in this.arms)) {
      const key = needs.experiment;
      this.arms[key] = null;
      jobs.push(
        (async () => {
          const { data, error } = await supabase
            .from('experiment_assignments')
            .select('arm')
            .eq('experiment_key', key)
            .eq('user_id', f.userId)
            .maybeSingle();
          this.arms[key] = error ? null : ((data?.arm as string | null) ?? null);
        })().catch(() => {
          this.arms[key] = null;
        })
      );
    }
    await Promise.all(jobs);
    return f;
  }
}

async function resolveIn(snap: ConfigSnapshot, key: RemoteConfigKey, loader: FactLoader): Promise<Resolution> {
  for (const rule of candidateRules(snap, key)) {
    const facts = await loader.for(rule.parsedAudience);
    if (audienceMismatch(rule.parsedAudience, facts, rule.id)) continue;
    const v = validValue(key, rule.value);
    if (v === null) continue;
    return { value: v, source: 'rule', ruleId: rule.id, ruleName: rule.name };
  }
  return fallbackResolution(snap, key);
}

export interface AdminActor {
  email: string | null;
}

function badRequest(path: string, message: string): RemoteConfigError {
  return new RemoteConfigError(400, 'VALIDATION_ERROR', 'Invalid request body', { issues: [{ path, message }] });
}

function requireKey(key: string): RemoteConfigKey {
  if (!isRemoteConfigKey(key)) throw new RemoteConfigError(404, 'NOT_FOUND', `Unknown config key: ${key}`);
  return key;
}

function requireValue(key: RemoteConfigKey, value: unknown): number {
  const v = validValue(key, value);
  if (v === null) throw badRequest('value', valueError(key));
  return v;
}

function ruleOut(r: RuleRow) {
  return {
    id: r.id,
    key: r.config_key,
    name: r.name,
    enabled: r.enabled,
    priority: r.priority,
    audience: r.audience ?? {},
    value: r.value,
    valid: validValue(r.config_key as RemoteConfigKey, r.value) !== null && audienceSchema.safeParse(r.audience ?? {}).success,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

/** Audience fields an estimate can't evaluate from stored data (they depend on the request). */
const ESTIMATE_IGNORED: Array<keyof RcAudience> = ['appVersionGte', 'appVersionLt'];

export class RemoteConfigService {
  // ------------------------------------------------------------------ resolution

  /** Resolved value + where it came from. Never throws. */
  static async resolveConfig(key: RemoteConfigKey, ctx: RemoteConfigContext): Promise<Resolution> {
    try {
      const snap = await snapshot();
      return await resolveIn(snap, key, new FactLoader(ctx));
    } catch (err: any) {
      console.warn(`[remote-config] resolve ${key} failed; code default`, err?.message ?? err);
      return { value: keyDef(key).default, source: 'code' };
    }
  }

  static async value(key: RemoteConfigKey, ctx: RemoteConfigContext): Promise<number> {
    return (await this.resolveConfig(key, ctx)).value;
  }

  /** Every registry key for one context (shares the lazy fact reads). */
  static async resolveAll(ctx: RemoteConfigContext): Promise<{ values: Record<RemoteConfigKey, Resolution>; facts: AudienceFacts }> {
    const snap = await snapshot();
    const loader = new FactLoader(ctx);
    const values = {} as Record<RemoteConfigKey, Resolution>;
    for (const key of REMOTE_CONFIG_KEYS) {
      try {
        values[key] = await resolveIn(snap, key, loader);
      } catch {
        values[key] = { value: keyDef(key).default, source: 'code' };
      }
    }
    return { values, facts: await loader.base() };
  }

  // ------------------------------------------------------------------ admin reads

  private static async rawRows(): Promise<{ rules: RuleRow[]; defaults: DefaultRow[] }> {
    const supabase = createAdminSupabase();
    const [rules, defaults] = await Promise.all([
      supabase.from('remote_config_rules').select('*'),
      supabase.from('remote_config_defaults').select('*'),
    ]);
    if (rules.error) throw new Error(`remote_config_rules: ${rules.error.message}`);
    if (defaults.error) throw new Error(`remote_config_defaults: ${defaults.error.message}`);
    return { rules: (rules.data ?? []) as RuleRow[], defaults: (defaults.data ?? []) as DefaultRow[] };
  }

  /** GET /api/admin/remote-config */
  static async listKeys() {
    const { rules, defaults } = await this.rawRows();
    return {
      keys: REMOTE_CONFIG_KEYS.map((key) => {
        const def = REMOTE_CONFIG_REGISTRY[key];
        const d = defaults.find((row) => row.config_key === key) ?? null;
        return {
          key,
          type: def.type,
          min: def.min,
          max: def.max,
          unit: def.unit,
          description: def.description,
          codeDefault: def.default,
          default: d ? { value: d.value, updatedBy: d.updated_by, updatedAt: d.updated_at } : null,
          rules: rules
            .filter((r) => r.config_key === key)
            .sort((a, b) => (a.priority !== b.priority ? b.priority - a.priority : Date.parse(a.created_at) - Date.parse(b.created_at)))
            .map(ruleOut),
        };
      }),
    };
  }

  /** GET /api/admin/remote-config/changes?key= */
  static async listChanges(key: string | null, limit = 200) {
    if (key) requireKey(key);
    let q = createAdminSupabase().from('remote_config_changes').select('*').order('at', { ascending: false }).limit(limit);
    if (key) q = q.eq('config_key', key);
    const { data, error } = await q;
    if (error) throw new Error(`remote_config_changes: ${error.message}`);
    return {
      changes: ((data ?? [])).map((c) => ({
        id: c.id,
        key: c.config_key,
        target: c.target,
        ruleId: c.rule_id ?? null,
        action: c.action,
        actor: c.actor ?? null,
        before: c.before ?? null,
        after: c.after ?? null,
        at: c.at,
      })),
    };
  }

  // ------------------------------------------------------------------ admin writes (each audited, each clears this instance's cache)

  private static async audit(row: { config_key: string; target: 'default' | 'rule'; rule_id?: string | null; action: 'create' | 'update' | 'delete'; actor: string | null; before: unknown; after: unknown }) {
    const { error } = await createAdminSupabase()
      .from('remote_config_changes')
      .insert({ ...row, rule_id: row.rule_id ?? null, at: new Date().toISOString() });
    if (error) console.error('[remote-config] audit insert failed:', error.message);
  }

  /** PUT /api/admin/remote-config/{key}/default {value} — null resets to the code default. */
  static async setDefault(rawKey: string, body: unknown, actor: AdminActor) {
    const key = requireKey(rawKey);
    if (!body || typeof body !== 'object' || !('value' in (body))) throw badRequest('value', 'Required (use null to reset to the code default)');
    const extra = Object.keys(body).filter((k) => k !== 'value');
    if (extra.length) throw badRequest(extra[0], 'Unrecognized key');
    const raw = (body as { value: unknown }).value;
    const supabase = createAdminSupabase();
    const { data: before, error: readError } = await supabase.from('remote_config_defaults').select('*').eq('config_key', key).maybeSingle();
    if (readError) throw new Error(`remote_config_defaults: ${readError.message}`);
    if (raw === null) {
      if (before) {
        const { error } = await supabase.from('remote_config_defaults').delete().eq('config_key', key);
        if (error) throw new Error(`remote_config_defaults: ${error.message}`);
        await this.audit({ config_key: key, target: 'default', action: 'delete', actor: actor.email, before, after: null });
      }
      remoteConfigCache.clear();
      return { key, default: null, codeDefault: keyDef(key).default };
    }
    const value = requireValue(key, raw);
    const row = { config_key: key, value, updated_by: actor.email, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('remote_config_defaults').upsert(row, { onConflict: 'config_key' });
    if (error) throw new Error(`remote_config_defaults: ${error.message}`);
    await this.audit({ config_key: key, target: 'default', action: before ? 'update' : 'create', actor: actor.email, before: before ?? null, after: row });
    remoteConfigCache.clear();
    return { key, default: { value, updatedBy: row.updated_by, updatedAt: row.updated_at }, codeDefault: keyDef(key).default };
  }

  /** POST /api/admin/remote-config/{key}/rules */
  static async createRule(rawKey: string, body: unknown, actor: AdminActor) {
    const key = requireKey(rawKey);
    const input = ruleCreateSchema.parse(body ?? {});
    const value = requireValue(key, input.value);
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      config_key: key,
      name: input.name,
      enabled: input.enabled,
      priority: input.priority,
      audience: input.audience,
      value,
      created_by: actor.email,
      created_at: now,
      updated_by: actor.email,
      updated_at: now,
    };
    const { data, error } = await createAdminSupabase().from('remote_config_rules').insert(row).select('*').single();
    if (error || !data) throw new Error(`remote_config_rules: ${error?.message ?? 'no row returned'}`);
    await this.audit({ config_key: key, target: 'rule', rule_id: data.id, action: 'create', actor: actor.email, before: null, after: data });
    remoteConfigCache.clear();
    return ruleOut(data as RuleRow);
  }

  private static async getRule(id: string): Promise<RuleRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new RemoteConfigError(404, 'NOT_FOUND', 'Rule not found');
    const { data, error } = await createAdminSupabase().from('remote_config_rules').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`remote_config_rules: ${error.message}`);
    if (!data) throw new RemoteConfigError(404, 'NOT_FOUND', 'Rule not found');
    return data as RuleRow;
  }

  /** PATCH /api/admin/remote-config/rules/{id} */
  static async updateRule(id: string, body: unknown, actor: AdminActor) {
    const before = { ...(await this.getRule(id)) }; // snapshot for the audit row
    const patch = rulePatchSchema.parse(body ?? {});
    const key = requireKey(before.config_key);
    const update: Record<string, unknown> = { updated_by: actor.email, updated_at: new Date().toISOString() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.enabled !== undefined) update.enabled = patch.enabled;
    if (patch.priority !== undefined) update.priority = patch.priority;
    if (patch.audience !== undefined) update.audience = patch.audience;
    if ('value' in ((body ?? {}) as object)) update.value = requireValue(key, patch.value);
    const { data, error } = await createAdminSupabase().from('remote_config_rules').update(update).eq('id', id).select('*').single();
    if (error || !data) throw new Error(`remote_config_rules: ${error?.message ?? 'no row returned'}`);
    await this.audit({ config_key: key, target: 'rule', rule_id: id, action: 'update', actor: actor.email, before, after: data });
    remoteConfigCache.clear();
    return ruleOut(data as RuleRow);
  }

  /** DELETE /api/admin/remote-config/rules/{id} */
  static async deleteRule(id: string, actor: AdminActor) {
    const before = await this.getRule(id);
    const { error } = await createAdminSupabase().from('remote_config_rules').delete().eq('id', id);
    if (error) throw new Error(`remote_config_rules: ${error.message}`);
    await this.audit({ config_key: before.config_key, target: 'rule', rule_id: id, action: 'delete', actor: actor.email, before, after: null });
    remoteConfigCache.clear();
    return { deleted: true, id };
  }

  // ------------------------------------------------------------------ preview + estimate

  /**
   * POST /api/admin/remote-config/preview {userId, platform?, appVersion?, country?}
   * Resolves every key for that user from FRESH rows (not the instance cache). The request
   * context (platform / version / country) can be supplied; otherwise platform + country come
   * from the user's attribution row and app version is unknown.
   */
  static async preview(body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const userId = typeof b.userId === 'string' ? b.userId.trim() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw badRequest('userId', 'Expected a user id (uuid)');
    const supabase = createAdminSupabase();
    const [{ data: profile }, { data: attribution }] = await Promise.all([
      supabase.from('profiles').select('id, created_at').eq('id', userId).maybeSingle(),
      supabase.from('user_attribution').select('channel, country, platform').eq('user_id', userId).maybeSingle(),
    ]);
    if (!profile) throw new RemoteConfigError(404, 'NOT_FOUND', 'User not found');
    const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const platformRaw = (pick(b.platform) ?? pick(attribution?.platform))?.toLowerCase() ?? null;
    const ctx: RemoteConfigContext = {
      userId: profile.id as string,
      platform: platformRaw === 'ios' || platformRaw === 'android' || platformRaw === 'web' ? platformRaw : null,
      appVersion: pick(b.appVersion),
      country: (pick(b.country) ?? pick(attribution?.country))?.toUpperCase() ?? null,
      channel: pick(attribution?.channel),
      signupAt: pick(profile.created_at),
    };
    const { rules, defaults } = await this.rawRows();
    const snap: ConfigSnapshot = {
      rules: parseRules(rules.filter((r) => isRemoteConfigKey(r.config_key))),
      defaults: new Map(defaults.map((d) => [d.config_key, d])),
    };
    const loader = new FactLoader(ctx);
    const values: Record<string, Resolution> = {};
    for (const key of REMOTE_CONFIG_KEYS) values[key] = await resolveIn(snap, key, loader);
    const facts = await loader.base();
    return {
      userId: ctx.userId,
      values,
      context: {
        platform: facts.platform,
        appVersion: facts.appVersion,
        country: facts.country,
        channel: facts.channel ?? null,
        signupAt: facts.signupAt ?? null,
        experimentArms: facts.experimentArms ?? {},
        now: facts.now.toISOString(),
      },
    };
  }

  /**
   * POST /api/admin/remote-config/{key}/estimate {audience} → approximate matching users.
   * Evaluated over all profiles with their stored attribution (platform / country / channel) and
   * experiment assignments. App version is per request, so appVersionGte / appVersionLt are
   * IGNORED (listed in `ignored`); platform comes from the attribution row (install platform).
   */
  static async estimate(rawKey: string, body: unknown) {
    requireKey(rawKey);
    const audience = audienceSchema.parse((body as any)?.audience ?? {});
    const ignored = ESTIMATE_IGNORED.filter((k) => audience[k] !== undefined);
    const evalAudience: RcAudience = { ...audience };
    for (const k of ignored) delete evalAudience[k];
    const supabase = createAdminSupabase();
    const PAGE = 1000;
    const MAX = 50_000;
    const profiles: Array<{ id: string; created_at: string | null }> = [];
    for (let from = 0; from < MAX; from += PAGE) {
      const { data, error } = await supabase.from('profiles').select('id, created_at').range(from, from + PAGE - 1);
      if (error) throw new Error(`profiles: ${error.message}`);
      profiles.push(...((data ?? []) as any[]));
      if ((data ?? []).length < PAGE) break;
    }
    const attribution = new Map<string, { channel: string | null; country: string | null; platform: string | null }>();
    if (evalAudience.channels || evalAudience.countries || evalAudience.platforms) {
      for (let from = 0; from < MAX; from += PAGE) {
        const { data, error } = await supabase.from('user_attribution').select('user_id, channel, country, platform').range(from, from + PAGE - 1);
        if (error) throw new Error(`user_attribution: ${error.message}`);
        for (const r of (data ?? []) as any[]) attribution.set(r.user_id, r);
        if ((data ?? []).length < PAGE) break;
      }
    }
    const arms = new Map<string, string>();
    if (evalAudience.experiment) {
      for (let from = 0; from < MAX; from += PAGE) {
        const { data, error } = await supabase
          .from('experiment_assignments')
          .select('user_id, arm')
          .eq('experiment_key', evalAudience.experiment.key)
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`experiment_assignments: ${error.message}`);
        for (const r of (data ?? []) as any[]) arms.set(r.user_id, r.arm);
        if ((data ?? []).length < PAGE) break;
      }
    }
    const now = new Date();
    let count = 0;
    for (const p of profiles) {
      const a = attribution.get(p.id);
      const platform = (a?.platform ?? '').toLowerCase();
      const facts: AudienceFacts = {
        userId: p.id,
        now,
        platform: platform === 'ios' || platform === 'android' || platform === 'web' ? platform : null,
        appVersion: null,
        country: a?.country ? a.country.toUpperCase() : null,
        channel: a?.channel ?? null,
        signupAt: p.created_at,
        experimentArms: evalAudience.experiment ? { [evalAudience.experiment.key]: arms.get(p.id) ?? null } : {},
      };
      if (!audienceMismatch(evalAudience, facts, 'estimate')) count++;
    }
    return {
      count,
      total: profiles.length,
      approximate: true,
      ignored,
      // A percent rollout salted by the rule id can't be reproduced before the rule exists.
      ...(audience.percent !== undefined && !audience.bucketSalt ? { note: 'percent was evaluated with a placeholder salt; the real split uses the rule id' } : {}),
    };
  }
}
