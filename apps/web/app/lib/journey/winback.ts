/**
 * Win-back ladder for lapsed users (docs/PUSH_NOTIFICATIONS.md §8.4). PURE.
 *
 *   stage       step    angle                                         screen
 *   lapsed_3    day3    free meal scans left (free users with N ≥ 1),  food_log (+ route log_meal_camera)
 *                       else "log tonight" (Pro / trial / 0 left)
 *   lapsed_7    day7    what their circle did this week (real counts    circle_detail, else dashboard
 *                       from a live private circle), else a plain restart
 *   lapsed_14   day14   their own logged history (days logged, best     dashboard
 *                       streak), else a plain restart
 *   lapsed_30   day30   the live seasonal campaign, else a feature      campaign, else dashboard
 *                       highlight
 *
 * Rules (selectWinbackStep):
 *   - one step per lapse episode, keyed on (user, step, last-seen local date);
 *   - a step whose stage band is still current may be sent on any day of the
 *     band (a day-3 step blocked by quiet hours goes on day 4), never later;
 *   - at most one win-back push per WINBACK_MIN_SPACING_HOURS;
 *   - a leaderboard_overtaken or health_sync_update push delivered in the last
 *     REPLACED_WINDOW_HOURS counts as that day's touch: the step waits a day;
 *   - sent in the user's local evening window (SEND_WINDOW).
 * No emoji, no invented numbers: every number is the user's own data.
 */
import type { Lifecycle, LifecycleStage } from '../notifications/lifecycle';

export type WinbackStep = 'day3' | 'day7' | 'day14' | 'day30';
export type WinbackType = 'winback_day3' | 'winback_day7' | 'winback_day14' | 'winback_day30';

export const WINBACK_STEPS: readonly WinbackStep[] = ['day3', 'day7', 'day14', 'day30'];

export const STEP_FOR_STAGE: Partial<Record<LifecycleStage, WinbackStep>> = {
  lapsed_3: 'day3',
  lapsed_7: 'day7',
  lapsed_14: 'day14',
  lapsed_30: 'day30',
};

export const typeForStep = (step: WinbackStep): WinbackType => `winback_${step}` as WinbackType;

/** Local send window [start, end) in minutes since midnight. The cron ticks hourly at :30 → 18:30 local. */
export const SEND_WINDOW = { start: 18 * 60, end: 19 * 60 };
export const WINBACK_MIN_SPACING_HOURS = 44;
export const REPLACED_WINDOW_HOURS = 20;

export type WinbackSkip =
  | 'not_lapsed'
  | 'unknown_stage'
  | 'test_user'
  | 'outside_window'
  | 'already_sent'
  | 'spacing'
  | 'replaced_by_trigger';

export interface WinbackHistory {
  /** Steps delivered in THIS lapse episode (data.lapseStart = lifecycle.lastSeenLocalDate). */
  sentSteps: ReadonlySet<WinbackStep>;
  /** Last delivered win-back push of any step, any episode. */
  lastWinbackAt: string | null;
  /** Last delivered leaderboard_overtaken / health_sync_update. */
  lastTriggerAt: string | null;
}

export function selectWinbackStep(input: {
  lifecycle: Lifecycle | null;
  testUser: boolean;
  localMinutes: number;
  history: WinbackHistory;
  now: Date;
  ignoreWindow?: boolean;
}): { step: WinbackStep } | { skip: WinbackSkip } {
  if (input.testUser) return { skip: 'test_user' };
  if (!input.lifecycle) return { skip: 'unknown_stage' };
  const step = STEP_FOR_STAGE[input.lifecycle.stage];
  if (!step) return { skip: 'not_lapsed' };
  if (!input.ignoreWindow && (input.localMinutes < SEND_WINDOW.start || input.localMinutes >= SEND_WINDOW.end)) return { skip: 'outside_window' };
  if (input.history.sentSteps.has(step)) return { skip: 'already_sent' };
  const within = (iso: string | null, hours: number) => !!iso && input.now.getTime() - Date.parse(iso) < hours * 3_600_000;
  if (within(input.history.lastWinbackAt, WINBACK_MIN_SPACING_HOURS)) return { skip: 'spacing' };
  if (within(input.history.lastTriggerAt, REPLACED_WINDOW_HOURS)) return { skip: 'replaced_by_trigger' };
  return { step };
}

/** Idempotency key for one step of one lapse episode. */
export function winbackDedupeKey(step: WinbackStep, lapseStart: string): string {
  return `winback:${step}:${lapseStart}`;
}

export interface WinbackCopy {
  title: string;
  body: string;
  screen: 'food_log' | 'circle_detail' | 'circles' | 'dashboard' | 'campaign';
  /** Which angle the copy took (logged in notification_log.data.variant). */
  variant: string;
  circleId?: string;
  campaignSlug?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- day 3 -----------------------------------------------------------------

/**
 * scansLeft: remaining lifetime free AI meal scans for a FREE user with the
 * gate live; null for Pro / trial / gate dark (no allowance to talk about).
 */
export function day3Copy(input: { scansLeft: number | null; isPro: boolean }): WinbackCopy {
  if (!input.isPro && typeof input.scansLeft === 'number' && input.scansLeft >= 1) {
    return {
      title: "Snap tonight's dinner",
      body: `You have ${plural(input.scansLeft, 'free meal scan')} left. Take a photo and FitCircle does the counting.`,
      screen: 'food_log',
      variant: 'scans_left',
    };
  }
  if (input.isPro || input.scansLeft === null) {
    return {
      title: "Snap tonight's dinner",
      body: 'Take a photo and FitCircle does the counting. Two taps and you are back on track.',
      screen: 'food_log',
      variant: 'two_taps',
    };
  }
  // A free user with no scans left: never promise a photo scan.
  return {
    title: "Log tonight's dinner",
    body: 'Search it or pick a recent meal. A few seconds and you are back on track.',
    screen: 'food_log',
    variant: 'manual_log',
  };
}

// ---- day 7 -----------------------------------------------------------------

export interface CircleWeek {
  circleId: string;
  circleName: string;
  /** Other REAL members with ≥ 1 check-in day in the last 7 days. */
  activeOthers: number;
  /** The most active of them (display name as the leaderboard shows it) and their days. */
  top: { name: string; days: number } | null;
}

export function day7Copy(week: CircleWeek | null): WinbackCopy {
  if (week && week.activeOthers >= 1 && week.top && week.top.days >= 1 && week.top.name.trim()) {
    const name = week.top.name.trim();
    const who =
      week.activeOthers === 1
        ? `${name} checked in on ${plural(week.top.days, 'day')} this week.`
        : `${name} and ${plural(week.activeOthers - 1, 'other')} checked in this week.`;
    return {
      title: `This week in ${week.circleName}`,
      body: `${who} One log tonight puts you back on the board.`,
      screen: 'circle_detail',
      circleId: week.circleId,
      variant: 'circle_week',
    };
  }
  return {
    title: 'Pick up where you left off',
    body: 'A week away is nothing. One log tonight gets you going again.',
    screen: 'dashboard',
    variant: 'restart',
  };
}

// ---- day 14 ----------------------------------------------------------------

export function day14Copy(input: { daysLogged: number; longestStreak: number }): WinbackCopy {
  if (input.daysLogged >= 2) {
    return {
      title: 'Ready for a fresh start?',
      body: `You have logged meals on ${plural(input.daysLogged, 'day')} so far. One log today adds the next.`,
      screen: 'dashboard',
      variant: 'days_logged',
    };
  }
  if (input.longestStreak >= 3) {
    return {
      title: 'Ready for a fresh start?',
      body: `Your best streak is ${plural(input.longestStreak, 'day')}. Today can be day 1 of the next one.`,
      screen: 'dashboard',
      variant: 'best_streak',
    };
  }
  return {
    title: 'Ready for a fresh start?',
    body: 'One meal or workout logged today starts a new streak.',
    screen: 'dashboard',
    variant: 'restart',
  };
}

// ---- day 30 ----------------------------------------------------------------

export function day30Copy(campaign: { slug: string; title: string; tagline?: string | null } | null): WinbackCopy {
  if (campaign && campaign.slug && campaign.title.trim()) {
    const tagline = (campaign.tagline ?? '').trim();
    return {
      title: `${campaign.title.trim()} is on`,
      body: tagline ? tagline.slice(0, 120) : 'Join in from the app. It takes one tap.',
      screen: 'campaign',
      campaignSlug: campaign.slug,
      variant: 'campaign',
    };
  }
  return {
    title: 'Still here when you are ready',
    body: 'Your food log and your circles are right where you left them. One log picks it back up.',
    screen: 'dashboard',
    variant: 'feature',
  };
}
