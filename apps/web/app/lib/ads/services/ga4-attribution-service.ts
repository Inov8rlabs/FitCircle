/**
 * GA4 attribution sync (docs/ADS_ATTRIBUTION_GA4.md): reads Google's
 * ad-id-matched attribution from the GA4 BigQuery export and upgrades our
 * organic / unknown (or missing) user_attribution rows to google_ads.
 *
 * Off unless GA4_ATTRIBUTION_SYNC_ENABLED=true; skips cleanly when the BigQuery
 * env is unset. Never downgrades a paid attribution; re-running is a no-op
 * (rows it wrote have source google_ads_ga4 and channel google_ads).
 */
import { addDays } from '../dates';
import { evidenceOf, ga4AttributionSql, googleAdsSignals, isUuid, planChange, UPGRADABLE_CHANNELS, type Ga4InstanceRow, type PlannedChange, type PlanOutcome } from '../ga4/attribution';
import { BigQueryClient, ga4BigQueryConfigFromEnv, type Ga4BigQueryConfig } from '../ga4/bigquery';
import type { AttributionRow } from '../types';

import { chunk, db, selectAll } from './db';

export const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_LOOKBACK_DAYS = 60;

export interface Ga4SyncResult {
  skipped: 'disabled' | 'not_configured' | null;
  dryRun: boolean;
  range: { start: string; end: string } | null;
  /** App instances read from the export. */
  instances: number;
  /** …of which Google Ads signals were found. */
  googleInstances: number;
  /** Google instances we could tie to one of our users. */
  matched: number;
  inserted: number;
  upgraded: number;
  outcomes: Partial<Record<PlanOutcome | 'unmatched' | 'lost_race', number>>;
  error: string | null;
}

export const ga4SyncEnabled = (env: NodeJS.ProcessEnv = process.env) => env.GA4_ATTRIBUTION_SYNC_ENABLED === 'true';

function lookbackDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.GA4_ATTRIBUTION_LOOKBACK_DAYS);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LOOKBACK_DAYS) : DEFAULT_LOOKBACK_DAYS;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const suffix = (day: string) => day.replace(/-/g, '');

export class Ga4AttributionService {
  /**
   * `start` / `end` (YYYY-MM-DD, export days) default to the last
   * GA4_ATTRIBUTION_LOOKBACK_DAYS full days before `now` (the daily export lands the next day).
   */
  static async run(
    opts: { now?: Date; start?: string; end?: string; dryRun?: boolean; config?: Ga4BigQueryConfig | null; client?: BigQueryClient; force?: boolean } = {}
  ): Promise<Ga4SyncResult> {
    const base: Ga4SyncResult = { skipped: null, dryRun: !!opts.dryRun, range: null, instances: 0, googleInstances: 0, matched: 0, inserted: 0, upgraded: 0, outcomes: {}, error: null };
    if (!opts.force && !ga4SyncEnabled()) return { ...base, skipped: 'disabled' };
    const config = opts.config !== undefined ? opts.config : ga4BigQueryConfigFromEnv();
    if (!config) return { ...base, skipped: 'not_configured' };

    const now = opts.now ?? new Date();
    const end = opts.end ?? addDays(ymd(now), -1);
    const start = opts.start ?? addDays(end, -(lookbackDays() - 1));
    const result: Ga4SyncResult = { ...base, range: { start, end } };
    const bump = (k: keyof Ga4SyncResult['outcomes']) => (result.outcomes[k] = (result.outcomes[k] ?? 0) + 1);

    const client = opts.client ?? new BigQueryClient(config);
    const rows = (await client.query(ga4AttributionSql(config.projectId, config.dataset), [
      { name: 'start', value: suffix(start) },
      { name: 'end', value: suffix(end) },
      { name: 'app_id', value: config.androidAppId },
    ])) as unknown as Ga4InstanceRow[];
    result.instances = rows.length;
    const google = rows.filter((r) => r.user_pseudo_id && googleAdsSignals(r).length > 0);
    result.googleInstances = google.length;
    if (!google.length) return result;

    // Resolve users: GA4 user_id (profile UUID) first, else our stored app_instance_id.
    const byInstance = new Map<string, AttributionRow>();
    for (const part of chunk(google.map((r) => r.user_pseudo_id!), 150)) {
      const found = await selectAll<AttributionRow>(() =>
        db().from('user_attribution').select('*').in('app_instance_id', part).order('user_id', { ascending: true })
      );
      for (const a of found) if (a.app_instance_id) byInstance.set(a.app_instance_id, a);
    }
    // Earliest install first, so a user seen on two devices keeps the first one.
    const sorted = [...google].sort((a, b) => Number(a.first_open_micros ?? Infinity) - Number(b.first_open_micros ?? Infinity));
    const matches = new Map<string, { row: Ga4InstanceRow; by: 'user_id' | 'app_instance_id' }>();
    for (const r of sorted) {
      const uid = isUuid(r.user_id) ? r.user_id.toLowerCase() : null;
      const viaInstance = byInstance.get(r.user_pseudo_id!)?.user_id ?? null;
      const userId = uid ?? viaInstance;
      if (!userId) {
        bump('unmatched');
        continue;
      }
      if (!matches.has(userId)) matches.set(userId, { row: r, by: uid ? 'user_id' : 'app_instance_id' });
    }
    result.matched = matches.size;
    if (!matches.size) return result;

    const ids = [...matches.keys()];
    const existing = new Map<string, AttributionRow>();
    const profiles = new Set<string>();
    for (const part of chunk(ids, 150)) {
      const [attr, prof] = await Promise.all([
        selectAll<AttributionRow>(() => db().from('user_attribution').select('*').in('user_id', part).order('user_id', { ascending: true })),
        selectAll<{ id: string }>(() => db().from('profiles').select('id').in('id', part).order('id', { ascending: true })),
      ]);
      for (const a of attr) existing.set(a.user_id, a);
      for (const p of prof) profiles.add(p.id);
    }
    const campaigns = await selectAll<{ external_id: string; name: string | null }>(() =>
      db().from('ad_entities').select('external_id, name').eq('channel', 'google_ads').eq('level', 'campaign').order('external_id', { ascending: true })
    );
    const campaignIdByName = new Map(campaigns.filter((c) => c.name).map((c) => [c.name!.toLowerCase(), c.external_id]));

    const syncedAt = now.toISOString();
    const plans: PlannedChange[] = ids.map((userId) => {
      const m = matches.get(userId)!;
      return planChange(userId, existing.get(userId) ?? null, profiles.has(userId), evidenceOf(m.row, m.by), campaignIdByName, syncedAt);
    });

    for (const p of plans) {
      if (!p.row) {
        bump(p.outcome);
        continue;
      }
      if (opts.dryRun) {
        bump(p.outcome);
        if (p.outcome === 'insert') result.inserted += 1;
        else result.upgraded += 1;
        continue;
      }
      if (p.outcome === 'upgrade') {
        // Guarded on channel: a paid attribution written meanwhile is never replaced.
        const { data, error } = await db().from('user_attribution').update(p.row).eq('user_id', p.userId).in('channel', [...UPGRADABLE_CHANNELS]).select('user_id');
        if (error) throw new Error(`user_attribution update: ${error.message}`);
        if ((data ?? []).length) {
          result.upgraded += 1;
          bump('upgrade');
        } else bump('lost_race');
      } else {
        const instanceId = matches.get(p.userId)!.row.user_pseudo_id;
        const { error } = await db().from('user_attribution').insert({ ...p.row, app_instance_id: instanceId, reported_at: syncedAt });
        if (error) {
          if (error.code === '23505') {
            bump('lost_race');
            continue;
          }
          throw new Error(`user_attribution insert: ${error.message}`);
        }
        result.inserted += 1;
        bump('insert');
      }
    }
    return result;
  }
}
