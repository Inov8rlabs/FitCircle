// ============================================================================
// Streak Claiming System Type Definitions
// ============================================================================

// ============================================================================
// DATABASE ENTITIES
// ============================================================================

export interface StreakClaim {
  id: string;
  user_id: string;
  claim_date: string; // DATE format YYYY-MM-DD
  claimed_at: string; // TIMESTAMPTZ
  claim_method: ClaimMethod;
  timezone: string;
  health_data_synced: boolean;
  metadata: Record<string, any>;
  created_at: string;
}

export interface StreakShield {
  id: string;
  user_id: string;
  shield_type: ShieldType;
  available_count: number;
  last_reset_at: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface StreakRecovery {
  id: string;
  user_id: string;
  broken_date: string; // DATE format YYYY-MM-DD
  recovery_type: RecoveryType;
  recovery_status: RecoveryStatus;
  actions_required: number | null;
  actions_completed: number;
  expires_at: string | null;
  completed_at: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// ENUMS
// ============================================================================

export type ClaimMethod = 'explicit' | 'manual_entry' | 'retroactive' | 'freeze';

export type ShieldType = 'freeze' | 'milestone_shield' | 'purchased';

export type RecoveryType = 'weekend_warrior' | 'shield_auto' | 'purchased';

export type RecoveryStatus = 'pending' | 'completed' | 'failed' | 'expired';

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ClaimResult {
  success: boolean;
  streakCount: number;
  milestone?: MilestoneInfo;
  /** YYYY-MM-DD that was auto-protected with a shield to keep this streak alive. */
  shieldAutoApplied?: string;
  message: string;
  claim?: StreakClaim;
}

export interface CanClaimResult {
  canClaim: boolean;
  alreadyClaimed: boolean;
  reason?: string;
  hasHealthData?: boolean;
  /** Full health-data breakdown, so callers don't re-query daily_tracking. */
  healthCheck?: HealthDataCheck;
  gracePeriodActive?: boolean;
}

export interface ClaimableDay {
  date: string;
  claimed: boolean;
  hasHealthData: boolean;
  canClaim: boolean;
  reason?: string;
  /** How the day was covered: explicit / manual_entry / retroactive / freeze (shield). */
  claimMethod?: string;
}

export interface ShieldStatus {
  freezes: number;
  milestone_shields: number;
  purchased: number;
  total: number;
  /** Pro users have unlimited shields; clients should render ∞ and ignore total. */
  unlimited: boolean;
  /** Max shields a free user can bank. */
  cap: number;
  /** @deprecated weekly freeze resets no longer exist; always null. */
  last_freeze_reset: string | null;
  /** @deprecated weekly freeze resets no longer exist; always null. */
  next_freeze_reset: string | null;
}

export interface MilestoneInfo {
  milestone: number;
  type: 'shield_earned' | 'achievement_unlocked';
  reward?: string;
  shieldsGranted?: number;
  /** A shield was earned but not banked because the balance is at the cap. */
  shieldsCapped?: boolean;
}

/** Result of the nightly protect-or-break check for one user. */
export interface StreakBreakOutcome {
  broken: boolean;
  shieldApplied: boolean;
  paywallEligible: boolean;
  /** Length of the run that was interrupted (0 when nothing broke). */
  lostStreak: number;
  /** Derived streak after this check. */
  currentStreak: number;
  /** Shields left after an auto-protect (null for Pro / not applicable). */
  shieldsRemaining: number | null;
  unlimited: boolean;
  /** This was the last auto-protect allowed in a row — next miss breaks. */
  lastAutoProtect?: boolean;
  /** Broke because MAX_CONSECUTIVE_AUTO_PROTECTS was exhausted, not for lack of shields. */
  zombieGuard?: boolean;
}

export interface RecoveryInfo {
  recovery: StreakRecovery;
  actionsRemaining: number;
  timeRemaining?: string;
}

// ============================================================================
// API INPUT TYPES
// ============================================================================

export interface ClaimStreakInput {
  claimDate?: string; // YYYY-MM-DD, defaults to today
  timezone: string; // e.g., "America/Los_Angeles"
  method?: 'explicit' | 'retroactive'; // manual_entry is automatic
}

export interface ActivateFreezeInput {
  date: string; // YYYY-MM-DD
  timezone: string;
}

export interface StartRecoveryInput {
  brokenDate: string; // YYYY-MM-DD
  recoveryType: Exclude<RecoveryType, 'shield_auto'>; // Can't manually start auto
}

export interface CompleteRecoveryActionInput {
  recoveryId: string;
  actionType: string; // e.g., 'weight_log', 'steps_log'
}

// ============================================================================
// SERVICE LAYER TYPES
// ============================================================================

export interface StreakClaimingContext {
  userId: string;
  timezone: string;
  localDate: Date;
  utcDate: Date;
}

export interface HealthDataCheck {
  hasWeight: boolean;
  hasSteps: boolean;
  hasMood: boolean;
  hasEnergy: boolean;
  /** A meal / water entry was logged that day. */
  hasFoodLog: boolean;
  /** A beverage entry was logged that day. */
  hasBeverageLog: boolean;
  /** A workout was logged that day. */
  hasExerciseLog: boolean;
  /** Any qualifying activity (tracking metrics OR logs) exists for the day. */
  hasAnyData: boolean;
}

/** Which manual log triggered a server-side auto-claim. */
export type AutoClaimSource = 'food_log' | 'beverage_log' | 'exercise_log' | 'daily_tracking';

/**
 * Outcome of StreakClaimingService.autoClaimForManualLog. Returned to clients
 * in the create response's `meta.streak` so they can refresh the streak card
 * and celebrate an earned shield without a second round-trip. Never an error:
 * a skipped claim is a normal outcome (e.g. backfilling a meal from 3 weeks
 * ago must not claim a streak day).
 */
export interface AutoClaimResult {
  /** A new claim row was written by this call. */
  claimed: boolean;
  /** The day was already claimed (by an earlier log, a tap, or a shield). */
  alreadyClaimed: boolean;
  /** The user-local YYYY-MM-DD the log counted for (null when skipped early). */
  day: string | null;
  /** Current streak after this call, when known. */
  streakCount: number | null;
  /** Milestone crossed / shield earned by this claim. */
  milestone?: MilestoneInfo;
  /** Why nothing was claimed. Absent when `claimed` or `alreadyClaimed`. */
  skipped?: 'future' | 'outside_window' | 'not_allowed' | 'error';
  source: AutoClaimSource;
}

export interface StreakBreakCheck {
  isBroken: boolean;
  missedDays: string[];
  canAutoRecover: boolean;
  recoveryOptions: RecoveryOption[];
}

export interface RecoveryOption {
  type: RecoveryType;
  available: boolean;
  description: string;
  cost?: number;
  requiresAction?: boolean;
  expiresIn?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Shield economy constants (earn intervals, caps) live in
// lib/streaks/streak-config — the single source of truth.
export const CLAIMING_CONSTANTS = {
  RETROACTIVE_WINDOW_DAYS: 7,
  GRACE_PERIOD_HOURS: 3,
  WEEKEND_WARRIOR_ACTIONS: 2,
  WEEKEND_WARRIOR_WINDOW_HOURS: 24,
  PURCHASED_RESURRECTION_PRICE: 2.99,
  PURCHASED_RESURRECTION_LIMIT_PER_YEAR: 1,
} as const;

// ============================================================================
// ERROR TYPES
// ============================================================================

export class StreakClaimError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'StreakClaimError';
  }
}

export const CLAIM_ERROR_CODES = {
  ALREADY_CLAIMED: 'ALREADY_CLAIMED',
  FUTURE_DATE: 'FUTURE_DATE',
  TOO_OLD: 'TOO_OLD',
  NO_HEALTH_DATA: 'NO_HEALTH_DATA',
  OUTSIDE_GRACE_PERIOD: 'OUTSIDE_GRACE_PERIOD',
  NO_SHIELDS_AVAILABLE: 'NO_SHIELDS_AVAILABLE',
  RECOVERY_IN_PROGRESS: 'RECOVERY_IN_PROGRESS',
  RECOVERY_EXPIRED: 'RECOVERY_EXPIRED',
  INVALID_RECOVERY_TYPE: 'INVALID_RECOVERY_TYPE',
  RECOVERY_LIMIT_REACHED: 'RECOVERY_LIMIT_REACHED',
  INSUFFICIENT_ACTIONS: 'INSUFFICIENT_ACTIONS',
} as const;

// Date/timezone utilities (localToday, addDays, isWithinRetroactiveWindow,
// isWithinGracePeriod, calculateStreak) live in lib/streaks/streak-calculator.
// Milestone helpers (milestoneCrossed, nextMilestone, shieldsEarnedBetween)
// live in lib/streaks/streak-config.
