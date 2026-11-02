/**
 * Keeps "steps" circle challenges in step with synced steps (daily_tracking).
 *
 * Runs (a) after the apps write steps (tracking/daily, tracking/bulk-sync) for the
 * writer's active steps challenges, and (b) on every challenge read as a safety
 * net, so already-shipped apps show synced steps with no update. Logic:
 * lib/circles/challenge-steps.ts. Rows are only written when a value changed.
 */
import {
  challengeDailyStepGoal,
  challengeDays,
  computeStepsProgress,
  isStepsChallenge,
  localDay,
} from '@/lib/circles/challenge-steps';
import { isValidTimezone } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { reconcileMilestones, toNumber, type ParticipantProgress } from './circle-challenge-progress';

type Row = Record<string, any>;

const PAGE = 1000;
const MAX_PAGES = 20;

const PROGRESS_KEYS: Array<keyof ParticipantProgress> = [
  'cumulative_total',
  'today_total',
  'log_count',
  'goal_completion_pct',
  'current_streak',
  'longest_streak',
  'last_logged_at',
];

/** profiles.timezone, else the circle's, else UTC ('UTC' is the never-synced default). */
export function memberTimezone(profileTz: unknown, circleTz: unknown): string {
  if (typeof profileTz === 'string' && profileTz !== 'UTC' && isValidTimezone(profileTz)) return profileTz;
  if (typeof circleTz === 'string' && isValidTimezone(circleTz)) return circleTz;
  return 'UTC';
}

async function readAll(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: any }>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export class ChallengeStepsSyncService {
  /**
   * Re-derive every active participant of a steps challenge. Returns the fresh
   * progress per participant id (empty for other challenges). `now` is injectable for tests.
   */
  static async syncChallenge(challenge: Row, now: Date = new Date()): Promise<Map<string, ParticipantProgress & { today_date: string }>> {
    const out = new Map<string, ParticipantProgress & { today_date: string }>();
    if (!isStepsChallenge(challenge) || challenge.status === 'cancelled') return out;
    const db = createAdminSupabase();

    // The start passed but the daily cron has not flipped the status yet.
    if (challenge.status === 'scheduled' && now >= new Date(challenge.starts_at) && now < new Date(challenge.ends_at)) {
      await db
        .from('challenges')
        .update({ status: 'active', updated_at: now.toISOString() })
        .eq('id', challenge.id)
        .eq('status', 'scheduled');
      challenge.status = 'active';
    }

    const { data: participantRows, error } = await db
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', challenge.id)
      .eq('status', 'active');
    if (error) throw error;
    const participants = (participantRows ?? []) as Row[];
    if (participants.length === 0) return out;

    const userIds = participants.map((p) => p.user_id as string);
    const [{ data: circle }, { data: profiles }] = await Promise.all([
      db.from('fitcircles').select('id, timezone').eq('id', challenge.fitcircle_id).maybeSingle(),
      db.from('profiles').select('id, timezone').in('id', userIds),
    ]);
    const tzByUser = new Map<string, string>(
      (profiles ?? []).map((p: Row) => [p.id, memberTimezone(p.timezone, circle?.timezone)])
    );

    // Widest local window across members (timezones shift it by at most a day).
    const anyTz = memberTimezone(null, circle?.timezone);
    const window = challengeDays(challenge.starts_at, challenge.ends_at, anyTz);
    const from = localDay(new Date(Date.parse(`${window.first}T00:00:00Z`) - 86400000), 'UTC');
    const to = localDay(new Date(Date.parse(`${window.last}T00:00:00Z`) + 86400000), 'UTC');

    const [tracking, logs] = await Promise.all([
      readAll((a, b) =>
        db
          .from('daily_tracking')
          .select('user_id, tracking_date, steps, steps_synced_at')
          .in('user_id', userIds)
          .gte('tracking_date', from)
          .lte('tracking_date', to)
          .not('steps', 'is', null)
          .order('tracking_date', { ascending: true })
          .order('user_id', { ascending: true })
          .range(a, b)
      ),
      readAll((a, b) =>
        db
          .from('challenge_logs')
          .select('id, participant_id, amount, log_date, logged_at')
          .eq('challenge_id', challenge.id)
          .order('logged_at', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b)
      ),
    ]);

    const dailyGoal = challengeDailyStepGoal(challenge);
    const goalAmount = toNumber(challenge.goal_amount);
    let changed = false;

    for (const p of participants) {
      const tz = tzByUser.get(p.user_id) ?? anyTz;
      const { first, last } = challengeDays(challenge.starts_at, challenge.ends_at, tz);
      const synced = new Map<string, number>();
      let lastSyncedAt: string | null = null;
      for (const r of tracking) {
        if (r.user_id !== p.user_id) continue;
        const day = String(r.tracking_date).slice(0, 10);
        synced.set(day, Math.max(synced.get(day) ?? 0, Math.max(0, Math.round(toNumber(r.steps)))));
        if (r.steps_synced_at && (!lastSyncedAt || r.steps_synced_at > lastSyncedAt)) lastSyncedAt = r.steps_synced_at;
      }
      const today = localDay(now, tz);
      const { days: _days, ...progress } = computeStepsProgress({
        synced,
        logs: logs.filter((l) => l.participant_id === p.id) as any,
        goalAmount,
        dailyGoal,
        first,
        last,
        today,
        lastSyncedAt,
      });
      out.set(p.id, { ...progress, today_date: today });

      const differs =
        p.today_date !== today ||
        PROGRESS_KEYS.some((k) => (k === 'last_logged_at' ? (p[k] ?? null) !== progress[k] : toNumber(p[k]) !== progress[k]));
      if (!differs) continue;

      const { milestones } = reconcileMilestones(p.milestones_achieved, toNumber(p.goal_completion_pct), progress.goal_completion_pct);
      const { error: updateError } = await db
        .from('challenge_participants')
        .update({ ...progress, today_date: today, milestones_achieved: milestones, updated_at: now.toISOString() })
        .eq('id', p.id);
      if (updateError) throw updateError;
      changed = true;
    }

    if (changed) {
      const { ChallengeService } = await import('./circle-challenge-service');
      await ChallengeService.recalculateRanks(challenge.id);
    }
    return out;
  }

  /** Best-effort read-path refresh: never throws. */
  static async refresh(challenges: Row[], now: Date = new Date()): Promise<void> {
    for (const challenge of challenges) {
      if (!isStepsChallenge(challenge) || challenge.status === 'cancelled' || challenge.status === 'completed') continue;
      try {
        await this.syncChallenge(challenge, now);
      } catch (err: any) {
        console.warn('[ChallengeStepsSync] refresh failed:', challenge.id, err?.message ?? err);
      }
    }
  }

  /** After a user's steps were written: refresh their live steps challenges. Never throws. */
  static async syncUser(userId: string, now: Date = new Date()): Promise<void> {
    try {
      const db = createAdminSupabase();
      const { data: rows } = await db
        .from('challenge_participants')
        .select('challenge_id')
        .eq('user_id', userId)
        .eq('status', 'active');
      const ids = [...new Set((rows ?? []).map((r: Row) => r.challenge_id as string))];
      if (ids.length === 0) return;
      const { data: challenges } = await db
        .from('challenges')
        .select('*')
        .in('id', ids)
        .in('status', ['scheduled', 'active']);
      await this.refresh(challenges ?? [], now);
    } catch (err: any) {
      console.warn('[ChallengeStepsSync] syncUser failed:', err?.message ?? err);
    }
  }
}
