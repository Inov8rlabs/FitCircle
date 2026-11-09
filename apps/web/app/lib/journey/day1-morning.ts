/**
 * Guaranteed Day-1 morning push (retention fix 1, 2026-11-09) — PURE.
 * Day1MorningPushService does the reads and the send.
 *
 * Who: every new (non-test) user with a push device, once: the local morning
 * after the local day they signed up on, from `hour`:00 to `hour`:59 (remote
 * config day1_morning_push_hour, default 8). Skipped when they already opened
 * the app that morning (server-side app opens / last_active_at).
 *
 * What (first match wins, from what they actually did on Day 0):
 *   1. in a circle (not the public demo circle):
 *        circle_rank      — ≥ 2 members synced steps yesterday and so did they:
 *                           "#2 of 4 with 6,412 steps"
 *        circle_challenge — the circle has an active challenge
 *        circle_steps     — they synced steps yesterday
 *        circle           — nothing to quote: "log one thing for <circle>"
 *   2. logged a meal on Day 0 → meal_logged ("log breakfast to keep your streak going")
 *   3. neither:
 *        finish_setup     — onboarding not finished
 *        start_circle     — "start a circle and invite one friend"
 *
 * Copy rules (docs/DESIGN_LANGUAGE + feedback "no fake data"): no emoji, and
 * every number quoted is the user's own synced / logged data — no estimates,
 * no social proof that was not measured.
 */
import type { NotificationScreen } from '@/lib/services/notification-orchestrator';
import { addDays } from '@/lib/streaks/streak-calculator';

import { localClockIn } from '../notifications/user-timezone';

export const DAY1_PUSH_TYPE = 'day1_morning' as const;
export const DEFAULT_DAY1_HOUR = 8;
export const day1DedupeKey = (userId: string) => `day1_morning:${userId}`;
/** "Opened that morning" counts opens from this local hour on (a 1 a.m. session is still Day 0). */
export const MORNING_STARTS_HOUR = 4;

export type Day1Variant = 'circle_rank' | 'circle_challenge' | 'circle_steps' | 'circle' | 'meal_logged' | 'finish_setup' | 'start_circle';

export interface Day1Window {
  due: boolean;
  /** The user's local date now. */
  localDate: string;
  /** The local date they signed up on. */
  signupLocalDate: string;
  /** Why not due: 'too_early' | 'too_late' | 'not_hour'. */
  wait?: 'too_early' | 'too_late' | 'not_hour';
}

/** Is it the user's Day-1 morning hour right now? */
export function day1Window(now: Date, signupAt: string, tz: string, hour = DEFAULT_DAY1_HOUR): Day1Window {
  const signupLocalDate = localClockIn(new Date(signupAt), tz).date;
  const { date: localDate, minutes } = localClockIn(now, tz);
  const target = addDays(signupLocalDate, 1);
  if (localDate < target) return { due: false, localDate, signupLocalDate, wait: 'too_early' };
  if (localDate > target) return { due: false, localDate, signupLocalDate, wait: 'too_late' };
  if (minutes < hour * 60) return { due: false, localDate, signupLocalDate, wait: 'too_early' };
  if (minutes >= (hour + 1) * 60) return { due: false, localDate, signupLocalDate, wait: 'too_late' };
  return { due: true, localDate, signupLocalDate };
}

export interface Day1Circle {
  id: string;
  name: string;
  /** Active challenge in the circle (name), if any. */
  challengeName?: string | null;
  /** Steps on the user's sign-up day for every member who synced any (user included). */
  memberSteps: ReadonlyArray<{ userId: string; steps: number }>;
}

export interface Day1Facts {
  userId: string;
  onboardingCompleted: boolean | null;
  /** Circles the user is an active member of (public demo circle excluded), most recent join first. */
  circles: readonly Day1Circle[];
  /** The user's own synced steps on their sign-up day, or null. */
  stepsDay0: number | null;
  /** At least one food entry since sign-up. */
  loggedMealDay0: boolean;
  /** engagement_streaks.current_streak. */
  streakDays: number;
}

export interface Day1Message {
  variant: Day1Variant;
  title: string;
  body: string;
  screen: NotificationScreen;
  circleId?: string;
}

const MAX_NAME = 32;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const shortName = (name: string) => {
  const clean = name.replace(/\s+/g, ' ').trim() || 'Your circle';
  return clean.length > MAX_NAME ? `${clean.slice(0, MAX_NAME - 1).trimEnd()}…` : clean;
};

/** Rank of `userId` by steps (1 = most) among members with steps > 0; null when < 2 such members or the user has none. */
export function stepsRank(memberSteps: Day1Circle['memberSteps'], userId: string): { rank: number; of: number; steps: number } | null {
  const withSteps = memberSteps.filter((m) => Number.isFinite(m.steps) && m.steps > 0);
  const me = withSteps.find((m) => m.userId === userId);
  if (!me || withSteps.length < 2) return null;
  const rank = 1 + withSteps.filter((m) => m.steps > me.steps).length;
  return { rank, of: withSteps.length, steps: me.steps };
}

export function chooseDay1Message(f: Day1Facts): Day1Message {
  // 1. In a circle: prefer the circle where there's something real to say.
  if (f.circles.length > 0) {
    for (const c of f.circles) {
      const r = stepsRank(c.memberSteps, f.userId);
      if (r) {
        return {
          variant: 'circle_rank',
          title: `${shortName(c.name)} yesterday`,
          body: `You finished #${r.rank} of ${r.of} with ${fmt(r.steps)} steps. Today is a new race.`,
          screen: 'circle_detail',
          circleId: c.id,
        };
      }
    }
    const withChallenge = f.circles.find((c) => (c.challengeName ?? '').trim());
    if (withChallenge) {
      return {
        variant: 'circle_challenge',
        title: `${shortName(withChallenge.challengeName!)} is on today`,
        body: `Log today's progress in ${shortName(withChallenge.name)} and keep your place.`,
        screen: 'circle_detail',
        circleId: withChallenge.id,
      };
    }
    const c = f.circles[0];
    if (f.stepsDay0 !== null && f.stepsDay0 > 0) {
      return {
        variant: 'circle_steps',
        title: `Yesterday: ${fmt(f.stepsDay0)} steps`,
        body: `Can you beat it today? ${shortName(c.name)} counts every step.`,
        screen: 'circle_detail',
        circleId: c.id,
      };
    }
    return {
      variant: 'circle',
      title: `Day 2 in ${shortName(c.name)}`,
      body: 'Log one thing today, a meal, a walk or a glass of water, to keep your circle going.',
      screen: 'circle_detail',
      circleId: c.id,
    };
  }
  // 2. Logged a meal on Day 0.
  if (f.loggedMealDay0) {
    return {
      variant: 'meal_logged',
      title: 'Good morning',
      body: f.streakDays > 0 ? 'Log breakfast to keep your streak going.' : 'Log breakfast to start your streak.',
      screen: 'food_log',
    };
  }
  // 3. Neither: the single most useful next step.
  if (f.onboardingCompleted !== true) {
    return {
      variant: 'finish_setup',
      title: 'Pick up where you left off',
      body: 'Finish setting up in about 2 minutes and get your daily plan.',
      screen: 'dashboard',
    };
  }
  return {
    variant: 'start_circle',
    title: 'Better with a friend',
    body: 'Start a circle and invite one friend to keep each other going.',
    screen: 'circles',
  };
}
