/**
 * Loads the facts the push audience rules need (lib/notifications/audience.ts):
 * real-vs-test account and lifecycle stage (lib/notifications/lifecycle.ts).
 * docs/PUSH_NOTIFICATIONS.md §8.
 *
 * lastSeenAt — the user's most recent FOREGROUND use — is the max of:
 *   - profiles.last_active_at   bumped (≤ every 10 min) by the requests the apps
 *                               make on every open/foreground: entitlements,
 *                               targets, home-feed (AppOpenService). Never by
 *                               background health sync or push handling.
 *   - app_opens.first_open_at   one row per user/local day/platform (1.1.x, since 2026-11-09)
 *   - home_feed_decisions.created_at   every dashboard load (1.0.8+)
 *   - food_log_entries.created_at      user-created logs (every row is source 'manual')
 *   - profiles.created_at       signing up happens in the app
 * Background-only activity (Health Connect / HealthKit syncs, auto-claimed
 * streaks, daily_tracking steps) is deliberately NOT a signal.
 *
 * `lastSeenAt()` is the ONE function to swap when an Amplitude-backed
 * user_active_days table exists. Every read fails soft: on error the signal is
 * skipped and, with nothing known, the stage is null (no lifecycle gating).
 */
import { testAccountReason, type AudienceFacts, type AudienceTestReason } from '../notifications/audience';
import { computeLifecycle, latestOf, type Lifecycle } from '../notifications/lifecycle';
import { DEFAULT_NOTIFICATION_TZ, isPlaceholderTimezone, resolveNotificationTimezone } from '../notifications/user-timezone';
import { createAdminSupabase } from '../supabase-admin';

export interface UserAudience extends AudienceFacts {
  userId: string;
  lastSeenAt: string | null;
  lifecycle: Lifecycle | null;
  /** The zone the user's pushes are timed in (quiet-hours zone → device zone → New York). */
  timezone: string;
  /** profiles.timezone is a placeholder ('UTC' / null): a real device zone is not known yet. */
  placeholderTimezone: boolean;
}

/** Only this far back is read from the per-event tables: anything older is dormant anyway. */
export const LAST_SEEN_LOOKBACK_DAYS = 40;
/** In-process cache of a user's audience (one cron tick / one fan-out reuses it). */
export const AUDIENCE_CACHE_TTL_MS = 5 * 60_000;

const PAGE = 1000;
const CHUNK = 150;

type Row = Record<string, any>;

async function readAll(build: (from: number, to: number) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? String(error));
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Per user, the latest `column` among rows of `table` since `since`. Fails soft (empty). */
async function latestPerUser(table: string, column: string, ids: string[], since: string, orderBy: string[] = ['id']): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const db = createAdminSupabase();
  for (const part of chunks(ids, CHUNK)) {
    try {
      const rows = await readAll((from, to) =>
        orderBy
          .reduce((q: any, col) => q.order(col, { ascending: true }), db.from(table).select(`user_id, ${column}`).in('user_id', part).gte(column, since))
          .range(from, to)
      );
      for (const r of rows) {
        const v = r[column] as string | null;
        if (!v) continue;
        const cur = out.get(r.user_id);
        if (!cur || Date.parse(v) > Date.parse(cur)) out.set(r.user_id, v);
      }
    } catch (err: any) {
      console.warn(`[UserAudienceService] ${table} read failed:`, err?.message ?? err);
    }
  }
  return out;
}

const cache = new Map<string, { value: UserAudience; expiresAt: number }>();

export class UserAudienceService {
  /**
   * lastSeenAt per user (most recent foreground use; see the file header).
   * Profiles' last_active_at / created_at are passed in when the caller already
   * read them; otherwise they are read here.
   */
  static async lastSeenAt(
    userIds: string[],
    now: Date = new Date(),
    profiles?: Map<string, { last_active_at?: string | null; created_at?: string | null }>
  ): Promise<Map<string, string | null>> {
    const ids = [...new Set(userIds)];
    const since = new Date(now.getTime() - LAST_SEEN_LOOKBACK_DAYS * 86_400_000).toISOString();
    const prof = profiles ?? (await this.readProfiles(ids));
    const [opens, feeds, foods] = await Promise.all([
      // app_opens has no id column: its primary key is (user_id, local_date, platform).
      latestPerUser('app_opens', 'first_open_at', ids, since, ['user_id', 'local_date', 'platform']),
      latestPerUser('home_feed_decisions', 'created_at', ids, since),
      latestPerUser('food_log_entries', 'created_at', ids, since),
    ]);
    const out = new Map<string, string | null>();
    for (const id of ids) {
      const p = prof.get(id);
      out.set(id, latestOf([p?.last_active_at, p?.created_at, opens.get(id), feeds.get(id), foods.get(id)]));
    }
    return out;
  }

  /** Audience facts for many users (crons, dry runs). Fills the cache. */
  static async loadMany(userIds: string[], now: Date = new Date()): Promise<Map<string, UserAudience>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    const out = new Map<string, UserAudience>();
    if (ids.length === 0) return out;
    const db = createAdminSupabase();
    const profiles = await this.readProfiles(ids);
    const mock = new Set<string>();
    const quietTz = new Map<string, string | null>();
    for (const part of chunks(ids, CHUNK)) {
      try {
        const { data, error } = await db.from('user_attribution').select('user_id, is_test').in('user_id', part);
        if (!error) for (const r of (data ?? []) as Row[]) if (r.is_test === true) mock.add(r.user_id);
      } catch {
        /* fail soft */
      }
      try {
        const { data, error } = await db.from('notification_preferences').select('user_id, quiet_hours_timezone').in('user_id', part);
        if (!error) for (const r of (data ?? []) as Row[]) quietTz.set(r.user_id, r.quiet_hours_timezone ?? null);
      } catch {
        /* fail soft */
      }
    }
    const seen = await this.lastSeenAt(ids, now, profiles);
    for (const id of ids) {
      const p = profiles.get(id);
      const testReason = p ? testAccountReason({ email: p.email, isAdmin: p.is_admin, mockAttribution: mock.has(id), metadata: p.metadata }) : null;
      const timezone = resolveNotificationTimezone({ quietHoursTimezone: quietTz.get(id) ?? null, profileTimezone: p?.timezone ?? null });
      const lastSeenAt = seen.get(id) ?? null;
      let lifecycle: Lifecycle | null = null;
      try {
        lifecycle = computeLifecycle(lastSeenAt, now, timezone);
      } catch {
        lifecycle = computeLifecycle(lastSeenAt, now, DEFAULT_NOTIFICATION_TZ);
      }
      const value: UserAudience = {
        userId: id,
        testReason,
        stage: lifecycle?.stage ?? null,
        lastSeenAt,
        lifecycle,
        timezone,
        placeholderTimezone: isPlaceholderTimezone(p?.timezone),
      };
      out.set(id, value);
      cache.set(id, { value, expiresAt: now.getTime() + AUDIENCE_CACHE_TTL_MS });
    }
    return out;
  }

  /** One user's audience, from the cache when fresh. Never throws (null = unknown, fail open). */
  static async forUser(userId: string, now: Date = new Date()): Promise<UserAudience | null> {
    const hit = cache.get(userId);
    if (hit && hit.expiresAt > now.getTime()) return hit.value;
    try {
      return (await this.loadMany([userId], now)).get(userId) ?? null;
    } catch (err: any) {
      console.warn('[UserAudienceService.forUser] failed open:', err?.message ?? err);
      return null;
    }
  }

  /** The cached test verdict (no I/O). send() loads the audience first, so it is warm. */
  static cachedTestReason(userId: string): AudienceTestReason | null {
    return cache.get(userId)?.value.testReason ?? null;
  }

  /** Test hook. */
  static resetCache(): void {
    cache.clear();
  }

  private static async readProfiles(ids: string[]): Promise<Map<string, Row>> {
    const out = new Map<string, Row>();
    const db = createAdminSupabase();
    for (const part of chunks(ids, CHUNK)) {
      try {
        const { data, error } = await db
          .from('profiles')
          .select('id, email, is_admin, metadata, timezone, created_at, last_active_at')
          .in('id', part);
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as Row[]) out.set(r.id, r);
      } catch (err: any) {
        console.warn('[UserAudienceService] profiles read failed:', err?.message ?? err);
      }
    }
    return out;
  }
}
