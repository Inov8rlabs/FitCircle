/**
 * GA4 attribution sync (docs/ADS_ATTRIBUTION_GA4.md): reads Google's
 * ad-id-matched attribution from the GA4 BigQuery export and
 *  - upgrades organic / unknown (or missing) user_attribution rows to google_ads,
 *  - enriches google_ads rows that have no campaign (campaign + ad group),
 * joining by GA4 user_id, stored app_instance_id, or (no id at all) the
 * time + geo + device fallback matcher. google_ads rows still without a
 * campaign get it from the Play referrer's gad_campaignid.
 *
 * Off unless GA4_ATTRIBUTION_SYNC_ENABLED=true (the admin backfill passes
 * force). Never touches apple_ads / meta rows, rows that already have a
 * campaign, or test / QA users; every write is guarded so a row changed
 * meanwhile is left alone. Re-running is a no-op.
 *
 * Dry run returns a per-user preview (current row, proposed row, evidence) for
 * Admin Tools to review; apply can be limited to the reviewed user ids.
 */
import { testFlags } from '@/lib/trials/classify';
import { canonicalEmail } from '@/lib/validation/email-canonical';

import { addDays, diffDays } from '../dates';
import {
  buildCatalog,
  evidenceOf,
  ga4AttributionSql,
  ga4TablesSql,
  googleAdsSignals,
  instanceDevices,
  instanceFirstOpenMs,
  isUuid,
  planChange,
  planReferrerEnrichment,
  UPGRADABLE_CHANNELS,
  type AttributionSnapshot,
  type GoogleAdsCatalog,
  type Ga4InstanceRow,
  type MatchedBy,
  type PlannedChange,
  type PlanOutcome,
} from '../ga4/attribution';
import { BigQueryClient, ga4BigQueryConfigFromEnv, type Ga4BigQueryConfig } from '../ga4/bigquery';
import { ga4CountryToIso2, normIso2, timezoneCountry } from '../ga4/countries';
import { CONFIDENCE_RANK, matchInstances, type Confidence, type MatchInstance, type MatchUser, type Unmatched } from '../ga4/matcher';
import type { AttributionRow } from '../types';

import { chunk, db, selectAll } from './db';

export const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_LOOKBACK_DAYS = 60;
/** Explicit backfills may go further back than the daily lookback (billing-enabled exports keep history). */
export const MAX_BACKFILL_DAYS = 400;
const PREVIEW_LIMIT = 500;
const DAY_MS = 86_400_000;

export type ApplyStatus = 'applied' | 'would_apply' | 'below_confidence' | 'not_selected' | 'lost_race' | 'no_change';

export interface Ga4PreviewRow {
  userId: string;
  email: string | null;
  outcome: PlanOutcome;
  method: PlannedChange['method'];
  confidence: Confidence;
  status: ApplyStatus;
  current: AttributionSnapshot | null;
  proposed: (AttributionSnapshot & { campaignName: string | null; adGroupName: string | null }) | null;
  evidence: Record<string, unknown>;
}

export interface Ga4UnmatchedRow {
  userPseudoId: string;
  reason: Unmatched['reason'] | 'not_in_pool';
  firstOpenAt: string | null;
  country: string | null;
  device: string | null;
  campaign: string | null;
  candidates: Unmatched['candidates'];
}

export interface Ga4SyncResult {
  skipped: 'disabled' | 'not_configured' | null;
  dryRun: boolean;
  minConfidence: Confidence;
  range: { start: string; end: string } | null;
  /** Earliest / latest daily export table seen (null when it could not be read). */
  exportTables: { first: string | null; last: string | null; count: number } | null;
  /** App instances read from the export. */
  instances: number;
  /** …of which Google Ads signals were found. */
  googleInstances: number;
  /** Users tied to an instance (exact + heuristic). */
  matched: number;
  exactMatched: number;
  heuristicMatched: number;
  inserted: number;
  upgraded: number;
  enriched: number;
  outcomes: Partial<Record<PlanOutcome | 'unmatched' | 'lost_race' | 'below_confidence' | 'not_selected', number>>;
  preview: Ga4PreviewRow[];
  previewTruncated: boolean;
  /** Google-signal instances we could not tie to a user, with why. */
  unmatchedGoogle: Ga4UnmatchedRow[];
  warnings: string[];
  error: string | null;
}

export interface Ga4RunOptions {
  now?: Date;
  start?: string;
  end?: string;
  dryRun?: boolean;
  config?: Ga4BigQueryConfig | null;
  client?: BigQueryClient;
  /** Run even when GA4_ATTRIBUTION_SYNC_ENABLED is off (admin backfill). */
  force?: boolean;
  /** Lowest confidence that is written (default medium). */
  minConfidence?: Confidence;
  /** Apply only these users (the rows an admin reviewed). */
  userIds?: string[];
  /** Admin who applied (raw.ga4.appliedBy). */
  actorEmail?: string | null;
}

export const ga4SyncEnabled = (env: NodeJS.ProcessEnv = process.env) => env.GA4_ATTRIBUTION_SYNC_ENABLED === 'true';

function lookbackDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.GA4_ATTRIBUTION_LOOKBACK_DAYS);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LOOKBACK_DAYS) : DEFAULT_LOOKBACK_DAYS;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const suffix = (day: string) => day.replace(/-/g, '');
const tableDay = (t: string | null | undefined) => {
  const m = /^events_(\d{4})(\d{2})(\d{2})$/.exec(String(t ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const ms = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
const minMs = (vals: Array<number | null>) => {
  const xs = vals.filter((v): v is number => v !== null);
  return xs.length ? Math.min(...xs) : null;
};

interface ProfileRow {
  id: string;
  email: string | null;
  email_canonical: string | null;
  is_admin: boolean | null;
  metadata: Record<string, any> | null;
  created_at: string | null;
  country_code: string | null;
  timezone: string | null;
}
const PROFILE_COLS = 'id, email, email_canonical, is_admin, metadata, created_at, country_code, timezone';
interface PushRow {
  id: string;
  user_id: string;
  platform: string | null;
  device_name: string | null;
  created_at: string | null;
}
interface AssignmentRow {
  user_id: string;
  experiment_key: string;
  platform: string | null;
  country: string | null;
  assigned_at: string | null;
}
interface SubEventRow {
  id: string;
  user_id: string | null;
  raw: Record<string, any> | null;
}

/** Everything we know about a set of users that the matcher and the guards need. */
interface UserFacts {
  profiles: Map<string, ProfileRow>;
  attribution: Map<string, AttributionRow>;
  push: Map<string, PushRow[]>;
  assignments: Map<string, AssignmentRow[]>;
  storeCountries: Map<string, string[]>;
}

async function loadFacts(ids: string[]): Promise<UserFacts> {
  const f: UserFacts = { profiles: new Map(), attribution: new Map(), push: new Map(), assignments: new Map(), storeCountries: new Map() };
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  for (const part of chunk([...new Set(ids)], 150)) {
    const [prof, attr, tokens, asg, subs] = await Promise.all([
      selectAll<ProfileRow>(() => db().from('profiles').select(PROFILE_COLS).in('id', part).order('id', { ascending: true })),
      selectAll<AttributionRow>(() => db().from('user_attribution').select('*').in('user_id', part).order('user_id', { ascending: true })),
      selectAll<PushRow>(() => db().from('push_tokens').select('id, user_id, platform, device_name, created_at').in('user_id', part).order('id', { ascending: true })),
      selectAll<AssignmentRow>(() =>
        db().from('experiment_assignments').select('user_id, experiment_key, platform, country, assigned_at').in('user_id', part).order('user_id', { ascending: true }).order('experiment_key', { ascending: true })
      ),
      selectAll<SubEventRow>(() => db().from('subscription_events').select('id, user_id, raw').in('user_id', part).order('id', { ascending: true })),
    ]);
    for (const p of prof) f.profiles.set(p.id, p);
    for (const a of attr) f.attribution.set(a.user_id, a);
    for (const t of tokens) push(f.push, t.user_id, t);
    for (const a of asg) push(f.assignments, a.user_id, a);
    for (const e of subs) {
      const c = normIso2(e.raw?.country_code);
      if (e.user_id && c) push(f.storeCountries, e.user_id, c);
    }
  }
  return f;
}

function isAndroidUser(f: UserFacts, id: string): boolean {
  if (f.attribution.get(id)?.platform === 'android') return true;
  if ((f.push.get(id) ?? []).some((t) => t.platform === 'android')) return true;
  return (f.assignments.get(id) ?? []).some((a) => String(a.platform ?? '').toLowerCase() === 'android');
}

function countrySignals(f: UserFacts, id: string): MatchUser['countries'] {
  const out: MatchUser['countries'] = [];
  const add = (source: string, v: unknown) => {
    const c = normIso2(v);
    if (c && !out.some((x) => x.source === source && x.value === c)) out.push({ source, value: c });
  };
  add('attribution', f.attribution.get(id)?.country);
  for (const a of f.assignments.get(id) ?? []) add('experiment_assignment', a.country);
  for (const c of f.storeCountries.get(id) ?? []) add('revenuecat', c);
  const p = f.profiles.get(id);
  add('profile', p?.country_code);
  add('timezone', timezoneCountry(p?.timezone));
  return out;
}

function toMatchUser(f: UserFacts, id: string, isTest: boolean): MatchUser {
  const p = f.profiles.get(id);
  const tokens = f.push.get(id) ?? [];
  return {
    userId: id,
    firstSeenMs: minMs([
      ms(p?.created_at),
      ms(f.attribution.get(id)?.reported_at),
      ...tokens.map((t) => ms(t.created_at)),
      ...(f.assignments.get(id) ?? []).map((a) => ms(a.assigned_at)),
    ]),
    countries: countrySignals(f, id),
    devices: [...new Set(tokens.filter((t) => t.platform === 'android' && t.device_name).map((t) => t.device_name!.trim()))],
    isTest,
  };
}

function toMatchInstance(r: Ga4InstanceRow): MatchInstance {
  return {
    pseudoId: String(r.user_pseudo_id),
    firstOpenMs: instanceFirstOpenMs(r),
    countryIso: ga4CountryToIso2(r.geo_country),
    countryName: r.geo_country ?? null,
    region: r.geo_region ?? null,
    devices: instanceDevices(r),
    brand: r.device_brand ?? null,
  };
}

async function adminCanonicals(): Promise<Set<string>> {
  const rows = await selectAll<{ id: string; email: string | null; email_canonical: string | null }>(() =>
    db().from('profiles').select('id, email, email_canonical').eq('is_admin', true).order('id', { ascending: true })
  );
  return new Set(rows.map((r) => r.email_canonical ?? canonicalEmail(r.email)).filter((v): v is string => !!v));
}

function isTestUser(f: UserFacts, id: string, admins: ReadonlySet<string>): boolean {
  const p = f.profiles.get(id);
  if (!p) return f.attribution.get(id)?.is_test === true;
  return testFlags({ profile: p, attributionIsTest: f.attribution.get(id)?.is_test === true, adminCanonicals: admins }).length > 0;
}

/** Profiles created in [from, to) (ISO), ids only. */
async function profilesCreatedBetween(from: string, to: string): Promise<string[]> {
  const rows = await selectAll<{ id: string }>(() => db().from('profiles').select('id').gte('created_at', from).lt('created_at', to).order('id', { ascending: true }));
  return rows.map((r) => r.id);
}

export class Ga4AttributionService {
  /**
   * `start` / `end` (YYYY-MM-DD, export days) default to the last
   * GA4_ATTRIBUTION_LOOKBACK_DAYS full days before `now` (the daily export lands the next day).
   */
  static async run(opts: Ga4RunOptions = {}): Promise<Ga4SyncResult> {
    const minConfidence = opts.minConfidence ?? 'medium';
    const base: Ga4SyncResult = {
      skipped: null,
      dryRun: !!opts.dryRun,
      minConfidence,
      range: null,
      exportTables: null,
      instances: 0,
      googleInstances: 0,
      matched: 0,
      exactMatched: 0,
      heuristicMatched: 0,
      inserted: 0,
      upgraded: 0,
      enriched: 0,
      outcomes: {},
      preview: [],
      previewTruncated: false,
      unmatchedGoogle: [],
      warnings: [],
      error: null,
    };
    if (!opts.force && !ga4SyncEnabled()) return { ...base, skipped: 'disabled' };

    const now = opts.now ?? new Date();
    const syncedAt = now.toISOString();
    const explicit = !!(opts.start || opts.end);
    let end = opts.end ?? addDays(ymd(now), -1);
    let start = opts.start ?? addDays(end, -(lookbackDays() - 1));
    if (explicit && diffDays(start, end) + 1 > MAX_BACKFILL_DAYS) {
      start = addDays(end, -(MAX_BACKFILL_DAYS - 1));
      base.warnings.push(`range capped to ${MAX_BACKFILL_DAYS} days`);
    }
    const result: Ga4SyncResult = { ...base, range: { start, end } };
    const bump = (k: keyof Ga4SyncResult['outcomes']) => (result.outcomes[k] = (result.outcomes[k] ?? 0) + 1);

    const config = opts.config !== undefined ? opts.config : ga4BigQueryConfigFromEnv();
    const plans = new Map<string, PlannedChange>();
    const entities = await selectAll<{ level: string; external_id: string; parent_external_id: string | null; name: string | null; platform: string | null; start_at: string | null }>(() =>
      db().from('ad_entities').select('level, external_id, parent_external_id, name, platform, start_at').eq('channel', 'google_ads').in('level', ['campaign', 'ad_group']).order('external_id', { ascending: true })
    );
    const catalog: GoogleAdsCatalog = buildCatalog(entities);
    const campaigns = entities.filter((e) => e.level === 'campaign');
    const admins = await adminCanonicals();
    let facts: UserFacts = { profiles: new Map(), attribution: new Map(), push: new Map(), assignments: new Map(), storeCountries: new Map() };

    if (!config) {
      result.skipped = 'not_configured';
    } else {
      const client = opts.client ?? new BigQueryClient(config);
      // Clamp to the export tables that exist (sandbox tables expire after 60 days).
      try {
        const [t] = await client.query(ga4TablesSql(config.projectId, config.dataset));
        const first = tableDay(t?.first_table);
        const last = tableDay(t?.last_table);
        result.exportTables = { first, last, count: Number(t?.tables ?? 0) || 0 };
        if (first && start < first) {
          result.warnings.push(`start ${start} is before the earliest export table (${first}); clamped`);
          start = first;
        }
        if (last && end > last) end = last;
        if (!first || start > end) {
          result.warnings.push('no export tables in range');
          result.range = { start, end: end < start ? start : end };
        } else result.range = { start, end };
      } catch (e: any) {
        result.warnings.push(`export table list unavailable (${String(e?.message ?? e).slice(0, 120)}); querying the requested range`);
      }

      const noTables = result.warnings.includes('no export tables in range');
      const rows = noTables
        ? []
        : ((await client.query(ga4AttributionSql(config.projectId, config.dataset), [
            { name: 'start', value: suffix(start) },
            { name: 'end', value: suffix(end) },
            { name: 'app_id', value: config.androidAppId },
          ])) as unknown as Ga4InstanceRow[]);
      const instances = rows.filter((r) => r.user_pseudo_id);
      result.instances = rows.length;
      const isGoogle = (r: Ga4InstanceRow) => googleAdsSignals(r).length > 0;
      result.googleInstances = instances.filter(isGoogle).length;

      // 1. Exact joins: GA4 user_id (profile UUID), else our stored app_instance_id.
      const byInstance = new Map<string, AttributionRow>();
      for (const part of chunk(instances.map((r) => r.user_pseudo_id!), 150)) {
        const found = await selectAll<AttributionRow>(() => db().from('user_attribution').select('*').in('app_instance_id', part).order('user_id', { ascending: true }));
        for (const a of found) if (a.app_instance_id) byInstance.set(a.app_instance_id, a);
      }
      const sorted = [...instances].sort((a, b) => (instanceFirstOpenMs(a) ?? Infinity) - (instanceFirstOpenMs(b) ?? Infinity));
      const matches = new Map<string, { row: Ga4InstanceRow; by: MatchedBy; confidence: Confidence; heuristic?: any }>();
      const linkedInstances = new Set<string>();
      for (const r of sorted) {
        const uid = isUuid(r.user_id) ? r.user_id.toLowerCase() : null;
        const viaInstance = byInstance.get(r.user_pseudo_id!)?.user_id ?? null;
        const userId = uid ?? viaInstance;
        if (!userId) continue;
        linkedInstances.add(r.user_pseudo_id!);
        // Earliest install first, so a user seen on two devices keeps the first one.
        if (!matches.has(userId)) matches.set(userId, { row: r, by: uid ? 'user_id' : 'app_instance_id', confidence: 'exact' });
      }
      result.exactMatched = matches.size;

      // 2. Fallback for everything else: time + geo + device, 1:1 only.
      const windowFrom = new Date(Date.parse(`${start}T00:00:00Z`) - DAY_MS).toISOString();
      const windowTo = new Date(Date.parse(`${end}T00:00:00Z`) + 2 * DAY_MS).toISOString();
      const poolIds = await profilesCreatedBetween(windowFrom, windowTo);
      facts = await loadFacts([...poolIds, ...matches.keys()]);
      const pool = poolIds
        .filter((id) => !matches.has(id) && isAndroidUser(facts, id) && !facts.attribution.get(id)?.app_instance_id)
        .map((id) => toMatchUser(facts, id, isTestUser(facts, id, admins)));
      const unlinked = instances.filter((r) => !linkedInstances.has(r.user_pseudo_id!));
      const heuristic = matchInstances(unlinked.map(toMatchInstance), pool);
      const rowById = new Map(instances.map((r) => [r.user_pseudo_id!, r]));
      for (const m of heuristic.matches) {
        matches.set(m.userId, { row: rowById.get(m.pseudoId)!, by: 'heuristic_time_geo_device', confidence: m.confidence, heuristic: m.evidence });
      }
      result.heuristicMatched = heuristic.matches.length;
      result.matched = matches.size;

      for (const u of heuristic.unmatched) {
        const r = rowById.get(u.pseudoId)!;
        if (!isGoogle(r)) continue;
        bump('unmatched');
        const ev = evidenceOf(r, 'heuristic_time_geo_device');
        result.unmatchedGoogle.push({ userPseudoId: u.pseudoId, reason: u.reason, firstOpenAt: ev.firstOpenAt, country: ev.country, device: ev.device, campaign: ev.googleAdsCampaignName ?? ev.firstUserCampaign, candidates: u.candidates });
      }

      for (const [userId, m] of matches) {
        const plan = planChange({
          userId,
          existing: facts.attribution.get(userId) ?? null,
          profileExists: facts.profiles.has(userId),
          isTest: isTestUser(facts, userId, admins),
          ev: evidenceOf(m.row, m.by, m.confidence, m.heuristic),
          catalog,
          syncedAt,
        });
        // Exact matches on non-Google instances are the bulk and carry nothing; keep them out of the preview.
        if (plan.outcome === 'not_google' && m.by !== 'heuristic_time_geo_device') {
          bump('not_google');
          continue;
        }
        plans.set(userId, plan);
      }
    }

    // 3. google_ads rows still without a campaign: referrer gad_campaignid, else the sole campaign (low).
    const missing = await selectAll<AttributionRow>(() =>
      db().from('user_attribution').select('*').eq('channel', 'google_ads').is('campaign_external_id', null).order('user_id', { ascending: true })
    );
    const needFacts = missing.map((a) => a.user_id).filter((id) => !facts.profiles.has(id));
    if (needFacts.length) {
      const more = await loadFacts(needFacts);
      for (const [k, v] of more.profiles) facts.profiles.set(k, v);
      for (const [k, v] of more.attribution) facts.attribution.set(k, v);
    }
    for (const a of missing) {
      if (plans.get(a.user_id)?.write) continue;
      const reported = ms(a.reported_at ?? null) ?? Date.parse(syncedAt);
      const live = campaigns.filter((c) => (c.platform ?? 'android') === (a.platform ?? 'android') && (ms(c.start_at) ?? 0) <= reported);
      const sole = live.length === 1 ? live[0].external_id : null;
      const p = planReferrerEnrichment(a, isTestUser(facts, a.user_id, admins), catalog, sole, syncedAt);
      if (p) plans.set(a.user_id, p);
    }

    // 4. Apply (guarded) or preview.
    const selected = opts.userIds ? new Set(opts.userIds.map((u) => u.toLowerCase())) : null;
    const preview: Ga4PreviewRow[] = [];
    for (const p of plans.values()) {
      let status: ApplyStatus = 'no_change';
      if (!p.write) bump(p.outcome);
      else if (CONFIDENCE_RANK[p.confidence] < CONFIDENCE_RANK[minConfidence]) {
        status = 'below_confidence';
        bump('below_confidence');
      } else if (selected && !selected.has(p.userId)) {
        status = 'not_selected';
        bump('not_selected');
      } else if (opts.dryRun) {
        status = 'would_apply';
        bump(p.outcome);
        if (p.outcome === 'insert') result.inserted += 1;
        else if (p.outcome === 'upgrade') result.upgraded += 1;
        else result.enriched += 1;
      } else {
        const ok = await Ga4AttributionService.write(p, syncedAt, opts.actorEmail ?? null);
        status = ok ? 'applied' : 'lost_race';
        if (!ok) bump('lost_race');
        else {
          bump(p.outcome);
          if (p.outcome === 'insert') result.inserted += 1;
          else if (p.outcome === 'upgrade') result.upgraded += 1;
          else result.enriched += 1;
        }
      }
      preview.push({
        userId: p.userId,
        email: facts.profiles.get(p.userId)?.email ?? null,
        outcome: p.outcome,
        method: p.method,
        confidence: p.confidence,
        status,
        current: p.current,
        proposed: p.proposed
          ? { ...p.proposed, campaignName: p.proposed.campaign_external_id ? (catalog.nameById.get(p.proposed.campaign_external_id) ?? null) : null, adGroupName: p.proposed.ad_group_external_id ? (catalog.nameById.get(p.proposed.ad_group_external_id) ?? null) : null }
          : null,
        evidence: p.evidence,
      });
    }
    const rank = (r: Ga4PreviewRow) => (r.proposed ? 0 : 1);
    preview.sort((a, b) => rank(a) - rank(b) || CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || a.userId.localeCompare(b.userId));
    result.previewTruncated = preview.length > PREVIEW_LIMIT;
    result.preview = preview.slice(0, PREVIEW_LIMIT);
    result.unmatchedGoogle = result.unmatchedGoogle.slice(0, PREVIEW_LIMIT);
    return result;
  }

  /** One guarded write. False when the row changed since it was planned (or a concurrent insert won). */
  private static async write(p: PlannedChange, syncedAt: string, actorEmail: string | null): Promise<boolean> {
    const w = p.write!;
    const stamp = (row: any) => {
      if (!actorEmail || !row.raw) return row;
      const raw = { ...row.raw };
      if (raw.ga4) raw.ga4 = { ...raw.ga4, appliedBy: actorEmail };
      if (raw.campaign_enrichment) raw.campaign_enrichment = { ...raw.campaign_enrichment, appliedBy: actorEmail };
      return { ...row, raw };
    };
    const row = stamp(w.row);
    if (w.kind === 'insert') {
      const { error } = await db().from('user_attribution').insert({ ...row, reported_at: syncedAt });
      if (error) {
        if (error.code === '23505') return false;
        throw new Error(`user_attribution insert: ${error.message}`);
      }
      return true;
    }
    const { user_id: _u, ...patch } = row;
    let q = db().from('user_attribution').update(patch).eq('user_id', p.userId);
    // Guards: an upgrade only replaces organic / unknown; an enrichment only fills a google_ads row with no campaign.
    q = w.kind === 'upgrade' ? q.in('channel', [...UPGRADABLE_CHANNELS]) : q.eq('channel', 'google_ads').is('campaign_external_id', null);
    const { data, error } = await q.select('user_id');
    if (error) throw new Error(`user_attribution update: ${error.message}`);
    return (data ?? []).length > 0;
  }
}
