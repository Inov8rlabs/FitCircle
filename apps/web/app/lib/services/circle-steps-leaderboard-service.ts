/**
 * Circle steps leaderboard — GET /api/mobile/circles/[id]/steps-leaderboard
 * (and the web twin /api/fitcircles/[id]/steps-leaderboard).
 *
 * Reads every active member's daily_tracking steps for the circle's days and
 * returns three rankings (today / total / % of daily goal). Members do not need
 * to have joined a challenge: the board is the circle's, the steps are the ones
 * HealthKit / Health Connect already sync.
 *
 * Contract: docs/CIRCLE_STEPS_LEADERBOARD.md. Ranking logic: lib/circles/steps-leaderboard.ts.
 */
import {
  addDays,
  buildStepsRows,
  overlayLegacySteps,
  calendarDay,
  challengeDailyStepGoal,
  exclusiveEndDay,
  goalDaysElapsed,
  localDayFraction,
  stepsPeriod,
  type StepsMemberInput,
  type StepsMemberRow,
  type StepsMetric,
  type StepsPeriod,
} from '@/lib/circles/steps-leaderboard';
import { isValidTimezone } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { savedTargets, DEFAULT_STEPS_TARGET } from '@/lib/targets/user-targets';
import { getTodayInTimezone } from '@/lib/utils/timezone';
import { logIgnoredQueryError } from '@/lib/api/route-errors';

export interface StepsLeaderboard extends StepsPeriod {
  circle_id: string;
  /** step_count circle, or one with a live steps challenge: the apps lead with this board. */
  is_steps_circle: boolean;
  /** The viewer's local date. */
  today: string;
  /** Circle-wide daily goal (from the steps challenge); null = each member's own goal. */
  daily_goal: { steps: number; source: 'challenge' } | null;
  challenge: { id: string; name: string; participant_count: number } | null;
  default_metric: StepsMetric;
  member_count: number;
  members: StepsMemberRow[];
}

export type StepsLeaderboardResult =
  /** goal_days: goal-days elapsed per member id (lowercase), for the shipped-app overlay only (not serialised). */
  | { ok: true; board: StepsLeaderboard; goal_days: Map<string, number> }
  | { ok: false; code: 'CIRCLE_NOT_FOUND' | 'FORBIDDEN' };

type Row = Record<string, any>;

const PAGE = 1000;
const MAX_PAGES = 50;
/** "Steps syncing" looks back this many days before the viewer's today. */
const SYNC_LOOKBACK_DAYS = 7;

const lower = (id: string | null | undefined) => (id ?? '').toLowerCase();

/** The member's "show progress to circle members" switch (settings route writes privacy.show_progress). */
export function showsProgress(preferences: unknown): boolean {
  const prefs = preferences && typeof preferences === 'object' ? (preferences as Row) : {};
  const privacy = prefs.privacy && typeof prefs.privacy === 'object' ? (prefs.privacy as Row) : {};
  for (const value of [privacy.show_progress, privacy.showProgress, prefs.show_progress]) {
    if (typeof value === 'boolean') return value;
  }
  return true;
}

/** Steps challenge that drives the circle goal: active first, then scheduled, earliest start. */
export function pickStepsChallenge(challenges: Row[]): Row | null {
  const order: Record<string, number> = { active: 0, scheduled: 1, completed: 2 };
  const steps = challenges.filter(
    (c) => (c.unit ?? '').trim().toLowerCase() === 'steps' && c.status !== 'cancelled'
  );
  steps.sort(
    (a, b) =>
      (order[a.status] ?? 3) - (order[b.status] ?? 3) ||
      String(a.starts_at ?? '').localeCompare(String(b.starts_at ?? ''))
  );
  return steps[0] ?? null;
}

export class CircleStepsLeaderboardService {
  static async build(circleId: string, viewerId: string, clientTimezone: string | null): Promise<StepsLeaderboardResult> {
    const db = createAdminSupabase();

    const { data: circle, error: circleError } = await db
      .from('fitcircles')
      .select('id, creator_id, type, start_date, end_date, timezone')
      .eq('id', circleId)
      .maybeSingle();
    logIgnoredQueryError('CircleStepsLeaderboardService.build', circleError);
    if (!circle) return { ok: false, code: 'CIRCLE_NOT_FOUND' };

    const { data: memberRows, error: membersError } = await db
      .from('fitcircle_members')
      .select('user_id, joined_at')
      .eq('fitcircle_id', circleId)
      .eq('status', 'active');
    if (membersError) throw membersError;
    const members = (memberRows ?? []) as Row[];

    const isMember = members.some((m) => lower(m.user_id) === lower(viewerId));
    if (!isMember && lower(circle.creator_id) !== lower(viewerId)) return { ok: false, code: 'FORBIDDEN' };
    const viewer = members.find((m) => lower(m.user_id) === lower(viewerId))?.user_id ?? viewerId;

    const circleTz = isValidTimezone(circle.timezone) ? circle.timezone : 'UTC';
    const viewerTz = isValidTimezone(clientTimezone) ? clientTimezone : circleTz;
    const today = getTodayInTimezone(viewerTz);
    const period = stepsPeriod(calendarDay(circle.start_date), exclusiveEndDay(String(circle.end_date)), today);

    const { data: challengeRows, error: challengeRowsError } = await db
      .from('challenges')
      .select('id, name, template_id, unit, status, starts_at, participant_count')
      .eq('fitcircle_id', circleId);
    logIgnoredQueryError('CircleStepsLeaderboardService.build', challengeRowsError);
    const challenge = pickStepsChallenge((challengeRows ?? []) as Row[]);
    const challengeGoal = challengeDailyStepGoal(challenge);

    const userIds = members.map((m) => m.user_id as string);
    const profiles = new Map<string, Row>();
    if (userIds.length > 0) {
      const { data: profileRows, error } = await db
        .from('profiles')
        .select('id, display_name, avatar_url, preferences, goals, timezone')
        .in('id', userIds);
      if (error) throw error;
      for (const p of profileRows ?? []) profiles.set(p.id, p);
    }

    // One read covers the sync lookback and the circle days up to the latest "today".
    const lookbackFrom = addDays(today, -SYNC_LOOKBACK_DAYS);
    const from = period.start_date < lookbackFrom ? period.start_date : lookbackFrom;
    // Members up to a day ahead of the viewer are on the next date.
    const tracking = await this.readSteps(userIds, from, addDays(today, 1));

    const now = new Date();
    const goalDays = new Map<string, number>();
    const inputs: StepsMemberInput[] = members.map((m) => {
      const profile = profiles.get(m.user_id) ?? {};
      const memberTz = isValidTimezone(profile.timezone) && profile.timezone !== 'UTC' ? profile.timezone : viewerTz;
      goalDays.set(lower(m.user_id), goalDaysElapsed(period, getTodayInTimezone(memberTz), localDayFraction(now, memberTz)));
      const ownGoal = savedTargets(profile).steps;
      const rows = tracking.get(m.user_id) ?? [];
      const stepsByDate = new Map<string, number>();
      let lastSynced: string | null = null;
      let syncedRecently = false;
      for (const r of rows) {
        const steps = Math.max(0, Math.round(Number(r.steps) || 0));
        const date = String(r.tracking_date).slice(0, 10);
        stepsByDate.set(date, Math.max(stepsByDate.get(date) ?? 0, steps));
        const synced = r.steps_synced_at ?? r.updated_at ?? null;
        if (synced && (!lastSynced || synced > lastSynced)) lastSynced = synced;
        if (steps > 0 && date >= lookbackFrom) syncedRecently = true;
      }
      return {
        user_id: m.user_id,
        display_name: (profile.display_name ?? '').trim() || 'Member',
        avatar_url: profile.avatar_url ?? null,
        local_today: getTodayInTimezone(memberTz),
        visible: showsProgress(profile.preferences),
        daily_goal_steps: challengeGoal ?? ownGoal ?? DEFAULT_STEPS_TARGET,
        goal_source: challengeGoal ? 'challenge' : ownGoal ? 'member' : 'default',
        steps_by_date: stepsByDate,
        last_synced_at: lastSynced,
        synced_recently: syncedRecently,
        joined_at: m.joined_at ?? null,
      };
    });

    return {
      ok: true,
      goal_days: goalDays,
      board: {
        circle_id: circle.id,
        is_steps_circle: circle.type === 'step_count' || challenge !== null,
        today,
        ...period,
        daily_goal: challengeGoal ? { steps: challengeGoal, source: 'challenge' } : null,
        challenge: challenge
          ? { id: challenge.id, name: challenge.name, participant_count: Number(challenge.participant_count) || 0 }
          : null,
        default_metric: 'today_steps',
        member_count: members.length,
        members: buildStepsRows(period, viewer, inputs),
      },
    };
  }

  /**
   * Steps circle: shipped apps (iOS ≤ 1.1.0, Android ≤ vc42) only render the goal leaderboard
   * (GET …/leaderboard and the `leaderboard` inside GET /api/mobile/circles/[id]),
   * which reads "No goal set" / 0% there. Fill its existing fields from steps.
   * Best-effort: any failure returns the goal board unchanged.
   */
  static async withLegacyStepsOverlay<T extends { rank: number; user_id: string; progress_percentage: number }>(
    leaderboard: T[],
    circleId: string,
    viewerId: string,
    clientTimezone: string | null
  ): Promise<T[]> {
    try {
      const steps = await this.build(circleId, viewerId, clientTimezone);
      return steps.ok && steps.board.is_steps_circle
        ? overlayLegacySteps(leaderboard, steps.board, steps.goal_days)
        : leaderboard;
    } catch (err: any) {
      console.warn('[StepsLeaderboard] legacy overlay skipped:', err?.message ?? err);
      return leaderboard;
    }
  }

  /** daily_tracking rows with steps, per user, paged past PostgREST's 1000-row cap. */
  private static async readSteps(userIds: string[], from: string, to: string): Promise<Map<string, Row[]>> {
    const out = new Map<string, Row[]>();
    if (userIds.length === 0) return out;
    const db = createAdminSupabase();
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await db
        .from('daily_tracking')
        .select('user_id, tracking_date, steps, steps_synced_at, updated_at')
        .in('user_id', userIds)
        .gte('tracking_date', from)
        .lte('tracking_date', to)
        .not('steps', 'is', null)
        .order('tracking_date', { ascending: true })
        .order('user_id', { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      for (const r of data ?? []) {
        const list = out.get(r.user_id) ?? [];
        list.push(r);
        out.set(r.user_id, list);
      }
      if (!data || data.length < PAGE) break;
    }
    return out;
  }
}
