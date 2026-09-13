import { createAdminSupabase } from '../supabase-admin';

import {
  NotificationPreferencesService,
  type NotificationCategory,
} from './notification-preferences-service';
import { PushService, type PushNotification } from './push-service';

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
  mealsThisWeek?: number;
  workoutsThisMonth?: number;
  mealsThisMonth?: number;
  bestStreak?: number;
  streakDays?: number;
  pointsEarned?: number;
  totalPoints?: number;

  // Daily drop
  challengeTitle?: string;

  // Generic
  userName?: string;

  // Circle Chat
  preview?: string;
  body?: string;
  senderName?: string;

  // Entity ids forwarded into the push data payload (as strings) when present
  circleId?: string;
  challengeId?: string;
  messageId?: string;

  // Streak shields
  shieldsRemaining?: number | null;
  shieldsGranted?: number;
  unlimited?: boolean;
  lostStreak?: number;
  paywallEligible?: boolean;
  zombieGuard?: boolean;
  lastAutoProtect?: boolean;

  // Deep link
  deepLink?: string;

  [key: string]: any;
}

export type NotificationType =
  // Journey: account age + dormancy ladder
  | 'day1_nothing_logged'
  | 'day3_circle_invite'
  | 'day14_challenge_nudge'
  | 'day30_monthly_recap'
  | 'dormant_7d'
  | 'dormant_14d'
  | 'dormant_30d'
  | 'win_back_60d'
  // Streak state + logging reminders
  | 'momentum_at_risk'
  | 'near_milestone'
  | 'reset_encouragement'
  | 'meal_reminder_lunch'
  | 'meal_reminder_dinner'
  // State - Streak shields
  | 'shield_applied'
  | 'streak_lost'
  | 'shield_earned'
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
  | 'circle_invite_received'
  // Circle Chat (social + celebration)
  | 'chat_message'
  | 'chat_mention'
  | 'chat_rally';

interface NotificationContent {
  title: string;
  body: string;
  category: NotificationCategory;
}

/**
 * Where a tap on the push should land. This is the wire contract with both
 * mobile apps (Android allowlists exactly these values in
 * NotificationDeepLink; iOS maps them in DeepLinkRouter). Types that need an
 * entity id (circle_detail / circle_chat) fall back to the list screen when
 * the id is absent — see screenFor().
 */
export type NotificationScreen =
  | 'dashboard'
  | 'food_log'
  | 'exercise_log'
  | 'circles'
  | 'circle_detail'
  | 'circle_chat'
  | 'challenges'
  | 'streaks';

export const TYPE_SCREEN_MAP: Record<NotificationType, NotificationScreen> = {
  // Journey
  day1_nothing_logged: 'food_log',
  day3_circle_invite: 'circles',
  day14_challenge_nudge: 'challenges',
  day30_monthly_recap: 'dashboard',
  dormant_7d: 'dashboard',
  dormant_14d: 'dashboard',
  dormant_30d: 'dashboard',
  win_back_60d: 'dashboard',
  // Streak state + logging reminders
  momentum_at_risk: 'streaks',
  near_milestone: 'streaks',
  reset_encouragement: 'streaks',
  meal_reminder_lunch: 'food_log',
  meal_reminder_dinner: 'food_log',
  shield_applied: 'streaks',
  streak_lost: 'streaks',
  shield_earned: 'streaks',
  // Circle
  circle_boost_threshold: 'circle_detail',
  perfect_day: 'circle_detail',
  friend_joined_circle: 'circle_detail',
  // Challenge
  challenge_halfway: 'challenges',
  challenge_ending_tomorrow: 'challenges',
  challenge_completed: 'challenges',
  // Summary / celebration
  weekly_summary: 'dashboard',
  daily_drop: 'challenges',
  milestone_achieved: 'streaks',
  circle_invite_received: 'circles',
  // Circle chat
  chat_message: 'circle_chat',
  chat_mention: 'circle_chat',
  chat_rally: 'circle_chat',
};

export function screenFor(type: NotificationType, data: NotificationData): NotificationScreen {
  const screen = TYPE_SCREEN_MAP[type] ?? 'dashboard';
  if ((screen === 'circle_detail' || screen === 'circle_chat') && !data.circleId) {
    return 'circles';
  }
  return screen;
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

export const NOTIFICATION_TEMPLATES: Record<
  NotificationType,
  (data: NotificationData) => NotificationContent
> = {
  // ---- Journey: account age + dormancy ladder ----
  day1_nothing_logged: () => ({
    title: 'Your streak starts with one log 🍽️',
    body: 'You joined FitCircle yesterday. Log a meal or a workout today and day 1 is yours.',
    category: 'journey',
  }),
  day3_circle_invite: () => ({
    title: 'Better together! 👋',
    body: "Three days in. Invite a friend to a FitCircle and keep each other honest.",
    category: 'journey',
  }),
  day14_challenge_nudge: () => ({
    title: 'Ready for a challenge? 🏋️',
    body: 'Two weeks in! Join a challenge and compete with your circle.',
    category: 'journey',
  }),
  day30_monthly_recap: (data) => {
    const parts: string[] = [];
    if (data.workoutsThisMonth) parts.push(`${data.workoutsThisMonth} workouts`);
    if (data.mealsThisMonth) parts.push(`${data.mealsThisMonth} days of meals logged`);
    if (data.bestStreak) parts.push(`a ${data.bestStreak}-day best streak`);
    return {
      title: 'One month with FitCircle 🏆',
      body: parts.length
        ? `30 days in: ${parts.join(', ')}. Here's to the next 30!`
        : "30 days in. Here's to the next 30!",
      category: 'journey',
    };
  },
  dormant_7d: () => ({
    title: 'We miss you 👋',
    body: "It's been a week since you last logged. One meal or workout restarts your streak.",
    category: 'journey',
  }),
  dormant_14d: () => ({
    title: "Don't let your progress fade 🕯️",
    body: 'Two weeks away is tough, but you can bounce back. Your circle is still going — jump back in!',
    category: 'journey',
  }),
  dormant_30d: () => ({
    title: 'Still here for you 🌱',
    body: 'A month away happens. Open the app and log one thing. That is all it takes.',
    category: 'journey',
  }),
  win_back_60d: () => ({
    title: 'A fresh start awaits 🌅',
    body: "It's never too late to restart. Your friends are still here, and so is your progress.",
    category: 'journey',
  }),

  // ---- Streak state + logging reminders ----
  momentum_at_risk: (data) => ({
    title: 'Your streak is at risk 🔥',
    body: `Your ${data.currentMomentum || 0}-day streak ends at midnight unless you log a meal or workout${
      data.unlimited
        ? ' — Pro shields have your back if you can\'t.'
        : typeof data.shieldsRemaining === 'number' && data.shieldsRemaining > 0
          ? ` — or a shield (${data.shieldsRemaining} left) will cover you.`
          : '. No shields left to cover a miss!'
    }`,
    category: 'momentum',
  }),
  near_milestone: (data) => {
    const days = data.daysAway || 0;
    return {
      title: 'So close! 🏆',
      body: `You're ${days} ${days === 1 ? 'day' : 'days'} from ${data.milestoneName || 'your next milestone'}. Log today to keep going.`,
      category: 'momentum',
    };
  },
  shield_applied: (data) => ({
    title: 'A shield saved your streak 🛡️',
    body: `You missed yesterday, so a shield kept your ${data.streakDays || 0}-day streak alive.${
      data.unlimited
        ? ' Pro keeps you covered.'
        : data.shieldsRemaining === 0
          ? " That was your last one — show up today to keep it going!"
          : ` ${data.shieldsRemaining ?? 0} shield${data.shieldsRemaining === 1 ? '' : 's'} left.`
    }${data.lastAutoProtect ? ' Shields won\'t cover another miss in a row.' : ''}`,
    category: 'momentum',
  }),
  streak_lost: (data) => ({
    title: `Your ${data.lostStreak || 0}-day streak ended 💔`,
    body: data.zombieGuard
      ? 'Shields can only cover two misses in a row. Log something today to start a fresh streak.'
      : data.paywallEligible
        ? 'No shields left to cover yesterday. Pro members get unlimited shields — or start fresh today!'
        : 'Log a meal, a workout, or check in today to start a new one.',
    category: 'momentum',
  }),
  shield_earned: (data) => ({
    title: 'Shield earned 🛡️',
    body: `${data.streakDays || 0} days strong! You earned ${data.shieldsGranted === 1 ? 'a streak shield' : `${data.shieldsGranted} streak shields`} — it auto-protects your next missed day.`,
    category: 'celebration',
  }),
  reset_encouragement: () => ({
    title: 'You got this! 💪',
    body: 'Yesterday ended a streak, today starts one. A single log is all it takes.',
    category: 'momentum',
  }),
  meal_reminder_lunch: () => ({
    title: 'Lunch logged? 🥗',
    body: "Haven't seen lunch yet. Snap it or type it — ten seconds.",
    category: 'momentum',
  }),
  meal_reminder_dinner: (data) => ({
    title: 'Dinner time 🍽️',
    body:
      data.currentMomentum && data.currentMomentum > 0
        ? `Log dinner to keep your ${data.currentMomentum}-day streak alive.`
        : "Log tonight's dinner to close out the day.",
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
  weekly_summary: (data) => {
    const parts = [`${data.workoutsThisWeek || 0} workouts`];
    if (typeof data.mealsThisWeek === 'number') parts.push(`${data.mealsThisWeek} days of meals logged`);
    parts.push(`${data.streakDays || 0}-day streak`);
    return {
      title: 'Your week in review 📊',
      body: `${parts.join(', ')}. Nice work this week!`,
      category: 'journey',
    };
  },
  daily_drop: (data) => ({
    title: "Today's challenge is here! 🎯",
    body: `${data.challengeTitle || 'A new daily challenge'} is waiting for you. Complete it for bonus points!`,
    category: 'challenge',
  }),
  milestone_achieved: (data) => ({
    title: 'Milestone unlocked! 🏅',
    body: `You just hit ${data.milestoneName || 'a new milestone'}! Your dedication is paying off.`,
    category: 'celebration',
  }),
  circle_invite_received: (data) => ({
    title: "You've been invited! 📬",
    body: `${data.friendName || 'Someone'} invited you to join "${data.circleName || 'a FitCircle'}". Check it out!`,
    category: 'social',
  }),

  // ---- Circle Chat ----
  chat_message: (data) => ({
    title: `${data.friendName || 'Someone'} in ${data.circleName || 'your circle'}`,
    body: data.preview || 'sent a message',
    category: 'social',
  }),
  chat_mention: (data) => ({
    title: `${data.friendName || 'Someone'} mentioned you`,
    body: data.preview || 'mentioned you in the chat',
    category: 'social',
  }),
  chat_rally: (data) => ({
    title: `🎉 Big moment in ${data.circleName || 'your circle'}`,
    body: data.body || 'Something worth celebrating just happened!',
    category: 'celebration',
  }),
};

// ============================================================================
// SUPPRESSION CHAINS
// Pairs of notification types that shouldn't fire together.
// If the "blocker" was sent recently, suppress the "blocked" type.
// ============================================================================

const SUPPRESSION_CHAINS: Array<{ blocker: NotificationType; blocked: NotificationType; windowMinutes: number }> = [
  // One evening nudge, not two: the dinner reminder already carries the streak.
  { blocker: 'meal_reminder_dinner', blocked: 'momentum_at_risk', windowMinutes: 120 },
  // Don't send momentum_at_risk if the user just got a milestone-flavoured nudge.
  { blocker: 'near_milestone', blocked: 'momentum_at_risk', windowMinutes: 120 },
  { blocker: 'milestone_achieved', blocked: 'momentum_at_risk', windowMinutes: 120 },
  // Don't spam dormant messages back-to-back.
  { blocker: 'dormant_7d', blocked: 'dormant_14d', windowMinutes: 1440 * 6 },
  { blocker: 'dormant_14d', blocked: 'dormant_30d', windowMinutes: 1440 * 14 },
  // Don't send challenge_ending right after halfway.
  { blocker: 'challenge_halfway', blocked: 'challenge_ending_tomorrow', windowMinutes: 1440 },
];

// Frequency cap: at most this many *nudges* per user per local day. Anything
// in CAP_EXEMPT_TYPES neither counts toward it nor is blocked by it, so the
// effective ceiling on a busy day is 3 nudges + lunch + dinner reminders +
// outcomes the user must not miss.
export const MAX_NOTIFICATIONS_PER_DAY = 3;

// Chat notifications are real-time conversation traffic: they ride the chat
// wire shape (data-only on Android, alert + thread-id on iOS) — see PushService.
const CHAT_NOTIFICATION_TYPES: NotificationType[] = [
  'chat_message',
  'chat_mention',
  'chat_rally',
];

// Cap-exempt: chat (conversation traffic), the two meal reminders (decided
// 2026-09-13: "3 + lunch and dinner"), and outcomes that report something
// that already happened to the user's streak or challenge — those must never
// be dropped in favour of a nudge sent earlier the same day.
export const CAP_EXEMPT_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  ...CHAT_NOTIFICATION_TYPES,
  'meal_reminder_lunch',
  'meal_reminder_dinner',
  'streak_lost',
  'shield_applied',
  'challenge_completed',
]);

export function isCapExempt(type: NotificationType): boolean {
  return CAP_EXEMPT_TYPES.has(type);
}

/** Start of the current day in an IANA timezone, as a UTC instant. */
export function startOfLocalDay(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Intl may render midnight as "24" with hour12:false; wrap it.
  const secondsIntoDay = (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
  return new Date(now.getTime() - secondsIntoDay * 1000);
}

/** Pure quiet-hours test; start/end are "HH:MM" (or "HH:MM:SS" from Postgres TIME). */
export function isWithinQuietWindow(currentMinutes: number, start: string, end: string): boolean {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  if (startMinutes === endMinutes) return false;
  return startMinutes < endMinutes
    ? currentMinutes >= startMinutes && currentMinutes < endMinutes
    : currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

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

    // 2. Check frequency cap (see CAP_EXEMPT_TYPES)
    const isChatType = CHAT_NOTIFICATION_TYPES.includes(type);
    if (!isCapExempt(type)) {
      const capResult = await this.checkFrequencyCap(userId);
      if (!capResult.allowed) {
        await this.logNotification(userId, type, content, data, true, 'frequency_cap');
        return { sent: false, reason: 'frequency_cap' };
      }
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

    // 5. Send the push notification.
    // All data values must be strings (FCM v1 requirement); absent keys are omitted.
    const pushData: Record<string, string> = {
      type,
      category: content.category,
      screen: screenFor(type, data),
    };
    if (data.circleId) pushData.circleId = String(data.circleId);
    if (data.challengeId) pushData.challengeId = String(data.challengeId);
    if (data.messageId) pushData.messageId = String(data.messageId);
    if (data.deepLink) pushData.deepLink = data.deepLink;

    if (isChatType) {
      // Chat wire contract: circleName + preview always; senderName except rallies.
      if (data.circleName) pushData.circleName = String(data.circleName);
      const senderName = data.senderName ?? data.friendName;
      if (senderName && type !== 'chat_rally') pushData.senderName = String(senderName);
      const preview = data.preview ?? data.body;
      if (preview) pushData.preview = String(preview);
    }

    const pushNotification: PushNotification = {
      title: content.title,
      body: content.body,
      data: pushData,
      // Chat pushes ride the data-only Android / alert+thread-id iOS shape.
      ...(isChatType
        ? { chat: { threadId: data.circleId ? String(data.circleId) : '' } }
        : {}),
    };

    const sentCount = await PushService.sendPush(userId, pushNotification);

    // 6. Log the notification — truthfully. With no registered device (or
    //    no FCM credentials) nothing was delivered, and a "sent" log row
    //    would both mislead and count against the daily frequency cap.
    if (sentCount > 0) {
      await this.logNotification(userId, type, content, data, false);
      console.log(
        `[NotificationOrchestrator] Sent "${type}" to user ${userId} (${sentCount} devices)`
      );
      return { sent: true };
    }
    await this.logNotification(userId, type, content, data, true, 'no_delivery');
    return { sent: false, reason: 'no_delivery' };
  }

  /**
   * Check if user has exceeded the daily frequency cap.
   * Chat notifications don't count toward the cap (a busy chat would otherwise
   * starve every other notification type for the rest of the day).
   */
  static async checkFrequencyCap(
    userId: string
  ): Promise<{ allowed: boolean; count: number }> {
    const supabaseAdmin = createAdminSupabase();

    // "Per day" means the user's day, not the server's.
    const prefs = await NotificationPreferencesService.getPreferences(userId);
    let startOfDay: Date;
    try {
      startOfDay = startOfLocalDay(prefs.quiet_hours_timezone || 'America/New_York');
    } catch {
      startOfDay = startOfLocalDay('America/New_York');
    }

    const { count, error } = await supabaseAdmin
      .from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('suppressed', false)
      .not('notification_type', 'in', `(${[...CAP_EXEMPT_TYPES].join(',')})`)
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

    return {
      inQuietHours: isWithinQuietWindow(currentMinutes, prefs.quiet_hours_start, prefs.quiet_hours_end),
    };
  }

  /**
   * Idempotency guard for time-based generators: was `type` already delivered
   * to this user within the window (optionally for the same entity)? Crons can
   * run twice, and late retry passes exist; this is what keeps a user from
   * getting the same nudge twice.
   */
  static async hasSent(
    userId: string,
    type: NotificationType,
    opts: { withinHours: number; entityKey?: 'circleId' | 'challengeId'; entityId?: string }
  ): Promise<boolean> {
    const supabaseAdmin = createAdminSupabase();
    const since = new Date(Date.now() - opts.withinHours * 60 * 60 * 1000).toISOString();
    let query = supabaseAdmin
      .from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('notification_type', type)
      .eq('suppressed', false)
      .gte('sent_at', since);
    if (opts.entityKey && opts.entityId) {
      query = query.eq(`data->>${opts.entityKey}`, opts.entityId);
    }
    const { count, error } = await query;
    if (error) {
      console.error('[NotificationOrchestrator.hasSent] Error:', error);
      return false; // fail open: a duplicate beats a silent miss
    }
    return (count || 0) > 0;
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
