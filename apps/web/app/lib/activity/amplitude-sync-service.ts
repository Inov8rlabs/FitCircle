/**
 * Amplitude Export → user_active_days (migration 136). One UTC hour at a time:
 *   fetch hour → keep user actions (toActiveEvent) → bucket per (user, local day in the profile
 *   time zone, platform) → merge into existing rows (least first_at, greatest last_at, sum counts)
 *   → record the hour in amplitude_export_sync.
 * Hours already in amplitude_export_sync are skipped unless `force` (a forced re-sync re-adds
 * event_count; first_at / last_at stay exact). Events of users without a profile are dropped.
 * Callers: GET /api/cron/activity/amplitude-sync, scripts/activity-backfill-amplitude.ts.
 */
import { chunk, db, selectAll } from '../ads/services/db';
import { ymdInTz } from '../ads/dates';
import { DEFAULT_NOTIFICATION_TZ, isPlaceholderTimezone } from '../notifications/user-timezone';
import { fetchAmplitudeExportHour, hourKey, hourStartMs, toActiveEvent, type ActiveEvent, type AmplitudeRawEvent } from './amplitude-export';

const HOUR_MS = 3_600_000;
/** Amplitude export lags ~2 h; only hours that ended ≥ 3 h ago are synced by the cron. */
export const EXPORT_LAG_HOURS = 3;
export const CRON_LOOKBACK_HOURS = 48;
export const MAX_HOURS_PER_RUN = 24;

export interface ActiveDayRow {
  user_id: string;
  local_date: string;
  platform: string;
  source: 'amplitude';
  first_at: string;
  last_at: string;
  event_count: number;
}

export interface HourResult {
  hour: string;
  skipped: boolean;
  rawEvents: number;
  activeEvents: number;
  users: number;
  rows: number;
}

export type HourFetcher = (hour: string) => Promise<{ events: AmplitudeRawEvent[]; badLines: number }>;

const keyOf = (r: Pick<ActiveDayRow, 'user_id' | 'local_date' | 'platform'>) => `${r.user_id}|${r.local_date}|${r.platform}`;
const iso = (v: string) => new Date(v).toISOString();

export function resolveTz(tz: string | null | undefined): string {
  return !isPlaceholderTimezone(tz) ? tz! : DEFAULT_NOTIFICATION_TZ;
}

/** Bucket active events per (user, local day, platform). `tzOf` returns undefined for unknown users (dropped). */
export function aggregateActiveEvents(events: ActiveEvent[], tzOf: (userId: string) => string | undefined): ActiveDayRow[] {
  const out = new Map<string, ActiveDayRow>();
  for (const e of events) {
    const tz = tzOf(e.userId);
    if (!tz) continue;
    const row: ActiveDayRow = { user_id: e.userId, local_date: ymdInTz(e.at, tz), platform: e.platform, source: 'amplitude', first_at: e.at, last_at: e.at, event_count: 1 };
    const k = keyOf(row);
    const hit = out.get(k);
    if (!hit) out.set(k, row);
    else {
      if (e.at < hit.first_at) hit.first_at = e.at;
      if (e.at > hit.last_at) hit.last_at = e.at;
      hit.event_count++;
    }
  }
  return [...out.values()];
}

/** incoming merged onto existing rows of the same key. */
export function mergeActiveDayRows(existing: ActiveDayRow[], incoming: ActiveDayRow[]): ActiveDayRow[] {
  const prev = new Map(existing.map((r) => [keyOf(r), r]));
  return incoming.map((r) => {
    const p = prev.get(keyOf(r));
    if (!p) return r;
    const pf = iso(p.first_at);
    const pl = iso(p.last_at ?? p.first_at);
    return { ...r, first_at: pf < r.first_at ? pf : r.first_at, last_at: pl > r.last_at ? pl : r.last_at, event_count: (Number(p.event_count) || 0) + r.event_count };
  });
}

/** Start of the latest UTC hour whose export is complete: the hour ending at least EXPORT_LAG_HOURS ago. */
export function latestCompleteHourMs(now: Date): number {
  return Math.floor((now.getTime() - EXPORT_LAG_HOURS * HOUR_MS) / HOUR_MS) * HOUR_MS - HOUR_MS;
}

export class AmplitudeSyncService {
  static async isSynced(hour: string): Promise<boolean> {
    const { data, error } = await db().from('amplitude_export_sync').select('hour').eq('hour', hour).maybeSingle();
    if (error) throw new Error(`amplitude_export_sync: ${error.message ?? error}`);
    return !!data;
  }

  static async syncHour(hour: string, opts: { force?: boolean; fetcher?: HourFetcher } = {}): Promise<HourResult> {
    if (!Number.isFinite(hourStartMs(hour))) throw new Error(`bad hour ${hour}`);
    if (!opts.force && (await this.isSynced(hour))) return { hour, skipped: true, rawEvents: 0, activeEvents: 0, users: 0, rows: 0 };

    const fetcher = opts.fetcher ?? ((h: string) => fetchAmplitudeExportHour(h));
    const { events } = await fetcher(hour);
    const active = events.map(toActiveEvent).filter((e): e is ActiveEvent => !!e);
    const ids = [...new Set(active.map((e) => e.userId))];

    const tz = new Map<string, string>();
    for (const part of chunk(ids, 150)) {
      const profiles = await selectAll<{ id: string; timezone: string | null }>(() => db().from('profiles').select('id, timezone').in('id', part).order('id', { ascending: true }));
      for (const p of profiles) tz.set(p.id, resolveTz(p.timezone));
    }
    const incoming = aggregateActiveEvents(active, (id) => tz.get(id));

    const merged: ActiveDayRow[] = [];
    const byUser = new Map<string, ActiveDayRow[]>();
    for (const r of incoming) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
    for (const part of chunk([...byUser.keys()], 150)) {
      const rows = part.flatMap((id) => byUser.get(id)!);
      const dates = [...new Set(rows.map((r) => r.local_date))];
      const existing = await selectAll<ActiveDayRow>(() =>
        db()
          .from('user_active_days')
          .select('user_id, local_date, platform, source, first_at, last_at, event_count')
          .eq('source', 'amplitude')
          .in('user_id', part)
          .in('local_date', dates)
          .order('user_id', { ascending: true })
          .order('local_date', { ascending: true })
          .order('platform', { ascending: true })
      );
      merged.push(...mergeActiveDayRows(existing.map((r) => ({ ...r, local_date: String(r.local_date).slice(0, 10) })), rows));
    }
    for (const part of chunk(merged, 500)) {
      const { error } = await db().from('user_active_days').upsert(part, { onConflict: 'user_id,local_date,platform,source' });
      if (error) throw new Error(`user_active_days upsert: ${error.message ?? error}`);
    }
    const users = new Set(incoming.map((r) => r.user_id)).size;
    const { error } = await db()
      .from('amplitude_export_sync')
      .upsert({ hour, synced_at: new Date().toISOString(), events: active.length, users }, { onConflict: 'hour' });
    if (error) throw new Error(`amplitude_export_sync upsert: ${error.message ?? error}`);
    return { hour, skipped: false, rawEvents: events.length, activeEvents: active.length, users, rows: merged.length };
  }

  /** Every hour in [fromHour, toHour] (inclusive), in order, at most maxHours. */
  static async syncRange(
    fromHour: string,
    toHour: string,
    opts: { force?: boolean; maxHours?: number; fetcher?: HourFetcher; now?: Date } = {}
  ): Promise<HourResult[]> {
    const start = hourStartMs(fromHour);
    if (!Number.isFinite(start) || !Number.isFinite(hourStartMs(toHour))) throw new Error('hours must be YYYYMMDDTHH');
    // Never sync (and so never mark done) an hour Amplitude can't have exported in full yet:
    // a marked hour is skipped by every later run, so its events would be lost for good.
    const end = Math.min(hourStartMs(toHour), latestCompleteHourMs(opts.now ?? new Date()));
    const out: HourResult[] = [];
    for (let t = start; t <= end && out.length < (opts.maxHours ?? Infinity); t += HOUR_MS) {
      out.push(await this.syncHour(hourKey(t), opts));
    }
    return out;
  }

  /** Cron: from the hour after the last synced one (else now − 48 h) to now − 3 h, ≤ 24 hours. */
  static async cronSync(now: Date = new Date(), opts: { fetcher?: HourFetcher } = {}) {
    const { data, error } = await db().from('amplitude_export_sync').select('hour').order('hour', { ascending: false }).limit(1);
    if (error) throw new Error(`amplitude_export_sync: ${error.message ?? error}`);
    const last = ((data ?? []) as Array<{ hour: string }>)[0]?.hour ?? null;
    const endMs = latestCompleteHourMs(now);
    const startMs = last ? hourStartMs(last) + HOUR_MS : Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - CRON_LOOKBACK_HOURS * HOUR_MS;
    if (startMs > endMs) return { from: null, to: null, lastSynced: last, hours: [] as HourResult[] };
    const hours = await this.syncRange(hourKey(startMs), hourKey(endMs), { maxHours: MAX_HOURS_PER_RUN, fetcher: opts.fetcher, now });
    return { from: hourKey(startMs), to: hours.length ? hours[hours.length - 1].hour : null, lastSynced: last, hours };
  }

  /** Coverage of the Amplitude signal: earliest / latest synced hour (as ISO), null when none has events. */
  static async coverage(): Promise<{ since: string | null; through: string | null }> {
    try {
      const supabase = db();
      const [first, last, any] = await Promise.all([
        supabase.from('amplitude_export_sync').select('hour').order('hour', { ascending: true }).limit(1),
        supabase.from('amplitude_export_sync').select('hour').order('hour', { ascending: false }).limit(1),
        supabase.from('amplitude_export_sync').select('hour').gte('events', 1).limit(1),
      ]);
      if (first.error || last.error || any.error || !(any.data ?? []).length) return { since: null, through: null };
      const f = ((first.data ?? []) as Array<{ hour: string }>)[0]?.hour;
      const l = ((last.data ?? []) as Array<{ hour: string }>)[0]?.hour;
      if (!f || !l) return { since: null, through: null };
      return { since: new Date(hourStartMs(f)).toISOString(), through: new Date(hourStartMs(l) + HOUR_MS).toISOString() };
    } catch {
      return { since: null, through: null };
    }
  }
}
