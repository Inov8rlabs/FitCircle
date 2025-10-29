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

export type ClaimMethod = 'explicit' | 'manual_entry' | 'retroactive';

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
  message: string;
  claim?: StreakClaim;
}

export interface CanClaimResult {
  canClaim: boolean;
  alreadyClaimed: boolean;
  reason?: string;
  hasHealthData?: boolean;
  gracePeriodActive?: boolean;
}

export interface ClaimableDay {
  date: string;
  claimed: boolean;
  hasHealthData: boolean;
  canClaim: boolean;
  reason?: string;
}

export interface ShieldStatus {
  freezes: number;
  milestone_shields: number;
  purchased: number;
  total: number;
  last_freeze_reset: string | null;
  next_freeze_reset: string | null;
}

export interface MilestoneInfo {
  milestone: number;
  type: 'shield_earned' | 'achievement_unlocked';
  reward?: string;
  shieldsGranted?: number;
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
  hasAnyData: boolean;
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

export const CLAIMING_CONSTANTS = {
  RETROACTIVE_WINDOW_DAYS: 7,
  GRACE_PERIOD_HOURS: 3,
  MILESTONE_SHIELDS: {
    30: 1,
    60: 1,
    100: 2,
    365: 3,
  },
  WEEKLY_FREE_FREEZE: 1,
  MAX_TOTAL_SHIELDS: 5,
  FREEZE_RESET_DAY: 1, // Monday (0=Sunday, 1=Monday, etc.)
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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a date is within the retroactive claiming window
 */
export function isWithinRetroactiveWindow(
  targetDate: Date,
  currentDate: Date
): boolean {
  const daysDiff = Math.floor(
    (currentDate.getTime() - targetDate.getTime()) / (24 * 60 * 60 * 1000)
  );
  return daysDiff >= 0 && daysDiff <= CLAIMING_CONSTANTS.RETROACTIVE_WINDOW_DAYS;
}

/**
 * Check if current time is within grace period for claiming yesterday
 */
export function isWithinGracePeriod(timezone: string): boolean {
  try {
    const now = new Date();
    const localHour = parseInt(
      now.toLocaleString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      })
    );
    return localHour < CLAIMING_CONSTANTS.GRACE_PERIOD_HOURS;
  } catch (error) {
    console.error('[isWithinGracePeriod] Error:', error);
    return false;
  }
}

/**
 * Get next Monday (freeze reset day)
 */
export function getNextFreezeReset(from: Date = new Date()): Date {
  const next = new Date(from);
  next.setHours(0, 0, 0, 0);
  const daysUntilMonday = (8 - next.getDay()) % 7 || 7;
  next.setDate(next.getDate() + daysUntilMonday);
  return next;
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateYYYYMMDD(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Check if user earned milestone shields
 */
export function getMilestoneShields(streakCount: number): number {
  if (streakCount in CLAIMING_CONSTANTS.MILESTONE_SHIELDS) {
    return CLAIMING_CONSTANTS.MILESTONE_SHIELDS[
      streakCount as keyof typeof CLAIMING_CONSTANTS.MILESTONE_SHIELDS
    ];
  }
  return 0;
}

/**
 * Check if milestone achievement was unlocked
 */
export function getMilestoneInfo(streakCount: number): MilestoneInfo | undefined {
  const shieldsGranted = getMilestoneShields(streakCount);
  if (shieldsGranted > 0) {
    return {
      milestone: streakCount,
      type: 'shield_earned',
      reward: `${shieldsGranted} streak shield(s) earned!`,
      shieldsGranted,
    };
  }
  return undefined;
}
