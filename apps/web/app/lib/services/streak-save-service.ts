/**
 * Streak save offers (docs/ENGAGEMENT_115_SPEC.md §5.3): "save your N-day streak" for a streak
 * that broke yesterday with no shield.
 *
 *  - getOffer: GET /api/mobile/streaks/save-offer. Eligible while D (yesterday, local) is
 *    unclaimed, D−1 ends a run >= streak_save_offer_min_streak, not the zombie guard, and now is
 *    before the end of D+1 + the 3 am grace. Marks the offer row opened (creating it on demand).
 *  - markSaved: POST /api/streaks/freeze/activate on that day marks the row saved.
 *  - applyAfterPurchase: RevenueCat webhook backstop — a user who opened an offer and then went
 *    Pro gets the day protected (unlimited shields), once.
 *
 * Fail-soft until migration 138: no streak_save_offers table → offers are computed but not
 * stored (offer_id null), and nothing is marked.
 */
import { logIgnoredQueryError } from '@/lib/api/route-errors';

import { saveOfferExpiresAt, trailingAutoShields } from '../journey/dont-miss-twice';
import { RemoteConfigService } from '../remote-config/service';
import { addDays, localToday } from '../streaks/streak-calculator';
import { GRACE_PERIOD_HOURS, SHIELD_RULES } from '../streaks/streak-config';
import { createAdminSupabase } from '../supabase-admin';
import { CLAIM_ERROR_CODES, StreakClaimError } from '../types/streak-claiming';

import { toClaimMap } from './dont-miss-twice-service';
import { StreakClaimingService } from './streak-claiming-service';

export type SaveOfferIneligibleReason = 'nothing_to_save' | 'expired' | 'zombie_guard' | 'too_short';

export type SaveOfferResponse =
  | {
      eligible: true;
      offer_id: string | null;
      missed_date: string;
      lost_streak: number;
      restored_streak: number;
      expires_at: string;
      path: 'activate' | 'paywall';
      shields_available: number;
      unlimited: boolean;
    }
  | { eligible: false; reason: SaveOfferIneligibleReason };

type SaveMethod = 'shield' | 'pro_unlimited' | 'after_purchase';

const isMissingRelation = (e: { code?: string } | null | undefined) => !!e && ['42P01', 'PGRST205', 'PGRST204', '42703'].includes(e.code ?? '');

function runLength(claims: ReadonlyMap<string, unknown>, day: string): number {
  let n = 0;
  for (let cursor = day; claims.has(cursor); cursor = addDays(cursor, -1)) n++;
  return n;
}

export class StreakSaveService {
  /**
   * `peek` (GET ?peek=1): read-only — no row is created and opened_at is never set, so dashboard
   * / Streaks card checks can poll it without arming the post-purchase webhook rescue. Only a
   * real open (push tap, card tap → save sheet / paywall) calls it without peek.
   */
  static async getOffer(userId: string, opts: { timezone?: string | null; now?: Date; peek?: boolean } = {}): Promise<SaveOfferResponse> {
    const now = opts.now ?? new Date();
    const tz = await StreakClaimingService.resolveTimezone(userId, opts.timezone ?? null);
    const today = localToday(tz);
    const db = createAdminSupabase();
    const { data: rows, error } = await db
      .from('streak_claims')
      .select('claim_date, claim_method, metadata')
      .eq('user_id', userId)
      .gte('claim_date', addDays(today, -40));
    if (error) throw error;
    const claims = toClaimMap((rows ?? []) as Array<Record<string, any>>);

    // Inside the 3 am grace the missed day is the day before yesterday (its offer is still open).
    const candidates = [addDays(today, -1), addDays(today, -2)];
    let missed: string | null = null;
    for (const d of candidates) {
      if (claims.has(d)) continue;
      if (now.getTime() < saveOfferExpiresAt(d, tz, GRACE_PERIOD_HOURS).getTime() && claims.has(addDays(d, -1))) {
        missed = d;
        break;
      }
    }
    if (!missed) {
      const d = candidates[0];
      if (!claims.has(d) && claims.has(addDays(d, -1))) return { eligible: false, reason: 'expired' };
      // D−2 broke and its window closed.
      if (!claims.has(candidates[1]) && claims.has(addDays(candidates[1], -1)) && !claims.has(d)) return { eligible: false, reason: 'expired' };
      return { eligible: false, reason: 'nothing_to_save' };
    }

    const lost = runLength(claims, addDays(missed, -1));
    const minStreak = await RemoteConfigService.value('streak_save_offer_min_streak', { userId }).catch(() => 3);
    if (trailingAutoShields(claims, addDays(missed, -1)) >= SHIELD_RULES.MAX_CONSECUTIVE_AUTO_PROTECTS) return { eligible: false, reason: 'zombie_guard' };
    if (lost < minStreak) return { eligible: false, reason: 'too_short' };

    const expiresAt = saveOfferExpiresAt(missed, tz, GRACE_PERIOD_HOURS);
    const shields = await StreakClaimingService.getAvailableShields(userId);
    const path = shields.unlimited || shields.total > 0 ? 'activate' : 'paywall';
    // Restoring D re-joins the run; any claims after D (today) continue it.
    let after = 0;
    for (let day = addDays(missed, 1); day <= today && claims.has(day); day = addDays(day, 1)) after++;
    const offerId = opts.peek ? await this.existingOfferId(userId, missed) : await this.openOffer(userId, missed, lost, expiresAt, now);
    return {
      eligible: true,
      offer_id: offerId,
      missed_date: missed,
      lost_streak: lost,
      restored_streak: lost + 1 + after,
      expires_at: expiresAt.toISOString(),
      path,
      shields_available: shields.unlimited ? 0 : shields.total,
      unlimited: shields.unlimited,
    };
  }

  /** The stored offer id for (user, D), if any. Read-only. */
  private static async existingOfferId(userId: string, missedDate: string): Promise<string | null> {
    const { data, error } = await createAdminSupabase()
      .from('streak_save_offers')
      .select('id')
      .eq('user_id', userId)
      .eq('missed_date', missedDate)
      .maybeSingle();
    if (error) {
      if (!isMissingRelation(error)) logIgnoredQueryError('StreakSaveService.existingOfferId', error);
      return null;
    }
    return (data?.id as string | undefined) ?? null;
  }

  /** Upsert the offer row for (user, D) and stamp opened_at (first open only). Null when not stored. */
  private static async openOffer(userId: string, missedDate: string, lostStreak: number, expiresAt: Date, now: Date): Promise<string | null> {
    const db = createAdminSupabase();
    const { data: existing, error } = await db
      .from('streak_save_offers')
      .select('id, opened_at, status')
      .eq('user_id', userId)
      .eq('missed_date', missedDate)
      .maybeSingle();
    if (error) {
      if (!isMissingRelation(error)) logIgnoredQueryError('StreakSaveService.openOffer', error);
      return null;
    }
    if (existing) {
      if (!existing.opened_at) {
        const { error: updateError } = await db.from('streak_save_offers').update({ opened_at: now.toISOString() }).eq('id', existing.id).is('opened_at', null);
        logIgnoredQueryError('StreakSaveService.openOffer', updateError);
      }
      return existing.id as string;
    }
    const { data: created, error: insertError } = await db
      .from('streak_save_offers')
      .insert({ user_id: userId, missed_date: missedDate, lost_streak: lostStreak, status: 'offered', expires_at: expiresAt.toISOString(), opened_at: now.toISOString() })
      .select('id')
      .single();
    if (insertError?.code === '23505') return this.openOffer(userId, missedDate, lostStreak, expiresAt, now);
    if (insertError) {
      if (!isMissingRelation(insertError)) logIgnoredQueryError('StreakSaveService.openOffer', insertError);
      return null;
    }
    return (created?.id as string | undefined) ?? null;
  }

  /** An activate on `date` saved the streak: mark the matching offered row saved. Never throws. */
  static async markSaved(userId: string, date: string, method: SaveMethod, now: Date = new Date()): Promise<boolean> {
    try {
      const { data, error } = await createAdminSupabase()
        .from('streak_save_offers')
        .update({ status: 'saved', method, saved_at: now.toISOString() })
        .eq('user_id', userId)
        .eq('missed_date', date)
        .eq('status', 'offered')
        .select('id');
      if (error) {
        if (!isMissingRelation(error)) logIgnoredQueryError('StreakSaveService.markSaved', error);
        return false;
      }
      return (data ?? []).length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Webhook backstop (§5.3): the user went Pro. Every offered + opened + unexpired offer gets
   * its day protected (Pro consumes nothing) and is marked saved (after_purchase) — once: the
   * status guard makes a second delivery a no-op, and a day the client already saved
   * (ALREADY_CLAIMED) is left to the client's markSaved. Never throws.
   */
  static async applyAfterPurchase(userId: string, now: Date = new Date()): Promise<number> {
    try {
      const db = createAdminSupabase();
      const { data, error } = await db
        .from('streak_save_offers')
        .select('id, missed_date, opened_at, expires_at')
        .eq('user_id', userId)
        .eq('status', 'offered')
        .gt('expires_at', now.toISOString());
      if (error) {
        if (!isMissingRelation(error)) logIgnoredQueryError('StreakSaveService.applyAfterPurchase', error);
        return 0;
      }
      let saved = 0;
      for (const offer of (data ?? []) as Array<{ id: string; missed_date: string; opened_at: string | null }>) {
        if (!offer.opened_at) continue;
        try {
          await StreakClaimingService.activateFreeze(userId, offer.missed_date);
        } catch (e) {
          if (e instanceof StreakClaimError && e.code === CLAIM_ERROR_CODES.ALREADY_CLAIMED) continue;
          console.error('[StreakSaveService.applyAfterPurchase] activate failed:', e instanceof Error ? e.message : String(e));
          continue;
        }
        const { data: marked } = await db
          .from('streak_save_offers')
          .update({ status: 'saved', method: 'after_purchase', saved_at: now.toISOString() })
          .eq('id', offer.id)
          .eq('status', 'offered')
          .select('id');
        if ((marked ?? []).length > 0) saved++;
      }
      return saved;
    } catch (e) {
      console.error('[StreakSaveService.applyAfterPurchase] swallowed:', e instanceof Error ? e.message : String(e));
      return 0;
    }
  }
}
