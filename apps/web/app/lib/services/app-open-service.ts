/**
 * Server-side app opens (retention fix 4, 2026-11-09) + timezone backfill (fix 5).
 *
 * Signal: the requests the CURRENT apps already make on every app open /
 * foreground, recorded by the route after the response:
 *   - GET /api/mobile/entitlements — iOS AppFeature.onAppBecomeActive
 *     (proAccessClient.refresh, 1.1.2+) and Android ON_START
 *     (ProStatusRepository.refresh, 1.1.1+); also at sign-in.
 *   - GET /api/mobile/targets — both apps on every foreground since 1.1.0
 *     (USER_TARGETS_CONTRACT §3.1).
 *   - GET /api/mobile/home-feed — only when the dashboard loads / refetches
 *     (iOS ~4.3 fetches per active day, Android ~2.0), which is why a
 *     feed-only signal undercounted Android.
 * None of these run from background work (Health Connect / HealthKit syncs,
 * WorkManager, push handling), so background activity can't inflate opens.
 *
 * Stored: one app_opens row per (user, local day, platform) — first open only,
 * insert-or-ignore (migration 133) — and profiles.last_active_at (bumped at
 * most every LAST_ACTIVE_THROTTLE_MS). Until 133 is applied the app_opens write
 * fails soft and last_active_at alone carries the signal.
 */
import { isValidTimezone } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { DEFAULT_NOTIFICATION_TZ, isPlaceholderTimezone, localClockIn } from '../notifications/user-timezone';

export type AppOpenPlatform = 'ios' | 'android' | 'web' | 'unknown';
export type AppOpenSource = 'entitlements' | 'targets' | 'home_feed';

export const LAST_ACTIVE_THROTTLE_MS = 10 * 60_000;
const UNDEFINED_TABLE = '42P01';
/** After a "table missing" error, don't retry the app_opens write for this long (per instance). */
const MISSING_TABLE_BACKOFF_MS = 10 * 60_000;

type HeaderSource = { headers: { get(name: string): string | null } };

export interface AppOpenUser {
  id: string;
  timezone?: string | null;
  last_active_at?: string | null;
}

export function platformFrom(request: HeaderSource): AppOpenPlatform {
  const v = (request.headers.get('x-app-platform') ?? request.headers.get('x-platform') ?? '').trim().toLowerCase();
  return v === 'ios' || v === 'android' || v === 'web' ? v : 'unknown';
}

/** The device zone from X-Client-Timezone, when it is a real zone (not 'UTC'). */
export function clientTimezoneFrom(request: HeaderSource): string | null {
  const tz = request.headers.get('x-client-timezone');
  return isValidTimezone(tz) && !isPlaceholderTimezone(tz) ? tz : null;
}

/** The zone an open's local day is counted in: device → profile → New York. */
export function openTimezone(clientTz: string | null, profileTz: string | null | undefined): string {
  if (clientTz) return clientTz;
  if (!isPlaceholderTimezone(profileTz)) return profileTz!;
  return DEFAULT_NOTIFICATION_TZ;
}

/** The profiles.timezone to write: only to replace a placeholder ('UTC' / empty) with a real device zone. */
export function timezoneBackfill(profileTz: string | null | undefined, clientTz: string | null): string | null {
  if (!clientTz || !isPlaceholderTimezone(profileTz)) return null;
  return clientTz;
}

export interface AppOpenPlan {
  row: { user_id: string; local_date: string; platform: AppOpenPlatform; timezone: string; first_open_at: string; app_version: string | null; source: AppOpenSource };
  profilePatch: { last_active_at?: string; timezone?: string };
}

/** What to write for one open. PURE. */
export function planAppOpen(
  user: AppOpenUser,
  request: HeaderSource,
  source: AppOpenSource,
  now: Date,
  opts: { backfillTimezone?: boolean } = {}
): AppOpenPlan {
  const clientTz = clientTimezoneFrom(request);
  const tz = openTimezone(clientTz, user.timezone);
  const version = (request.headers.get('x-app-version') ?? '').trim().slice(0, 32) || null;
  const profilePatch: AppOpenPlan['profilePatch'] = {};
  const last = user.last_active_at ? Date.parse(user.last_active_at) : NaN;
  if (!Number.isFinite(last) || now.getTime() - last >= LAST_ACTIVE_THROTTLE_MS) profilePatch.last_active_at = now.toISOString();
  const backfill = opts.backfillTimezone === false ? null : timezoneBackfill(user.timezone, clientTz);
  if (backfill) profilePatch.timezone = backfill;
  return {
    row: {
      user_id: user.id,
      local_date: localClockIn(now, tz).date,
      platform: platformFrom(request),
      timezone: tz,
      first_open_at: now.toISOString(),
      app_version: version,
      source,
    },
    profilePatch,
  };
}

/** Bounded per-instance memory of (user, day, platform) rows already written. */
const seen = new Map<string, number>();
const seenTz = new Set<string>();
let tableMissingUntil = 0;

export class AppOpenService {
  /** Best-effort; never throws. Call it after the response (runAfterResponse). */
  static async record(user: AppOpenUser, request: HeaderSource, source: AppOpenSource, opts: { now?: Date; backfillTimezone?: boolean } = {}): Promise<void> {
    if (!user?.id) return;
    const now = opts.now ?? new Date();
    const plan = planAppOpen(user, request, source, now, opts);
    const db = createAdminSupabase();
    const key = `${plan.row.user_id}:${plan.row.local_date}:${plan.row.platform}`;
    try {
      if (!seen.has(key) && now.getTime() >= tableMissingUntil) {
        const { error } = await db.from('app_opens').upsert(plan.row, { onConflict: 'user_id,local_date,platform', ignoreDuplicates: true });
        if (error) {
          if (error.code === UNDEFINED_TABLE) {
            tableMissingUntil = now.getTime() + MISSING_TABLE_BACKOFF_MS;
            console.warn('[AppOpenService] app_opens missing (migration 133 not applied); last_active_at only');
          } else console.warn('[AppOpenService] app_opens write failed:', error.message);
        } else {
          seen.set(key, now.getTime());
          if (seen.size > 20_000) for (const [k, at] of seen) if (now.getTime() - at > 36 * 3_600_000) seen.delete(k);
        }
      }
      if (Object.keys(plan.profilePatch).length) {
        const { error } = await db.from('profiles').update(plan.profilePatch).eq('id', user.id);
        if (error) console.warn('[AppOpenService] profile update failed:', error.message);
      }
    } catch (err: any) {
      console.warn('[AppOpenService] record failed:', err?.message ?? err);
    }
  }

  /**
   * Fix 5 for every authenticated request: the apps send X-Client-Timezone on
   * all of them (iOS APIClient, Android AuthInterceptor). A profile still on a
   * placeholder zone gets the device zone, once per user per instance.
   * Returns the zone to write (the caller schedules the write), or null.
   */
  static pendingTimezoneBackfill(user: AppOpenUser | null | undefined, request: HeaderSource): string | null {
    if (!user?.id || seenTz.has(user.id)) return null;
    return timezoneBackfill(user.timezone, clientTimezoneFrom(request));
  }

  static async backfillTimezone(userId: string, tz: string): Promise<void> {
    seenTz.add(userId);
    if (seenTz.size > 50_000) seenTz.clear();
    try {
      // Only while still a placeholder: never overwrite a real zone set meanwhile.
      const { data, error } = await createAdminSupabase().from('profiles').select('timezone').eq('id', userId).maybeSingle();
      if (error || !data) return;
      if (!isPlaceholderTimezone((data as { timezone?: string | null }).timezone)) return;
      const { error: upErr } = await createAdminSupabase().from('profiles').update({ timezone: tz }).eq('id', userId);
      if (upErr) console.warn('[AppOpenService] timezone backfill failed:', upErr.message);
    } catch (err: any) {
      console.warn('[AppOpenService] timezone backfill failed:', err?.message ?? err);
    }
  }

  /**
   * Did this user open the app at/after `since` (any platform)? last_active_at
   * first (works before migration 133), then today's app_opens rows. Fails
   * closed to "not opened" so a read error never blocks the push.
   */
  static async openedSince(userId: string, since: Date, localDate: string): Promise<boolean> {
    const db = createAdminSupabase();
    try {
      const { data } = await db.from('profiles').select('last_active_at').eq('id', userId).maybeSingle();
      const last = (data as { last_active_at?: string | null } | null)?.last_active_at;
      if (last && Date.parse(last) >= since.getTime()) return true;
      const { data: opens, error } = await db.from('app_opens').select('first_open_at').eq('user_id', userId).eq('local_date', localDate);
      if (error) return false;
      return ((opens ?? []) as Array<{ first_open_at: string }>).some((o) => Date.parse(o.first_open_at) >= since.getTime());
    } catch {
      return false;
    }
  }

  /** Test hook. */
  static resetForTests(): void {
    seen.clear();
    seenTz.clear();
    tableMissingUntil = 0;
  }
}
