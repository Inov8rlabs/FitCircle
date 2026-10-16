/**
 * ReferralRewardService — turns earned referral rewards into Pro time.
 *
 * Ledger model (docs/REFERRALS_SPEC.md §2 "Pro time bank"):
 *  - every reward is a `referral_rewards` row, born `banked`;
 *  - while the user has NO live store subscription, banked days are folded into
 *    one `complimentary_grants` row (granted_by 'referral-program') whose expiry
 *    is pushed out by the days earned → rows flip to `applied`;
 *  - while the user IS paying (App Store / Play / Stripe), days stay banked and
 *    are applied the moment the store subscription ends — every downgrade path
 *    calls ComplimentaryGrantService.holdIfGranted, which calls applyBanked;
 *  - lifetime is a never-expiring grant ('referral-lifetime'), applied at once.
 *
 * Concurrency: rows are claimed banked→applied with a conditional update (only
 * the caller that flips a row adds its days), and the grant's expiry moves by
 * compare-and-set on its previous value, so two qualifications landing at the
 * same moment can neither double-count nor lose a week.
 */
import { REFERRAL_GRANT } from '../referrals/referral-policy';
import type { RewardKind } from '../referrals/types';
import { createAdminSupabase } from '../supabase-admin';

import { ComplimentaryGrantService, type ComplimentaryGrant } from './complimentary-grant-service';

const DAY_MS = 24 * 60 * 60 * 1000;
const PROFILE_FIELDS = 'id, subscription_tier, subscription_platform, subscription_expires_at';

export interface RewardRow {
  id: string;
  user_id: string;
  referral_id: string | null;
  kind: RewardKind;
  days: number | null;
  status: 'banked' | 'applied' | 'revoked';
  applied_at: string | null;
  seen_at: string | null;
  created_at: string;
}

export interface AwardOutcome {
  /** false when this reward already existed (idempotent replay). */
  created: boolean;
  /** true when the days are banked behind a store subscription rather than live now. */
  banked: boolean;
}

export class ReferralRewardService {
  /**
   * Record a reward and apply it if possible. Idempotent per (referral, kind)
   * and per user for lifetime — replays return `created: false`.
   */
  static async award(
    userId: string,
    kind: RewardKind,
    days: number | null,
    referralId: string | null
  ): Promise<AwardOutcome> {
    const supabase = createAdminSupabase();
    const { error } = await supabase.from('referral_rewards').insert({
      user_id: userId,
      referral_id: referralId,
      kind,
      days: kind === 'lifetime' ? null : days,
      status: 'banked',
    });
    if (error) {
      if (error.code === '23505') return { created: false, banked: false };
      throw new Error(`referral reward insert failed: ${error.message}`);
    }
    const applied = await this.applyBanked(userId);
    return { created: true, banked: kind !== 'lifetime' && applied.storeActive };
  }

  /**
   * Fold banked rewards into grant time. No-op while a store subscription is
   * live unless `storeEnded` (the caller knows the store state just lapsed).
   */
  static async applyBanked(
    userId: string,
    opts: { storeEnded?: boolean } = {}
  ): Promise<{ appliedDays: number; lifetime: boolean; storeActive: boolean }> {
    const supabase = createAdminSupabase();
    const [{ data: profile }, { data: banked }] = await Promise.all([
      supabase.from('profiles').select(PROFILE_FIELDS).eq('id', userId).maybeSingle(),
      supabase.from('referral_rewards').select('id, kind, days').eq('user_id', userId).eq('status', 'banked'),
    ]);
    const storeActive = !opts.storeEnded && !!profile && ComplimentaryGrantService.hasStoreSubscription(profile);
    const rows = (banked ?? []) as Array<Pick<RewardRow, 'id' | 'kind' | 'days'>>;
    if (!profile || rows.length === 0) return { appliedDays: 0, lifetime: false, storeActive };

    // Lifetime: applied immediately even for payers (they can cancel the store
    // plan); it supersedes every banked week.
    if (rows.some((r) => r.kind === 'lifetime')) {
      await this.ensureLifetimeGrant(userId);
      await this.claimRows(rows.map((r) => r.id));
      if (!storeActive) await this.pinProfile(userId);
      return { appliedDays: 0, lifetime: true, storeActive };
    }

    if (storeActive) return { appliedDays: 0, lifetime: false, storeActive };

    const claimed = await this.claimRows(rows.map((r) => r.id));
    const days = claimed.reduce((sum, r) => sum + (r.days ?? 0), 0);
    if (days === 0) return { appliedDays: 0, lifetime: false, storeActive };

    try {
      await this.extendGrant(userId, days);
    } catch (err) {
      // Put the rows back so the next applyBanked (cron / next event) retries.
      await supabase
        .from('referral_rewards')
        .update({ status: 'banked', applied_at: null })
        .in('id', claimed.map((r) => r.id));
      throw err;
    }
    await this.pinProfile(userId);
    return { appliedDays: days, lifetime: false, storeActive };
  }

  /**
   * Clawback for one referral (admin revoke): banked rewards are voided,
   * applied weeks are taken back off the referral grant (never below now).
   */
  static async revokeForReferral(referralId: string): Promise<{ revokedDays: number }> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('referral_rewards')
      .select('id, user_id, kind, days, status')
      .eq('referral_id', referralId);
    let revokedDays = 0;
    for (const row of (data ?? []) as RewardRow[]) {
      if (row.status === 'revoked' || row.kind === 'lifetime') continue;
      await supabase.from('referral_rewards').update({ status: 'revoked' }).eq('id', row.id);
      if (row.status === 'applied' && row.days) {
        await this.shortenGrant(row.user_id, row.days);
        revokedDays += row.days;
      }
    }
    return { revokedDays };
  }

  // --------------------------------------------------------------------------

  /** banked→applied for these ids; returns only the rows THIS call flipped. */
  private static async claimRows(ids: string[]): Promise<Array<Pick<RewardRow, 'id' | 'days'>>> {
    if (ids.length === 0) return [];
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('referral_rewards')
      .update({ status: 'applied', applied_at: new Date().toISOString() })
      .in('id', ids)
      .eq('status', 'banked')
      .select('id, days');
    if (error) throw new Error(`referral reward claim failed: ${error.message}`);
    return (data ?? []) as Array<Pick<RewardRow, 'id' | 'days'>>;
  }

  private static async activeReferralGrant(userId: string, grantedBy: string): Promise<ComplimentaryGrant | null> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('complimentary_grants')
      .select('*')
      .eq('user_id', userId)
      .eq('granted_by', grantedBy)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(5);
    const now = Date.now();
    return (
      ((data ?? []) as ComplimentaryGrant[]).find(
        (g) => !g.expires_at || new Date(g.expires_at).getTime() > now
      ) ?? null
    );
  }

  /** Push the referral grant's expiry out by `days` (creates it if needed). CAS + retry. */
  private static async extendGrant(userId: string, days: number): Promise<void> {
    const supabase = createAdminSupabase();
    for (let attempt = 0; attempt < 5; attempt++) {
      const grant = await this.activeReferralGrant(userId, REFERRAL_GRANT.timeBoxed);
      const now = Date.now();
      if (!grant) {
        const { error } = await supabase.from('complimentary_grants').insert({
          user_id: userId,
          granted_by: REFERRAL_GRANT.timeBoxed,
          note: 'Pro time earned by inviting friends',
          expires_at: new Date(now + days * DAY_MS).toISOString(),
        });
        if (error) throw new Error(`referral grant insert failed: ${error.message}`);
        return;
      }
      const from = Math.max(now, new Date(grant.expires_at!).getTime());
      const { data, error } = await supabase
        .from('complimentary_grants')
        .update({ expires_at: new Date(from + days * DAY_MS).toISOString() })
        .eq('id', grant.id)
        .eq('expires_at', grant.expires_at)
        .select('id');
      if (error) throw new Error(`referral grant extend failed: ${error.message}`);
      if ((data ?? []).length === 1) return;
      // Lost the race to another extension — re-read and retry.
    }
    throw new Error('referral grant extend: too much contention');
  }

  private static async shortenGrant(userId: string, days: number): Promise<void> {
    const supabase = createAdminSupabase();
    const grant = await this.activeReferralGrant(userId, REFERRAL_GRANT.timeBoxed);
    if (!grant?.expires_at) return;
    const target = Math.max(Date.now(), new Date(grant.expires_at).getTime() - days * DAY_MS);
    await supabase
      .from('complimentary_grants')
      .update({ expires_at: new Date(target).toISOString() })
      .eq('id', grant.id)
      .eq('expires_at', grant.expires_at);
    // A grant now at "now" is expired; the hourly referrals cron re-syncs the profile.
  }

  private static async ensureLifetimeGrant(userId: string): Promise<void> {
    if (await this.activeReferralGrant(userId, REFERRAL_GRANT.lifetime)) return;
    const supabase = createAdminSupabase();
    const { error } = await supabase.from('complimentary_grants').insert({
      user_id: userId,
      granted_by: REFERRAL_GRANT.lifetime,
      note: 'Lifetime Pro — 100 friends invited',
      expires_at: null,
    });
    if (error) throw new Error(`referral lifetime grant insert failed: ${error.message}`);
  }

  /** Pin the profile cache to the best active grant (store subscriptions are left untouched). */
  private static async pinProfile(userId: string): Promise<void> {
    const supabase = createAdminSupabase();
    const { data: profile } = await supabase.from('profiles').select(PROFILE_FIELDS).eq('id', userId).maybeSingle();
    if (profile && ComplimentaryGrantService.hasStoreSubscription(profile)) return;
    const best = await ComplimentaryGrantService.activeGrant(userId);
    if (best) await ComplimentaryGrantService.applyToProfile(userId, best);
  }
}
