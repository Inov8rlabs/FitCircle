/**
 * Store → releases sync (docs/RELEASES_TRACKER_SPEC.md §5): per configured
 * connector, read the store snapshot, upsert store-owned columns by
 * release_key, append a release_events row only when a status changed, and one
 * release_sync_runs row per source. One failing store never blocks another.
 */
import { chunk, db } from '@/lib/ads/services/db';

import { getReleaseConnector, SYNC_SOURCES, type StoreSnapshot } from '../connectors';
import { planRelease, type ExistingRelease, type ObservedRelease } from '../status';
import type { ReleaseStatus, ReleaseSyncStatus, SyncSource, SyncSourceResult } from '../types';

const DEBOUNCE_MS = 2 * 60 * 1000;
const EXISTING_COLS = 'id, release_key, status, store_created_at, uploaded_at, submitted_at, approved_at, released_at, superseded_at, whats_new';
/** Rows of a fully-listed track that are "current" and get superseded when they drop off the list. */
const CURRENT_ON_TRACK: ReleaseStatus[] = ['live', 'rolling_out', 'in_testing', 'halted'];

export class ReleaseSyncService {
  /** Apply one store snapshot. Returns rows upserted and events written. */
  static async applySnapshot(source: SyncSource, snapshot: StoreSnapshot, now = new Date()): Promise<{ rowsReleases: number; rowsEvents: number }> {
    const supabase = db();
    const nowIso = now.toISOString();
    const uniq = new Map<string, ObservedRelease>(snapshot.releases.map((r) => [r.releaseKey, r]));
    const keys = [...uniq.keys()];

    const existing = new Map<string, ExistingRelease>();
    for (const part of chunk(keys, 200)) {
      const { data, error } = await supabase.from('releases').select(EXISTING_COLS).in('release_key', part);
      if (error) throw new Error(`releases read: ${error.message}`);
      for (const r of (data ?? []) as ExistingRelease[]) existing.set(r.release_key, r);
    }

    const plans = [...uniq.values()].map((o) => ({ key: o.releaseKey, ...planRelease(existing.get(o.releaseKey) ?? null, o, source, nowIso) }));
    for (const part of chunk(plans, 200)) {
      const { error } = await supabase.from('releases').upsert(part.map((p) => p.row), { onConflict: 'release_key' });
      if (error) throw new Error(`releases upsert: ${error.message}`);
    }

    // Ids for new rows.
    const ids = new Map<string, string>([...existing.values()].map((r) => [r.release_key, r.id]));
    const missing = plans.filter((p) => p.event && !ids.has(p.key)).map((p) => p.key);
    for (const part of chunk(missing, 200)) {
      const { data, error } = await supabase.from('releases').select('id, release_key').in('release_key', part);
      if (error) throw new Error(`releases read ids: ${error.message}`);
      for (const r of (data ?? []) as Array<{ id: string; release_key: string }>) ids.set(r.release_key, r.id);
    }

    const events = plans
      .filter((p) => p.event && ids.has(p.key))
      .map((p) => ({ release_id: ids.get(p.key)!, ...p.event!, source: 'sync' as const }));

    // Fully-listed tracks: current rows that dropped off the list were replaced.
    for (const scope of snapshot.completeTracks) {
      const [platform, track] = scope.split(':');
      const { data, error } = await supabase.from('releases').select('id, release_key, status').eq('platform', platform).eq('track', track).in('status', CURRENT_ON_TRACK);
      if (error) throw new Error(`releases read track: ${error.message}`);
      const gone = ((data ?? []) as Array<{ id: string; release_key: string; status: ReleaseStatus }>).filter((r) => !uniq.has(r.release_key));
      for (const r of gone) {
        const { error: upErr } = await supabase.from('releases').update({ status: 'superseded', superseded_at: nowIso, updated_at: nowIso, synced_at: nowIso }).eq('id', r.id);
        if (upErr) throw new Error(`releases supersede: ${upErr.message}`);
        events.push({ release_id: r.id, from_status: r.status, to_status: 'superseded', store_status: null, occurred_at: nowIso, note: 'no longer on the track', source: 'sync' });
      }
    }

    for (const part of chunk(events, 200)) {
      const { error } = await supabase.from('release_events').upsert(part, { onConflict: 'release_id,to_status,occurred_at', ignoreDuplicates: true });
      if (error) throw new Error(`release_events insert: ${error.message}`);
    }
    return { rowsReleases: plans.length, rowsEvents: events.length };
  }

  static async run(opts: { sources?: SyncSource[]; trigger?: 'cron' | 'manual' | 'backfill'; debounce?: boolean; now?: Date } = {}): Promise<SyncSourceResult[]> {
    const now = opts.now ?? new Date();
    const supabase = db();
    const results: SyncSourceResult[] = [];
    for (const source of opts.sources ?? SYNC_SOURCES) {
      const base = { source, rowsReleases: 0, rowsEvents: 0, error: null, runId: null };
      const connector = getReleaseConnector(source);
      if (!connector || !connector.isConfigured()) {
        results.push({ ...base, ok: false, skipped: 'not_configured' });
        continue;
      }
      if (opts.debounce) {
        const { data: last } = await supabase
          .from('release_sync_runs')
          .select('finished_at')
          .eq('source', source)
          .not('finished_at', 'is', null)
          .order('finished_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const at = last?.finished_at ? Date.parse(last.finished_at) : NaN;
        if (Number.isFinite(at) && now.getTime() - at < DEBOUNCE_MS) {
          results.push({ ...base, ok: true, skipped: 'debounced' });
          continue;
        }
      }
      const { data: run } = await supabase
        .from('release_sync_runs')
        .insert({ source, trigger: opts.trigger ?? 'cron', started_at: now.toISOString() })
        .select('id')
        .maybeSingle();
      const runId: string | null = run?.id ?? null;
      let rowsReleases = 0;
      let rowsEvents = 0;
      let error: string | null = null;
      try {
        const snapshot = await connector.fetchSnapshot();
        ({ rowsReleases, rowsEvents } = await this.applySnapshot(source, snapshot, new Date()));
      } catch (e: any) {
        error = String(e?.message ?? e).slice(0, 1000);
        console.error(`[releases/sync] ${source} failed:`, error);
      }
      if (runId) await supabase.from('release_sync_runs').update({ finished_at: new Date().toISOString(), ok: !error, rows_releases: rowsReleases, rows_events: rowsEvents, error }).eq('id', runId);
      results.push({ source, ok: !error, rowsReleases, rowsEvents, error, runId });
    }
    return results;
  }

  /** Latest run per source + configuration state. */
  static async status(): Promise<ReleaseSyncStatus[]> {
    const { data } = await db().from('release_sync_runs').select('source, started_at, finished_at, ok, error').order('started_at', { ascending: false }).limit(50);
    const rows = (data ?? []) as Array<{ source: SyncSource; started_at: string; finished_at: string | null; ok: boolean | null; error: string | null }>;
    return SYNC_SOURCES.map((source) => {
      const last = rows.find((r) => r.source === source && r.finished_at) ?? rows.find((r) => r.source === source) ?? null;
      return {
        source,
        configured: getReleaseConnector(source)?.isConfigured() ?? false,
        startedAt: last?.started_at ?? null,
        finishedAt: last?.finished_at ?? null,
        ok: last?.ok ?? null,
        error: last?.error ?? null,
      };
    });
  }
}
