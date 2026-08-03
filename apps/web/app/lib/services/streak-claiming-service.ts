/**
 * StreakClaimingService — the canonical streak engine.
 *
 * Source of truth for the streak itself is the `streak_claims` table:
 * one row per user per protected/claimed local day. The streak number is
 * always derived from claims (calculateStreak), never trusted from a
 * stored counter; `engagement_streaks` holds a denormalized copy for fast
 * reads and legacy clients.
 *
 * Shield inventory lives exclusively in StreakShieldService.
 * Milestones and the shield economy live in lib/streaks/streak-config.
 *
 * All dates are YYYY-MM-DD strings in the USER'S timezone — see
 * lib/streaks/streak-calculator for the date-handling rules.
 */

import { createAdminSupabase } from '../supabase-admin';
import {
  StreakClaim,
  type ClaimResult,
  type CanClaimResult,
  type ClaimableDay,
  type ShieldStatus,
  type RecoveryInfo,
  type HealthDataCheck,
  type MilestoneInfo,
  StreakClaimError,
  CLAIM_ERROR_CODES,
  CLAIMING_CONSTANTS,
} from '../types/streak-claiming';
import { SHIELD_RULES, milestoneCrossed } from '../streaks/streak-config';
import {
  localToday,
  addDays,
  isWithinGracePeriod,
  isWithinRetroactiveWindow,
  calculateStreak,
} from '../streaks/streak-calculator';
import { StreakShieldService } from './streak-shield-service';
import { MomentumService } from './momentum-service';

/** Normalize route inputs (Date at UTC midnight, or YYYY-MM-DD string). */
function toDayStr(date: Date | string): string {
  if (typeof date === 'string') return date.slice(0, 10);
  return date.toISOString().split('T')[0];
}

export class StreakClaimingService {
  // ==========================================================================
  // CORE CLAIMING
  // ==========================================================================

  /**
   * Claim a streak day (today or retroactive within the window).
   * Awards milestone celebrations and earned shields atomically with the
   * streak recompute.
   */
  static async claimStreak(
    userId: string,
    claimDate: Date | string,
    timezone: string,
    method: 'explicit' | 'manual_entry' | 'retroactive'
  ): Promise<ClaimResult> {
    const supabaseAdmin = createAdminSupabase();
    const claimDateStr = toDayStr(claimDate);
    const todayStr = localToday(timezone);

    // 1. Validate
    const canClaimResult = await this.canClaimStreak(userId, claimDateStr, timezone);
    if (canClaimResult.alreadyClaimed) {
      throw new StreakClaimError('Streak already claimed for this date', CLAIM_ERROR_CODES.ALREADY_CLAIMED, {
        date: claimDateStr,
      });
    }
    if (!canClaimResult.canClaim) {
      throw new StreakClaimError(
        canClaimResult.reason || 'Cannot claim streak',
        canClaimResult.reason === 'Cannot claim future dates'
          ? CLAIM_ERROR_CODES.FUTURE_DATE
          : canClaimResult.reason?.includes('window')
            ? CLAIM_ERROR_CODES.TOO_OLD
            : 'CLAIM_NOT_ALLOWED',
        { date: claimDateStr, reason: canClaimResult.reason }
      );
    }

    // 2. Health data snapshot (informational — claims are allowed without it).
    //    canClaimStreak already queried it; only re-query if it didn't.
    const healthCheck =
      canClaimResult.healthCheck ?? (await this.checkHealthData(userId, claimDateStr));

    // 3. Streak BEFORE this claim (needed to detect crossed milestones)
    const claimDates = await this.getClaimDates(userId);
    const oldStreak = calculateStreak(claimDates, todayStr);

    // 4. Insert the claim
    const { data: claim, error: claimError } = await supabaseAdmin
      .from('streak_claims')
      .insert({
        user_id: userId,
        claim_date: claimDateStr,
        claimed_at: new Date().toISOString(),
        claim_method: method,
        timezone,
        health_data_synced: healthCheck.hasAnyData,
        metadata: {
          health_data: {
            has_weight: healthCheck.hasWeight,
            has_steps: healthCheck.hasSteps,
            has_mood: healthCheck.hasMood,
            has_energy: healthCheck.hasEnergy,
          },
        },
      })
      .select()
      .single();

    if (claimError) {
      if (claimError.code === '23505') {
        throw new StreakClaimError('Streak already claimed for this date', CLAIM_ERROR_CODES.ALREADY_CLAIMED, {
          date: claimDateStr,
        });
      }
      throw new StreakClaimError(claimError.message || 'Failed to insert claim record', 'DATABASE_ERROR', {
        originalError: claimError.code,
        date: claimDateStr,
      });
    }

    // 5. Recompute the streak including the new claim
    claimDates.add(claimDateStr);
    const newStreak = calculateStreak(claimDates, todayStr);

    // 6. Persist to engagement_streaks + activity history (best-effort)
    await this.syncStreakRecord(userId, newStreak, claimDateStr, claim.id);

    // 7. Milestones + earned shields
    let milestone: MilestoneInfo | undefined;
    try {
      const shieldsEarned = await StreakShieldService.earnForStreakIncrease(userId, oldStreak, newStreak);
      const crossed = milestoneCrossed(oldStreak, newStreak);
      if (crossed) {
        milestone = {
          milestone: crossed.days,
          type: shieldsEarned > 0 ? 'shield_earned' : 'achievement_unlocked',
          reward: crossed.name,
          shieldsGranted: shieldsEarned,
        };
      } else if (shieldsEarned > 0) {
        // Weekly shield earn without a celebration milestone (e.g. day 21)
        milestone = {
          milestone: newStreak,
          type: 'shield_earned',
          reward: `${shieldsEarned} streak shield(s) earned!`,
          shieldsGranted: shieldsEarned,
        };
      }
    } catch (e: any) {
      console.error('[StreakClaimingService.claimStreak] milestone/shield error:', e.message);
    }

    return {
      success: true,
      streakCount: newStreak,
      milestone,
      message: `Streak claimed! Current streak: ${newStreak} days`,
      claim,
    };
  }

  /** Can the user claim `date`? All checks are in the user's timezone. */
  static async canClaimStreak(
    userId: string,
    date: Date | string,
    timezone: string
  ): Promise<CanClaimResult> {
    const supabaseAdmin = createAdminSupabase();
    const dateStr = toDayStr(date);
    const todayStr = localToday(timezone);

    // 1. Future dates: the user's local tomorrow is not claimable, even when
    //    the server's UTC calendar hasn't caught up with the user's clock.
    if (dateStr > todayStr) {
      return { canClaim: false, alreadyClaimed: false, reason: 'Cannot claim future dates' };
    }

    // 2. Retroactive window. The 3am grace period extends the window for
    //    "yesterday relative to the window edge" by treating early-morning
    //    claims as belonging to the just-ended day.
    if (!isWithinRetroactiveWindow(dateStr, todayStr)) {
      return {
        canClaim: false,
        alreadyClaimed: false,
        reason: `Date is outside ${CLAIMING_CONSTANTS.RETROACTIVE_WINDOW_DAYS}-day retroactive claiming window`,
      };
    }

    // 3. Already claimed?
    const { data: existingClaim } = await supabaseAdmin
      .from('streak_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('claim_date', dateStr)
      .maybeSingle();

    if (existingClaim) {
      return { canClaim: false, alreadyClaimed: true, reason: 'Already claimed for this date' };
    }

    // 4. Health data (informational)
    const healthCheck = await this.checkHealthData(userId, dateStr);

    const isYesterday = dateStr === addDays(todayStr, -1);
    return {
      canClaim: true,
      alreadyClaimed: false,
      hasHealthData: healthCheck.hasAnyData,
      healthCheck,
      gracePeriodActive: isYesterday ? isWithinGracePeriod(timezone) : undefined,
    };
  }

  /**
   * Shared "shield a 1-day gap" policy used by the check-in flows: if
   * yesterday (relative to anchorDate) is unclaimed but the day before is
   * claimed, auto-apply a shield so the streak survives. Mutates claimDates
   * on success so the caller's recompute sees the protected day.
   */
  static async tryAutoProtectYesterday(
    userId: string,
    claimDates: Set<string>,
    anchorDate: string,
    timezone?: string
  ): Promise<{ applied: boolean; outOfShields: boolean }> {
    const yesterday = addDays(anchorDate, -1);
    if (claimDates.has(yesterday) || !claimDates.has(addDays(anchorDate, -2))) {
      return { applied: false, outOfShields: false };
    }
    try {
      await this.activateFreeze(userId, yesterday, timezone, { auto: true });
      claimDates.add(yesterday);
      return { applied: true, outOfShields: false };
    } catch (e) {
      if (e instanceof StreakClaimError && e.code === CLAIM_ERROR_CODES.NO_SHIELDS_AVAILABLE) {
        return { applied: false, outOfShields: true };
      }
      if (e instanceof StreakClaimError && e.code === CLAIM_ERROR_CODES.ALREADY_CLAIMED) {
        claimDates.add(yesterday); // protected concurrently
        return { applied: false, outOfShields: false };
      }
      console.error('[tryAutoProtectYesterday] error (non-blocking):', e);
      return { applied: false, outOfShields: false };
    }
  }

  /** Claimable-day states for the retroactive window (today + past 7 days). */
  static async getClaimableDays(userId: string, timezone: string): Promise<ClaimableDay[]> {
    const supabaseAdmin = createAdminSupabase();
    const todayStr = localToday(timezone);
    const windowStart = addDays(todayStr, -CLAIMING_CONSTANTS.RETROACTIVE_WINDOW_DAYS);

    const [{ data: claims }, { data: tracking }] = await Promise.all([
      supabaseAdmin
        .from('streak_claims')
        .select('claim_date')
        .eq('user_id', userId)
        .gte('claim_date', windowStart),
      supabaseAdmin
        .from('daily_tracking')
        .select('tracking_date, weight_kg, steps, mood_score, energy_level')
        .eq('user_id', userId)
        .gte('tracking_date', windowStart),
    ]);

    const claimedDates = new Set(claims?.map(c => c.claim_date) || []);
    const healthByDate = new Map(
      (tracking || []).map(t => [
        t.tracking_date,
        !!(t.weight_kg || t.steps || t.mood_score || t.energy_level),
      ])
    );

    const days: ClaimableDay[] = [];
    for (let i = 0; i <= CLAIMING_CONSTANTS.RETROACTIVE_WINDOW_DAYS; i++) {
      const dateStr = addDays(todayStr, -i);
      const claimed = claimedDates.has(dateStr);
      days.push({
        date: dateStr,
        claimed,
        hasHealthData: healthByDate.get(dateStr) || false,
        canClaim: !claimed && isWithinRetroactiveWindow(dateStr, todayStr),
        reason: claimed ? 'Already claimed for this date' : undefined,
      });
    }
    return days;
  }

  // ==========================================================================
  // SHIELDS
  // ==========================================================================

  /**
   * Shield status for API responses. Keeps the legacy ShieldStatus shape and
   * adds `unlimited`/`cap` so updated clients can render ∞ for Pro.
   */
  static async getAvailableShields(userId: string): Promise<ShieldStatus> {
    const inventory = await StreakShieldService.getInventory(userId);

    // Weekly freeze resets are gone (shields are milestone-earned now), but
    // legacy clients may decode next_freeze_reset as a non-optional date —
    // keep sending a synthetic next-Monday timestamp so their decoders
    // don't reject the whole payload. Updated clients ignore these fields.
    const nextMonday = new Date();
    nextMonday.setUTCHours(0, 0, 0, 0);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + ((8 - nextMonday.getUTCDay()) % 7 || 7));

    return {
      freezes: inventory.breakdown.freeze,
      milestone_shields: inventory.breakdown.milestone_shield,
      purchased: inventory.breakdown.purchased,
      total: inventory.available,
      unlimited: inventory.unlimited,
      cap: inventory.cap,
      last_freeze_reset: null,
      next_freeze_reset: nextMonday.toISOString(),
    };
  }

  /**
   * Protect a missed day with a shield (manual or auto).
   * Pro users never decrement a balance. Throws NO_SHIELDS_AVAILABLE with an
   * `upsell` detail when a free user is out of shields — routes surface that
   * so clients can open the paywall.
   */
  static async activateFreeze(
    userId: string,
    date: Date | string,
    timezone?: string,
    options: { auto?: boolean; skipStreakSync?: boolean } = {}
  ): Promise<{ shieldType: string; remaining: number; unlimited: boolean }> {
    const supabaseAdmin = createAdminSupabase();
    const dateStr = toDayStr(date);
    const tz = timezone || (await this.getLastKnownTimezone(userId)) || 'UTC';
    const todayStr = localToday(tz);

    // Protecting the future makes no sense; protecting beyond the window is
    // pointless (the streak already broke past recovery).
    if (dateStr >= todayStr) {
      throw new StreakClaimError('Can only shield past days', CLAIM_ERROR_CODES.FUTURE_DATE, { date: dateStr });
    }
    if (!isWithinRetroactiveWindow(dateStr, todayStr)) {
      throw new StreakClaimError('Day is outside the shieldable window', CLAIM_ERROR_CODES.TOO_OLD, {
        date: dateStr,
      });
    }

    // Already claimed/protected? Nothing to do — don't burn a shield.
    const { data: existing } = await supabaseAdmin
      .from('streak_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('claim_date', dateStr)
      .maybeSingle();
    if (existing) {
      throw new StreakClaimError('Day is already claimed or protected', CLAIM_ERROR_CODES.ALREADY_CLAIMED, {
        date: dateStr,
      });
    }

    // Consume from the single inventory (no-op decrement for Pro).
    const consumed = await StreakShieldService.consume(userId);

    // Insert the protecting claim. On a duplicate-key race, refund the shield.
    const { error: claimInsertError } = await supabaseAdmin.from('streak_claims').insert({
      user_id: userId,
      claim_date: dateStr,
      claimed_at: new Date().toISOString(),
      claim_method: 'freeze',
      timezone: tz,
      health_data_synced: false,
      metadata: {
        shield_type: consumed.consumedType,
        auto_applied: options.auto === true,
        activated_at: new Date().toISOString(),
      },
    });

    let remaining = consumed.remaining;
    if (claimInsertError) {
      if (claimInsertError.code === '23505' && !consumed.unlimited) {
        // The day was claimed/protected concurrently — give the shield back.
        await StreakShieldService.refund(
          userId,
          consumed.consumedType as 'freeze' | 'milestone_shield' | 'purchased'
        );
        remaining = consumed.remaining + 1;
      }
      if (claimInsertError.code !== '23505') {
        throw claimInsertError;
      }
    }

    // History + streak recompute (best-effort).
    await supabaseAdmin
      .from('engagement_activities')
      .insert({
        user_id: userId,
        activity_date: dateStr,
        activity_type: 'streak_freeze',
        reference_id: null,
      })
      .then(({ error }) => {
        if (error && error.code !== '23505') {
          console.error('[activateFreeze] activity insert error:', error);
        }
      });

    if (!options.skipStreakSync) {
      const claimDates = await this.getClaimDates(userId);
      const newStreak = calculateStreak(claimDates, todayStr);
      await this.syncStreakRecord(userId, newStreak, null, null);
    }

    return { shieldType: consumed.consumedType, remaining, unlimited: consumed.unlimited };
  }

  // ==========================================================================
  // DAILY CRON — protect or break
  // ==========================================================================

  /**
   * Nightly check for one user, in that user's timezone.
   *
   * If yesterday (user-local) is unclaimed and it interrupted a real streak
   * (≥2 consecutive claimed days ending the day before — a shield spent on a
   * 1-day streak saves nothing worth saving):
   * - auto-apply a shield when the user has one (Pro: always, without
   *   decrementing), but never more than MAX_CONSECUTIVE_AUTO_PROTECTS in a
   *   row — a streak kept alive only by shields for days on end is a zombie,
   *   and users hate discovering their "streak" counted days they never
   *   showed up (the retro window still lets them claim honestly).
   * - otherwise the streak breaks: the stored value is set to the true
   *   derived streak (which may be 1 if today is already claimed, not
   *   blindly 0). For free users the result carries paywallEligible so
   *   notification/UI layers can pitch Pro.
   *
   * Idempotent: a protected day gets a claim row (unique), and re-writing
   * the derived streak value is harmless.
   */
  static async checkAndBreakStreak(
    userId: string
  ): Promise<{ broken: boolean; shieldApplied: boolean; paywallEligible: boolean }> {
    const tz = (await this.getLastKnownTimezone(userId)) || 'UTC';

    // Still inside the 3am grace window? Let the user finish their "yesterday".
    if (isWithinGracePeriod(tz)) {
      return { broken: false, shieldApplied: false, paywallEligible: false };
    }

    const todayStr = localToday(tz);
    const yesterdayStr = addDays(todayStr, -1);

    const claimDates = await this.getClaimDates(userId);
    if (claimDates.has(yesterdayStr)) {
      return { broken: false, shieldApplied: false, paywallEligible: false };
    }

    // Only a real streak is worth a shield: ≥2 consecutive claimed days
    // ending the day before the gap.
    const interruptedRun = this.runLengthEndingAt(claimDates, addDays(todayStr, -2));
    if (interruptedRun < 2) {
      await this.syncStreakRecord(userId, calculateStreak(claimDates, todayStr), null, null);
      return { broken: false, shieldApplied: false, paywallEligible: false };
    }

    // Count consecutive auto-protected days immediately before yesterday.
    const consecutiveAutoProtects = await this.countTrailingAutoProtects(userId, yesterdayStr);
    const canAutoProtect = consecutiveAutoProtects < SHIELD_RULES.MAX_CONSECUTIVE_AUTO_PROTECTS;

    let outOfShields = false;
    if (canAutoProtect) {
      try {
        await this.activateFreeze(userId, yesterdayStr, tz, { auto: true, skipStreakSync: true });
        claimDates.add(yesterdayStr);
        await this.syncStreakRecord(userId, calculateStreak(claimDates, todayStr), null, null);
        return { broken: false, shieldApplied: true, paywallEligible: false };
      } catch (e: any) {
        if (e instanceof StreakClaimError && e.code === CLAIM_ERROR_CODES.ALREADY_CLAIMED) {
          // Protected concurrently (e.g. by a check-in) — not broken.
          return { broken: false, shieldApplied: false, paywallEligible: false };
        }
        if (!(e instanceof StreakClaimError && e.code === CLAIM_ERROR_CODES.NO_SHIELDS_AVAILABLE)) {
          throw e;
        }
        outOfShields = true; // definitionally a free user — fall through to break
      }
    }

    // Break: store the TRUE derived streak (today may already be claimed,
    // in which case the user is on a fresh 1-day run, not 0).
    await this.syncStreakRecord(userId, calculateStreak(claimDates, todayStr), null, null);

    // A user who just ran out of shields is by definition not Pro; only the
    // zombie-guard path needs a tier lookup.
    const paywallEligible = outOfShields
      ? true
      : !(await StreakShieldService.hasUnlimitedShields(userId));
    return { broken: true, shieldApplied: false, paywallEligible };
  }

  /** Length of the consecutive claimed run ending exactly at `day`. */
  private static runLengthEndingAt(claimDates: ReadonlySet<string>, day: string): number {
    let length = 0;
    let cursor = day;
    while (claimDates.has(cursor)) {
      length++;
      cursor = addDays(cursor, -1);
    }
    return length;
  }

  /** Consecutive auto-applied freeze claims ending the day before `dayStr`. */
  private static async countTrailingAutoProtects(userId: string, dayStr: string): Promise<number> {
    const supabaseAdmin = createAdminSupabase();
    const lookback = SHIELD_RULES.MAX_CONSECUTIVE_AUTO_PROTECTS + 1;
    const { data: rows } = await supabaseAdmin
      .from('streak_claims')
      .select('claim_date, claim_method, metadata')
      .eq('user_id', userId)
      .gte('claim_date', addDays(dayStr, -lookback))
      .lt('claim_date', dayStr);

    const byDate = new Map((rows || []).map(r => [r.claim_date, r]));
    let count = 0;
    for (let i = 1; i <= lookback; i++) {
      const row = byDate.get(addDays(dayStr, -i));
      if (row && row.claim_method === 'freeze' && row.metadata?.auto_applied === true) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  // ==========================================================================
  // RECOVERY
  // ==========================================================================

  /** Start a recovery attempt (Weekend Warrior or Purchased). */
  static async startRecovery(
    userId: string,
    brokenDate: Date | string,
    type: 'weekend_warrior' | 'purchased'
  ): Promise<RecoveryInfo> {
    const supabaseAdmin = createAdminSupabase();
    const brokenDateStr = toDayStr(brokenDate);

    const { data: existing } = await supabaseAdmin
      .from('streak_recoveries')
      .select('*')
      .eq('user_id', userId)
      .eq('broken_date', brokenDateStr)
      .maybeSingle();

    if (existing && existing.recovery_status === 'pending') {
      throw new StreakClaimError('Recovery already in progress', CLAIM_ERROR_CODES.RECOVERY_IN_PROGRESS);
    }

    let actionsRequired: number | null = null;
    let expiresAt: Date | null = null;
    if (type === 'weekend_warrior') {
      actionsRequired = CLAIMING_CONSTANTS.WEEKEND_WARRIOR_ACTIONS;
      expiresAt = new Date(Date.now() + CLAIMING_CONSTANTS.WEEKEND_WARRIOR_WINDOW_HOURS * 60 * 60 * 1000);
    }

    const { data: recovery, error } = await supabaseAdmin
      .from('streak_recoveries')
      .insert({
        user_id: userId,
        broken_date: brokenDateStr,
        recovery_type: type,
        recovery_status: type === 'purchased' ? 'completed' : 'pending',
        actions_required: actionsRequired,
        actions_completed: 0,
        expires_at: expiresAt?.toISOString(),
        completed_at: type === 'purchased' ? new Date().toISOString() : null,
        metadata: { started_at: new Date().toISOString() },
      })
      .select()
      .single();

    if (error) throw error;

    if (type === 'purchased') {
      await this.restoreBrokenDay(userId, brokenDateStr, recovery.id, 'purchased_recovery');
    }

    return {
      recovery,
      actionsRemaining: actionsRequired || 0,
      timeRemaining: expiresAt ? expiresAt.toISOString() : undefined,
    };
  }

  /** Complete a recovery action (Weekend Warrior). */
  static async completeRecoveryAction(userId: string, recoveryId: string): Promise<boolean> {
    const supabaseAdmin = createAdminSupabase();

    const { data: recovery } = await supabaseAdmin
      .from('streak_recoveries')
      .select('*')
      .eq('id', recoveryId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!recovery) {
      throw new StreakClaimError('Recovery not found', CLAIM_ERROR_CODES.RECOVERY_EXPIRED);
    }
    if (recovery.recovery_status !== 'pending') {
      throw new StreakClaimError('Recovery is not in pending status', CLAIM_ERROR_CODES.RECOVERY_EXPIRED);
    }
    if (recovery.expires_at && new Date(recovery.expires_at) < new Date()) {
      await supabaseAdmin.from('streak_recoveries').update({ recovery_status: 'expired' }).eq('id', recoveryId);
      throw new StreakClaimError('Recovery window expired', CLAIM_ERROR_CODES.RECOVERY_EXPIRED);
    }

    const newActionsCompleted = recovery.actions_completed + 1;
    const isComplete = newActionsCompleted >= (recovery.actions_required || 0);

    await supabaseAdmin
      .from('streak_recoveries')
      .update({
        actions_completed: newActionsCompleted,
        recovery_status: isComplete ? 'completed' : 'pending',
        completed_at: isComplete ? new Date().toISOString() : null,
      })
      .eq('id', recoveryId);

    if (isComplete) {
      await this.restoreBrokenDay(userId, recovery.broken_date, recoveryId, 'weekend_warrior_recovery');
    }

    return isComplete;
  }

  /**
   * Restoring a broken day must write a streak_claims row — the streak is
   * derived from claims, so an engagement_activities entry alone (the old
   * behavior) silently failed to restore anything.
   */
  private static async restoreBrokenDay(
    userId: string,
    brokenDateStr: string,
    recoveryId: string,
    source: string
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const tz = (await this.getLastKnownTimezone(userId)) || 'UTC';

    await supabaseAdmin.from('streak_claims').upsert(
      {
        user_id: userId,
        claim_date: brokenDateStr,
        claimed_at: new Date().toISOString(),
        claim_method: 'retroactive',
        timezone: tz,
        health_data_synced: false,
        metadata: { source, recovery_id: recoveryId },
      },
      { onConflict: 'user_id,claim_date' }
    );

    const claimDates = await this.getClaimDates(userId);
    await this.syncStreakRecord(userId, calculateStreak(claimDates, localToday(tz)), null, null);

    // Recovery is real engagement — keep the momentum system in the loop.
    try {
      await MomentumService.checkIn(userId);
    } catch (momentumError) {
      console.error('[restoreBrokenDay] momentum check-in failed (non-blocking):', momentumError);
    }
  }

  // ==========================================================================
  // HEALTH DATA
  // ==========================================================================

  static async checkHealthData(userId: string, date: string): Promise<HealthDataCheck> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('daily_tracking')
      .select('weight_kg, steps, mood_score, energy_level')
      .eq('user_id', userId)
      .eq('tracking_date', date)
      .maybeSingle();

    if (error) {
      console.error(`[checkHealthData] Error querying daily_tracking for ${date}:`, error);
    }

    const hasWeight = !!data?.weight_kg && data.weight_kg > 0;
    const hasSteps = !!data?.steps && data.steps > 0;
    const hasMood = !!data?.mood_score;
    const hasEnergy = !!data?.energy_level;

    return {
      hasWeight,
      hasSteps,
      hasMood,
      hasEnergy,
      hasAnyData: hasWeight || hasSteps || hasMood || hasEnergy,
    };
  }

  // ==========================================================================
  // CALCULATION HELPERS
  // ==========================================================================

  /** Current streak derived from claims, anchored on the user's timezone. */
  static async calculateCurrentStreak(userId: string, timezone?: string): Promise<number> {
    const tz = timezone || (await this.getLastKnownTimezone(userId)) || 'UTC';
    const claimDates = await this.getClaimDates(userId);
    return calculateStreak(claimDates, localToday(tz));
  }

  /** All claim dates for the last two years as a Set of YYYY-MM-DD. */
  private static async getClaimDates(userId: string): Promise<Set<string>> {
    const supabaseAdmin = createAdminSupabase();
    const { data: claims } = await supabaseAdmin
      .from('streak_claims')
      .select('claim_date')
      .eq('user_id', userId)
      .gte('claim_date', addDays(localToday('UTC'), -730))
      .order('claim_date', { ascending: false })
      .limit(732); // one row per day max — hard bound on the payload
    return new Set((claims || []).map(c => c.claim_date));
  }

  /** Timezone of the most recent claim — best available signal for crons. */
  private static async getLastKnownTimezone(userId: string): Promise<string | null> {
    const supabaseAdmin = createAdminSupabase();
    const { data } = await supabaseAdmin
      .from('streak_claims')
      .select('timezone')
      .eq('user_id', userId)
      .order('claim_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.timezone || null;
  }

  /**
   * Denormalize the derived streak into engagement_streaks (fast reads,
   * legacy clients) and append the history row + momentum ping for real
   * claims. Never throws — the claim itself already succeeded.
   */
  private static async syncStreakRecord(
    userId: string,
    currentStreak: number,
    claimDateStr: string | null,
    claimId: string | null
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    try {
      const { data: record } = await supabaseAdmin
        .from('engagement_streaks')
        .select('longest_streak, total_claims, paused, current_streak')
        .eq('user_id', userId)
        .maybeSingle();

      const updates: Record<string, unknown> = {
        user_id: userId,
        // Paused streaks keep their stored value — the paused gap has no
        // claims, so a recompute would wrongly collapse the number that
        // resumeStreak's bridge is going to preserve.
        current_streak: record?.paused ? record.current_streak : currentStreak,
        longest_streak: Math.max(currentStreak, record?.longest_streak || 0),
      };
      if (claimDateStr) {
        updates.last_engagement_date = claimDateStr;
        updates.last_claim_date = claimDateStr;
        updates.total_claims = (record?.total_claims || 0) + 1;
      }

      await supabaseAdmin.from('engagement_streaks').upsert(updates, { onConflict: 'user_id' });

      if (claimDateStr) {
        const { error: activityError } = await supabaseAdmin.from('engagement_activities').insert({
          user_id: userId,
          activity_date: claimDateStr,
          activity_type: 'circle_checkin',
          reference_id: claimId,
        });
        if (activityError && activityError.code !== '23505') {
          console.error('[syncStreakRecord] activity insert error:', activityError);
        }
        try {
          await MomentumService.checkIn(userId);
        } catch (momentumError) {
          console.error('[syncStreakRecord] momentum check-in failed (non-blocking):', momentumError);
        }
      }
    } catch (e: any) {
      console.error('[syncStreakRecord] error:', e.message);
    }
  }
}
