import { localToday, addDays } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';
import {
  CIRCLE_STREAK_MILESTONES,
  circleStreakMajorityThreshold,
  type CircleStreakDTO,
  type CircleStreakRow,
  type CircleStreakSaveResultDTO,
  type CircleStreakSaveRow,
  type CircleStreakView,
} from '../types/circle-streak';

import type * as OrchestratorModule from './notification-orchestrator';

/**
 * CircleStreakService — collective circle streak + the weekly save pool
 * (PRD v4 §6.13, REFERRALS_SPEC §10.3).
 *
 * The circle earns a COLLECTIVE streak for consecutive days where a strict
 * majority of active members show up. "Showing up" = any real activity that
 * day: a non-freeze streak_claims row (every meal / workout / check-in log
 * claims its day), a calorie-bearing food entry, or a save covering them.
 *
 * Saves are the circle's shared pool: every member brings one save per
 * (Monday-based, circle-local) week and can spend it covering a friend who
 * hasn't logged today or yesterday — forgiveness-first, never punish a lapse.
 *
 * Day lifecycle: TODAY is in progress, so a not-yet-qualifying today never
 * resets anything — it can only extend. A FINISHED day (yesterday, evaluated
 * by the hourly cron with `final`) resets the streak if it didn't qualify.
 *
 * All streak math lives HERE (no stored procs / business-logic triggers).
 */

export class CircleStreakError extends Error {
  constructor(
    public readonly code: 'SAVE_USED' | 'NOT_NEEDED' | 'SELF' | 'DATE_OUT_OF_RANGE',
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

type PushFn = (userId: string, type: string, data: Record<string, unknown>) => void;

/** One shared module promise: a burst of pushes resolves the import once. */
let orchestrator: Promise<typeof OrchestratorModule> | null = null;

/** Fire-and-forget push; never fails the write that caused it. */
const push: PushFn = (userId, type, data) => {
  (orchestrator ??= import('./notification-orchestrator'))
    .then(({ NotificationOrchestrator }) => NotificationOrchestrator.send(userId, type as any, data))
    .catch((err) => console.error('[CircleStreakService] push failed:', type, err?.message));
};

export class CircleStreakService {
  // ==========================================================================
  // AUTHORIZATION
  // ==========================================================================

  /** Throws Error('Forbidden') if the user is not an active member of the circle. */
  static async assertActiveMember(fitcircleId: string, userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', fitcircleId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Forbidden');
  }

  // ==========================================================================
  // RECOMPUTE
  // ==========================================================================

  /**
   * Recompute the collective streak for one calendar day and persist it.
   * `final` = the day is over (cron's "yesterday"): only then may a
   * non-qualifying day reset the streak.
   */
  static async recomputeForDay(
    fitcircleId: string,
    date: string,
    opts: { final?: boolean } = {}
  ): Promise<CircleStreakDTO> {
    const supabaseAdmin = createAdminSupabase();
    const activeUserIds = await this.activeMemberIds(fitcircleId);
    const loggedSet = await this.loggedOn(fitcircleId, activeUserIds, date);
    const dayQualifies = activeUserIds.length > 0 && loggedSet.size >= circleStreakMajorityThreshold(activeUserIds.length);

    const existing = await this.fetchRow(fitcircleId);
    const prevCurrent = existing?.current_streak ?? 0;
    const prevLongest = existing?.longest_streak ?? 0;
    const prevLastActive = existing?.last_active_date ?? null;

    let nextCurrent = prevCurrent;
    let nextLastActive = prevLastActive;

    if (dayQualifies) {
      if (prevLastActive === null) {
        nextCurrent = 1;
      } else if (date === prevLastActive) {
        nextCurrent = prevCurrent === 0 ? 1 : prevCurrent; // idempotent re-run
      } else if (this.isDayAfter(prevLastActive, date)) {
        nextCurrent = prevCurrent + 1;
      } else if (date > prevLastActive) {
        nextCurrent = 1; // gap since the last active day — restart
      }
      if (nextLastActive === null || date > nextLastActive) nextLastActive = date;
    } else if (opts.final && (prevLastActive === null || date > prevLastActive)) {
      // A finished day nobody (enough) showed up for — the streak ends.
      nextCurrent = 0;
    }

    const nextLongest = Math.max(prevLongest, nextCurrent);
    if (existing && nextCurrent === prevCurrent && nextLongest === prevLongest && nextLastActive === prevLastActive) {
      return this.toDTO(existing);
    }

    const { data: upserted, error: upsertError } = await supabaseAdmin
      .from('circle_streaks')
      .upsert(
        {
          fitcircle_id: fitcircleId,
          current_streak: nextCurrent,
          longest_streak: nextLongest,
          last_active_date: nextLastActive,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'fitcircle_id' }
      )
      .select('fitcircle_id, current_streak, longest_streak, last_active_date, updated_at')
      .single();
    if (upsertError) throw upsertError;

    if (nextCurrent > prevCurrent && (CIRCLE_STREAK_MILESTONES as readonly number[]).includes(nextCurrent)) {
      void this.celebrateMilestone(fitcircleId, nextCurrent, activeUserIds);
    }
    return this.toDTO(upserted as CircleStreakRow);
  }

  /** Activity hook: a member claimed `date` — advance each of their circles' streaks. */
  static async onMemberActivity(userId: string, date: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const { data } = await supabaseAdmin
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', userId)
      .eq('status', 'active');
    for (const row of (data ?? []) as Array<{ fitcircle_id: string }>) {
      await this.recomputeForDay(row.fitcircle_id, date).catch((err) =>
        console.error('[CircleStreakService] activity recompute failed:', row.fitcircle_id, err?.message)
      );
    }
  }

  /**
   * Cron: settle each live streak's circle-local yesterday (resets missed
   * days; idempotent, so running hourly is safe).
   */
  static async settleYesterday(limit = 500): Promise<{ checked: number; reset: number }> {
    const supabaseAdmin = createAdminSupabase();
    const { data } = await supabaseAdmin
      .from('circle_streaks')
      .select('fitcircle_id, current_streak')
      .gt('current_streak', 0)
      .limit(limit);
    let reset = 0;
    for (const row of (data ?? []) as Array<{ fitcircle_id: string; current_streak: number }>) {
      try {
        const yesterday = addDays(localToday(await this.timezoneOf(row.fitcircle_id)), -1);
        const after = await this.recomputeForDay(row.fitcircle_id, yesterday, { final: true });
        if (after.currentStreak === 0) reset++;
      } catch (err: any) {
        console.error('[CircleStreakService] settle failed:', row.fitcircle_id, err?.message);
      }
    }
    return { checked: data?.length ?? 0, reset };
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  /** Active-member-gated read: the streak plus today's progress and the save pool. */
  static async getStreak(fitcircleId: string, viewerUserId: string): Promise<CircleStreakView> {
    await this.assertActiveMember(fitcircleId, viewerUserId);
    const supabaseAdmin = createAdminSupabase();
    const timezone = await this.timezoneOf(fitcircleId);
    const today = localToday(timezone);
    const yesterday = addDays(today, -1);

    const row = await this.fetchRow(fitcircleId);
    const base: CircleStreakDTO = row
      ? this.toDTO(row)
      : { fitcircleId, currentStreak: 0, longestStreak: 0, lastActiveDate: null, updatedAt: null };
    // Not settled yet but already broken (last active before yesterday): show the truth.
    if (base.lastActiveDate && base.lastActiveDate < yesterday) base.currentStreak = 0;

    const activeIds = await this.activeMemberIds(fitcircleId);
    const logged = await this.loggedOn(fitcircleId, activeIds, today, { excludeSaves: true });
    const [{ data: people }, { data: saves }] = await Promise.all([
      activeIds.length
        ? supabaseAdmin.from('profiles').select('id, display_name, username, avatar_url').in('id', activeIds)
        : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; username: string | null; avatar_url: string | null }> }),
      supabaseAdmin
        .from('circle_streak_saves')
        .select('saver_user_id, covered_user_id, save_date')
        .eq('fitcircle_id', fitcircleId)
        .gte('save_date', this.weekStart(today)),
    ]);
    const saveRows = (saves ?? []) as Array<{ saver_user_id: string; covered_user_id: string; save_date: string }>;
    const nameOf = new Map(
      ((people ?? []) as Array<{ id: string; display_name: string | null; username: string | null; avatar_url: string | null }>).map((p) => [p.id, p])
    );
    const coveredToday = new Map(saveRows.filter((s) => s.save_date === today).map((s) => [s.covered_user_id, s.saver_user_id]));
    const usedSavers = new Set(saveRows.map((s) => s.saver_user_id));
    const first = (id: string) => ((nameOf.get(id)?.display_name || nameOf.get(id)?.username || 'Friend').trim().split(/\s+/)[0]);

    const members = activeIds.map((id) => ({
      userId: id,
      displayName: nameOf.get(id)?.display_name || nameOf.get(id)?.username || 'Friend',
      avatarUrl: nameOf.get(id)?.avatar_url ?? null,
      logged: logged.has(id),
      covered: coveredToday.has(id),
      coveredBy: coveredToday.has(id) ? first(coveredToday.get(id)!) : null,
    }));
    // Logged first, then covered, then the rest — the chips read left-to-right as momentum.
    members.sort((a, b) => Number(b.logged) - Number(a.logged) || Number(b.covered) - Number(a.covered));
    const loggedCount = members.filter((m) => m.logged || m.covered).length;
    const needed = circleStreakMajorityThreshold(activeIds.length);
    const shown = base.currentStreak;
    const next = CIRCLE_STREAK_MILESTONES.find((m) => m > shown);

    return {
      ...base,
      today: { date: today, loggedCount, activeCount: activeIds.length, needed, qualified: activeIds.length > 0 && loggedCount >= needed, members },
      saves: {
        poolRemaining: activeIds.filter((id) => !usedSavers.has(id)).length,
        poolSize: activeIds.length,
        mySaveAvailable: !usedSavers.has(viewerUserId),
        weekResetsAt: this.weekResetsAt(today, timezone),
      },
      nextMilestone: next ? { days: next, remaining: next - shown } : null,
    };
  }

  // ==========================================================================
  // SAVES
  // ==========================================================================

  /**
   * Spend the saver's weekly save covering a friend for `date` (today or
   * yesterday, circle-local). The covered member then counts for that day.
   */
  static async useSave(
    fitcircleId: string,
    saverUserId: string,
    coveredUserId: string,
    date?: string | null
  ): Promise<CircleStreakSaveResultDTO & { streak: CircleStreakView }> {
    const supabaseAdmin = createAdminSupabase();
    await this.assertActiveMember(fitcircleId, saverUserId);
    await this.assertActiveMember(fitcircleId, coveredUserId);
    if (saverUserId === coveredUserId) {
      throw new CircleStreakError('SELF', "You can't cover yourself — ask a friend 💜", 400);
    }

    const timezone = await this.timezoneOf(fitcircleId);
    const today = localToday(timezone);
    const day = date ?? today;
    if (day !== today && day !== addDays(today, -1)) {
      throw new CircleStreakError('DATE_OUT_OF_RANGE', 'You can cover today or yesterday', 400);
    }
    const already = await this.loggedOn(fitcircleId, [coveredUserId], day, { excludeSaves: true });
    if (already.has(coveredUserId)) {
      throw new CircleStreakError('NOT_NEEDED', 'They already checked in — no save needed', 400);
    }

    // Existing save for this friend & day → idempotent replay (no budget spent).
    const { data: prior } = await supabaseAdmin
      .from('circle_streak_saves')
      .select('id, fitcircle_id, saver_user_id, covered_user_id, save_date, created_at')
      .eq('fitcircle_id', fitcircleId)
      .eq('covered_user_id', coveredUserId)
      .eq('save_date', day)
      .maybeSingle();
    let saveRow = prior as CircleStreakSaveRow | null;
    let created = false;

    if (!saveRow) {
      const { count } = await supabaseAdmin
        .from('circle_streak_saves')
        .select('id', { count: 'exact', head: true })
        .eq('fitcircle_id', fitcircleId)
        .eq('saver_user_id', saverUserId)
        .gte('save_date', this.weekStart(day));
      if ((count ?? 0) >= 1) {
        throw new CircleStreakError('SAVE_USED', 'Your save for this week is used — it resets Monday', 409);
      }
      const { data: inserted, error } = await supabaseAdmin
        .from('circle_streak_saves')
        .insert({ fitcircle_id: fitcircleId, saver_user_id: saverUserId, covered_user_id: coveredUserId, save_date: day })
        .select('id, fitcircle_id, saver_user_id, covered_user_id, save_date, created_at')
        .single();
      if (error) {
        if ((error as { code?: string }).code !== '23505') throw error;
        const { data: raced } = await supabaseAdmin
          .from('circle_streak_saves')
          .select('id, fitcircle_id, saver_user_id, covered_user_id, save_date, created_at')
          .eq('fitcircle_id', fitcircleId)
          .eq('covered_user_id', coveredUserId)
          .eq('save_date', day)
          .single();
        saveRow = raced as CircleStreakSaveRow;
      } else {
        saveRow = inserted as CircleStreakSaveRow;
        created = true;
      }
    }

    await this.recomputeForDay(fitcircleId, day);
    if (created) {
      const { ChatActivityHooks } = await import('./chat-activity-hooks');
      void ChatActivityHooks.onCircleStreakSaved(fitcircleId, saverUserId, coveredUserId, saveRow.id);
      const [{ data: saver }, { data: circle }] = await Promise.all([
        supabaseAdmin.from('profiles').select('display_name, username').eq('id', saverUserId).maybeSingle(),
        supabaseAdmin.from('fitcircles').select('name').eq('id', fitcircleId).maybeSingle(),
      ]);
      push(coveredUserId, 'circle_streak_saved', {
        friendName: ((saver?.display_name || saver?.username || 'A friend') as string).split(/\s+/)[0],
        circleName: circle?.name,
        circleId: fitcircleId,
      });
    }

    return {
      save: {
        id: saveRow.id,
        fitcircleId: saveRow.fitcircle_id,
        saverUserId: saveRow.saver_user_id,
        coveredUserId: saveRow.covered_user_id,
        saveDate: saveRow.save_date,
        createdAt: saveRow.created_at,
      },
      created,
      streak: await this.getStreak(fitcircleId, saverUserId),
    };
  }

  // ==========================================================================
  // INTERNALS
  // ==========================================================================

  /** Members (of `userIds`) who showed up on `date`: real activity, food, or a save. */
  private static async loggedOn(
    fitcircleId: string,
    userIds: string[],
    date: string,
    opts: { excludeSaves?: boolean } = {}
  ): Promise<Set<string>> {
    const logged = new Set<string>();
    if (userIds.length === 0) return logged;
    const supabaseAdmin = createAdminSupabase();
    const wanted = new Set(userIds);
    const [{ data: claims, error: claimsError }, { data: entries, error: entriesError }] = await Promise.all([
      supabaseAdmin.from('streak_claims').select('user_id, claim_method').eq('claim_date', date).in('user_id', userIds),
      supabaseAdmin
        .from('food_log_entries')
        .select('user_id')
        .eq('entry_date', date)
        .in('user_id', userIds)
        .not('calories', 'is', null)
        .is('deleted_at', null),
    ]);
    if (claimsError) throw claimsError;
    if (entriesError) throw entriesError;
    for (const c of (claims ?? []) as Array<{ user_id: string; claim_method: string | null }>) {
      if (c.claim_method !== 'freeze') logged.add(c.user_id);
    }
    for (const e of (entries ?? []) as Array<{ user_id: string }>) logged.add(e.user_id);
    if (!opts.excludeSaves) {
      const { data: saves, error } = await supabaseAdmin
        .from('circle_streak_saves')
        .select('covered_user_id')
        .eq('fitcircle_id', fitcircleId)
        .eq('save_date', date);
      if (error) throw error;
      for (const s of (saves ?? []) as Array<{ covered_user_id: string }>) logged.add(s.covered_user_id);
    }
    return new Set([...logged].filter((id) => wanted.has(id)));
  }

  private static async celebrateMilestone(fitcircleId: string, days: number, memberIds: string[]): Promise<void> {
    try {
      const { ChatActivityHooks } = await import('./chat-activity-hooks');
      await ChatActivityHooks.onCircleStreakMilestone(fitcircleId, days);
      const { data: circle } = await createAdminSupabase().from('fitcircles').select('name').eq('id', fitcircleId).maybeSingle();
      for (const id of memberIds) {
        push(id, 'circle_streak_milestone', { circleName: circle?.name, streakDays: days, circleId: fitcircleId });
      }
    } catch (err: any) {
      console.error('[CircleStreakService] milestone celebration failed:', err?.message);
    }
  }

  private static async timezoneOf(fitcircleId: string): Promise<string | null> {
    const { data } = await createAdminSupabase().from('fitcircles').select('timezone').eq('id', fitcircleId).maybeSingle();
    return (data?.timezone as string | null) ?? null;
  }

  /** Monday of the week containing `day` (YYYY-MM-DD). */
  static weekStart(day: string): string {
    const d = new Date(`${day}T12:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    return addDays(day, -dow);
  }

  /** Approximate instant the week rolls over (next Monday 00:00 in the circle's zone). */
  private static weekResetsAt(today: string, timezone: string | null): string {
    const nextMonday = addDays(this.weekStart(today), 7);
    try {
      // Offset of the zone at that date, via Intl (handles DST well enough for display).
      const probe = new Date(`${nextMonday}T00:00:00Z`);
      const local = new Date(probe.toLocaleString('en-US', { timeZone: timezone || 'UTC' }));
      const offsetMs = local.getTime() - probe.getTime();
      return new Date(probe.getTime() - offsetMs).toISOString();
    } catch {
      return `${nextMonday}T00:00:00.000Z`;
    }
  }

  private static async activeMemberIds(fitcircleId: string): Promise<string[]> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', fitcircleId)
      .eq('status', 'active');
    if (error) throw error;
    return (data ?? []).map((r) => r.user_id as string).filter(Boolean);
  }

  private static async fetchRow(fitcircleId: string): Promise<CircleStreakRow | null> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('circle_streaks')
      .select('fitcircle_id, current_streak, longest_streak, last_active_date, updated_at')
      .eq('fitcircle_id', fitcircleId)
      .maybeSingle();
    if (error) throw error;
    return (data as CircleStreakRow | null) ?? null;
  }

  /** True if `day` (YYYY-MM-DD) is exactly one calendar day after `base`. */
  private static isDayAfter(base: string, day: string): boolean {
    const baseMs = Date.parse(`${base}T00:00:00Z`);
    const dayMs = Date.parse(`${day}T00:00:00Z`);
    if (Number.isNaN(baseMs) || Number.isNaN(dayMs)) return false;
    return dayMs - baseMs === 24 * 60 * 60 * 1000;
  }

  private static toDTO(row: CircleStreakRow): CircleStreakDTO {
    return {
      fitcircleId: row.fitcircle_id,
      currentStreak: row.current_streak,
      longestStreak: row.longest_streak,
      lastActiveDate: row.last_active_date,
      updatedAt: row.updated_at,
    };
  }
}
