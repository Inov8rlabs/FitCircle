import { createAdminSupabase } from '../supabase-admin';
import { PushService, PushNotification } from './push-service';
import {
  NotificationPreferencesService,
  NotificationCategory,
} from './notification-preferences-service';

// ============================================================================
// TYPES
// ============================================================================

export interface NotificationData {
  // Momentum
  currentMomentum?: number;
  daysAway?: number;
  milestoneName?: string;
  decayAmount?: number;
  previousMomentum?: number;

  // Circle
  circleName?: string;
  checkedIn?: number;
  total?: number;
  multiplier?: string;
  friendName?: string;

  // Challenge
  challengeName?: string;
  daysLeft?: number;
  rank?: number;

  // Summary
  workoutsThisWeek?: number;
  streakDays?: number;
  pointsEarned?: number;
  totalPoints?: number;

  // Daily drop
  challengeTitle?: string;

  // Generic
  userName?: string;

  // Deep link
  deepLink?: string;

  [key: string]: any;
}

export type NotificationType =
  // Journey (J1-J11)
  | 'welcome_day0'
  | 'day1_first_workout'
  | 'day3_circle_invite'
  | 'day7_weekly_summary'
  | 'day14_challenge_nudge'
  | 'day21_momentum_check'
  | 'day30_monthly_recap'
  | 'dormant_7d'
  | 'dormant_14d'
  | 'dormant_30d'
  | 'win_back_60d'
  // State - Momentum (S1-S4b)
  | 'momentum_at_risk'
  | 'near_milestone'
  | 'grace_day_used'
  | 'momentum_decay'
  | 'momentum_reset'
  | 'reset_encouragement'
  // State - Circle (S5/S6/S12)
  | 'circle_boost_threshold'
  | 'perfect_day'
  | 'friend_joined_circle'
  // State - Challenge (S7/S8/S9)
  | 'challenge_halfway'
  | 'challenge_ending_tomorrow'
  | 'challenge_completed'
  // State - Summary (S10-S15)
  | 'weekly_summary'
  | 'daily_drop'
  | 'milestone_achieved'
  | 'points_earned'
  | 'circle_invite_received';

interface NotificationContent {
  title: string;
  body: string;
  category: NotificationCategory;
}

interface NotificationLogEntry {
  user_id: string;
  notification_type: string;
  notification_category: string;
  title: string;
  body: string;
  data: Record<string, any>;
  suppressed: boolean;
  suppression_reason?: string;
}

// ============================================================================
// CONTENT TEMPLATES (Fitzy voice)
// ============================================================================

const NOTIFICATION_TEMPLATES: Record<
  NotificationType,
  (data: NotificationData) => NotificationContent
> = {
  // ---- Journey (J1-J11) ----
  welcome_day0: () => ({
    title: 'Welcome to FitCircle! 🎉',
    body: 'Your fitness journey starts now. Log your first workout to build momentum!',
    category: 'journey',
  }),
  day1_first_workout: (data) => ({
    title: 'Great start! 💪',
    body: `Way to go${data.userName ? `, ${data.userName}` : ''}! You logged your first workout. Keep the momentum going tomorrow!`,
    category: 'journey',
  }),
  day3_circle_invite: () => ({
    title: 'Better together! 👋',
    body: "You've been at it for 3 days! Invite friends to a FitCircle and crush goals together.",
    category: 'journey',
  }),
  day7_weekly_summary: (data) => ({
    title: 'Your first week in review! 📊',
    body: `What a week! ${data.workoutsThisWeek || 0} workouts logged and ${data.streakDays || 0} day streak. You're building something great.`,
    category: 'journey',
  }),
  day14_challenge_nudge: () => ({
    title: 'Ready for a challenge? 🏋️',
    body: "Two weeks in! Time to level up — join a challenge and compete with your circle.",
    category: 'journey',
  }),
  day21_momentum_check: (data) => ({
    title: '3 weeks strong! 🔥',
    body: `Your momentum is at ${data.currentMomentum || 0} days. You're building a real habit. Don't stop now!`,
    category: 'journey',
  }),
  day30_monthly_recap: (data) => ({
    title: 'One month milestone! 🏆',
    body: `30 days of commitment! ${data.workoutsThisWeek ? `${data.workoutsThisWeek} workouts this month` : 'Amazing progress'}. Here's to the next 30!`,
    category: 'journey',
  }),
  dormant_7d: () => ({
    title: 'We miss you! 😢',
    body: "It's been a week since your last check-in. A quick workout is all it takes to restart your momentum!",
    category: 'journey',
  }),
  dormant_14d: () => ({
    title: "Don't let your progress fade 🕯️",
    body: "Two weeks away is tough, but you can bounce back. Your circle is still going — jump back in!",
    category: 'journey',
  }),
  dormant_30d: () => ({
    title: 'Your FitCircle misses you! 💔',
    body: "It's been a month. No judgment — just open the app and take one small step today.",
    category: 'journey',
  }),
  win_back_60d: () => ({
    title: 'A fresh start awaits 🌅',
    body: "It's never too late to restart. Your friends are still here, and so is your potential. Come back!",
    category: 'journey',
  }),

  // ---- State - Momentum (S1-S4b) ----
  momentum_at_risk: (data) => ({
    title: 'Your flame is flickering! 🕯️',
    body: `Don't let your ${data.currentMomentum || 0}-day momentum slip. A quick workout keeps it alive!`,
    category: 'momentum',
  }),
  near_milestone: (data) => ({
    title: 'So close! 🏆',
    body: `You're ${data.daysAway || 0} day(s) from your ${data.milestoneName || 'next'} milestone. Keep going!`,
    category: 'momentum',
  }),
  grace_day_used: () => ({
    title: 'Grace day activated 🛡️',
    body: "We've got your back! Your grace day protected your momentum. Try to check in tomorrow!",
    category: 'momentum',
  }),
  momentum_decay: (data) => ({
    title: 'Momentum slipping 📉',
    body: `Your momentum dropped by ${data.decayAmount || 0} to ${data.currentMomentum || 0} days. Check in today to stop the slide!`,
    category: 'momentum',
  }),
  momentum_reset: () => ({
    title: 'Fresh start time 🌱',
    body: "Your momentum reset to 0, but that's OK. Every champion has comebacks. Start building again today!",
    category: 'momentum',
  }),
  reset_encouragement: () => ({
    title: 'You got this! 💪',
    body: "Yesterday was a reset, today is a comeback. One check-in is all it takes to start your new streak!",
    category: 'momentum',
  }),

  // ---- State - Circle (S5/S6/S12) ----
  circle_boost_threshold: (data) => ({
    title: `${data.circleName || 'Your circle'} is heating up! 🔥`,
    body: `${data.checkedIn || 0}/${data.total || 0} members checked in. Join them for a ${data.multiplier || '1.5'}x boost!`,
    category: 'circle',
  }),
  perfect_day: (data) => ({
    title: 'Perfect day! ⭐',
    body: `Everyone in ${data.circleName || 'your circle'} checked in today! That's teamwork at its finest.`,
    category: 'circle',
  }),
  friend_joined_circle: (data) => ({
    title: 'New member alert! 🎊',
    body: `${data.friendName || 'Someone new'} just joined ${data.circleName || 'your circle'}. Give them a warm welcome!`,
    category: 'circle',
  }),

  // ---- State - Challenge (S7/S8/S9) ----
  challenge_halfway: (data) => ({
    title: 'Halfway there! 🏃',
    body: `"${data.challengeName || 'Your challenge'}" is at the midpoint. ${data.rank ? `You're ranked #${data.rank}. ` : ''}Push through the second half!`,
    category: 'challenge',
  }),
  challenge_ending_tomorrow: (data) => ({
    title: 'Last chance! ⏰',
    body: `"${data.challengeName || 'Your challenge'}" ends tomorrow. Give it everything you've got!`,
    category: 'challenge',
  }),
  challenge_completed: (data) => ({
    title: 'Challenge complete! 🎉',
    body: `"${data.challengeName || 'Your challenge'}" is over. ${data.rank ? `You finished #${data.rank}!` : 'Great effort!'} Check your results.`,
    category: 'challenge',
  }),

  // ---- State - Summary (S10-S15) ----
  weekly_summary: (data) => ({
    title: 'Your week in review 📊',
    body: `${data.workoutsThisWeek || 0} workouts, ${data.streakDays || 0}-day streak${data.pointsEarned ? `, ${data.pointsEarned} points earned` : ''}. Nice work this week!`,
    category: 'social',
  }),
  daily_drop: (data) => ({
    title: "Today's challenge is here! 🎯",
    body: `${data.challengeTitle || 'A new daily challenge'} is waiting for you. Complete it for bonus points!`,
    category: 'social',
  }),
  milestone_achieved: (data) => ({
    title: 'Milestone unlocked! 🏅',
    body: `You just hit ${data.milestoneName || 'a new milestone'}! Your dedication is paying off.`,
    category: 'celebration',
  }),
  points_earned: (data) => ({
    title: 'Points earned! 🌟',
    body: `+${data.pointsEarned || 0} points! Your total is now ${data.totalPoints || 0}. Keep stacking them up!`,
    category: 'celebration',
  }),
  circle_invite_received: (data) => ({
    title: "You've been invited! 📬",
    body: `${data.friendName || 'Someone'} invited you to join "${data.circleName || 'a FitCircle'}". Check it out!`,
    category: 'social',
  }),
};

// ============================================================================
// SUPPRESSION CHAINS
// Pairs of notification types that shouldn't fire together.
// If the "blocker" was sent recently, suppress the "blocked" type.
// ============================================================================

const SUPPRESSION_CHAINS: Array<{ blocker: NotificationType; blocked: NotificationType; windowMinutes: number }> = [
  // Don't send momentum_at_risk if user just completed a check-in milestone
  { blocker: 'near_milestone', blocked: 'momentum_at_risk', windowMinutes: 120 },
  { blocker: 'milestone_achieved', blocked: 'momentum_at_risk', windowMinutes: 120 },
  // Don't send decay warning right after a reset
  { blocker: 'momentum_reset', blocked: 'momentum_decay', windowMinutes: 240 },
  // Don't send reset_encouragement if welcome was just sent
  { blocker: 'welcome_day0', blocked: 'reset_encouragement', windowMinutes: 1440 },
  // Don't spam dormant messages back-to-back
  { blocker: 'dormant_7d', blocked: 'dormant_14d', windowMinutes: 1440 * 6 },
  { blocker: 'dormant_14d', blocked: 'dormant_30d', windowMinutes: 1440 * 14 },
  // Don't send challenge_ending right after halfway
  { blocker: 'challenge_halfway', blocked: 'challenge_ending_tomorrow', windowMinutes: 1440 },
  // Don't send grace_day_used and momentum_at_risk together
  { blocker: 'grace_day_used', blocked: 'momentum_at_risk', windowMinutes: 720 },
];

// Frequency cap
const MAX_NOTIFICATIONS_PER_DAY = 5;

// ============================================================================
// SERVICE
// ============================================================================

export class NotificationOrchestrator {
  /**
   * Main entry point: determine content, check suppression rules, log, and send.
   */
  static async send(
    userId: string,
    type: NotificationType,
    data: NotificationData = {}
  ): Promise<{ sent: boolean; reason?: string }> {
    const template = NOTIFICATION_TEMPLATES[type];
    if (!template) {
      console.error(`[NotificationOrchestrator] Unknown notification type: ${type}`);
      return { sent: false, reason: 'unknown_type' };
    }

    const content = template(data);

    // 1. Check if user has this category enabled
    const isEnabled = await NotificationPreferencesService.isTypeEnabled(userId, type);
    if (!isEnabled) {
      await this.logNotification(userId, type, content, data, true, 'category_disabled');
      return { sent: false, reason: 'category_disabled' };
    }

    // 2. Check frequency cap
    const capResult = await this.checkFrequencyCap(userId);
    if (!capResult.allowed) {
      await this.logNotification(userId, type, content, data, true, 'frequency_cap');
      return { sent: false, reason: 'frequency_cap' };
    }

    // 3. Check quiet hours
    const quietResult = await this.checkQuietHours(userId);
    if (quietResult.inQuietHours) {
      await this.logNotification(userId, type, content, data, true, 'quiet_hours');
      return { sent: false, reason: 'quiet_hours' };
    }

    // 4. Check suppression chains
    const suppressionResult = await this.checkSuppression(userId, type);
    if (suppressionResult.suppressed) {
      await this.logNotification(
        userId,
        type,
        content,
        data,
        true,
        `suppressed_by_${suppressionResult.blockerType}`
      );
      return { sent: false, reason: `suppressed_by_${suppressionResult.blockerType}` };
    }

    // 5. Send the push notification
    const pushNotification: PushNotification = {
      title: content.title,
      body: content.body,
      data: {
        type,
        category: content.category,
        ...(data.deepLink ? { deepLink: data.deepLink } : {}),
      },
    };

    const sentCount = await PushService.sendPush(userId, pushNotification);

    // 6. Log the notification
    await this.logNotification(userId, type, content, data, false);

    console.log(
      `[NotificationOrchestrator] Sent "${type}" to user ${userId} (${sentCount} devices)`
    );

    return { sent: true };
  }

  /**
   * Check if user has exceeded the daily frequency cap.
   */
  static async checkFrequencyCap(
    userId: string
  ): Promise<{ allowed: boolean; count: number }> {
    const supabaseAdmin = createAdminSupabase();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { count, error } = await supabaseAdmin
      .from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('suppressed', false)
      .gte('sent_at', startOfDay.toISOString());

    if (error) {
      console.error('[NotificationOrchestrator.checkFrequencyCap] Error:', error);
      // Allow on error to avoid blocking notifications
      return { allowed: true, count: 0 };
    }

    const currentCount = count || 0;
    return {
      allowed: currentCount < MAX_NOTIFICATIONS_PER_DAY,
      count: currentCount,
    };
  }

  /**
   * Check if it's currently quiet hours for the user.
   */
  static async checkQuietHours(
    userId: string
  ): Promise<{ inQuietHours: boolean }> {
    const prefs = await NotificationPreferencesService.getPreferences(userId);

    if (!prefs.quiet_hours_start || !prefs.quiet_hours_end) {
      return { inQuietHours: false };
    }

    // Get current time in user's timezone
    const now = new Date();
    const userTime = new Date(
      now.toLocaleString('en-US', { timeZone: prefs.quiet_hours_timezone })
    );
    const currentMinutes = userTime.getHours() * 60 + userTime.getMinutes();

    const [startHour, startMin] = prefs.quiet_hours_start.split(':').map(Number);
    const [endHour, endMin] = prefs.quiet_hours_end.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    let inQuietHours: boolean;
    if (startMinutes <= endMinutes) {
      // Same day range (e.g., 09:00 - 17:00)
      inQuietHours = currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Overnight range (e.g., 22:00 - 07:00)
      inQuietHours = currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return { inQuietHours };
  }

  /**
   * Check suppression chains — don't send a notification if a related one was recently sent.
   */
  static async checkSuppression(
    userId: string,
    type: NotificationType
  ): Promise<{ suppressed: boolean; blockerType?: string }> {
    const applicableChains = SUPPRESSION_CHAINS.filter((chain) => chain.blocked === type);
    if (applicableChains.length === 0) {
      return { suppressed: false };
    }

    const supabaseAdmin = createAdminSupabase();

    for (const chain of applicableChains) {
      const windowStart = new Date(Date.now() - chain.windowMinutes * 60 * 1000);

      const { count, error } = await supabaseAdmin
        .from('notification_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('notification_type', chain.blocker)
        .eq('suppressed', false)
        .gte('sent_at', windowStart.toISOString());

      if (error) {
        console.error('[NotificationOrchestrator.checkSuppression] Error:', error);
        continue;
      }

      if ((count || 0) > 0) {
        return { suppressed: true, blockerType: chain.blocker };
      }
    }

    return { suppressed: false };
  }

  /**
   * Generate notification content from type and data.
   */
  static getNotificationContent(
    type: NotificationType,
    data: NotificationData = {}
  ): NotificationContent | null {
    const template = NOTIFICATION_TEMPLATES[type];
    if (!template) return null;
    return template(data);
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  private static async logNotification(
    userId: string,
    type: NotificationType,
    content: NotificationContent,
    data: NotificationData,
    suppressed: boolean,
    suppressionReason?: string
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const entry: NotificationLogEntry = {
      user_id: userId,
      notification_type: type,
      notification_category: content.category,
      title: content.title,
      body: content.body,
      data: data as Record<string, any>,
      suppressed,
      suppression_reason: suppressionReason,
    };

    const { error } = await supabaseAdmin
      .from('notification_log')
      .insert(entry);

    if (error) {
      console.error('[NotificationOrchestrator.logNotification] Error:', error);
    }
  }
}
