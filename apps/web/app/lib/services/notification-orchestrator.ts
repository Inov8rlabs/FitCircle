import { createHash } from 'crypto';

import { createAdminSupabase } from '../supabase-admin';
import { stripEmoji } from '../text/strip-emoji';

import {
  NotificationPreferencesService,
  type NotificationCategory,
} from './notification-preferences-service';
import {
  APNS_PAYLOAD_BUDGET_BYTES,
  CIRCLE_CARD_TYPES,
  buildCircleCard,
  byteLength,
  isHttpsUrl,
  presentationFor,
  type CircleCard,
} from './push-presentation';
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
  emoji?: string; // chat_reaction: the reaction glyph
  body?: string;
  senderName?: string;
  /** Chat sender (Communication Notifications on iOS: name + avatar). */
  senderId?: string;
  senderAvatarUrl?: string | null;

  /** Optional https image the iOS service extension attaches (`image_url`). */
  imageUrl?: string;

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

  /**
   * Idempotency key for the underlying event (docs/PUSH_NOTIFICATIONS.md §3).
   * At most one delivered push per (user, dedupeKey) per 24 h; also becomes the
   * APNs `apns-collapse-id` and the Android notification `tag`. Stored in
   * notification_log.data, so it is queryable (migration 109 indexes it).
   */
  dedupeKey?: string;
  /** Cross-circle coalesced push: how many OTHER circles the event was posted to. */
  otherCircleCount?: number;
  /** Cross-circle rally: the achievement line used as the title. */
  headline?: string;

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
  // Meal-slot reminders (docs/ACTIVATION_JOURNEY_SPEC.md §4; MealReminderService)
  | 'meal_reminder_breakfast'
  | 'meal_reminder_lunch'
  | 'meal_reminder_snack'
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
  | 'chat_rally'
  | 'chat_reaction'
  // One bundled push per recipient per night covering all their circles' summaries.
  | 'circle_daily_summary'
  // Referrals ("Better Together" — docs/REFERRALS_SPEC.md)
  | 'referral_friend_joined'
  | 'referral_reward_earned'
  | 'referral_reward_banked'
  | 'referral_lifetime'
  | 'referral_invitee_welcome'
  | 'referral_nudge'
  | 'referral_progress'
  // Circle streak + lobby (REFERRALS_SPEC §10)
  | 'circle_streak_saved'
  | 'circle_streak_milestone'
  | 'circle_kickoff'
  // Admin-authored campaign pushes (docs/CAMPAIGNS_SPEC.md §5)
  | 'campaign'
  // Fitzy coaching tips (docs/FITZY_PUSH_NOTIFICATIONS.md; copy built by FitzyPushService)
  | 'fitzy_daily_focus'
  | 'fitzy_weekly_recap'
  | 'fitzy_weekly_plan'
  | 'fitzy_hydration_nudge'
  | 'fitzy_protein_nudge'
  // Day-2 "meet Fitzy" for activated users who never opened Fitzy (ACTIVATION_JOURNEY_SPEC §6)
  | 'fitzy_intro'
  // Transactional: the free trial renews tomorrow (ONBOARDING_V2_EXPERIMENT_SPEC §3.2; TrialReminderService)
  | 'trial_ending_reminder';

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
  | 'streaks'
  | 'invite_hub'
  | 'campaign'
  // Fitzy chat, seeded with the tip from `fitzyTip`. Older app builds don't know this screen and
  // fall back to `type` (fitzy_* → dashboard, where the Fitzy focus card lives).
  | 'fitzy_chat';

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
  // Shipped 1.0.8/1.0.9 apps route screen=food_log to the Food Log tab (they ignore mealType);
  // 1.1.0 reads data.mealType to open the logger with the slot preselected.
  meal_reminder_breakfast: 'food_log',
  meal_reminder_lunch: 'food_log',
  meal_reminder_snack: 'food_log',
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
  chat_reaction: 'circle_chat',
  // Single circle → that chat; several circles → no circleId → the circles list.
  circle_daily_summary: 'circle_chat',
  // Referrals
  referral_friend_joined: 'invite_hub',
  referral_reward_earned: 'invite_hub',
  referral_reward_banked: 'invite_hub',
  referral_lifetime: 'invite_hub',
  referral_invitee_welcome: 'invite_hub',
  // The nudged friend should go log a check-in.
  referral_nudge: 'dashboard',
  referral_progress: 'dashboard',
  circle_streak_saved: 'circle_detail',
  circle_streak_milestone: 'circle_detail',
  circle_kickoff: 'circle_detail',
  // Clients route by data.campaignSlug (calendar screen / home card / wizard).
  campaign: 'campaign',
  fitzy_daily_focus: 'fitzy_chat',
  fitzy_weekly_recap: 'fitzy_chat',
  fitzy_weekly_plan: 'fitzy_chat',
  fitzy_hydration_nudge: 'fitzy_chat',
  fitzy_protein_nudge: 'fitzy_chat',
  // Older builds without screen=fitzy_chat still route fitzy_* types to Fitzy (iOS) / fitzy_chat (Android).
  fitzy_intro: 'fitzy_chat',
  // Shipped apps have no subscription screen in the allowlist; the dashboard is safe everywhere.
  trial_ending_reminder: 'dashboard',
};

/** Coach pushes: Android "Coach" channel (FCM falls back to the default channel on older builds). */
export const ANDROID_COACH_CHANNEL_ID = 'fitcircle_coach';
/** Longest tip forwarded to the app in the data payload (never shown on the lock screen). */
export const FITZY_TIP_DATA_MAX = 400;

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
    title: 'Your streak starts with one log',
    body: 'You joined FitCircle yesterday. Log a meal or a workout today and day 1 is yours.',
    category: 'journey',
  }),
  day3_circle_invite: () => ({
    title: 'Better together',
    body: "Three days in. Invite a friend to a FitCircle and keep each other honest.",
    category: 'journey',
  }),
  day14_challenge_nudge: () => ({
    title: 'Ready for a challenge?',
    body: 'Two weeks in! Join a challenge and compete with your circle.',
    category: 'journey',
  }),
  day30_monthly_recap: (data) => {
    const parts: string[] = [];
    if (data.workoutsThisMonth) parts.push(`${data.workoutsThisMonth} workouts`);
    if (data.mealsThisMonth) parts.push(`${data.mealsThisMonth} days of meals logged`);
    if (data.bestStreak) parts.push(`a ${data.bestStreak}-day best streak`);
    return {
      title: 'One month with FitCircle',
      body: parts.length
        ? `30 days in: ${parts.join(', ')}. Here's to the next 30!`
        : "30 days in. Here's to the next 30!",
      category: 'journey',
    };
  },
  dormant_7d: () => ({
    title: 'We miss you',
    body: "It's been a week since you last logged. One meal or workout restarts your streak.",
    category: 'journey',
  }),
  dormant_14d: () => ({
    title: "Don't let your progress fade",
    body: 'Two weeks away is tough, but you can bounce back. Your circle is still going — jump back in!',
    category: 'journey',
  }),
  dormant_30d: () => ({
    title: 'Still here for you',
    body: 'A month away happens. Open the app and log one thing. That is all it takes.',
    category: 'journey',
  }),
  win_back_60d: () => ({
    title: 'A fresh start awaits',
    body: "It's never too late to restart. Your friends are still here, and so is your progress.",
    category: 'journey',
  }),

  // ---- Streak state + logging reminders ----
  momentum_at_risk: (data) => ({
    title: 'Your streak ends at midnight',
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
      title: 'So close!',
      body: `You're ${days} ${days === 1 ? 'day' : 'days'} from ${data.milestoneName || 'your next milestone'}. Log today to keep going.`,
      category: 'momentum',
    };
  },
  shield_applied: (data) => ({
    title: 'A shield saved your streak',
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
    title: `Your ${data.lostStreak || 0}-day streak ended`,
    body: data.zombieGuard
      ? 'Shields can only cover two misses in a row. Log something today to start a fresh streak.'
      : data.paywallEligible
        ? 'No shields left to cover yesterday. Pro members get unlimited shields — or start fresh today!'
        : 'Log a meal, a workout, or check in today to start a new one.',
    category: 'momentum',
  }),
  shield_earned: (data) => ({
    title: 'You earned a streak shield',
    body: `${data.streakDays || 0} days strong! You earned ${data.shieldsGranted === 1 ? 'a streak shield' : `${data.shieldsGranted} streak shields`} — it auto-protects your next missed day.`,
    category: 'celebration',
  }),
  reset_encouragement: () => ({
    title: "You've got this",
    body: 'Yesterday ended a streak, today starts one. A single log is all it takes.',
    category: 'momentum',
  }),
  // Meal-slot reminders: warm, short, no guilt (ACTIVATION_JOURNEY_SPEC §4).
  meal_reminder_breakfast: () => ({
    title: 'Good morning',
    body: 'Snap breakfast and see calories and macros in seconds.',
    category: 'momentum',
  }),
  meal_reminder_lunch: () => ({
    title: 'Lunch break?',
    body: "Snap your lunch and see what's on your plate in seconds.",
    category: 'momentum',
  }),
  meal_reminder_snack: () => ({
    title: 'Snack time',
    body: 'Having a snack? A quick photo keeps your day complete.',
    category: 'momentum',
  }),
  meal_reminder_dinner: (data) => ({
    title: 'Dinner time',
    body:
      data.currentMomentum && data.currentMomentum > 0
        ? `Snap dinner to keep your ${data.currentMomentum}-day streak going.`
        : 'Snap dinner to round out your day.',
    category: 'momentum',
  }),

  // ---- State - Circle (S5/S6/S12) ----
  circle_boost_threshold: (data) => ({
    title: `${data.circleName || 'Your circle'} is heating up`,
    body: `${data.checkedIn || 0}/${data.total || 0} members checked in. Join them for a ${data.multiplier || '1.5'}x boost!`,
    category: 'circle',
  }),
  perfect_day: (data) => ({
    title: 'Perfect day!',
    body: `Everyone in ${data.circleName || 'your circle'} checked in today! That's teamwork at its finest.`,
    category: 'circle',
  }),
  friend_joined_circle: (data) => ({
    title: `New member in ${data.circleName || 'your circle'}`,
    body: `${data.friendName || 'Someone new'} just joined ${data.circleName || 'your circle'}. Give them a warm welcome!`,
    category: 'circle',
  }),

  // ---- State - Challenge (S7/S8/S9) ----
  challenge_halfway: (data) => ({
    title: 'Halfway there',
    body: `"${data.challengeName || 'Your challenge'}" is at the midpoint. ${data.rank ? `You're ranked #${data.rank}. ` : ''}Push through the second half!`,
    category: 'challenge',
  }),
  challenge_ending_tomorrow: (data) => ({
    title: 'Last day tomorrow',
    body: `"${data.challengeName || 'Your challenge'}" ends tomorrow. Give it everything you've got!`,
    category: 'challenge',
  }),
  challenge_completed: (data) => ({
    title: 'Challenge complete',
    body: `"${data.challengeName || 'Your challenge'}" is over. ${data.rank ? `You finished #${data.rank}!` : 'Great effort!'} Check your results.`,
    category: 'challenge',
  }),

  // ---- State - Summary (S10-S15) ----
  weekly_summary: (data) => {
    const parts = [`${data.workoutsThisWeek || 0} workouts`];
    if (typeof data.mealsThisWeek === 'number') parts.push(`${data.mealsThisWeek} days of meals logged`);
    parts.push(`${data.streakDays || 0}-day streak`);
    return {
      title: 'Your week in review',
      body: `${parts.join(', ')}. Nice work this week!`,
      category: 'journey',
    };
  },
  daily_drop: (data) => ({
    title: "Today's challenge is here",
    body: `${data.challengeTitle || 'A new daily challenge'} is waiting for you. Complete it for bonus points!`,
    category: 'challenge',
  }),
  milestone_achieved: (data) => ({
    title: 'Milestone unlocked',
    body: `You just hit ${data.milestoneName || 'a new milestone'}! Your dedication is paying off.`,
    category: 'celebration',
  }),
  circle_invite_received: (data) => ({
    title: "You've been invited",
    body: `${data.friendName || 'Someone'} invited you to join "${data.circleName || 'a FitCircle'}". Check it out!`,
    category: 'social',
  }),

  // ---- Circle Chat ----
  chat_message: (data) => ({
    title: `${data.friendName || 'Someone'} in ${data.circleName || 'your circle'}${otherCirclesSuffix(data)}`,
    body: data.preview || 'sent a message',
    category: 'social',
  }),
  chat_mention: (data) => ({
    title: `${data.friendName || 'Someone'} mentioned you`,
    body: data.preview || 'mentioned you in the chat',
    category: 'social',
  }),
  // One circle: "Big moment in <circle>" / the post. The same event posted to
  // several circles the recipient shares: the achievement is the title and the
  // body names where to celebrate (ChatNotificationService.planEventPushes).
  chat_rally: (data) =>
    (data.otherCircleCount ?? 0) > 0
      ? {
          title: stripEmoji(String(data.headline || data.body || 'Something worth celebrating just happened!')),
          body: `Celebrate in ${data.circleName || 'your circle'}${otherCirclesSuffix(data)}`,
          category: 'celebration',
        }
      : {
          title: `Big moment in ${data.circleName || 'your circle'}`,
          body: stripEmoji(String(data.body || 'Something worth celebrating just happened!')),
          category: 'celebration',
        },
  // Someone reacted to a message you posted (or a meal/streak card about you).
  chat_reaction: (data) => ({
    title: `${data.friendName || 'Someone'} reacted ${data.emoji || ''}`.trim(),
    body: data.preview ? `to "${data.preview}"` : 'to your message',
    category: 'social',
  }),

  // Copy is built per recipient by DailySummaryService.planSummaryPushes.
  circle_daily_summary: (data) => ({
    title: String(data.title || 'Your circles today'),
    body: String(data.body || 'See how your circles did today.'),
    category: 'social',
  }),

  // ---- Referrals (docs/REFERRALS_SPEC.md §9.3) ----
  referral_friend_joined: (data) => ({
    title: `${data.friendName || 'Your friend'} just joined FitCircle`,
    body: 'Your invite worked! Once they check in on 3 days, you both get a free week of Pro.',
    category: 'social',
  }),
  referral_reward_earned: (data) => ({
    title: 'You both just earned a free week of Pro',
    body: `${data.friendName || 'Your friend'} checked in for the third day. Invite another friend for another free week.`,
    category: 'celebration',
  }),
  referral_reward_banked: (data) => ({
    title: `+${data.days || 7} days of Pro banked`,
    body: `${data.friendName || 'Your friend'} checked in! Your free week kicks in when your current plan ends. Invite another friend for more.`,
    category: 'celebration',
  }),
  referral_lifetime: () => ({
    title: 'Lifetime Pro unlocked',
    body: '100 friends moving because of you. Pro is yours, forever.',
    category: 'celebration',
  }),
  referral_invitee_welcome: (data) => ({
    title: `You and ${data.inviterName || 'your friend'} just earned a free week of Pro`,
    body: 'Thanks for showing up! Invite your own friends: every one who checks in earns you another week.',
    category: 'celebration',
  }),
  referral_progress: (data) => ({
    title: 'One more check-in to unlock Pro',
    body: `Check in tomorrow and you and ${data.inviterName || 'your friend'} both unlock a free week of Pro.`,
    category: 'celebration',
  }),
  circle_streak_saved: (data) => ({
    title: `${data.friendName || 'A friend'} covered for you today`,
    body: `Your ${data.circleName || 'circle'} streak is safe. Pay it forward when someone needs it.`,
    category: 'circle',
  }),
  circle_streak_milestone: (data) => ({
    title: `${data.circleName || 'Your circle'} hit a ${data.streakDays || 0}-day streak`,
    body: 'Most of you showed up every single day. Keep it rolling.',
    category: 'circle',
  }),
  circle_kickoff: (data) => ({
    title: data.kickoffReason === 'full' ? `Your crew is in! ${data.circleName || 'Your circle'} starts now` : `${data.circleName || 'Your circle'} starts now`,
    body: data.kickoffReason === 'full' ? 'Log something today to get the circle streak going.' : 'Seats stay open, so keep inviting friends. Log something today to get the streak going.',
    category: 'circle',
  }),
  // Copy is authored per campaign and rendered (placeholders filled) by
  // CampaignDeliveryService before it gets here.
  campaign: (data) => ({
    title: stripEmoji(String(data.title || 'FitCircle')) || 'FitCircle',
    body: stripEmoji(String(data.body || '')),
    category: 'challenge',
  }),
  referral_nudge: (data) => ({
    title: `${data.inviterName || 'Your friend'} is cheering you on`,
    body: 'Check in today. 3 days of check-ins and you both get a free week of Pro.',
    category: 'social',
  }),

  // ---- Fitzy coaching tips (docs/FITZY_PUSH_NOTIFICATIONS.md) ----
  // Copy is generated / templated and lock-screen-checked by FitzyPushService (lib/fitzy/push.ts);
  // these defaults only apply if a caller omits it.
  fitzy_daily_focus: (data) => ({
    title: stripEmoji(String(data.title || "Today's focus from Fitzy")),
    body: stripEmoji(String(data.body || 'One small, doable idea for today is waiting for you.')),
    category: 'coach',
  }),
  fitzy_weekly_recap: (data) => ({
    title: stripEmoji(String(data.title || 'Your week with Fitzy')),
    body: stripEmoji(String(data.body || 'Your weekly recap is ready. See what went well and what to carry into next week.')),
    category: 'coach',
  }),
  fitzy_weekly_plan: (data) => ({
    title: stripEmoji(String(data.title || 'Plan your week with Fitzy')),
    body: stripEmoji(String(data.body || 'Turn one goal into a few small, doable steps for this week.')),
    category: 'coach',
  }),
  fitzy_hydration_nudge: (data) => ({
    title: stripEmoji(String(data.title || 'Water break?')),
    body: stripEmoji(String(data.body || 'A glass now makes the afternoon easier. Log it in a tap.')),
    category: 'coach',
  }),
  fitzy_protein_nudge: (data) => ({
    title: stripEmoji(String(data.title || 'A protein boost for later')),
    body: stripEmoji(String(data.body || 'A protein-rich snack you enjoy could round out your afternoon.')),
    category: 'coach',
  }),
  fitzy_intro: (data) => ({
    title: stripEmoji(String(data.title || 'Meet Fitzy, your coach')),
    body: stripEmoji(String(data.body || 'Ask me anything about your meals: what is working, and one easy idea to try next.')),
    category: 'coach',
  }),
  // Approved copy (ONBOARDING_V2_EXPERIMENT_SPEC §3.2) — the paywall timeline promises it.
  trial_ending_reminder: () => ({
    title: 'Your trial ends tomorrow',
    body: 'Your FitCircle Pro trial ends tomorrow. Keep it, or cancel anytime in Settings → Subscriptions.',
    category: 'journey',
  }),
};

/** " and 2 other circles" for a cross-circle coalesced push; "" otherwise. */
function otherCirclesSuffix(data: NotificationData): string {
  const n = Math.max(0, Math.floor(Number(data.otherCircleCount) || 0));
  if (n === 0) return '';
  return ` and ${n} other circle${n === 1 ? '' : 's'}`;
}

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
  'chat_reaction',
];

// ============================================================================
// DUPLICATE + BURST GUARDS (docs/PUSH_NOTIFICATIONS.md §3–§4)
// ============================================================================

/** A delivered push with the same (user, dedupeKey) inside this window blocks a resend. */
export const DEDUPE_WINDOW_HOURS = 24;
/** Identical (type, title, body) to the same user inside this window is a duplicate. */
export const IDENTICAL_CONTENT_WINDOW_MINUTES = 10;
/** Burst control: at most BURST_LIMIT social/celebration pushes per BURST_WINDOW_MINUTES. */
export const BURST_WINDOW_MINUTES = 2;
export const BURST_LIMIT = 3;
/**
 * Ambient social / celebration traffic subject to burst control. Direct
 * @mentions, outcomes (rewards, streak loss) and reminders are never dropped
 * for a burst.
 */
export const BURST_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'chat_message',
  'chat_rally',
  'chat_reaction',
  'circle_daily_summary',
  'circle_streak_milestone',
  'perfect_day',
  'circle_boost_threshold',
  'friend_joined_circle',
]);

/** APNs rejects an `apns-collapse-id` over 64 bytes. */
export const APNS_COLLAPSE_ID_MAX_BYTES = 64;

/**
 * The `apns-collapse-id` / Android `tag` for a dedupe key: the key itself when
 * it is short printable ASCII, else a stable 64-char sha256 hex digest. Pure.
 */
export function collapseIdFor(dedupeKey: string | null | undefined): string | undefined {
  if (!dedupeKey) return undefined;
  if (/^[\x21-\x7e]+$/.test(dedupeKey) && dedupeKey.length <= APNS_COLLAPSE_ID_MAX_BYTES) {
    return dedupeKey;
  }
  return createHash('sha256').update(dedupeKey).digest('hex').slice(0, APNS_COLLAPSE_ID_MAX_BYTES);
}

/**
 * Notification-centre grouping (APNs `thread-id`; also `groupKey` in FCM data):
 * one thread per circle for chat, one per category for everything else. Pure.
 */
export function threadIdFor(type: NotificationType, category: string, data: NotificationData): string {
  if (CHAT_NOTIFICATION_TYPES.includes(type)) return data.circleId ? String(data.circleId) : '';
  return `fitcircle.${category}`;
}

/**
 * In-process half of the duplicate guard. Concurrent fan-outs inside one
 * request (or one warm serverless instance) all read an empty notification_log
 * before any of them has logged, so the DB check alone cannot stop them: the
 * first send claims the key here and every concurrent / later send with the
 * same key is a duplicate. The notification_log query is the cross-instance
 * backstop. Bounded and TTL'd; process-local by design.
 */
class InProcessSendGuard {
  private readonly claims = new Map<string, number>(); // key -> expiresAt
  private readonly bursts = new Map<string, number[]>(); // userId -> reservation times

  claim(key: string, ttlMs: number, now: number): boolean {
    const expiresAt = this.claims.get(key);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.claims.set(key, now + ttlMs);
    if (this.claims.size > 10_000) this.prune(now);
    return true;
  }

  release(key: string): void {
    this.claims.delete(key);
  }

  burstCount(userId: string, windowMs: number, now: number): number {
    const times = (this.bursts.get(userId) ?? []).filter((t) => t > now - windowMs);
    this.bursts.set(userId, times);
    return times.length;
  }

  reserveBurst(userId: string, now: number): void {
    this.bursts.set(userId, [...(this.bursts.get(userId) ?? []), now]);
  }

  releaseBurst(userId: string, at: number): void {
    const times = this.bursts.get(userId) ?? [];
    const i = times.indexOf(at);
    if (i >= 0) times.splice(i, 1);
  }

  reset(): void {
    this.claims.clear();
    this.bursts.clear();
  }

  private prune(now: number): void {
    for (const [k, exp] of this.claims) if (exp <= now) this.claims.delete(k);
    for (const [u, times] of this.bursts) if (times.every((t) => t <= now - 60 * 60 * 1000)) this.bursts.delete(u);
  }
}

const sendGuard = new InProcessSendGuard();

// Cap-exempt: chat (conversation traffic), the meal-slot reminders (decided
// 2026-09-13: "3 + meal reminders" — they never COUNT toward the cap, but since
// ACTIVATION_JOURNEY_SPEC §4 they are skipped once the cap is reached, see
// CAP_RESPECTING_EXEMPT_TYPES), and outcomes that report something
// that already happened to the user's streak or challenge — those must never
// be dropped in favour of a nudge sent earlier the same day.
export const CAP_EXEMPT_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  ...CHAT_NOTIFICATION_TYPES,
  'meal_reminder_breakfast',
  'meal_reminder_lunch',
  'meal_reminder_snack',
  'meal_reminder_dinner',
  'streak_lost',
  'shield_applied',
  'challenge_completed',
  // Referral outcomes: a reward the user earned must never lose to a nudge.
  'referral_friend_joined',
  'referral_reward_earned',
  'referral_reward_banked',
  'referral_lifetime',
  'referral_invitee_welcome',
  // A friend's explicit, rate-limited nudge (≤3 ever, 48h apart) — never dropped for a system nudge.
  'referral_nudge',
  // Sent once per referral, the day the friend is one check-in from their reward.
  'referral_progress',
  // Something a friend did for you / your crew is in — never dropped for a nudge.
  'circle_streak_saved',
  'circle_kickoff',
  // Replaces the per-circle chat_message summaries (which were chat, hence exempt).
  'circle_daily_summary',
  // Transactional trust message about money (ONBOARDING_V2 §3.2): never capped.
  'trial_ending_reminder',
]);

export function isCapExempt(type: NotificationType): boolean {
  return CAP_EXEMPT_TYPES.has(type);
}

/** Meal-slot reminder types (MealReminderService). */
export const MEAL_REMINDER_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'meal_reminder_breakfast',
  'meal_reminder_lunch',
  'meal_reminder_snack',
  'meal_reminder_dinner',
]);

/**
 * Exempt from COUNTING toward the daily cap, but still skipped once the cap
 * is reached (ACTIVATION_JOURNEY_SPEC §4: "skip … if the per-day push cap is hit").
 */
export const CAP_RESPECTING_EXEMPT_TYPES: ReadonlySet<NotificationType> = MEAL_REMINDER_TYPES;

/** Does the daily cap block this type (when reached)? */
export function isCapChecked(type: NotificationType): boolean {
  return !isCapExempt(type) || CAP_RESPECTING_EXEMPT_TYPES.has(type);
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
    const now = Date.now();
    const dedupeKey = typeof data.dedupeKey === 'string' && data.dedupeKey ? data.dedupeKey : undefined;

    // 0. Duplicate guard (docs/PUSH_NOTIFICATIONS.md §3). In-process claims
    //    first (race-safe for concurrent fan-outs), notification_log second
    //    (cross-instance backstop). A claim is held for the window once the push
    //    is delivered and released on any non-delivery so a later attempt can go.
    const claimKeys: string[] = [];
    const contentKey = `c:${userId}:${type}:${content.title}\u0000${content.body}`;
    if (!sendGuard.claim(contentKey, IDENTICAL_CONTENT_WINDOW_MINUTES * 60_000, now)) {
      await this.logNotification(userId, type, content, data, true, 'duplicate');
      return { sent: false, reason: 'duplicate' };
    }
    claimKeys.push(contentKey);
    if (dedupeKey) {
      const keyKey = `k:${userId}:${dedupeKey}`;
      if (!sendGuard.claim(keyKey, DEDUPE_WINDOW_HOURS * 3_600_000, now)) {
        sendGuard.release(contentKey);
        await this.logNotification(userId, type, content, data, true, 'duplicate');
        return { sent: false, reason: 'duplicate' };
      }
      claimKeys.push(keyKey);
    }

    let burstReservation: number | null = null;
    let delivered = false;
    try {
      if (await this.isDuplicate(userId, type, content, dedupeKey)) {
        await this.logNotification(userId, type, content, data, true, 'duplicate');
        return { sent: false, reason: 'duplicate' };
      }

      // 1. Check if user has this category enabled
      const isEnabled = await NotificationPreferencesService.isTypeEnabled(userId, type);
      if (!isEnabled) {
        await this.logNotification(userId, type, content, data, true, 'category_disabled');
        return { sent: false, reason: 'category_disabled' };
      }

      // 2. Check frequency cap (see CAP_EXEMPT_TYPES / CAP_RESPECTING_EXEMPT_TYPES)
      if (isCapChecked(type)) {
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

      // 4b. Burst control: the 4th+ ambient social/celebration push inside
      //     2 minutes is dropped (the in-app timeline still has everything).
      if (BURST_TYPES.has(type)) {
        if (await this.isBurst(userId, now)) {
          await this.logNotification(userId, type, content, data, true, 'burst');
          return { sent: false, reason: 'burst' };
        }
        sendGuard.reserveBurst(userId, now);
        burstReservation = now;
      }

      const sentCount = await PushService.sendPush(
        userId,
        await this.buildPushNotification(userId, type, data, content, dedupeKey)
      );

      // 6. Log the notification — truthfully. With no registered device (or
      //    no FCM credentials) nothing was delivered, and a "sent" log row
      //    would both mislead and count against the daily frequency cap.
      if (sentCount > 0) {
        delivered = true;
        await this.logNotification(userId, type, content, data, false);
        console.log(
          `[NotificationOrchestrator] Sent "${type}" to user ${userId} (${sentCount} devices)`
        );
        return { sent: true };
      }
      await this.logNotification(userId, type, content, data, true, 'no_delivery');
      return { sent: false, reason: 'no_delivery' };
    } finally {
      if (!delivered) {
        for (const key of claimKeys) sendGuard.release(key);
        if (burstReservation !== null) sendGuard.releaseBurst(userId, burstReservation);
      }
    }
  }

  /** Test hook: forget the in-process duplicate / burst state. */
  static resetInProcessGuards(): void {
    sendGuard.reset();
  }

  /**
   * notification_log backstop for the duplicate guard: a delivered row with the
   * same dedupeKey in 24 h, or identical (type, title, body) in 10 min. Fails
   * open (a DB hiccup must not silence every push). Works without migration
   * 109's index — that only makes the dedupeKey lookup cheap.
   */
  static async isDuplicate(
    userId: string,
    type: NotificationType,
    content: { title: string; body: string },
    dedupeKey?: string
  ): Promise<boolean> {
    const supabaseAdmin = createAdminSupabase();
    try {
      if (dedupeKey) {
        const since = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 3_600_000).toISOString();
        const { count, error } = await supabaseAdmin
          .from('notification_log')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('data->>dedupeKey', dedupeKey)
          .eq('suppressed', false)
          .gte('sent_at', since);
        if (error) console.error('[NotificationOrchestrator.isDuplicate] dedupeKey:', error);
        else if ((count || 0) > 0) return true;
      }
      const since = new Date(Date.now() - IDENTICAL_CONTENT_WINDOW_MINUTES * 60_000).toISOString();
      const { count, error } = await supabaseAdmin
        .from('notification_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('notification_type', type)
        .eq('title', content.title)
        .eq('body', content.body)
        .eq('suppressed', false)
        .gte('sent_at', since);
      if (error) {
        console.error('[NotificationOrchestrator.isDuplicate] content:', error);
        return false;
      }
      return (count || 0) > 0;
    } catch (err) {
      console.error('[NotificationOrchestrator.isDuplicate] failed open:', err);
      return false;
    }
  }

  /**
   * More than BURST_LIMIT burst-type pushes delivered (DB) or in flight
   * (in-process reservations) in the last BURST_WINDOW_MINUTES. The larger of
   * the two counts is used so rows this instance already logged are not
   * double-counted. Fails open.
   */
  static async isBurst(userId: string, now: number = Date.now()): Promise<boolean> {
    const windowMs = BURST_WINDOW_MINUTES * 60_000;
    const local = sendGuard.burstCount(userId, windowMs, now);
    if (local >= BURST_LIMIT) return true;
    try {
      const { count, error } = await createAdminSupabase()
        .from('notification_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('suppressed', false)
        .in('notification_type', [...BURST_TYPES])
        .gte('sent_at', new Date(now - windowMs).toISOString());
      if (error) {
        console.error('[NotificationOrchestrator.isBurst] Error:', error);
        return false;
      }
      return Math.max(local, count || 0) >= BURST_LIMIT;
    } catch {
      return false;
    }
  }

  /** The wire-level PushNotification for a send that passed every guard. */
  private static async buildPushNotification(
    userId: string,
    type: NotificationType,
    data: NotificationData,
    content: NotificationContent,
    dedupeKey: string | undefined
  ): Promise<PushNotification> {
    const isChatType = CHAT_NOTIFICATION_TYPES.includes(type);
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
    if (data.campaignSlug) pushData.campaignSlug = String(data.campaignSlug);
    // Meal-slot reminders: the slot, so 1.1.0 opens the logger preselected (older apps ignore it).
    if (MEAL_REMINDER_TYPES.has(type) && typeof data.mealType === 'string') pushData.mealType = data.mealType;
    // Fitzy chat context (the tip the push came from); clients render it as plain text.
    if (content.category === 'coach' && data.fitzyTip) {
      pushData.fitzyTip = [...String(data.fitzyTip)].slice(0, FITZY_TIP_DATA_MAX).join('');
    }

    if (isChatType) {
      // Chat wire contract: circleName + preview always; senderName except rallies.
      if (data.circleName) pushData.circleName = String(data.circleName);
      const senderName = data.senderName ?? data.friendName;
      if (senderName && type !== 'chat_rally') pushData.senderName = String(senderName);
      const preview = data.preview ?? data.body;
      if (preview) pushData.preview = String(preview);
      // Communication Notification sender (iOS service extension). Rallies have none.
      if (type !== 'chat_rally') {
        if (data.senderId) pushData.senderId = String(data.senderId);
        if (isHttpsUrl(data.senderAvatarUrl)) pushData.senderAvatarUrl = data.senderAvatarUrl;
      }
    }
    if (isHttpsUrl(data.imageUrl)) pushData.image_url = data.imageUrl;

    // Grouping / replace-instead-of-stack (docs/PUSH_NOTIFICATIONS.md §5).
    const threadId = threadIdFor(type, content.category, data);
    const collapseId = collapseIdFor(dedupeKey);
    if (collapseId) {
      // Data-only Android chat pushes are rendered by the app: give it the keys.
      pushData.dedupeKey = collapseId;
      pushData.groupKey = threadId || `fitcircle.${content.category}`;
    }

    // iOS rich presentation: category / mutable-content / interruption level /
    // relevance, plus the circle card for the Circle Ring content extension.
    const presentation = presentationFor(type, data);
    const custom: Record<string, unknown> = {};
    if (CIRCLE_CARD_TYPES.has(type) && data.circleId) {
      const card = await this.circleCardFor(String(data.circleId), userId, data.circleName);
      if (card && byteLength(card) + byteLength(pushData) <= APNS_PAYLOAD_BUDGET_BYTES) {
        custom.fc = card;
      }
    }

    return {
      title: content.title,
      body: content.body,
      data: pushData,
      // Chat pushes ride the data-only Android / alert+thread-id iOS shape.
      ...(isChatType ? { chat: { threadId } } : { threadId }),
      ...(collapseId ? { collapseId } : {}),
      ...(content.category === 'coach' ? { androidChannelId: ANDROID_COACH_CHANNEL_ID } : {}),
      apns: {
        category: presentation.category,
        mutableContent: presentation.mutableContent,
        interruptionLevel: presentation.interruptionLevel,
        relevanceScore: presentation.relevanceScore,
        ...(Object.keys(custom).length ? { custom } : {}),
      },
    };
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
   * The recipient's view of today's circle ring (member initials + check-in
   * states), or null — a missing card only costs the extension its ring, so
   * this never fails the send.
   */
  static async circleCardFor(
    circleId: string,
    recipientId: string,
    circleName?: string | null
  ): Promise<CircleCard | null> {
    try {
      const { CircleStreakService } = await import('./circle-streak-service');
      const view = await CircleStreakService.getStreak(circleId, recipientId);
      return buildCircleCard(view, recipientId, circleName);
    } catch (err: any) {
      console.warn('[NotificationOrchestrator.circleCardFor] skipped:', circleId, err?.message);
      return null;
    }
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
