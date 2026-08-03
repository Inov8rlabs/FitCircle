/**
 * Canonical streak configuration — the single source of truth for
 * milestone definitions and the shield (streak-freeze) economy.
 *
 * Every service, route, and cron that deals with streaks must import from
 * here. The Android/iOS milestone lists mirror MILESTONES below; if you
 * change thresholds, names, or icons, update the clients in the same PR
 * (Android: ClaimMilestone.kt, iOS: StreakMilestone/AppConstants).
 *
 * Shield economy (see docs/STREAKS-SPEC.md):
 * - Free users EARN shields by maintaining the streak:
 *     +1 for every 7 consecutive days (weekly), and
 *     +1 extra for every 30 consecutive days (monthly).
 *   Balance is capped at MAX_SHIELD_BALANCE so shields stay scarce and the
 *   streak keeps meaning (Duolingo caps equipped freezes for the same reason).
 * - Pro users have unlimited shields: protection never decrements a balance.
 * - Shields auto-apply to a single missed day; with no shields left the
 *   streak breaks and clients surface the Pro paywall.
 */

export interface StreakMilestoneDef {
  days: number;
  name: string;
  description: string;
  /** Emoji shown in feeds/messages; clients render their own vector icon per tier. */
  badge: string;
  /** Icon hint for clients: flame | medal | trophy | crown | star | gem | mountain */
  icon: string;
}

/**
 * Celebration milestones. Early ones are close together (habit formation),
 * later ones spread out. Keep this list sorted ascending.
 */
export const MILESTONES: StreakMilestoneDef[] = [
  { days: 3, name: '3-Day Spark', description: 'Habit ignited — three days in a row!', badge: '✨', icon: 'flame' },
  { days: 7, name: '1-Week Warrior', description: 'One full week of consistency!', badge: '🔥', icon: 'flame' },
  { days: 14, name: '2-Week Champion', description: 'Two weeks strong!', badge: '💪', icon: 'medal' },
  { days: 30, name: 'Monthly Master', description: 'A full month of showing up!', badge: '🎖️', icon: 'medal' },
  { days: 60, name: '60-Day Dynamo', description: 'Two months of dedication!', badge: '🏆', icon: 'trophy' },
  { days: 100, name: 'Centurion', description: 'The elite 100-day club!', badge: '👑', icon: 'crown' },
  { days: 180, name: 'Half-Year Hero', description: 'Six months without letting go!', badge: '🌟', icon: 'star' },
  { days: 365, name: 'Year Legend', description: 'A full year of commitment!', badge: '🏅', icon: 'gem' },
  { days: 500, name: '500 Club', description: '500 days — rarefied air!', badge: '💎', icon: 'gem' },
  { days: 730, name: 'Two-Year Titan', description: 'Two full years. Unstoppable.', badge: '⛰️', icon: 'mountain' },
  { days: 1000, name: 'Thousand-Day Immortal', description: '1,000 days. You are the streak.', badge: '🗻', icon: 'mountain' },
];

/** Shield economy constants. */
export const SHIELD_RULES = {
  /** +1 shield each time the streak crosses a multiple of this (weekly). */
  WEEKLY_EARN_INTERVAL: 7,
  /** +1 extra shield each time the streak crosses a multiple of this (monthly). */
  MONTHLY_EARN_INTERVAL: 30,
  /**
   * Max shields a free user can bank across all shield types. Duolingo's
   * experiments found 2 equipped freezes optimal and a 3rd net-negative
   * (trains skipping); we allow 3 because our earn cadence is slower than
   * gem-purchase. Overflow earns are simply not banked.
   */
  MAX_SHIELD_BALANCE: 3,
  /** New users start with 1 shield so their first slip doesn't kill the habit. */
  STARTER_SHIELDS: 1,
  /** Only auto-protect this many consecutive missed days before the streak breaks (free users). */
  MAX_CONSECUTIVE_AUTO_PROTECTS: 2,
} as const;

/** Retroactive claiming window (days back from the user's local today). */
export const RETROACTIVE_WINDOW_DAYS = 7;

/** Users can still claim "yesterday" until this local hour (3am grace). */
export const GRACE_PERIOD_HOURS = 3;

/**
 * Shields earned when a streak moves from oldStreak to newStreak.
 * Awards accumulate across every weekly/monthly boundary crossed, so a
 * retroactive claim that jumps the streak several days still pays out
 * each earned shield exactly once.
 */
export function shieldsEarnedBetween(oldStreak: number, newStreak: number): number {
  if (newStreak <= oldStreak) return 0;
  const crossings = (interval: number) =>
    Math.floor(newStreak / interval) - Math.floor(oldStreak / interval);
  return (
    crossings(SHIELD_RULES.WEEKLY_EARN_INTERVAL) +
    crossings(SHIELD_RULES.MONTHLY_EARN_INTERVAL)
  );
}

/** The milestone reached at exactly `days`, if any. */
export function milestoneForDays(days: number): StreakMilestoneDef | null {
  return MILESTONES.find(m => m.days === days) || null;
}

/**
 * The highest milestone newly reached when moving from oldStreak to
 * newStreak (retroactive claims can cross several at once).
 */
export function milestoneCrossed(oldStreak: number, newStreak: number): StreakMilestoneDef | null {
  const crossed = MILESTONES.filter(m => m.days > oldStreak && m.days <= newStreak);
  return crossed.length > 0 ? crossed[crossed.length - 1] : null;
}

/** Next milestone strictly above the current streak. */
export function nextMilestone(currentStreak: number): StreakMilestoneDef | null {
  return MILESTONES.find(m => m.days > currentStreak) || null;
}

/** All milestones earned at or below the given (longest) streak. */
export function earnedMilestones(longestStreak: number): StreakMilestoneDef[] {
  return MILESTONES.filter(m => m.days <= longestStreak);
}

/** Streak flame color used by clients for theming. */
export function streakColor(streak: number): string {
  if (streak >= 100) return 'gold';
  if (streak >= 60) return 'purple';
  if (streak >= 30) return 'blue';
  if (streak >= 14) return 'green';
  if (streak >= 7) return 'orange';
  if (streak >= 3) return 'yellow';
  return 'gray';
}
