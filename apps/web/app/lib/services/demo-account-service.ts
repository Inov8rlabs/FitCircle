/**
 * Keeps the App Review demo account looking current.
 *
 * App Review signs in with a demo account (see App Store Connect → App Review
 * Information). Its history is seeded once; this service slides that history
 * forward every day so the newest entries always land on "today" — otherwise
 * the reviewer opens an account whose last activity was a week ago, with a
 * broken streak and an empty dashboard.
 *
 * It only ever touches rows that belong to the demo user and the demo circle.
 * Dates are moved by whole days, newest first, so unique (user, day) keys never
 * collide mid-way. Running it twice on the same day is a no-op.
 */

import { addDays, daysBetween, localDayOf, localToday } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';

export const DEMO_ACCOUNT = {
  userId: '47476150-a984-4431-a89a-7cc8085adfe6',
  email: 'fitcircle.user@gmail.com',
  circleId: 'dc69b1b5-9fb6-4f50-8f5f-0f1776af82be',
  /** App Review works in Pacific time; "today" is measured there. */
  timezone: 'America/Los_Angeles',
} as const;

const DAY_MS = 86_400_000;
const WRITE_BATCH = 10;
/** The demo circle must never reach its end date while a review is pending. */
const CIRCLE_RUNWAY_DAYS = 30;

interface ShiftSpec {
  table: string;
  /** YYYY-MM-DD columns. */
  dateColumns: string[];
  /** timestamptz columns. */
  timestampColumns: string[];
  /** Column that decides "newest first". */
  orderBy: string;
  /** Tables with a unique (user, day) key are written one row at a time. */
  sequential: boolean;
}

const SHIFTED_TABLES: ShiftSpec[] = [
  { table: 'streak_claims', dateColumns: ['claim_date'], timestampColumns: ['claimed_at', 'created_at'], orderBy: 'claim_date', sequential: true },
  { table: 'daily_tracking', dateColumns: ['tracking_date'], timestampColumns: ['created_at'], orderBy: 'tracking_date', sequential: true },
  { table: 'food_log_entries', dateColumns: ['entry_date'], timestampColumns: ['logged_at', 'created_at'], orderBy: 'entry_date', sequential: false },
  { table: 'exercise_logs', dateColumns: ['exercise_date'], timestampColumns: ['started_at', 'created_at'], orderBy: 'exercise_date', sequential: false },
  { table: 'engagement_activities', dateColumns: ['activity_date'], timestampColumns: ['created_at'], orderBy: 'activity_date', sequential: false },
];

export interface DemoRefreshResult {
  today: string;
  shiftedDays: number;
  rowsShifted: Record<string, number>;
  chatShiftedDays: number;
  currentStreak: number;
  skipped?: string;
}

type Row = Record<string, unknown>;

export function shiftDay(day: string, days: number): string {
  return addDays(day, days);
}

export function shiftTimestamp(timestamp: string, days: number): string {
  return new Date(new Date(timestamp).getTime() + days * DAY_MS).toISOString();
}

/** Moves every YYYY-MM-DD found inside a JSON value (e.g. "7:2026-09-17"). */
export function shiftDatesInJson<T>(value: T, days: number): T {
  if (typeof value === 'string') {
    return value.replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, (match, time) =>
      time ? shiftTimestamp(match, days) : shiftDay(match, days)
    ) as unknown as T;
  }
  if (Array.isArray(value)) return value.map(v => shiftDatesInJson(v, days)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Row).map(([k, v]) => [k, shiftDatesInJson(v, days)])
    ) as unknown as T;
  }
  return value;
}

/** Length of the run of consecutive claimed days that ends on `today`. */
export function streakEndingOn(today: string, claimedDays: Iterable<string>): number {
  const claimed = new Set(claimedDays);
  let streak = 0;
  for (let day = today; claimed.has(day); day = addDays(day, -1)) streak++;
  return streak;
}

export class DemoAccountService {
  static async refresh(): Promise<DemoRefreshResult> {
    const supabase = createAdminSupabase();
    const { userId, circleId, timezone, email } = DEMO_ACCOUNT;
    const today = localToday(timezone);
    const result: DemoRefreshResult = { today, shiftedDays: 0, rowsShifted: {}, chatShiftedDays: 0, currentStreak: 0 };

    // Refuse to touch anything unless the id still belongs to the demo account.
    const { data: profile } = await supabase.from('profiles').select('id, email').eq('id', userId).maybeSingle();
    if (!profile || profile.email !== email) return { ...result, skipped: 'demo profile not found' };

    const { data: newestClaim } = await supabase
      .from('streak_claims')
      .select('claim_date')
      .eq('user_id', userId)
      .order('claim_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!newestClaim?.claim_date) return { ...result, skipped: 'demo account has no seeded history' };

    const days = daysBetween(newestClaim.claim_date as string, today);
    if (days > 0) {
      result.shiftedDays = days;
      for (const spec of SHIFTED_TABLES) {
        result.rowsShifted[spec.table] = await this.shiftTable(spec, days);
      }
      await this.shiftShieldHistory(days);
      // Cached scores are keyed by day; drop them so each day is recomputed on view.
      await supabase.from('plate_scores').delete().eq('user_id', userId);
    }

    result.currentStreak = await this.syncStreak(today);
    result.chatShiftedDays = await this.keepChatRecent(today);

    const runwayEnd = `${addDays(today, CIRCLE_RUNWAY_DAYS)}T00:00:00.000Z`;
    await supabase.from('fitcircles').update({ end_date: runwayEnd }).eq('id', circleId).lt('end_date', runwayEnd);
    await supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', userId);

    return result;
  }

  private static async shiftTable(spec: ShiftSpec, days: number): Promise<number> {
    const supabase = createAdminSupabase();
    const columns = ['id', ...spec.dateColumns, ...spec.timestampColumns].join(', ');
    const { data, error } = await supabase
      .from(spec.table)
      .select(columns)
      .eq('user_id', DEMO_ACCOUNT.userId)
      .order(spec.orderBy, { ascending: false });
    if (error) throw new Error(`demo refresh: reading ${spec.table} failed: ${error.message}`);

    const rows = (data ?? []) as unknown as Row[];
    const write = async (row: Row) => {
      const patch: Row = {};
      for (const c of spec.dateColumns) if (row[c]) patch[c] = shiftDay(row[c] as string, days);
      for (const c of spec.timestampColumns) if (row[c]) patch[c] = shiftTimestamp(row[c] as string, days);
      const { error: writeError } = await supabase.from(spec.table).update(patch).eq('id', row.id as string);
      if (writeError) throw new Error(`demo refresh: updating ${spec.table} failed: ${writeError.message}`);
    };

    if (spec.sequential) {
      for (const row of rows) await write(row);
    } else {
      for (let i = 0; i < rows.length; i += WRITE_BATCH) {
        await Promise.all(rows.slice(i, i + WRITE_BATCH).map(write));
      }
    }
    return rows.length;
  }

  /** Milestone bookkeeping stores the days shields were earned; keep it aligned. */
  private static async shiftShieldHistory(days: number): Promise<void> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('streak_shields')
      .select('id, metadata')
      .eq('user_id', DEMO_ACCOUNT.userId)
      .eq('shield_type', 'milestone_shield')
      .maybeSingle();
    if (!data?.metadata) return;
    await supabase
      .from('streak_shields')
      .update({ metadata: shiftDatesInJson(data.metadata, days) })
      .eq('id', data.id);
  }

  private static async syncStreak(today: string): Promise<number> {
    const supabase = createAdminSupabase();
    const { userId } = DEMO_ACCOUNT;
    const [{ data: claims }, { data: record }] = await Promise.all([
      supabase.from('streak_claims').select('claim_date').eq('user_id', userId),
      supabase.from('engagement_streaks').select('longest_streak').eq('user_id', userId).maybeSingle(),
    ]);
    const current = streakEndingOn(today, (claims ?? []).map(c => c.claim_date as string));
    if (current === 0) return 0;

    const longest = Math.max(current, (record?.longest_streak as number) || 0);
    await supabase
      .from('engagement_streaks')
      .update({
        current_streak: current,
        longest_streak: longest,
        last_claim_date: today,
        last_engagement_date: today,
        paused: false,
        pause_start_date: null,
        pause_end_date: null,
      })
      .eq('user_id', userId);
    await supabase.from('profiles').update({ current_streak: current, longest_streak: longest }).eq('id', userId);
    return current;
  }

  /**
   * The circle's own daily summary normally keeps the chat current. If it has
   * gone quiet, slide the whole conversation so the newest message is yesterday.
   */
  private static async keepChatRecent(today: string): Promise<number> {
    const supabase = createAdminSupabase();
    const { circleId, timezone } = DEMO_ACCOUNT;
    const { data, error } = await supabase
      .from('circle_messages')
      .select('id, created_at, deleted_at')
      .eq('fitcircle_id', circleId)
      .order('created_at', { ascending: false });
    if (error || !data?.length) return 0;

    const newest = data.find(m => !m.deleted_at);
    if (!newest) return 0;
    const days = daysBetween(localDayOf(newest.created_at as string, timezone), addDays(today, -1));
    if (days <= 0) return 0;

    for (let i = 0; i < data.length; i += WRITE_BATCH) {
      await Promise.all(
        data.slice(i, i + WRITE_BATCH).map(m =>
          supabase
            .from('circle_messages')
            .update({ created_at: shiftTimestamp(m.created_at as string, days) })
            .eq('id', m.id)
        )
      );
    }
    return days;
  }
}
