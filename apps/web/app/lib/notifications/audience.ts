/**
 * Who may receive which push, by lifecycle stage and real-vs-test account
 * (docs/PUSH_NOTIFICATIONS.md §8). PURE — the orchestrator applies it in
 * send(), so every caller (crons, hooks, fan-outs) gets the same rules.
 *
 * Suppression reasons (notification_log.suppression_reason / Push Sent):
 *   test_user    internal, review, robot (Play pre-launch / Test Lab), QA or
 *                X-Test-Device account: no non-transactional pushes at all.
 *   dormant_user > 30 local days since the last foreground use: only
 *                transactional pushes (and a health-sync update, §8.5).
 *   lapsed_user  3–30 days: daily habit nudges stop (meal reminders,
 *                momentum_at_risk, Fitzy tips …); the win-back ladder runs instead.
 *   not_lapsed   a win-back step for a user who came back before it was sent.
 */
import { classifyTestUser, type TestUserReason } from '../ads/test-users';
import type { NotificationType } from '../services/notification-orchestrator';

import { isLapsed, type LifecycleStage } from './lifecycle';

export type AudienceSuppression = 'test_user' | 'dormant_user' | 'lapsed_user' | 'not_lapsed';

export type AudienceTestReason = TestUserReason | 'test_device';

/**
 * Messages a person or the account itself caused: a circle member's chat,
 * a mention, reaction or cheer, an invite from a friend, money and Pro status,
 * referral rewards. Never gated by stage or test status.
 */
export const TRANSACTIONAL_AUDIENCE_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'chat_message',
  'chat_mention',
  'chat_reaction',
  'chat_cheer',
  'circle_invite_received',
  'trial_ending_reminder',
  'pro_expiring_reminder',
  'pro_expired',
  'referral_reward_earned',
  'referral_reward_banked',
  'referral_lifetime',
  'referral_invitee_welcome',
]);

/** Daily habit nudges: only for active users (§8.3). */
export const HABIT_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'momentum_at_risk',
  'near_milestone',
  'reset_encouragement',
  'meal_reminder_breakfast',
  'meal_reminder_lunch',
  'meal_reminder_snack',
  'meal_reminder_dinner',
  'fitzy_daily_focus',
  'fitzy_hydration_nudge',
  'fitzy_protein_nudge',
  'fitzy_weekly_recap',
  'fitzy_weekly_plan',
  'daily_drop',
]);

export const WINBACK_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'winback_day3',
  'winback_day7',
  'winback_day14',
  'winback_day30',
]);

/** Sent to dormant users too (a phone that still syncs is a strong win-back signal; §8.5). */
const DORMANT_ALLOWED_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>(['health_sync_update']);

export interface AudienceFacts {
  testReason: AudienceTestReason | null;
  /** Null when nothing is known: no lifecycle gating (fail open). */
  stage: LifecycleStage | null;
}

export function isTransactionalAudience(type: NotificationType): boolean {
  return TRANSACTIONAL_AUDIENCE_TYPES.has(type);
}

/** Why `type` must not go to this user, or null. */
export function audienceSuppression(type: NotificationType, facts: AudienceFacts): AudienceSuppression | null {
  if (isTransactionalAudience(type)) return null;
  if (facts.testReason) return 'test_user';
  const stage = facts.stage;
  if (WINBACK_TYPES.has(type)) return isLapsed(stage) ? null : stage === 'dormant' ? 'dormant_user' : stage === null ? null : 'not_lapsed';
  if (stage === 'dormant' && !DORMANT_ALLOWED_TYPES.has(type)) return 'dormant_user';
  if (isLapsed(stage) && HABIT_TYPES.has(type)) return 'lapsed_user';
  return null;
}

export interface TestAccountInput {
  email: string | null | undefined;
  isAdmin?: boolean | null;
  /** user_attribution.is_test (Apple's mock AdServices payload). */
  mockAttribution?: boolean;
  /** profiles.metadata (test_device is set from the X-Test-Device header). */
  metadata?: Record<string, unknown> | null;
}

/** The Ads Console / PMF rules (lib/ads/test-users.ts) plus profiles.metadata.test_device. */
export function testAccountReason(input: TestAccountInput, env: Record<string, string | undefined> = process.env): AudienceTestReason | null {
  const reason = classifyTestUser({ email: input.email, isAdmin: input.isAdmin, mockAttribution: input.mockAttribution }, env);
  if (reason) return reason;
  return input.metadata && (input.metadata as { test_device?: unknown }).test_device ? 'test_device' : null;
}
