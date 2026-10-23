// iOS rich-notification presentation for each notification type.
//
// Decides, per type, the APNs fields the iOS app's rich surfaces key off:
//   * aps.category          → which UNNotificationCategory (action buttons, and
//                             the FitCircleNotificationContent extension for
//                             CIRCLE_* / FRIEND_MISSED) the push uses;
//   * aps.mutable-content   → lets FitCircleNotificationService run (chat
//                             Communication Notifications, image attachments);
//   * aps.interruption-level→ time-sensitive for "your streak ends tonight",
//                             passive for low-value nudges;
//   * aps.relevance-score   → ordering inside a notification summary / stack.
// It also builds the compact `fc` circle card the content extension draws the
// Circle Ring from.
//
// Backward compatible by construction: an app build that does not register a
// category, has no extensions, or lacks the Time Sensitive entitlement simply
// ignores these keys (unknown category → plain banner; mutable-content with no
// service extension → original content; time-sensitive without entitlement →
// active). Android never sees any of it (these live under `apns` only).
//
// Pure module — no I/O — so the whole mapping is unit-tested.

import type { CircleStreakView } from '../types/circle-streak';

import type { NotificationData, NotificationType } from './notification-orchestrator';

export type ApnsCategory =
  | 'WATER_REMINDER'
  | 'STREAK_AT_RISK'
  | 'FRIEND_MISSED'
  | 'CIRCLE_CLOSED'
  | 'CIRCLE_UPDATE';

export type InterruptionLevel = 'passive' | 'active' | 'time-sensitive';

export interface ApnsPresentation {
  category?: ApnsCategory;
  interruptionLevel: InterruptionLevel;
  /** 0…1; higher sorts first in the summary / notification stack. */
  relevanceScore: number;
  mutableContent: boolean;
}

/**
 * Types that carry an iOS category. Must match the identifiers registered by
 * the app (FitCircle-iOS NotificationsShared/FitCircleNotificationCategory.swift).
 * There is no backend water-reminder or friend-missed type yet; those
 * categories are registered on iOS and wait for a generator.
 */
export const TYPE_APNS_CATEGORY: Partial<Record<NotificationType, ApnsCategory>> = {
  // "Log a meal" (opens the app) / "Remind me in 1 hour" (local reschedule).
  momentum_at_risk: 'STREAK_AT_RISK',
  // The circle hit the bar together → "Share".
  perfect_day: 'CIRCLE_CLOSED',
  circle_streak_milestone: 'CIRCLE_CLOSED',
  // Circle state changes → Circle Ring content extension, no buttons.
  circle_boost_threshold: 'CIRCLE_UPDATE',
  circle_streak_saved: 'CIRCLE_UPDATE',
  circle_kickoff: 'CIRCLE_UPDATE',
};

/** Types that get the circle card (`fc`) for the Circle Ring extension. */
export const CIRCLE_CARD_TYPES: ReadonlySet<NotificationType> = new Set(
  (Object.keys(TYPE_APNS_CATEGORY) as NotificationType[]).filter((t) =>
    (TYPE_APNS_CATEGORY[t] ?? '').startsWith('CIRCLE_')
  )
);

/** Breaks through Focus / scheduled summary (needs the Time Sensitive entitlement). */
export const TIME_SENSITIVE_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'momentum_at_risk',
]);

/**
 * Low-value nudges: delivered quietly to the notification list (no sound,
 * no screen wake). Re-engagement (dormant / win-back) stays active on purpose —
 * a passive win-back is a win-back nobody sees. Weekly summary and referral
 * progress stay audible (product decision 2026-10-23).
 *
 * Reversible without a code change (Vercel env, takes effect on redeploy):
 *   PUSH_PASSIVE_ENABLED=false   → every type is delivered with sound again
 *   PUSH_PASSIVE_TYPES=a,b,c     → replaces this default list (empty = none)
 */
export const DEFAULT_PASSIVE_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'day14_challenge_nudge',
  'day30_monthly_recap',
  'daily_drop',
  'challenge_halfway',
]);

type Env = Record<string, string | undefined>;
const OFF = new Set(['0', 'false', 'off', 'no']);

/** The types delivered passively right now (see DEFAULT_PASSIVE_TYPES for the env overrides). */
export function passiveTypes(env: Env = process.env): ReadonlySet<NotificationType> {
  if (OFF.has((env.PUSH_PASSIVE_ENABLED ?? '').trim().toLowerCase())) return new Set();
  const raw = env.PUSH_PASSIVE_TYPES;
  if (raw === undefined) return DEFAULT_PASSIVE_TYPES;
  return new Set(
    raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean) as NotificationType[]
  );
}

/** Chat types whose sender becomes a Communication Notification (not rallies: no sender). */
export const COMMUNICATION_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'chat_message',
  'chat_mention',
  'chat_reaction',
]);

const RELEVANCE: Partial<Record<NotificationType, number>> = {
  momentum_at_risk: 0.9,
  chat_mention: 0.85,
  circle_streak_saved: 0.8,
  perfect_day: 0.75,
  circle_streak_milestone: 0.75,
  streak_lost: 0.7,
  shield_applied: 0.7,
  chat_message: 0.6,
  chat_reaction: 0.4,
};

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1024) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function presentationFor(type: NotificationType, data: NotificationData = {}, env: Env = process.env): ApnsPresentation {
  const interruptionLevel: InterruptionLevel = TIME_SENSITIVE_TYPES.has(type)
    ? 'time-sensitive'
    : passiveTypes(env).has(type)
      ? 'passive'
      : 'active';
  const relevanceScore =
    RELEVANCE[type] ?? (interruptionLevel === 'passive' ? 0.2 : 0.5);
  const hasSender = COMMUNICATION_TYPES.has(type) && !!(data.senderName ?? data.friendName);
  return {
    category: TYPE_APNS_CATEGORY[type],
    interruptionLevel,
    relevanceScore,
    mutableContent: hasSender || isHttpsUrl(data.imageUrl),
  };
}

// ============================================================================
// Circle card (`fc` in the APNs payload)
// ============================================================================

export const CIRCLE_CARD_MAX_MEMBERS = 8;

export type CircleCardMemberState = 'in' | 'saved' | 'out';

export interface CircleCard {
  v: 1;
  circleId: string;
  name?: string;
  streak: number;
  checkedIn: number;
  total: number;
  needed: number;
  closed: boolean;
  members: Array<{ initials: string; state: CircleCardMemberState; me?: true }>;
}

/** "Sam Lee" → "SL", "sam" → "SA", "" → "?". Two characters, upper-case. */
export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters =
    words.length > 1
      ? [...words[0]][0] + [...words[words.length - 1]][0]
      : [...words[0]].slice(0, 2).join('');
  return letters.toLocaleUpperCase('en-US');
}

/**
 * Build the compact card from the recipient's circle streak view. The user's
 * own segment is always kept when the circle is bigger than 8 (it is drawn
 * thicker); counts stay true to the whole circle.
 */
export function buildCircleCard(
  view: CircleStreakView,
  recipientId: string,
  circleName?: string | null
): CircleCard {
  const all = view.today.members.map((m) => ({
    initials: initialsFor(m.displayName),
    state: (m.logged ? 'in' : m.covered ? 'saved' : 'out') as CircleCardMemberState,
    me: m.userId === recipientId,
  }));
  let shown = all.slice(0, CIRCLE_CARD_MAX_MEMBERS);
  const mine = all.find((m) => m.me);
  if (mine && !shown.includes(mine)) shown = [...shown.slice(0, CIRCLE_CARD_MAX_MEMBERS - 1), mine];
  const name = (circleName ?? '').trim();
  return {
    v: 1,
    circleId: view.fitcircleId,
    ...(name ? { name: name.length > 40 ? `${name.slice(0, 39)}…` : name } : {}),
    streak: view.currentStreak,
    checkedIn: view.today.loggedCount,
    total: view.today.activeCount,
    needed: view.today.needed,
    closed: view.today.activeCount > 0 && view.today.loggedCount >= view.today.activeCount,
    members: shown.map((m) => ({ initials: m.initials, state: m.state, ...(m.me ? { me: true as const } : {}) })),
  };
}

/** APNs caps the whole payload at 4096 bytes; keep our share well under it. */
export const APNS_PAYLOAD_BUDGET_BYTES = 3500;

export function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
