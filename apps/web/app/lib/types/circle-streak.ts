// Circle Streak + food streak mechanics — shared type contract (FROZEN).
// PRD v4 §6.13. Mirrors migration 059_circle_streak.sql.
//
// This file is the single source of truth for the circle-streak feature's shapes and
// the CircleStreakService API surface. The service and every route handler build
// against it; nothing here changes without updating the service + all routes together.
//
// Feature recap (§6.13):
//   * The circle earns a COLLECTIVE streak for consecutive days where MOST active
//     members log a calorie-bearing food entry (shared, gentle accountability).
//   * A logged meal already counts toward the existing per-user daily engagement
//     streak (engagement-streak-service) — NOT rebuilt here.
//   * Streak save: a member can cover for another once per period (per covered member
//     per save_date). A saved member counts as "logged" for that day's recompute —
//     pro-social, forgiveness-first: never punish a lapse.

// ============================================================================
// "MOST members" — definition (single source of truth, used by the service)
// ============================================================================
//
// "Most" = a STRICT MAJORITY (> 50%) of the circle's active members logged that day.
// The threshold is the smallest integer strictly greater than half the active count:
//   threshold = ceil((activeMembers + 1) / 2)
//   1 -> 1, 2 -> 2, 3 -> 2, 4 -> 3, 5 -> 3, 6 -> 4 ...
// An empty circle (0 active members) can never hit the threshold (0 >= 1 is false),
// so a memberless circle never extends a streak.
export function circleStreakMajorityThreshold(activeMemberCount: number): number {
  if (activeMemberCount <= 0) return 1; // unreachable threshold for 0 members
  return Math.ceil((activeMemberCount + 1) / 2);
}

// ============================================================================
// DB row shapes (snake_case — as stored; mirror 059)
// ============================================================================

export interface CircleStreakRow {
  fitcircle_id: string;
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
  updated_at: string;
}

export interface CircleStreakSaveRow {
  id: string;
  fitcircle_id: string;
  saver_user_id: string;
  covered_user_id: string;
  save_date: string;
  created_at: string;
}

// ============================================================================
// API DTO (camelCase — what the client contract returns; §6.13)
// The service maps rows -> this shape. Clients render this; never re-derive.
// ============================================================================

export interface CircleStreakDTO {
  fitcircleId: string;
  /** Consecutive qualifying days, anchored to the latest recomputed day. */
  currentStreak: number;
  /** All-time best current_streak this circle has reached. */
  longestStreak: number;
  /** ISO date (YYYY-MM-DD) of the most recent qualifying day, or null if never. */
  lastActiveDate: string | null;
  /** ISO timestamp of the last state change. */
  updatedAt: string | null;
}

/** Result of recording a streak save (§6.13 "cover for a member"). */
export interface CircleStreakSaveResultDTO {
  save: {
    id: string;
    fitcircleId: string;
    saverUserId: string;
    coveredUserId: string;
    saveDate: string;
    createdAt: string;
  };
  /** Whether THIS call created the save (false if it already existed for the period). */
  created: boolean;
  /** The circle streak after recomputing the saved day (the save counts as a log). */
  streak: CircleStreakDTO;
}

// ============================================================================
// FROZEN service signatures — CircleStreakService implements EXACTLY these.
// (Declared as a type so the implementation is structurally checked against it.)
// ============================================================================

/** Milestones that post to chat + push every member (REFERRALS_SPEC §10.3). */
export const CIRCLE_STREAK_MILESTONES = [3, 7, 14, 30, 50, 100] as const;

/** GET /streak payload: the DTO plus today's progress and the weekly save pool (additive). */
export interface CircleStreakView extends CircleStreakDTO {
  today: {
    date: string;
    loggedCount: number;
    activeCount: number;
    needed: number;
    qualified: boolean;
    members: Array<{
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      logged: boolean;
      covered: boolean;
      coveredBy: string | null;
    }>;
  };
  saves: { poolRemaining: number; poolSize: number; mySaveAvailable: boolean; weekResetsAt: string };
  nextMilestone: { days: number; remaining: number } | null;
}

export interface ICircleStreakService {
  /**
   * Recompute the collective streak for one calendar day. A member counts if they
   * showed up (non-freeze streak claim, calorie-bearing food entry, or a save).
   * A qualifying day extends/starts the streak; a non-qualifying day only resets
   * it when `final` (the day is over) — today in progress never resets.
   */
  recomputeForDay(fitcircleId: string, date: string, opts?: { final?: boolean }): Promise<CircleStreakDTO>;

  /** Active-member-gated read: streak + today's progress + save pool. */
  getStreak(fitcircleId: string, viewerUserId: string): Promise<CircleStreakView>;

  /** Spend the saver's weekly save covering a friend (today or yesterday). */
  useSave(
    fitcircleId: string,
    saverUserId: string,
    coveredUserId: string,
    date?: string | null
  ): Promise<CircleStreakSaveResultDTO>;
}
