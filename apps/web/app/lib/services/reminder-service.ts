import { createAdminSupabase } from '../supabase-admin';

import { NotificationOrchestrator } from './notification-orchestrator';

/**
 * STATE-AWARE daily streak reminder (the remote replacement for the iOS "static" local
 * reminders that fired regardless of whether the user had already logged/claimed).
 *
 * Designed to run HOURLY: each user is reminded once, at their local TARGET hour, and ONLY
 * if they haven't already engaged today (claimed the streak OR logged food) in THEIR
 * timezone. Sends go through NotificationOrchestrator (category prefs + quiet hours +
 * frequency cap + suppression + logging + the FCM PushService). No-op for users without an
 * active push token.
 */
const TARGET_LOCAL_HOUR = Number(process.env.REMINDER_LOCAL_HOUR ?? 19); // 7pm local

const MILESTONES = [
  { days: 7, name: '1 week' },
  { days: 30, name: '1 month' },
  { days: 100, name: '100 days' },
  { days: 365, name: '1 year' },
];

/** The user's local YYYY-MM-DD date and 0–23 hour, from their IANA timezone. */
function localDateAndHour(timeZone: string): { date: string; hour: number } {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // YYYY-MM-DD
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const hour = parseInt(hourStr, 10) % 24;
  return { date, hour };
}

export class ReminderService {
  static async sendDailyStreakReminders(): Promise<{
    candidates: number;
    sent: number;
    skippedActed: number;
    skippedHour: number;
    errors: number;
  }> {
    const supabase = createAdminSupabase();

    // Only users with an active push token are reachable.
    const { data: tokenRows } = await supabase
      .from('push_tokens')
      .select('user_id')
      .eq('is_active', true);
    const userIds = [...new Set((tokenRows ?? []).map((r: any) => r.user_id as string))];
    if (userIds.length === 0) {
      return { candidates: 0, sent: 0, skippedActed: 0, skippedHour: 0, errors: 0 };
    }

    // Batch the per-user context (timezone + current streak).
    const [{ data: prefs }, { data: streaks }] = await Promise.all([
      supabase.from('notification_preferences').select('user_id, quiet_hours_timezone').in('user_id', userIds),
      supabase.from('engagement_streaks').select('user_id, current_streak').in('user_id', userIds),
    ]);
    const tzByUser = new Map(
      (prefs ?? []).map((p: any) => [p.user_id, p.quiet_hours_timezone || 'America/New_York'] as const),
    );
    const streakByUser = new Map(
      (streaks ?? []).map((s: any) => [s.user_id, (s.current_streak ?? 0) as number] as const),
    );

    let candidates = 0;
    let sent = 0;
    let skippedActed = 0;
    let skippedHour = 0;
    let errors = 0;

    for (const userId of userIds) {
      try {
        const tz = tzByUser.get(userId) ?? 'America/New_York';
        let local: { date: string; hour: number };
        try {
          local = localDateAndHour(tz);
        } catch {
          local = localDateAndHour('America/New_York');
        }

        // One reminder per day, at the user's local target hour (the cron runs hourly).
        if (local.hour !== TARGET_LOCAL_HOUR) {
          skippedHour++;
          continue;
        }
        candidates++;

        // Already engaged today (in their local date)? Then don't nag.
        if (await this.claimedToday(supabase, userId, local.date)) {
          skippedActed++;
          continue;
        }
        if (await this.loggedFoodToday(supabase, userId, local.date)) {
          skippedActed++;
          continue;
        }

        const currentStreak = streakByUser.get(userId) ?? 0;
        const near = MILESTONES.find((m) => m.days > currentStreak && m.days - currentStreak <= 2);
        const result = near
          ? await NotificationOrchestrator.send(userId, 'near_milestone', {
              currentMomentum: currentStreak,
              daysAway: near.days - currentStreak,
              milestoneName: near.name,
            })
          : await NotificationOrchestrator.send(userId, 'momentum_at_risk', {
              currentMomentum: currentStreak,
            });
        if (result.sent) sent++;
      } catch (err) {
        console.error(`[ReminderService] reminder failed for ${userId}:`, err);
        errors++;
      }
    }

    return { candidates, sent, skippedActed, skippedHour, errors };
  }

  /** Did the user claim their streak on their local date? (canonical "engaged today"). */
  private static async claimedToday(supabase: any, userId: string, localDate: string): Promise<boolean> {
    const { data } = await supabase
      .from('streak_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('claim_date', localDate)
      .limit(1)
      .maybeSingle();
    return !!data;
  }

  /** Did the user log a (non-deleted, calorie-bearing) food entry on their local date? */
  private static async loggedFoodToday(supabase: any, userId: string, localDate: string): Promise<boolean> {
    const { data } = await supabase
      .from('food_log_entries')
      .select('id')
      .eq('user_id', userId)
      .eq('entry_date', localDate)
      .not('calories', 'is', null)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    return !!data;
  }
}
