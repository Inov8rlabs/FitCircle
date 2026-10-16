/**
 * ComplimentaryGrantService — free Pro for friends, testers and support cases,
 * issued from the backend without a store purchase.
 *
 * Model: `complimentary_grants` rows are the audit trail; the profile's
 * `subscription_*` columns are the entitlement cache the apps read (through
 * EntitlementService / UsageService / ads). While a grant is ACTIVE the profile
 * is pinned to premium/promotional, and every path that could downgrade it
 * (RevenueCat webhooks, the reconcile cron, the post-purchase sync fallback)
 * asks `activeGrant()` first and re-applies the grant instead of downgrading.
 *
 * A real store purchase always wins over a grant: purchase events overwrite the
 * profile with the store state, and when that store subscription later expires
 * the grant (if still active) takes over again.
 */
import { createAdminSupabase } from '../supabase-admin';

export interface ComplimentaryGrant {
  id: string;
  user_id: string;
  granted_by: string;
  note: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface GrantInput {
  /** Profile id (uuid) or account email — one of the two. */
  userId?: string;
  email?: string;
  /** ISO timestamp; omit for "until revoked". */
  expiresAt?: string | null;
  note?: string;
  grantedBy: string;
}

export class GrantError extends Error {
  constructor(
    message: string,
    public readonly code: 'USER_NOT_FOUND' | 'ALREADY_ACTIVE' | 'NOT_FOUND' | 'INVALID'
  ) {
    super(message);
  }
}

export function isReferralGrant(grant: Pick<ComplimentaryGrant, 'granted_by'>): boolean {
  return grant.granted_by === 'referral-program' || grant.granted_by === 'referral-lifetime';
}

const PROFILE_FIELDS = 'id, email, subscription_tier, subscription_platform, subscription_status, subscription_expires_at';

export class ComplimentaryGrantService {
  /**
   * The user's best active grant, or null. A user can hold several at once (an
   * admin grant plus referral time), so "best" = never-expiring first, then the
   * latest expiry — that is the grant the profile should be pinned to.
   */
  static async activeGrant(userId: string): Promise<ComplimentaryGrant | null> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('complimentary_grants')
      .select('*')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    const now = Date.now();
    const active = ((data ?? []) as ComplimentaryGrant[]).filter(
      (g) => !g.expires_at || new Date(g.expires_at).getTime() > now
    );
    if (active.length === 0) return null;
    return active.reduce((best, g) => {
      if (!best.expires_at) return best;
      if (!g.expires_at) return g;
      return new Date(g.expires_at).getTime() > new Date(best.expires_at).getTime() ? g : best;
    });
  }

  /** Grant Pro. Idempotent per user: an existing active grant is an error so intent is explicit. */
  static async grant(input: GrantInput): Promise<{ grant: ComplimentaryGrant; userId: string; email: string | null }> {
    const supabase = createAdminSupabase();
    const profile = await this.resolveProfile(input.userId, input.email);
    if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) {
      throw new GrantError('expiresAt must be an ISO timestamp', 'INVALID');
    }
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
      throw new GrantError('expiresAt is in the past', 'INVALID');
    }
    const existing = await this.activeGrant(profile.id);
    // Referral-earned time doesn't block an explicit admin grant.
    if (existing && !isReferralGrant(existing)) {
      throw new GrantError('User already has an active complimentary grant', 'ALREADY_ACTIVE');
    }

    const { data: grant, error } = await supabase
      .from('complimentary_grants')
      .insert({
        user_id: profile.id,
        granted_by: input.grantedBy,
        note: input.note ?? null,
        expires_at: input.expiresAt ?? null,
      })
      .select('*')
      .single();
    if (error || !grant) throw new Error(`grant insert failed: ${error?.message}`);

    // Only pin the profile if the user is not already premium through a store —
    // a paid subscription's state must keep flowing from RevenueCat untouched.
    if (!this.hasStoreSubscription(profile)) {
      // Pin to the best grant — an existing lifetime referral grant outranks a time-boxed admin one.
      await this.applyToProfile(profile.id, (await this.activeGrant(profile.id)) ?? grant);
    }
    return { grant, userId: profile.id, email: profile.email ?? null };
  }

  /** Revoke the active grant. The profile drops to free unless a store subscription is active. */
  static async revoke(input: { userId?: string; email?: string; revokedBy: string }): Promise<{ userId: string }> {
    const supabase = createAdminSupabase();
    const profile = await this.resolveProfile(input.userId, input.email);
    const { data: grants } = await supabase
      .from('complimentary_grants')
      .select('*')
      .eq('user_id', profile.id)
      .is('revoked_at', null)
      .limit(20);
    const now = Date.now();
    // Admin revoke targets admin-issued grants; referral-earned time is the user's.
    const grant = ((grants ?? []) as ComplimentaryGrant[]).find(
      (g) => !isReferralGrant(g) && (!g.expires_at || new Date(g.expires_at).getTime() > now)
    );
    if (!grant) throw new GrantError('No active complimentary grant for this user', 'NOT_FOUND');

    const { error } = await supabase
      .from('complimentary_grants')
      .update({ revoked_at: new Date().toISOString(), revoked_by: input.revokedBy })
      .eq('id', grant.id);
    if (error) throw new Error(`grant revoke failed: ${error.message}`);

    // Earned referral time (if any) keeps the user premium.
    if (!this.hasStoreSubscription(profile) && !(await this.holdIfGranted(profile.id))) {
      await supabase
        .from('profiles')
        .update({
          subscription_tier: 'free',
          subscription_status: 'cancelled',
          subscription_platform: null,
          subscription_product_id: null,
          subscription_expires_at: null,
          subscription_will_renew: false,
          subscription_synced_at: new Date().toISOString(),
        })
        .eq('id', profile.id);
    }
    return { userId: profile.id };
  }

  /** Active grants with the account email, newest first. */
  static async list(): Promise<Array<ComplimentaryGrant & { email: string | null }>> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('complimentary_grants')
      .select('*, profiles!inner(email)')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(500);
    const now = Date.now();
    return (data ?? [])
      .filter((g: any) => !g.expires_at || new Date(g.expires_at).getTime() > now)
      .map(({ profiles, ...g }: any) => ({ ...g, email: profiles?.email ?? null }));
  }

  /** Pin the profile's entitlement cache to this grant. */
  static async applyToProfile(userId: string, grant: ComplimentaryGrant): Promise<void> {
    const supabase = createAdminSupabase();
    const { error } = await supabase
      .from('profiles')
      .update({
        subscription_tier: 'premium',
        subscription_status: 'active',
        subscription_platform: 'promotional',
        // 'referral' lets clients say "earned by inviting friends" (entitlements subscription.source).
        subscription_product_id: isReferralGrant(grant) ? 'referral' : 'complimentary',
        subscription_expires_at: grant.expires_at,
        subscription_will_renew: false,
        subscription_synced_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (error) throw new Error(`profile update failed: ${error.message}`);
  }

  /**
   * Called by every downgrade path. If the user holds an active grant, re-apply
   * it and return true (caller must NOT downgrade); otherwise return false.
   */
  static async holdIfGranted(userId: string): Promise<boolean> {
    // The store subscription just ended (that's why we're here): this is the
    // moment banked referral days start counting. Lazy import — the reward
    // service depends on this one.
    try {
      const { ReferralRewardService } = await import('./referral-reward-service');
      await ReferralRewardService.applyBanked(userId, { storeEnded: true });
    } catch (err: any) {
      console.error('[ComplimentaryGrantService] applying banked referral days failed:', userId, err?.message);
    }
    const grant = await this.activeGrant(userId);
    if (!grant) return false;
    await this.applyToProfile(userId, grant);
    return true;
  }

  static hasStoreSubscription(p: { subscription_tier: string | null; subscription_platform: string | null; subscription_expires_at: string | null }): boolean {
    if (p.subscription_tier !== 'premium' && p.subscription_tier !== 'enterprise') return false;
    if (!p.subscription_platform || p.subscription_platform === 'promotional') return false;
    return !p.subscription_expires_at || new Date(p.subscription_expires_at).getTime() > Date.now();
  }

  private static async resolveProfile(userId?: string, email?: string) {
    const supabase = createAdminSupabase();
    let query = supabase.from('profiles').select(PROFILE_FIELDS);
    if (userId) query = query.eq('id', userId);
    else if (email) query = query.ilike('email', email.trim());
    else throw new GrantError('userId or email is required', 'INVALID');
    const { data } = await query.maybeSingle();
    if (!data) throw new GrantError('No account matches that user id / email', 'USER_NOT_FOUND');
    return data as { id: string; email: string | null; subscription_tier: string | null; subscription_platform: string | null; subscription_status: string | null; subscription_expires_at: string | null };
  }
}
