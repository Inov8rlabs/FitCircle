import { MomentumService } from '../services/momentum-service';
import {
  NotificationOrchestrator,
  type NotificationType,
  type NotificationData,
} from '../services/notification-orchestrator';
import { PushService } from '../services/push-service';
import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// HELPERS
// ============================================================================

function daysBetween(a: Date, b: Date): number {
  const aDate = new Date(a);
  aDate.setHours(0, 0, 0, 0);
  const bDate = new Date(b);
  bDate.setHours(0, 0, 0, 0);
  return Math.floor((bDate.getTime() - aDate.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================================================================
// JOURNEY NOTIFICATIONS
// ============================================================================

/**
 * Send journey-based notifications based on account age.
 * Should be called once per day (e.g., 10:00 AM UTC).
 */
export async function sendJourneyNotifications(): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  const supabaseAdmin = createAdminSupabase();
  const now = new Date();
  let processed = 0;
  let sent = 0;
  let errors = 0;

  console.log('[Cron:JourneyNotifications] Starting...');

  // Get all users with their creation date and last engagement
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('id, created_at, display_name')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Cron:JourneyNotifications] Error fetching users:', error);
    throw error;
  }

  // Journey notification day mappings
  const journeyDayMap: Array<{ day: number; type: NotificationType }> = [
    { day: 0, type: 'welcome_day0' },
    { day: 1, type: 'day1_first_workout' },
    { day: 3, type: 'day3_circle_invite' },
    { day: 7, type: 'day7_weekly_summary' },
    { day: 14, type: 'day14_challenge_nudge' },
    { day: 21, type: 'day21_momentum_check' },
    { day: 30, type: 'day30_monthly_recap' },
  ];

  // Get last engagement dates for dormant checks
  const { data: streaks } = await supabaseAdmin
    .from('engagement_streaks')
    .select('user_id, last_engagement_date, current_streak');

  const streakMap = new Map(
    (streaks || []).map((s: any) => [s.user_id, s])
  );

  for (const user of users || []) {
    try {
      processed++;
      const accountAge = daysBetween(new Date(user.created_at), now);
      const streak = streakMap.get(user.id);

      // Check journey day notifications
      const journeyMatch = journeyDayMap.find((j) => j.day === accountAge);
      if (journeyMatch) {
        const data: NotificationData = {
          userName: user.display_name,
          currentMomentum: streak?.current_streak || 0,
          streakDays: streak?.current_streak || 0,
        };

        const result = await NotificationOrchestrator.send(user.id, journeyMatch.type, data);
        if (result.sent) sent++;
        continue;
      }

      // Check dormant notifications
      if (streak?.last_engagement_date) {
        const daysSinceEngagement = daysBetween(
          new Date(streak.last_engagement_date),
          now
        );

        const dormantMap: Array<{ days: number; type: NotificationType }> = [
          { days: 7, type: 'dormant_7d' },
          { days: 14, type: 'dormant_14d' },
          { days: 30, type: 'dormant_30d' },
          { days: 60, type: 'win_back_60d' },
        ];

        const dormantMatch = dormantMap.find((d) => d.days === daysSinceEngagement);
        if (dormantMatch) {
          const result = await NotificationOrchestrator.send(user.id, dormantMatch.type, {
            userName: user.display_name,
          });
          if (result.sent) sent++;
        }
      }
    } catch (err) {
      console.error(`[Cron:JourneyNotifications] Error for user ${user.id}:`, err);
      errors++;
    }
  }

  console.log(
    `[Cron:JourneyNotifications] Done: ${processed} processed, ${sent} sent, ${errors} errors`
  );
  return { processed, sent, errors };
}

// ============================================================================
// MOMENTUM NOTIFICATIONS
// ============================================================================

/**
 * Send momentum-related notifications (at-risk, near-milestone, decay warnings).
 * Should be called once per day (e.g., evening, 6:00 PM UTC).
 */
export async function sendMomentumNotifications(): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  const supabaseAdmin = createAdminSupabase();
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  let processed = 0;
  let sent = 0;
  let errors = 0;

  console.log('[Cron:MomentumNotifications] Starting...');

  // Get all users with active momentum who haven't checked in today
  const { data: streaks, error } = await supabaseAdmin
    .from('engagement_streaks')
    .select('user_id, current_streak, last_engagement_date, best_momentum, grace_day_used_this_week, paused')
    .gt('current_streak', 0)
    .eq('paused', false);

  if (error) {
    console.error('[Cron:MomentumNotifications] Error:', error);
    throw error;
  }

  // Milestones for near-milestone check
  const MILESTONES = [
    { days: 3, name: '3-Day Spark' },
    { days: 7, name: '1-Week Flame' },
    { days: 14, name: '2-Week Blaze' },
    { days: 30, name: 'Monthly Inferno' },
    { days: 60, name: '60-Day Furnace' },
    { days: 100, name: 'Centurion Flame' },
    { days: 365, name: 'Eternal Flame' },
  ];

  for (const streak of streaks || []) {
    try {
      processed++;
      const hasCheckedInToday = streak.last_engagement_date === today;

      if (hasCheckedInToday) continue;

      const currentMomentum = streak.current_streak;

      // Check if near a milestone (within 2 days)
      const nearMilestone = MILESTONES.find(
        (m) => m.days > currentMomentum && m.days - currentMomentum <= 2
      );

      if (nearMilestone) {
        const result = await NotificationOrchestrator.send(streak.user_id, 'near_milestone', {
          currentMomentum,
          daysAway: nearMilestone.days - currentMomentum,
          milestoneName: nearMilestone.name,
        });
        if (result.sent) sent++;
        continue; // Don't double-notify
      }

      // If hasn't checked in today and has significant momentum, send at-risk
      if (currentMomentum >= 3) {
        const result = await NotificationOrchestrator.send(
          streak.user_id,
          'momentum_at_risk',
          { currentMomentum }
        );
        if (result.sent) sent++;
      }
    } catch (err) {
      console.error(
        `[Cron:MomentumNotifications] Error for user ${streak.user_id}:`,
        err
      );
      errors++;
    }
  }

  console.log(
    `[Cron:MomentumNotifications] Done: ${processed} processed, ${sent} sent, ${errors} errors`
  );
  return { processed, sent, errors };
}

// ============================================================================
// DAILY DROP
// ============================================================================

/**
 * Send daily challenge notification to all active users.
 * Should be called once per day (e.g., 8:00 AM UTC).
 */
export async function sendDailyDrop(): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  const supabaseAdmin = createAdminSupabase();
  let processed = 0;
  let sent = 0;
  let errors = 0;

  console.log('[Cron:DailyDrop] Starting...');

  // Get today's daily challenge
  const today = new Date().toISOString().split('T')[0];
  const { data: challenge } = await supabaseAdmin
    .from('daily_challenges')
    .select('id, title, description')
    .eq('challenge_date', today)
    .single();

  if (!challenge) {
    console.log('[Cron:DailyDrop] No daily challenge found for today, skipping');
    return { processed: 0, sent: 0, errors: 0 };
  }

  // Get active users (had engagement in last 14 days)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 14);

  const { data: activeUsers, error } = await supabaseAdmin
    .from('engagement_streaks')
    .select('user_id')
    .gte('last_engagement_date', cutoffDate.toISOString().split('T')[0])
    .eq('paused', false);

  if (error) {
    console.error('[Cron:DailyDrop] Error fetching active users:', error);
    throw error;
  }

  for (const user of activeUsers || []) {
    try {
      processed++;
      const result = await NotificationOrchestrator.send(user.user_id, 'daily_drop', {
        challengeTitle: challenge.title,
        deepLink: '/challenges/daily',
      });
      if (result.sent) sent++;
    } catch (err) {
      console.error(`[Cron:DailyDrop] Error for user ${user.user_id}:`, err);
      errors++;
    }
  }

  console.log(
    `[Cron:DailyDrop] Done: ${processed} processed, ${sent} sent, ${errors} errors`
  );
  return { processed, sent, errors };
}

// ============================================================================
// WEEKLY SUMMARY
// ============================================================================

/**
 * Send weekly summary notification (Friday evening).
 * Should be called once per week on Fridays.
 */
export async function sendWeeklySummary(): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  const supabaseAdmin = createAdminSupabase();
  let processed = 0;
  let sent = 0;
  let errors = 0;

  console.log('[Cron:WeeklySummary] Starting...');

  // Get all active users
  const { data: users, error } = await supabaseAdmin
    .from('engagement_streaks')
    .select('user_id, current_streak')
    .eq('paused', false);

  if (error) {
    console.error('[Cron:WeeklySummary] Error:', error);
    throw error;
  }

  // Get this week's date range (Monday to now)
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);

  for (const user of users || []) {
    try {
      processed++;

      // Count workouts this week from exercise_logs
      const { count: workoutCount } = await supabaseAdmin
        .from('exercise_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.user_id)
        .gte('logged_at', monday.toISOString());

      const result = await NotificationOrchestrator.send(user.user_id, 'weekly_summary', {
        workoutsThisWeek: workoutCount || 0,
        streakDays: user.current_streak || 0,
      });
      if (result.sent) sent++;
    } catch (err) {
      console.error(`[Cron:WeeklySummary] Error for user ${user.user_id}:`, err);
      errors++;
    }
  }

  console.log(
    `[Cron:WeeklySummary] Done: ${processed} processed, ${sent} sent, ${errors} errors`
  );
  return { processed, sent, errors };
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Remove notification logs older than 90 days and stale push tokens.
 * Should be called once per day or week.
 */
export async function cleanupNotificationLog(): Promise<{
  logsDeleted: number;
  tokensDeleted: number;
}> {
  const supabaseAdmin = createAdminSupabase();

  console.log('[Cron:CleanupNotificationLog] Starting...');

  // Delete old notification logs
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);

  const { data: deletedLogs, error: logError } = await supabaseAdmin
    .from('notification_log')
    .delete()
    .lt('sent_at', cutoffDate.toISOString())
    .select('id');

  if (logError) {
    console.error('[Cron:CleanupNotificationLog] Error deleting logs:', logError);
  }

  const logsDeleted = deletedLogs?.length || 0;

  // Cleanup stale tokens
  const tokensDeleted = await PushService.cleanupStaleTokens();

  console.log(
    `[Cron:CleanupNotificationLog] Done: ${logsDeleted} logs deleted, ${tokensDeleted} tokens deleted`
  );

  return { logsDeleted, tokensDeleted };
}
