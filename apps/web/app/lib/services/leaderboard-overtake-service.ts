/**
 * Leaderboard overtake pushes (docs/PUSH_NOTIFICATIONS.md §8.6). Hourly cron
 * (/api/cron/leaderboard-overtakes, :45). For every live private circle whose
 * local time is in the 18:00 hour:
 *   1. snapshot the circle's leaderboard metric for its local date into
 *      circle_leaderboard_snapshots (migration 137; idempotent upsert);
 *   2. diff it against yesterday's snapshot (lib/circles/overtake.ts);
 *   3. send one `leaderboard_overtaken` per recipient through the orchestrator.
 *
 * Limits: circles need ≥ MIN_REAL_ACTIVE_MEMBERS real members seen in the last
 * 7 days; recipients are real and active or lapsed (≤ 30 days; the orchestrator
 * also enforces it); overtakers are real; at most one overtake push per user per
 * day across circles (TYPE_MIN_INTERVAL_HOURS + one per run); not the same
 * (circle, overtaker) again within REPEAT_WINDOW_DAYS; a lapsed user who already
 * got a win-back step today is skipped (it never stacks on the ladder, and the
 * ladder skips the day after an overtake push).
 */
import { loadLiveCircles, type LiveCircle } from '../circles/live-circles';
import {
  competitionRanks,
  detectOvertakes,
  overtakeCopy,
  overtakeDedupeKey,
  type OvertakeCopy,
  type OvertakeMetric,
  type SnapshotEntry,
} from '../circles/overtake';
import { isLapsed } from '../notifications/lifecycle';
import { DEFAULT_NOTIFICATION_TZ, localClockIn } from '../notifications/user-timezone';
import { isValidTimezone } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';

import { CircleService } from './circle-service';
import { CircleStepsLeaderboardService } from './circle-steps-leaderboard-service';
import { NotificationOrchestrator } from './notification-orchestrator';
import { UserAudienceService, type UserAudience } from './user-audience-service';
import { firstName } from './winback-service';

export const MIN_REAL_ACTIVE_MEMBERS = 3;
export const SNAPSHOT_LOCAL_HOUR = 18;
export const REPEAT_WINDOW_DAYS = 7;
const UNDEFINED_TABLE = '42P01';

type Row = Record<string, any>;

export interface CircleBoard {
  metric: OvertakeMetric;
  entries: Array<SnapshotEntry & { name: string; goalType?: string | null }>;
}

export interface OvertakeDecision {
  circleId: string;
  circleName: string;
  recipientId: string;
  overtakerId: string;
  gap: number;
  copy: OvertakeCopy | null;
  skip?: string;
  result?: { sent: boolean; reason?: string };
}

export interface OvertakeRunResult {
  dryRun: boolean;
  circlesChecked: number;
  circlesSnapshotted: number;
  skippedCircles: Record<string, number>;
  decisions: OvertakeDecision[];
  sent: number;
}

const prevDate = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export class LeaderboardOvertakeService {
  /** The circle's own leaderboard metric for every member who shows progress. */
  static async boardFor(circle: LiveCircle): Promise<CircleBoard | null> {
    const viewer = circle.memberIds[0];
    if (!viewer) return null;
    const steps = await CircleStepsLeaderboardService.build(circle.id, viewer, circle.timezone);
    if (steps.ok && steps.board.is_steps_circle) {
      if (steps.board.phase !== 'active') return null;
      return {
        metric: 'total_steps',
        entries: steps.board.members
          .filter((m) => m.steps_visible && typeof m.total_steps === 'number')
          .map((m) => ({ userId: m.user_id, value: m.total_steps as number, name: firstName(m.display_name) })),
      };
    }
    const board = await CircleService.getLeaderboard(circle.id);
    return {
      metric: 'goal_progress',
      entries: board
        .filter((e: any) => e.target_value !== null && e.target_value !== undefined && Number(e.target_value) !== 0 && Number.isFinite(Number(e.progress_percentage)))
        .map((e: any) => ({ userId: e.user_id, value: Number(e.progress_percentage), name: firstName(e.display_name), goalType: e.goal_type ?? null })),
    };
  }

  static async run(opts: { dryRun?: boolean; now?: Date; circleId?: string; ignoreHour?: boolean } = {}): Promise<OvertakeRunResult> {
    const now = opts.now ?? new Date();
    const out: OvertakeRunResult = { dryRun: !!opts.dryRun, circlesChecked: 0, circlesSnapshotted: 0, skippedCircles: {}, decisions: [], sent: 0 };
    const skipCircle = (why: string) => (out.skippedCircles[why] = (out.skippedCircles[why] ?? 0) + 1);

    let circles = await loadLiveCircles({ now });
    if (opts.circleId) circles = circles.filter((c) => c.id === opts.circleId);
    const notifiedThisRun = new Set<string>();

    for (const circle of circles) {
      out.circlesChecked++;
      const tz = isValidTimezone(circle.timezone) ? circle.timezone : DEFAULT_NOTIFICATION_TZ;
      const local = localClockIn(now, tz);
      if (!opts.ignoreHour && Math.floor(local.minutes / 60) !== SNAPSHOT_LOCAL_HOUR) {
        skipCircle('outside_hour');
        continue;
      }
      const audiences = await UserAudienceService.loadMany(circle.memberIds, now);
      const real = new Set(circle.memberIds.filter((id) => !audiences.get(id)?.testReason));
      const recentlyActive = [...real].filter((id) => {
        const s = audiences.get(id)?.stage;
        return s === 'active' || s === 'lapsed_3';
      });
      if (recentlyActive.length < MIN_REAL_ACTIVE_MEMBERS) {
        skipCircle('too_few_active_members');
        continue;
      }
      let board: CircleBoard | null;
      try {
        board = await this.boardFor(circle);
      } catch (err: any) {
        console.warn('[LeaderboardOvertakeService] board failed:', circle.id, err?.message);
        skipCircle('board_error');
        continue;
      }
      if (!board || board.entries.length < 2) {
        skipCircle('no_board');
        continue;
      }

      const today = local.date;
      const previous = await this.readSnapshot(circle.id, board.metric, prevDate(today));
      if (!opts.dryRun) {
        if (await this.writeSnapshot(circle.id, board, today)) out.circlesSnapshotted++;
      }
      if (!previous) {
        skipCircle('no_previous_snapshot');
        continue;
      }

      const recipients = new Set(
        board.entries
          .map((e) => e.userId)
          .filter((id) => {
            const s = audiences.get(id)?.stage ?? null;
            return real.has(id) && s !== 'dormant';
          })
      );
      const passes = detectOvertakes({ previous, current: board.entries, real, recipients });
      for (const pass of passes) {
        const over = board.entries.find((e) => e.userId === pass.overtakerId)!;
        const me = board.entries.find((e) => e.userId === pass.recipientId)!;
        const copy = overtakeCopy({ metric: board.metric, overtakerName: over.name, circleName: circle.name, gap: pass.gap, overtakerRank: pass.overtakerRank, goalType: me.goalType });
        const decision: OvertakeDecision = { circleId: circle.id, circleName: circle.name, recipientId: pass.recipientId, overtakerId: pass.overtakerId, gap: pass.gap, copy };
        out.decisions.push(decision);
        if (!copy) {
          decision.skip = 'no_truthful_copy';
          continue;
        }
        if (notifiedThisRun.has(pass.recipientId)) {
          decision.skip = 'one_per_day';
          continue;
        }
        const why = await this.recipientSkip(pass.recipientId, circle.id, pass.overtakerId, audiences.get(pass.recipientId) ?? null, now);
        if (why) {
          decision.skip = why;
          continue;
        }
        notifiedThisRun.add(pass.recipientId);
        if (opts.dryRun) continue;
        const r = await NotificationOrchestrator.send(pass.recipientId, 'leaderboard_overtaken', {
          title: copy.title,
          body: copy.body,
          circleId: circle.id,
          circleName: circle.name,
          overtakerId: pass.overtakerId,
          metric: board.metric,
          gap: pass.gap,
          variant: copy.variant,
          dedupeKey: overtakeDedupeKey(circle.id, pass.overtakerId, today),
        });
        decision.result = r;
        if (r.sent) out.sent++;
      }
    }
    return out;
  }

  /** Per-recipient limits that need notification_log (null = may send). */
  static async recipientSkip(userId: string, circleId: string, overtakerId: string, audience: UserAudience | null, now: Date): Promise<string | null> {
    const db = createAdminSupabase();
    const since = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    const { data, error } = await db
      .from('notification_log')
      .select('notification_type, data, sent_at')
      .eq('user_id', userId)
      .eq('suppressed', false)
      .in('notification_type', ['leaderboard_overtaken', 'winback_day3', 'winback_day7', 'winback_day14', 'winback_day30'])
      .gte('sent_at', since(REPEAT_WINDOW_DAYS * 24));
    if (error) return null; // fail open; the orchestrator's interval + dedupe still apply
    const rows = (data ?? []) as Row[];
    const recent = (r: Row, h: number) => Date.parse(r.sent_at) >= Date.parse(since(h));
    if (rows.some((r) => r.notification_type === 'leaderboard_overtaken' && recent(r, 20))) return 'one_per_day';
    if (rows.some((r) => r.notification_type === 'leaderboard_overtaken' && r.data?.circleId === circleId && r.data?.overtakerId === overtakerId)) return 'repeat_pair';
    if (isLapsed(audience?.stage) && rows.some((r) => String(r.notification_type).startsWith('winback_') && recent(r, 20))) return 'winback_sent_today';
    return null;
  }

  static async readSnapshot(circleId: string, metric: OvertakeMetric, date: string): Promise<SnapshotEntry[] | null> {
    const { data, error } = await createAdminSupabase()
      .from('circle_leaderboard_snapshots')
      .select('user_id, value')
      .eq('circle_id', circleId)
      .eq('metric', metric)
      .eq('snapshot_date', date);
    if (error) {
      if (error.code === UNDEFINED_TABLE) console.warn('[LeaderboardOvertakeService] circle_leaderboard_snapshots missing (migration 137 not applied)');
      return null;
    }
    const rows = (data ?? []) as Row[];
    return rows.length ? rows.map((r) => ({ userId: r.user_id, value: Number(r.value) })) : null;
  }

  static async writeSnapshot(circleId: string, board: CircleBoard, date: string): Promise<boolean> {
    const ranks = competitionRanks(board.entries);
    const rows = board.entries.map((e) => ({ circle_id: circleId, user_id: e.userId, snapshot_date: date, metric: board.metric, value: e.value, rank: ranks.get(e.userId) }));
    const { error } = await createAdminSupabase()
      .from('circle_leaderboard_snapshots')
      .upsert(rows, { onConflict: 'circle_id,snapshot_date,metric,user_id', ignoreDuplicates: true });
    if (error) {
      console.warn('[LeaderboardOvertakeService] snapshot write failed:', error.message);
      return false;
    }
    return true;
  }
}
