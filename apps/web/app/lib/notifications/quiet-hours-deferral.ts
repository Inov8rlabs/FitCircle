/**
 * Quiet hours HOLD nudges instead of dropping them (retention fix 2, 2026-11-09). PURE.
 *
 * Before: NotificationOrchestrator.send logged a deferrable nudge that hit quiet
 * hours as suppressed ('quiet_hours') and returned. Meal reminders were then
 * "attempted" for the day (gone); the onboarding nudge released its claim and
 * re-tried every 15 minutes all night (335 suppressed rows for 21 deliveries).
 *
 * Now, for DEFERRABLE_TYPES only:
 *   1. send() logs ONE row: suppressed = true, suppression_reason =
 *      'deferred_quiet_hours', data.deferUntil = the end of the user's quiet
 *      window (their local time), data.deferExpiresAt = the last moment the
 *      nudge is still worth sending. It returns { sent: false, reason: 'deferred' }.
 *   2. DeferredNudgeService.releaseDue (every 15 min, inside the meal-reminders
 *      cron) picks AT MOST ONE due row per user, re-checks that it still makes
 *      sense, and sends it through send() again with data.deferredRelease = true
 *      (prefs, the daily cap and the dedupe key are applied again then). Every
 *      other due row for that user is closed as superseded, so a morning never
 *      starts with a stack of held pushes.
 *
 * Row outcomes (suppression_reason, the row stays suppressed = true; the real
 * send writes its own log row): deferred_released | deferred_superseded |
 * deferred_expired | deferred_stale (precondition failed, e.g. onboarding done).
 */
import type { NotificationType } from '@/lib/services/notification-orchestrator';

import { localClockIn } from './user-timezone';

export const DEFERRED_REASON = 'deferred_quiet_hours';
export type DeferredOutcome = 'deferred_released' | 'deferred_superseded' | 'deferred_expired' | 'deferred_stale';

/** Nudges worth holding until morning, highest release priority first. */
export const DEFERRABLE_PRIORITY: readonly NotificationType[] = [
  'day1_morning',
  'onboarding_finish_reminder',
  'meal_reminder_breakfast',
  'meal_reminder_lunch',
  'meal_reminder_snack',
  'meal_reminder_dinner',
];
export const DEFERRABLE_TYPES: ReadonlySet<NotificationType> = new Set(DEFERRABLE_PRIORITY);

export const isDeferrable = (type: NotificationType) => DEFERRABLE_TYPES.has(type);

const MEAL_TYPES = new Set<NotificationType>(['meal_reminder_breakfast', 'meal_reminder_lunch', 'meal_reminder_snack', 'meal_reminder_dinner']);

/** How long after quiet hours end a held nudge may still go out. */
export const RELEASE_WINDOW_MINUTES: Partial<Record<NotificationType, number>> = {
  day1_morning: 3 * 60,
  onboarding_finish_reminder: 6 * 60,
};
const MEAL_RELEASE_WINDOW_MINUTES = 2 * 60;

/** A user who got a released nudge this recently gets no second one (one per morning). */
export const ONE_RELEASE_PER_HOURS = 12;
/** Held rows older than this are never looked at again (and expire). */
export const DEFERRED_LOOKBACK_HOURS = 24;

const parseHm = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * When the quiet window that contains `now` ends, as an instant. `start`/`end`
 * are "HH:MM[:SS]" in `tz`. Assumes `now` is inside the window.
 */
export function quietHoursEndAt(now: Date, tz: string, end: string): Date {
  const { minutes } = localClockIn(now, tz);
  const delta = (parseHm(end) - minutes + 1440) % 1440;
  const floorToMinute = now.getTime() - (now.getTime() % 60_000);
  return new Date(floorToMinute + delta * 60_000);
}

export interface DeferralPlan {
  deferUntil: string;
  deferExpiresAt: string;
}

/**
 * The hold for a nudge that hit quiet hours, or null when it should be dropped
 * as before (not deferrable, or a meal slot whose day is over by morning).
 */
export function planDeferral(type: NotificationType, now: Date, tz: string, quietEnd: string): DeferralPlan | null {
  if (!isDeferrable(type)) return null;
  const until = quietHoursEndAt(now, tz, quietEnd);
  if (MEAL_TYPES.has(type)) {
    // A meal reminder only makes sense on its own local day (no dinner reminder at breakfast).
    if (localClockIn(until, tz).date !== localClockIn(now, tz).date) return null;
    return { deferUntil: until.toISOString(), deferExpiresAt: new Date(until.getTime() + MEAL_RELEASE_WINDOW_MINUTES * 60_000).toISOString() };
  }
  const window = RELEASE_WINDOW_MINUTES[type] ?? 3 * 60;
  return { deferUntil: until.toISOString(), deferExpiresAt: new Date(until.getTime() + window * 60_000).toISOString() };
}

export interface DeferredRow {
  id: string;
  user_id: string;
  notification_type: NotificationType;
  sent_at: string;
  data: Record<string, any> | null;
}

export interface ReleasePlan {
  release: DeferredRow | null;
  close: Array<{ row: DeferredRow; outcome: DeferredOutcome }>;
  /** Not due yet: left untouched. */
  waiting: DeferredRow[];
}

const priority = (t: NotificationType) => {
  const i = DEFERRABLE_PRIORITY.indexOf(t);
  return i === -1 ? DEFERRABLE_PRIORITY.length : i;
};

/**
 * One user's held rows → at most one release. `releasedRecently` = this user
 * already had a held nudge released in the last ONE_RELEASE_PER_HOURS.
 */
export function planRelease(rows: readonly DeferredRow[], now: Date, releasedRecently: boolean): ReleasePlan {
  const t = now.getTime();
  const plan: ReleasePlan = { release: null, close: [], waiting: [] };
  const due: DeferredRow[] = [];
  for (const row of rows) {
    const until = Date.parse(String(row.data?.deferUntil ?? ''));
    const expires = Date.parse(String(row.data?.deferExpiresAt ?? ''));
    if (!Number.isFinite(until) || !Number.isFinite(expires) || t >= expires) {
      plan.close.push({ row, outcome: 'deferred_expired' });
    } else if (t < until) {
      plan.waiting.push(row);
    } else {
      due.push(row);
    }
  }
  if (due.length === 0) return plan;
  // Highest priority; the most recently held one within a type.
  due.sort((a, b) => priority(a.notification_type) - priority(b.notification_type) || (a.sent_at < b.sent_at ? 1 : a.sent_at > b.sent_at ? -1 : 0));
  const [first, ...rest] = due;
  if (releasedRecently) {
    plan.close.push(...due.map((row) => ({ row, outcome: 'deferred_superseded' as const })));
    return plan;
  }
  plan.release = first;
  plan.close.push(...rest.map((row) => ({ row, outcome: 'deferred_superseded' as const })));
  // Rows still waiting would land later the same morning: one per morning, so close them too.
  plan.close.push(...plan.waiting.map((row) => ({ row, outcome: 'deferred_superseded' as const })));
  plan.waiting = [];
  return plan;
}
