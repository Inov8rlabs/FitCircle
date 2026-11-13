/**
 * Health sync update pushes (docs/PUSH_NOTIFICATIONS.md §8.5). Called after the
 * response of the routes background health sync uses:
 *   POST /api/mobile/exercises/sync      → onWorkoutsSynced
 *   POST /api/mobile/tracking/bulk-sync  → onStepsSynced
 * Android's HealthSyncWorker calls them hourly in the background; iOS calls them
 * from HealthKit background delivery (HKObserverQuery, steps + workouts
 * immediate) and the end-of-day BGProcessingTask, as well as on foreground.
 *
 * The request does not say whether it came from background work, so the rule
 * is behavioural: no push when the user had the app in the foreground in the
 * last 3 hours (lastSeenAt, UserAudienceService). The check runs after
 * SETTLE_MS so the open-recording requests of a foreground sync land first.
 *
 * Limits: one health_sync_update per user per day (orchestrator
 * TYPE_MIN_INTERVAL_HOURS), dormant users at most one per 3 days, never on a day
 * a win-back step went out (and the ladder skips the day after one), never for
 * test accounts; category celebration (user-toggleable), quiet hours, cap and
 * dedupe via NotificationOrchestrator.
 */
import {
  healthSyncDedupeKey,
  healthSyncSkip,
  stepGoalUpdate,
  workoutUpdate,
  type HealthSyncSkip,
  type HealthSyncUpdate,
  type SyncedWorkout,
} from '../health-sync/push';
import { localClockIn } from '../notifications/user-timezone';
import { createAdminSupabase } from '../supabase-admin';
import { targetsView } from '../targets/user-targets';

import { NotificationOrchestrator } from './notification-orchestrator';
import { UserAudienceService } from './user-audience-service';

/** Let the app-open requests of a foreground sync be recorded before deciding. */
export const SETTLE_MS = Number(process.env.HEALTH_SYNC_PUSH_SETTLE_MS ?? (process.env.VITEST ? 0 : 8_000));

export const isHealthSyncPushEnabled = () => (process.env.HEALTH_SYNC_PUSH_ENABLED ?? '').toLowerCase() !== 'false';

type Row = Record<string, any>;

export interface HealthSyncOutcome {
  update: HealthSyncUpdate | null;
  skip?: HealthSyncSkip | 'disabled';
  result?: { sent: boolean; reason?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HealthSyncPushService {
  static async onWorkoutsSynced(
    userId: string,
    input: { workouts: SyncedWorkout[]; platform: string | null; streak?: { claimed?: boolean; day?: string | null; streakCount?: number | null } | null },
    opts: { now?: Date; settleMs?: number } = {}
  ): Promise<HealthSyncOutcome> {
    if (!isHealthSyncPushEnabled()) return { update: null, skip: 'disabled' };
    if (input.workouts.length === 0) return { update: null, skip: 'nothing_new' };
    return this.evaluate(userId, opts, (today) =>
      workoutUpdate({
        workouts: input.workouts,
        today,
        platform: input.platform,
        claimedToday: !!input.streak?.claimed && input.streak?.day === today,
        streakCount: input.streak?.claimed && input.streak?.day === today ? input.streak.streakCount ?? null : null,
      })
    );
  }

  static async onStepsSynced(
    userId: string,
    input: { entries: Array<{ date: string; steps: number }>; platform: string | null },
    opts: { now?: Date; settleMs?: number } = {}
  ): Promise<HealthSyncOutcome> {
    if (!isHealthSyncPushEnabled()) return { update: null, skip: 'disabled' };
    if (input.entries.length === 0) return { update: null, skip: 'nothing_new' };
    let goal: number | null = null;
    try {
      const { data } = await createAdminSupabase().from('profiles').select('preferences, goals').eq('id', userId).maybeSingle();
      goal = targetsView((data as Row | null) ?? null).steps;
    } catch {
      goal = null;
    }
    return this.evaluate(userId, opts, (today) => {
      const todays = input.entries.filter((e) => e.date === today).sort((a, b) => b.steps - a.steps)[0];
      return todays ? stepGoalUpdate({ steps: todays.steps, goal, date: todays.date, today, platform: input.platform }) : null;
    });
  }

  private static async evaluate(userId: string, opts: { now?: Date; settleMs?: number }, build: (today: string) => HealthSyncUpdate | null): Promise<HealthSyncOutcome> {
    const settle = opts.settleMs ?? SETTLE_MS;
    if (settle > 0) await sleep(settle);
    const now = opts.now ?? new Date();
    // Fresh read (not the cache): the point is whether they opened the app just now.
    const audience = (await UserAudienceService.loadMany([userId], now)).get(userId) ?? null;
    const today = localClockIn(now, audience?.timezone ?? 'America/New_York').date;
    const update = build(today);
    if (!update) return { update: null, skip: 'nothing_new' };
    const history = await this.history(userId, now);
    const skip = healthSyncSkip({
      testUser: !!audience?.testReason,
      stage: audience?.stage ?? null,
      lastSeenAt: audience?.lastSeenAt ?? null,
      now,
      lastHealthSyncAt: history.lastHealthSyncAt,
      lastWinbackAt: history.lastWinbackAt,
    });
    if (skip) return { update, skip };
    const result = await NotificationOrchestrator.send(userId, 'health_sync_update', {
      title: update.title,
      body: update.body,
      screen: update.screen,
      ...update.facts,
      lifecycleStage: audience?.stage ?? null,
      dedupeKey: healthSyncDedupeKey(update.kind, today),
    });
    return { update, result };
  }

  private static async history(userId: string, now: Date): Promise<{ lastHealthSyncAt: string | null; lastWinbackAt: string | null }> {
    try {
      const { data, error } = await createAdminSupabase()
        .from('notification_log')
        .select('notification_type, sent_at')
        .eq('user_id', userId)
        .eq('suppressed', false)
        .in('notification_type', ['health_sync_update', 'winback_day3', 'winback_day7', 'winback_day14', 'winback_day30'])
        .gte('sent_at', new Date(now.getTime() - 4 * 86_400_000).toISOString());
      if (error) return { lastHealthSyncAt: null, lastWinbackAt: null };
      let lastHealthSyncAt: string | null = null;
      let lastWinbackAt: string | null = null;
      for (const r of (data ?? []) as Row[]) {
        if (r.notification_type === 'health_sync_update') {
          if (!lastHealthSyncAt || Date.parse(r.sent_at) > Date.parse(lastHealthSyncAt)) lastHealthSyncAt = r.sent_at;
        } else if (!lastWinbackAt || Date.parse(r.sent_at) > Date.parse(lastWinbackAt)) lastWinbackAt = r.sent_at;
      }
      return { lastHealthSyncAt, lastWinbackAt };
    } catch {
      return { lastHealthSyncAt: null, lastWinbackAt: null };
    }
  }
}
