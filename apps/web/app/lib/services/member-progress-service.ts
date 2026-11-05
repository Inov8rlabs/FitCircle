/**
 * A circle member's progress for the member "Profile" sheet, in the metric the
 * circle tracks (docs/MEMBER_PROGRESS_CONTRACT.md). Loads the rows; the rules
 * live in lib/circles/member-progress.ts.
 */
import { logIgnoredQueryError } from '@/lib/api/route-errors';
import { localDay } from '@/lib/circles/challenge-steps';
import {
  buildMemberEntries,
  buildMemberSummary,
  dayOf,
  EMPTY_SUMMARY,
  memberProgressVisibility,
  parsePrivacyPrefs,
  resolveCircleMetric,
  type Aggregation,
  type CircleChallengeInfo,
  type HiddenReason,
  type MemberMetric,
  type MemberProgressEntry,
  type MemberProgressSummary,
  type MetricSpec,
  type Period,
  type RawMetricRow,
} from '@/lib/circles/member-progress';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { UserService } from './user-service';

export interface MemberCircleProgress {
  user_id: string;
  circle_id: string;
  circle_type: string | null;
  metric: MemberMetric;
  unit: string | null;
  label: string | null;
  aggregation: Aggregation;
  can_view: boolean;
  hidden_reason: HiddenReason | null;
  timezone: string;
  today: string;
  period: Period | null;
  summary: MemberProgressSummary;
  entries: MemberProgressEntry[];
}

/** Rows read per request: a circle runs at most a few months. */
const MAX_ROWS = 400;

const isValidTimezone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export class CircleNotFoundError extends Error {
  constructor() {
    super('Circle not found');
  }
}

export class MemberProgressService {
  /**
   * The circle's metric and what the viewer may see of it, without reading any
   * progress rows (the legacy weight routes only need this).
   */
  static async describe(
    memberId: string,
    viewerId: string,
    circleId: string,
    now: Date = new Date()
  ): Promise<Omit<MemberCircleProgress, 'summary' | 'entries'>> {
    const ctx = await this.context(memberId, viewerId, circleId, now);
    return { ...ctx.base, ...ctx.visibility };
  }

  /**
   * `viewerId` looks at `memberId` in `circleId`. Never throws for privacy:
   * hidden progress comes back with can_view = false and nothing in it.
   * Throws 'User not found' / CircleNotFoundError for unknown ids.
   */
  static async getMemberCircleProgress(
    memberId: string,
    viewerId: string,
    circleId: string,
    now: Date = new Date()
  ): Promise<MemberCircleProgress> {
    const { db, base, visibility, spec, challenge, period, today, isOwner } = await this.context(
      memberId,
      viewerId,
      circleId,
      now
    );

    if (!visibility.can_view || spec.source == null) {
      return { ...base, ...visibility, summary: { ...EMPTY_SUMMARY }, entries: [] };
    }

    const rows = await this.loadRows(db, spec, memberId, period, today);
    const entries = buildMemberEntries(rows, {
      metric: spec.metric,
      aggregation: spec.aggregation,
      today,
      period,
      isOwner,
    });

    let summary: MemberProgressSummary;
    if (spec.metric === 'weight') {
      // Goal start / target come from the member row or the member's weight goal
      // (the same derivation the legacy weight card uses).
      let weight: { startKg: number | null; currentKg: number | null; targetKg: number | null; progressPct: number | null } | undefined;
      try {
        const p = await UserService.getUserProgress(memberId, memberId, circleId);
        const hasGoal = p.starting_weight != null && p.target_weight != null && p.current_weight != null;
        weight = {
          startKg: p.starting_weight ?? (entries.length ? entries[entries.length - 1].value : null),
          currentKg: entries[0]?.value ?? p.current_weight,
          targetKg: p.target_weight,
          progressPct: hasGoal ? p.progress_percentage : null,
        };
      } catch (error) {
        console.warn('[MemberProgressService] weight goal unavailable:', error);
      }
      summary = buildMemberSummary(entries, { metric: spec.metric, aggregation: spec.aggregation, today, weight });
    } else {
      const goalInfo = await this.goalFor(db, challenge, spec, memberId);
      summary = buildMemberSummary(entries, {
        metric: spec.metric,
        aggregation: spec.aggregation,
        today,
        goal: goalInfo.goal,
        storedProgressPct: goalInfo.storedPct,
      });
    }

    return { ...base, ...visibility, summary, entries };
  }

  private static async context(memberId: string, viewerId: string, circleId: string, now: Date) {
    const db = createAdminSupabase();
    const isOwner = memberId === viewerId;

    const [{ data: circle, error: circleError }, { data: profile, error: profileError }] = await Promise.all([
      db.from('fitcircles').select('id, type, start_date, end_date').eq('id', circleId).maybeSingle(),
      db.from('profiles').select('id, preferences, timezone').eq('id', memberId).maybeSingle(),
    ]);
    logIgnoredQueryError('MemberProgressService.circle', circleError);
    logIgnoredQueryError('MemberProgressService.profile', profileError);
    if (!circle) throw new CircleNotFoundError();
    if (!profile) throw new Error('User not found');

    const timezone = isValidTimezone(profile.timezone) ? profile.timezone : 'UTC';
    const today = localDay(now, timezone);
    const challenge = await this.circleChallenge(db, circleId, circle.type);
    const spec = resolveCircleMetric(circle.type, challenge);

    const start = dayOf(circle.start_date);
    const end = dayOf(circle.end_date);
    const period: Period | null = start ? { start, end: end ?? today } : null;

    const viewerInCircle = isOwner || (await this.isActiveMember(db, circleId, viewerId));
    const visibility = memberProgressVisibility({
      isOwner,
      viewerInCircle,
      privacy: parsePrivacyPrefs(profile.preferences),
      metric: spec.metric,
    });

    const base = {
      user_id: memberId,
      circle_id: circleId,
      circle_type: (circle.type as string | null) ?? null,
      metric: spec.metric,
      unit: spec.unit,
      label: spec.label,
      aggregation: spec.aggregation,
      timezone,
      today,
      period,
    };
    return { db, base, visibility, spec, challenge, period, today, isOwner };
  }

  /** The circle's challenge: the active one (newest first), else the newest not cancelled. */
  private static async circleChallenge(
    db: ReturnType<typeof createAdminSupabase>,
    circleId: string,
    circleType: string | null
  ): Promise<CircleChallengeInfo | null> {
    const { data, error } = await db
      .from('challenges')
      .select('id, name, unit, goal_amount, status, created_at')
      .eq('fitcircle_id', circleId)
      .limit(50);
    logIgnoredQueryError('MemberProgressService.challenge', error);
    const rows = ((data ?? []) as Array<CircleChallengeInfo & { status?: string; created_at?: string }>)
      .filter((c) => c.status !== 'cancelled')
      .sort((a, b) => {
        const rank = (c: { status?: string }) => (c.status === 'active' ? 0 : 1);
        return rank(a) - rank(b) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
      });
    // A typed circle prefers a challenge in its own unit (its goal).
    const wanted = circleType === 'step_count' ? ['steps'] : circleType === 'workout_minutes' ? ['minutes', 'min'] : null;
    if (wanted) {
      return rows.find((c) => wanted.includes((c.unit ?? '').trim().toLowerCase())) ?? null;
    }
    return rows[0] ?? null;
  }

  private static async isActiveMember(db: ReturnType<typeof createAdminSupabase>, circleId: string, userId: string) {
    const { data, error } = await db
      .from('fitcircle_members')
      .select('id')
      .eq('fitcircle_id', circleId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1);
    logIgnoredQueryError('MemberProgressService.membership', error);
    return (data ?? []).length > 0;
  }

  private static async loadRows(
    db: ReturnType<typeof createAdminSupabase>,
    spec: MetricSpec,
    memberId: string,
    period: Period | null,
    today: string
  ): Promise<RawMetricRow[]> {
    const source = spec.source;
    if (!source) return [];
    const from = period?.start ?? null;
    const to = period && period.end < today ? period.end : today;

    if (source.table === 'daily_tracking') {
      let q = db
        .from('daily_tracking')
        .select(`id, tracking_date, ${source.column}, is_public, notes`)
        .eq('user_id', memberId)
        .gt(source.column, 0)
        .lte('tracking_date', to);
      if (from) q = q.gte('tracking_date', from);
      const { data, error } = await q.order('tracking_date', { ascending: false }).limit(MAX_ROWS);
      if (error) throw error;
      return ((data ?? []) as unknown as Array<Record<string, any>>).map((r) => ({
        id: r.id,
        date: r.tracking_date,
        value: r[source.column],
        is_public: r.is_public,
        note: r.notes ?? null,
      }));
    }

    if (source.table === 'exercise_logs') {
      let q = db
        .from('exercise_logs')
        .select('id, exercise_date, duration_minutes, is_public, is_deleted')
        .eq('user_id', memberId)
        .lte('exercise_date', to);
      if (from) q = q.gte('exercise_date', from);
      const { data, error } = await q.order('exercise_date', { ascending: false }).limit(MAX_ROWS);
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, any>>)
        .filter((r) => r.is_deleted !== true)
        .map((r) => ({ id: r.id, date: r.exercise_date, value: r.duration_minutes, is_public: r.is_public, note: null }));
    }

    let q = db
      .from('challenge_logs')
      .select('id, log_date, amount, note')
      .eq('challenge_id', source.challengeId)
      .eq('user_id', memberId)
      .lte('log_date', to);
    if (from) q = q.gte('log_date', from);
    const { data, error } = await q.order('log_date', { ascending: false }).limit(MAX_ROWS);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, any>>).map((r) => ({
      id: r.id,
      date: r.log_date,
      value: r.amount,
      is_public: true,
      note: r.note ?? null,
    }));
  }

  /** The challenge goal and the member's stored completion % (matches the leaderboard). */
  private static async goalFor(
    db: ReturnType<typeof createAdminSupabase>,
    challenge: CircleChallengeInfo | null,
    spec: MetricSpec,
    memberId: string
  ): Promise<{ goal: number | string | null; storedPct: number | string | null }> {
    if (!challenge) return { goal: null, storedPct: null };
    const unit = (challenge.unit ?? '').trim().toLowerCase();
    const matches =
      (spec.metric === 'steps' && unit === 'steps') ||
      (spec.metric === 'workout_minutes' && (unit === 'minutes' || unit === 'min')) ||
      (spec.metric === 'custom' && spec.source?.table === 'challenge_logs' && spec.source.challengeId === challenge.id);
    if (!matches) return { goal: null, storedPct: null };

    const { data, error } = await db
      .from('challenge_participants')
      .select('goal_completion_pct')
      .eq('challenge_id', challenge.id)
      .eq('user_id', memberId)
      .maybeSingle();
    logIgnoredQueryError('MemberProgressService.participant', error);
    return { goal: challenge.goal_amount, storedPct: (data as { goal_completion_pct?: number | string } | null)?.goal_completion_pct ?? null };
  }
}
