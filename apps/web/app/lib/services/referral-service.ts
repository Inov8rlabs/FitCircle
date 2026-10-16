/**
 * ReferralService — "Better Together" invites (docs/REFERRALS_SPEC.md).
 *
 *   attribution  claim(): invitee ← inviter, once, within 7 days of signup,
 *                with self/cycle/device checks. Circle joins attribute too.
 *   qualification evaluate(): the invitee finished onboarding and logged a
 *                activity on 3 different days (non-freeze streak_claims) within 14
 *                days → inviter +7 days, invitee +7 days, lifetime at 100.
 *                Driven by the activity hook (StreakClaimingService) with the
 *                hourly /api/cron/referrals as the safety net.
 *   hub          getHub(): everything the invite hub, home card and wizard show.
 *
 * Rewards are applied by ReferralRewardService (Pro time bank).
 */
import { createHash } from 'node:crypto';

import {
  circleInviteUrl,
  circleShareMessage,
  classifyCode,
  generateReferralCode,
  normalizeCode,
  personalInviteUrl,
  personalShareMessage,
} from '../referrals/links';
import {
  MILESTONES,
  REFERRAL_POLICY,
  inviteeRewardDays,
  isDisposableEmail,
} from '../referrals/referral-policy';
import {
  ReferralError,
  type ClaimInput,
  type ClaimResult,
  type InviteContactsInput,
  type InviteContactsResult,
  type NudgeResult,
  type ReferralHub,
  type ReferralPreview,
  type ReferralStatus,
  type RewardKind,
} from '../referrals/types';
import { createAdminSupabase } from '../supabase-admin';

import { FeatureFlagService } from './feature-flag-service';
import { ReferralInviteService, joinedNudgeState } from './referral-invite-service';
import { ReferralRewardService } from './referral-reward-service';

const DAY_MS = 24 * 60 * 60 * 1000;

interface ReferralRow {
  id: string;
  invitee_id: string;
  inviter_id: string | null;
  code: string;
  circle_id: string | null;
  source: string;
  status: ReferralStatus;
  status_reason: string | null;
  attributed_at: string;
  qualified_at: string | null;
}

interface ProfileLite {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface CircleLite {
  id: string;
  name: string;
  invite_code: string;
  creator_id: string;
  type: string | null;
  status?: string | null;
  end_date?: string | null;
}

interface Resolved {
  inviterId: string;
  code: string;
  circle: CircleLite | null;
}

export function firstNameOf(p: Pick<ProfileLite, 'display_name' | 'username'> | null | undefined): string {
  const name = (p?.display_name || p?.username || '').trim();
  return name.split(/\s+/)[0] || 'A friend';
}

export function hashDeviceId(deviceId: string): string {
  const salt = process.env.REFERRAL_DEVICE_SALT || 'fitcircle-referrals';
  return createHash('sha256').update(`${salt}:${deviceId.trim().toLowerCase()}`).digest('hex');
}

/**
 * Send a referral push. Resolves true when it is "handled": delivered, or the
 * user switched that category off (retrying would be noise). Quiet hours, no
 * registered device, or a failure resolve false so the hourly cron retries.
 * Never throws — referral pushes must not break the request that caused them.
 */
async function deliver(userId: string, type: string, data: Record<string, unknown>): Promise<boolean> {
  try {
    const { NotificationOrchestrator } = await import('./notification-orchestrator');
    const out = await NotificationOrchestrator.send(userId, type as any, data);
    return out.sent || out.reason === 'category_disabled';
  } catch (err: any) {
    console.error('[ReferralService] push failed:', type, err?.message);
    return false;
  }
}

/** Fire-and-forget variant for pushes with no delivery bookkeeping (lifetime, nudges). */
function notify(userId: string, type: string, data: Record<string, unknown>): void {
  void deliver(userId, type, data);
}

export class ReferralService {
  // ==========================================================================
  // Program switch + codes
  // ==========================================================================

  /** feature_flags 'referrals' AND the subscription surface (rewards are Pro time). Fail-closed. */
  static async isProgramEnabled(userId: string): Promise<boolean> {
    try {
      const supabase = createAdminSupabase();
      const [referrals, subscriptions] = await Promise.all([
        FeatureFlagService.isFeatureEnabled('referrals', userId, supabase),
        FeatureFlagService.isFeatureEnabled('subscriptions', userId, supabase),
      ]);
      return referrals.enabled === true && subscriptions.enabled === true;
    } catch {
      return false;
    }
  }

  static async getOrCreateCode(userId: string): Promise<string> {
    const supabase = createAdminSupabase();
    const { data: existing } = await supabase
      .from('referral_codes')
      .select('code')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing?.code) return existing.code;

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username')
      .eq('id', userId)
      .maybeSingle();
    const stem = firstNameOf(profile as ProfileLite | null);
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateReferralCode(attempt < 6 ? stem : null);
      const { error } = await supabase.from('referral_codes').insert({ user_id: userId, code });
      if (!error) return code;
      if (error.code !== '23505') throw new Error(`referral code insert failed: ${error.message}`);
      // Either the code collided (retry) or a concurrent request created ours.
      const { data: raced } = await supabase
        .from('referral_codes')
        .select('code')
        .eq('user_id', userId)
        .maybeSingle();
      if (raced?.code) return raced.code;
    }
    throw new Error('could not allocate a referral code');
  }

  // ==========================================================================
  // Resolution + preview
  // ==========================================================================

  /** Resolve a personal or circle code (+ optional personal `ref`) to an inviter. */
  static async resolve(rawCode: string, rawRef?: string | null): Promise<Resolved | null> {
    const supabase = createAdminSupabase();
    const code = normalizeCode(rawCode);
    const kind = classifyCode(code);
    if (!kind) return null;

    const ownerOf = async (ref: string): Promise<string | null> => {
      if (classifyCode(ref) !== 'personal') return null;
      const { data } = await supabase.from('referral_codes').select('user_id').eq('code', ref).maybeSingle();
      return data?.user_id ?? null;
    };

    if (kind === 'personal') {
      const inviterId = await ownerOf(code);
      return inviterId ? { inviterId, code, circle: null } : null;
    }

    // Circle codes are stored as FITXXXXXX or FIT-XXXXXX; accept either spelling.
    const variants = Array.from(new Set([code, code.replace('-', ''), code.replace(/^FIT-?/, 'FIT-')]));
    const { data: circles } = await supabase
      .from('fitcircles')
      .select('id, name, invite_code, creator_id, type, status, end_date')
      .in('invite_code', variants)
      .limit(1);
    const circle = (circles?.[0] as CircleLite | undefined) ?? null;
    if (!circle) return null;
    const ref = normalizeCode(rawRef);
    const inviterId = (ref && (await ownerOf(ref))) || circle.creator_id;
    return { inviterId, code: ref && inviterId !== circle.creator_id ? ref : circle.invite_code, circle };
  }

  static async preview(rawCode: string, rawRef?: string | null): Promise<ReferralPreview> {
    const resolved = await this.resolve(rawCode, rawRef);
    if (!resolved) return { valid: false };
    const supabase = createAdminSupabase();
    const { data: inviter } = await supabase
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .eq('id', resolved.inviterId)
      .maybeSingle();
    if (!inviter) return { valid: false };

    let circle: ReferralPreview['circle'] = null;
    if (resolved.circle) {
      const { members, count } = await this.circleMembers(resolved.circle.id, 5);
      circle = {
        name: resolved.circle.name,
        inviteCode: resolved.circle.invite_code,
        memberCount: count,
        memberAvatars: members.map((m) => m.avatar_url).filter((u): u is string => !!u),
        challengeType: resolved.circle.type ?? null,
      };
    }
    const p = inviter as ProfileLite;
    return {
      valid: true,
      kind: resolved.circle ? 'circle' : 'personal',
      code: normalizeCode(rawCode),
      inviter: {
        firstName: firstNameOf(p),
        displayName: p.display_name || p.username || firstNameOf(p),
        avatarUrl: p.avatar_url ?? null,
      },
      circle,
      inviteeRewardDays: inviteeRewardDays(),
    };
  }

  // ==========================================================================
  // Attribution
  // ==========================================================================

  static async claim(inviteeId: string, input: ClaimInput): Promise<ClaimResult> {
    const supabase = createAdminSupabase();
    if (!(await this.isProgramEnabled(inviteeId))) {
      throw new ReferralError('PROGRAM_DISABLED', 'Invites are not available right now');
    }

    const resolved = await this.resolve(input.code, input.ref);
    if (!resolved) throw new ReferralError('INVALID_CODE', "That invite code doesn't exist");
    if (resolved.inviterId === inviteeId) {
      throw new ReferralError('SELF_REFERRAL', "You can't use your own invite");
    }

    const existing = await this.referralFor(inviteeId);
    if (existing) {
      throw new ReferralError(
        'ALREADY_ATTRIBUTED',
        'This account already joined with an invite',
        await this.inviterSummary(existing.inviter_id)
      );
    }

    const { data: invitee } = await supabase
      .from('profiles')
      .select('id, created_at')
      .eq('id', inviteeId)
      .maybeSingle();
    if (!invitee) throw new ReferralError('INVALID_CODE', 'Account not found');
    const ageMs = Date.now() - new Date(invitee.created_at).getTime();
    if (ageMs > REFERRAL_POLICY.attributionWindowDays * DAY_MS) {
      throw new ReferralError('WINDOW_CLOSED', 'Invite codes can only be used by new accounts');
    }

    // A↔B cycles: the inviter can't have been invited by this invitee.
    const { data: reverse } = await supabase
      .from('referrals')
      .select('id')
      .eq('invitee_id', resolved.inviterId)
      .eq('inviter_id', inviteeId)
      .maybeSingle();
    if (reverse) throw new ReferralError('SELF_REFERRAL', "You can't use this invite");

    // Device: a phone that belongs to the inviter, or to any account older
    // than this one, is not a new person. Recorded as a rejected referral so
    // retries resolve as ALREADY_ATTRIBUTED and the audit trail survives.
    let deviceHash: string | null = null;
    let deviceVerdict: string | null = null;
    if (input.deviceId && input.deviceId.trim().length >= 8) {
      deviceHash = hashDeviceId(input.deviceId);
      deviceVerdict = await this.deviceVerdict(deviceHash, inviteeId, resolved.inviterId, invitee.created_at);
      await this.recordDeviceHash(deviceHash, inviteeId);
    }

    const { data: inserted, error } = await supabase
      .from('referrals')
      .insert({
        invitee_id: inviteeId,
        inviter_id: resolved.inviterId,
        code: resolved.code,
        circle_id: resolved.circle?.id ?? null,
        source: input.source,
        status: deviceVerdict ? 'rejected' : 'pending',
        status_reason: deviceVerdict,
        invitee_device_hash: deviceHash,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        const raced = await this.referralFor(inviteeId);
        throw new ReferralError(
          'ALREADY_ATTRIBUTED',
          'This account already joined with an invite',
          await this.inviterSummary(raced?.inviter_id ?? null)
        );
      }
      throw new Error(`referral insert failed: ${error.message}`);
    }
    if (deviceVerdict) {
      throw new ReferralError('DEVICE_INELIGIBLE', 'This invite can only be used on a new device');
    }

    const referral = inserted as ReferralRow;
    const [inviter, inviteeProfile, { data: contact }] = await Promise.all([
      this.profile(resolved.inviterId),
      this.profile(inviteeId),
      supabase.from('profiles').select('email, phone_number').eq('id', inviteeId).maybeSingle(),
    ]);
    // Their email/text invite (if any) now shows as "Joined" in the inviter's list.
    await ReferralInviteService.markJoined(resolved.inviterId, referral.id, {
      email: contact?.email ?? null,
      phone: contact?.phone_number ?? null,
    }).catch((err) => console.error('[ReferralService] markJoined failed:', err?.message));
    void this.notifyFriendJoined(referral.id, resolved.inviterId, firstNameOf(inviteeProfile));

    // The invitee may already have logged activity (claim on day 3, say).
    await this.evaluate(referral).catch((err) =>
      console.error('[ReferralService] evaluate after claim failed:', referral.id, err?.message)
    );

    return {
      status: referral.status,
      inviter: { firstName: firstNameOf(inviter), avatarUrl: inviter?.avatar_url ?? null },
      circle: resolved.circle
        ? { id: resolved.circle.id, name: resolved.circle.name, inviteCode: resolved.circle.invite_code }
        : null,
      inviteeRewardDays: inviteeRewardDays(),
    };
  }

  /** Best-effort attribution after a circle join (`POST /api/mobile/circles/join`). Never throws. */
  static async attributeCircleJoin(inviteeId: string, inviteCode: string, ref?: string | null): Promise<void> {
    try {
      await this.claim(inviteeId, { code: inviteCode, ref: ref ?? null, source: 'circle_join' });
    } catch (err) {
      if (!(err instanceof ReferralError)) {
        console.error('[ReferralService] circle-join attribution failed:', inviteeId, (err as Error)?.message);
      }
    }
  }

  /** Remember an install id for this account (hub fetches carry X-FitCircle-Device). */
  static async recordDevice(userId: string, deviceId: string | null | undefined): Promise<void> {
    if (!deviceId || deviceId.trim().length < 8) return;
    await this.recordDeviceHash(hashDeviceId(deviceId), userId).catch(() => {});
  }

  private static async recordDeviceHash(deviceHash: string, userId: string): Promise<void> {
    const supabase = createAdminSupabase();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('referral_devices')
      .insert({ device_hash: deviceHash, user_id: userId, first_seen_at: now, last_seen_at: now });
    if (error?.code === '23505') {
      await supabase
        .from('referral_devices')
        .update({ last_seen_at: now })
        .eq('device_hash', deviceHash)
        .eq('user_id', userId);
    }
  }

  private static async deviceVerdict(
    deviceHash: string,
    inviteeId: string,
    inviterId: string,
    inviteeCreatedAt: string
  ): Promise<string | null> {
    const supabase = createAdminSupabase();
    const { data } = await supabase.from('referral_devices').select('user_id').eq('device_hash', deviceHash);
    const others = ((data ?? []) as Array<{ user_id: string }>)
      .map((r) => r.user_id)
      .filter((id) => id !== inviteeId);
    if (others.length === 0) return null;
    if (others.includes(inviterId)) return 'device_matches_inviter';
    const { data: olderAccounts } = await supabase
      .from('profiles')
      .select('id')
      .in('id', others)
      .lt('created_at', inviteeCreatedAt);
    return (olderAccounts ?? []).length > 0 ? 'device_reused' : null;
  }

  // ==========================================================================
  // Qualification
  // ==========================================================================

  /** Activity hook — called (fire-and-forget) whenever the user logs something. */
  static async onActivity(userId: string): Promise<void> {
    const referral = await this.referralFor(userId);
    if (referral?.status === 'pending') await this.evaluate(referral);
  }

  /** Move a pending referral forward if its conditions are now met. Idempotent. */
  static async evaluate(referral: ReferralRow): Promise<ReferralStatus> {
    if (referral.status !== 'pending') return referral.status;
    const supabase = createAdminSupabase();

    const deadline = new Date(referral.attributed_at).getTime() + REFERRAL_POLICY.qualifyWindowDays * DAY_MS;
    const { data: invitee } = await supabase
      .from('profiles')
      .select('id, email, onboarding_completed')
      .eq('id', referral.invitee_id)
      .maybeSingle();
    if (!invitee) return referral.status;

    const days = await this.activityDays(referral.invitee_id, new Date(deadline));
    await this.recordProgress(referral, days);
    const active = invitee.onboarding_completed === true && days >= REFERRAL_POLICY.qualifyingDays;
    if (!active) {
      if (Date.now() > deadline) {
        await this.transition(referral.id, 'pending', 'rejected', 'qualify_window_expired');
        return 'rejected';
      }
      return 'pending';
    }

    if (isDisposableEmail(invitee.email)) {
      await this.transition(referral.id, 'pending', 'rejected', 'disposable_email');
      return 'rejected';
    }

    let next: ReferralStatus = 'qualified';
    if (referral.inviter_id) {
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const { count } = await supabase
        .from('referrals')
        .select('id', { count: 'exact', head: true })
        .eq('inviter_id', referral.inviter_id)
        .eq('status', 'qualified')
        .gte('qualified_at', since);
      if ((count ?? 0) >= REFERRAL_POLICY.velocityPer24h) next = 'review';
    }

    const won = await this.transition(referral.id, 'pending', next, next === 'review' ? 'velocity' : null);
    if (!won) return referral.status; // another worker got here first
    if (next === 'qualified') await this.payOut({ ...referral, status: 'qualified' });
    return next;
  }

  /** Admin: approve a referral held for review. */
  static async approve(referralId: string, reviewer: string): Promise<boolean> {
    const referral = await this.referralById(referralId);
    if (!referral || referral.status !== 'review') return false;
    const won = await this.transition(referral.id, 'review', 'qualified', null, reviewer);
    if (won) await this.payOut({ ...referral, status: 'qualified' });
    return won;
  }

  /** Admin: revoke (fraud). Takes back the weeks this referral paid. */
  static async revoke(referralId: string, reviewer: string, reason: string): Promise<boolean> {
    const referral = await this.referralById(referralId);
    if (!referral || referral.status === 'revoked') return false;
    const supabase = createAdminSupabase();
    await supabase
      .from('referrals')
      .update({ status: 'revoked', status_reason: reason.slice(0, 200), reviewed_by: reviewer })
      .eq('id', referralId);
    await ReferralRewardService.revokeForReferral(referralId);
    return true;
  }

  static async listForReview(status: ReferralStatus = 'review', limit = 100): Promise<ReferralRow[]> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('referrals')
      .select('*')
      .eq('status', status)
      .order('attributed_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as ReferralRow[];
  }

  /** Cron safety net: re-evaluate every pending referral (activity hook misses, window expiry). */
  static async evaluatePending(limit = 500): Promise<{ checked: number; qualified: number; rejected: number }> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('referrals')
      .select('*')
      .eq('status', 'pending')
      .order('attributed_at', { ascending: true })
      .limit(limit);
    let qualified = 0;
    let rejected = 0;
    for (const row of (data ?? []) as ReferralRow[]) {
      try {
        const next = await this.evaluate(row);
        if (next === 'qualified') qualified++;
        if (next === 'rejected') rejected++;
      } catch (err: any) {
        console.error('[ReferralService] evaluate failed:', row.id, err?.message);
      }
    }
    return { checked: data?.length ?? 0, qualified, rejected };
  }

  private static async payOut(referral: ReferralRow): Promise<void> {
    const supabase = createAdminSupabase();
    const [invitee, inviter] = await Promise.all([this.profile(referral.invitee_id), this.profile(referral.inviter_id)]);
    await ReferralInviteService.markQualified(referral.id).catch(() => {});

    let inviterBanked = false;
    if (referral.inviter_id) {
      const outcome = await ReferralRewardService.award(
        referral.inviter_id,
        'inviter_week',
        REFERRAL_POLICY.inviterRewardDays,
        referral.id
      );
      inviterBanked = outcome.banked;
      if (outcome.created) await this.deliverReward(referral, 'inviter_week', { banked: outcome.banked });
      const { count } = await supabase
        .from('referrals')
        .select('id', { count: 'exact', head: true })
        .eq('inviter_id', referral.inviter_id)
        .eq('status', 'qualified');
      if ((count ?? 0) >= REFERRAL_POLICY.lifetimeThreshold) {
        const lifetime = await ReferralRewardService.award(referral.inviter_id, 'lifetime', null, referral.id);
        if (lifetime.created) await this.deliverReward(referral, 'lifetime', {});
      }
    }

    const days = inviteeRewardDays();
    if (days > 0) {
      const outcome = await ReferralRewardService.award(referral.invitee_id, 'invitee_welcome', days, referral.id);
      if (outcome.created) await this.deliverReward(referral, 'invitee_welcome', { banked: outcome.banked });
    }

    // "You and {friend} each earned a week" — one email to each side.
    await this.emailRewards(referral, inviter, invitee, inviterBanked).catch((err) =>
      console.error('[ReferralService] reward emails failed:', referral.id, err?.message)
    );
  }

  /** Push for a reward; stamps notified_at when handled so the cron stops retrying. */
  private static async deliverReward(
    referral: ReferralRow,
    kind: RewardKind,
    opts: { banked?: boolean }
  ): Promise<void> {
    const supabase = createAdminSupabase();
    const [invitee, inviter] = await Promise.all([this.profile(referral.invitee_id), this.profile(referral.inviter_id)]);
    const target = kind === 'invitee_welcome' ? referral.invitee_id : referral.inviter_id;
    if (!target) return;
    const type =
      kind === 'lifetime'
        ? 'referral_lifetime'
        : kind === 'invitee_welcome'
          ? 'referral_invitee_welcome'
          : opts.banked
            ? 'referral_reward_banked'
            : 'referral_reward_earned';
    const handled = await deliver(target, type, {
      friendName: firstNameOf(invitee),
      inviterName: firstNameOf(inviter),
      days: kind === 'invitee_welcome' ? inviteeRewardDays() : REFERRAL_POLICY.inviterRewardDays,
    });
    if (handled) {
      await supabase
        .from('referral_rewards')
        .update({ notified_at: new Date().toISOString() })
        .eq('referral_id', referral.id)
        .eq('kind', kind);
    }
  }

  private static async notifyFriendJoined(referralId: string, inviterId: string, friendName: string): Promise<void> {
    const handled = await deliver(inviterId, 'referral_friend_joined', { friendName });
    if (handled) {
      await createAdminSupabase()
        .from('referrals')
        .update({ inviter_notified_at: new Date().toISOString() })
        .eq('id', referralId);
    }
  }

  private static async emailRewards(
    referral: ReferralRow,
    inviter: ProfileLite | null,
    invitee: ProfileLite | null,
    inviterBanked: boolean
  ): Promise<void> {
    const supabase = createAdminSupabase();
    const { data: rows } = await supabase
      .from('referral_rewards')
      .select('id, user_id, kind, days, emailed_at')
      .eq('referral_id', referral.id);
    const ids = [referral.invitee_id, referral.inviter_id].filter((id): id is string => !!id);
    const { data: contacts } = await supabase.from('profiles').select('id, email').in('id', ids);
    const emailOf = new Map(((contacts ?? []) as Array<{ id: string; email: string | null }>).map((c) => [c.id, c.email]));
    for (const row of (rows ?? []) as Array<{ id: string; user_id: string; kind: RewardKind; days: number | null; emailed_at: string | null }>) {
      if (row.emailed_at || row.kind === 'lifetime' || !row.days) continue;
      const isInviter = row.kind === 'inviter_week';
      const me = isInviter ? inviter : invitee;
      const friend = isInviter ? invitee : inviter;
      if (!me || !friend) continue;
      const code = await this.getOrCreateCode(row.user_id);
      const sent = await ReferralInviteService.sendRewardEmail(emailOf.get(row.user_id), {
        recipientFirstName: firstNameOf(me),
        friendFirstName: firstNameOf(friend),
        days: row.days,
        role: isInviter ? 'inviter' : 'invitee',
        banked: isInviter ? inviterBanked : false,
        inviteLink: personalInviteUrl(code),
      });
      if (sent) await supabase.from('referral_rewards').update({ emailed_at: new Date().toISOString() }).eq('id', row.id);
    }
  }

  /**
   * Cron: re-send referral pushes that weren't delivered (quiet hours, no device
   * yet, transient failure) until handled or 48h old.
   */
  static async retryUndeliveredPushes(): Promise<{ rewards: number; joins: number }> {
    const supabase = createAdminSupabase();
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: rewards } = await supabase
      .from('referral_rewards')
      .select('referral_id, kind, status, notified_at, created_at')
      .is('notified_at', null)
      .neq('status', 'revoked')
      .gte('created_at', since)
      .limit(200);
    let rewardCount = 0;
    for (const r of (rewards ?? []) as Array<{ referral_id: string | null; kind: RewardKind; status: string }>) {
      if (!r.referral_id) continue;
      const referral = await this.referralById(r.referral_id);
      if (!referral || referral.status !== 'qualified') continue;
      await this.deliverReward(referral, r.kind, { banked: r.status === 'banked' });
      rewardCount++;
    }
    const { data: joins } = await supabase
      .from('referrals')
      .select('*')
      .is('inviter_notified_at', null)
      .in('status', ['pending', 'qualified', 'review'])
      .gte('attributed_at', since)
      .limit(200);
    let joinCount = 0;
    for (const j of (joins ?? []) as ReferralRow[]) {
      if (!j.inviter_id) continue;
      const invitee = await this.profile(j.invitee_id);
      await this.notifyFriendJoined(j.id, j.inviter_id, firstNameOf(invitee));
      joinCount++;
    }
    return { rewards: rewardCount, joins: joinCount };
  }

  // ==========================================================================
  // v2: invite by email / text, nudges (docs/REFERRALS_SPEC.md §9)
  // ==========================================================================

  static async inviteContacts(userId: string, input: InviteContactsInput): Promise<InviteContactsResult> {
    if (!(await this.isProgramEnabled(userId))) {
      throw new ReferralError('PROGRAM_DISABLED', 'Invites are not available right now');
    }
    return ReferralInviteService.inviteContacts(userId, input, (id) => this.getOrCreateCode(id));
  }

  static async nudge(userId: string, target: { inviteId?: string; referralId?: string }): Promise<NudgeResult> {
    if (target.inviteId) return ReferralInviteService.nudgeInvite(userId, target.inviteId, (id) => this.getOrCreateCode(id));
    if (!target.referralId) return { status: 'not_nudgeable', nextAt: null, remaining: 0, smsBody: null };

    const supabase = createAdminSupabase();
    const referral = (await this.referralById(target.referralId)) as (ReferralRow & { nudge_count?: number; last_nudged_at?: string | null }) | null;
    if (!referral || referral.inviter_id !== userId) return { status: 'not_nudgeable', nextAt: null, remaining: 0, smsBody: null };
    const state = joinedNudgeState(referral);
    if (referral.status !== 'pending') return { status: 'not_nudgeable', nextAt: null, remaining: 0, smsBody: null };
    if (state.remaining === 0) return { status: 'limit_reached', nextAt: null, remaining: 0, smsBody: null };
    if (!state.available) return { status: 'too_soon', nextAt: state.nextAt, remaining: state.remaining, smsBody: null };

    const count = referral.nudge_count ?? 0;
    const now = new Date().toISOString();
    const { data: claimed } = await supabase
      .from('referrals')
      .update({ nudge_count: count + 1, last_nudged_at: now })
      .eq('id', referral.id)
      .eq('nudge_count', count)
      .select('id');
    if ((claimed ?? []).length !== 1) return { status: 'too_soon', nextAt: null, remaining: state.remaining, smsBody: null };
    const inviter = await this.profile(userId);
    notify(referral.invitee_id, 'referral_nudge', { inviterName: firstNameOf(inviter) });
    const after = joinedNudgeState({ status: 'pending', nudge_count: count + 1, last_nudged_at: now });
    return { status: 'sent', nextAt: after.nextAt, remaining: after.remaining, smsBody: null };
  }

  /** Signed up with an email a member invited? Attribute to the earliest inviter (once, in-window). */
  static async autoAttributeByEmail(userId: string): Promise<boolean> {
    if (await this.referralFor(userId)) return false;
    const supabase = createAdminSupabase();
    const { data: me } = await supabase.from('profiles').select('email').eq('id', userId).maybeSingle();
    const invite = await ReferralInviteService.findInviteForEmail(me?.email, userId);
    if (!invite) return false;
    const code = await this.getOrCreateCode(invite.inviter_id);
    let circleCode: string | null = null;
    if (invite.circle_id) {
      const { data: c } = await supabase.from('fitcircles').select('invite_code').eq('id', invite.circle_id).maybeSingle();
      circleCode = c?.invite_code ?? null;
    }
    try {
      await this.claim(userId, circleCode ? { code: circleCode, ref: code, source: 'email_invite' } : { code, source: 'email_invite' });
      return true;
    } catch (err) {
      if (!(err instanceof ReferralError)) console.error('[ReferralService] email attribution failed:', (err as Error)?.message);
      return false;
    }
  }

  /**
   * Distinct days with real activity (a non-freeze streak_claims row — every
   * food/exercise/check-in log auto-claims its day) up to the deadline.
   */
  static async activityDays(userId: string, deadline: Date = new Date()): Promise<number> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('streak_claims')
      .select('claim_date, claim_method')
      .eq('user_id', userId)
      .limit(400);
    const cutoff = deadline.toISOString().slice(0, 10);
    const days = new Set(
      ((data ?? []) as Array<{ claim_date: string; claim_method: string | null }>)
        // Shield freezes protect a streak without any logging — they don't count.
        .filter((r) => r.claim_method !== 'freeze' && String(r.claim_date) <= cutoff)
        .map((r) => String(r.claim_date))
    );
    return days.size;
  }

  /**
   * Persist the friend's progress (drives the "Sam · 2/3" bar) and, the first
   * time they're one day away, give the invitee a single gentle push.
   */
  private static async recordProgress(referral: ReferralRow, days: number): Promise<void> {
    const supabase = createAdminSupabase();
    const row = referral as ReferralRow & { progress_days?: number; progress_notified_days?: number };
    const capped = Math.min(days, REFERRAL_POLICY.qualifyingDays);
    if ((row.progress_days ?? 0) !== capped) {
      await supabase.from('referrals').update({ progress_days: capped }).eq('id', referral.id);
    }
    const oneAway = REFERRAL_POLICY.qualifyingDays - 1;
    if (capped === oneAway && oneAway > 0 && (row.progress_notified_days ?? 0) < oneAway) {
      const { data: claimed } = await supabase
        .from('referrals')
        .update({ progress_notified_days: oneAway })
        .eq('id', referral.id)
        .lt('progress_notified_days', oneAway)
        .select('id');
      if ((claimed ?? []).length === 1) {
        const inviter = await this.profile(referral.inviter_id);
        notify(referral.invitee_id, 'referral_progress', { inviterName: firstNameOf(inviter) });
      }
    }
  }


  /** Conditional status move; true only for the caller that made it. */
  private static async transition(
    id: string,
    from: ReferralStatus,
    to: ReferralStatus,
    reason: string | null,
    reviewer?: string
  ): Promise<boolean> {
    const supabase = createAdminSupabase();
    const patch: Record<string, unknown> = { status: to, status_reason: reason };
    if (to === 'qualified') patch.qualified_at = new Date().toISOString();
    if (reviewer) patch.reviewed_by = reviewer;
    const { data, error } = await supabase
      .from('referrals')
      .update(patch)
      .eq('id', id)
      .eq('status', from)
      .select('id');
    if (error) throw new Error(`referral transition failed: ${error.message}`);
    return (data ?? []).length === 1;
  }

  // ==========================================================================
  // Hub
  // ==========================================================================

  static async getHub(userId: string): Promise<ReferralHub> {
    if (!(await this.isProgramEnabled(userId))) return { enabled: false };
    const supabase = createAdminSupabase();
    const code = await this.getOrCreateCode(userId);
    const shareUrl = personalInviteUrl(code);
    await this.autoAttributeByEmail(userId).catch(() => false);

    const [{ data: me }, { data: referralRows }, { data: rewardRows }, asInvitee] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, username, created_at, subscription_tier, subscription_platform, subscription_product_id, subscription_expires_at')
        .eq('id', userId)
        .maybeSingle(),
      supabase
        .from('referrals')
        .select('*')
        .eq('inviter_id', userId)
        .order('attributed_at', { ascending: false })
        .limit(200),
      supabase
        .from('referral_rewards')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(500),
      this.referralFor(userId),
    ]);

    const referrals = ((referralRows ?? []) as ReferralRow[]).filter((r) => r.status !== 'revoked');
    const rewards = ((rewardRows ?? []) as Array<{
      id: string;
      kind: RewardKind;
      days: number | null;
      status: string;
      seen_at: string | null;
      created_at: string;
      referral_id: string | null;
    }>).filter((r) => r.status !== 'revoked');

    // Names for invitees, circles, and the people behind unseen rewards.
    const rewardReferralIds = rewards.filter((r) => !r.seen_at && r.referral_id).map((r) => r.referral_id!);
    const extraReferrals = rewardReferralIds.filter((id) => !referrals.some((r) => r.id === id));
    const { data: extraRows } = extraReferrals.length
      ? await supabase.from('referrals').select('*').in('id', extraReferrals)
      : { data: [] as ReferralRow[] };
    const allReferrals = [...referrals, ...((extraRows ?? []) as ReferralRow[])];
    const profileIds = Array.from(
      new Set(allReferrals.flatMap((r) => [r.invitee_id, r.inviter_id]).filter((id): id is string => !!id))
    );
    const circleIds = Array.from(new Set(referrals.map((r) => r.circle_id).filter((id): id is string => !!id)));
    const [{ data: people }, { data: circles }] = await Promise.all([
      profileIds.length
        ? supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', profileIds)
        : Promise.resolve({ data: [] as ProfileLite[] }),
      circleIds.length
        ? supabase.from('fitcircles').select('id, name').in('id', circleIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    ]);
    const personById = new Map(((people ?? []) as ProfileLite[]).map((p) => [p.id, p]));
    const circleName = new Map(((circles ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
    const referralById = new Map(allReferrals.map((r) => [r.id, r]));

    const qualified = referrals.filter((r) => r.status === 'qualified').length;
    const pending = referrals.filter((r) => r.status === 'pending' || r.status === 'review').length;
    const inviterRewards = rewards.filter((r) => r.kind === 'inviter_week');
    const daysEarned = inviterRewards.reduce((s, r) => s + (r.days ?? 0), 0);
    const daysBanked = rewards.filter((r) => r.status === 'banked').reduce((s, r) => s + (r.days ?? 0), 0);
    const hasLifetime = rewards.some((r) => r.kind === 'lifetime');

    const milestones = MILESTONES.map((m) => ({ ...m, reached: qualified >= m.count || (m.key === 'lifetime' && hasLifetime) }));
    const upcoming = MILESTONES.find((m) => qualified < m.count && !(m.key === 'lifetime' && hasLifetime));

    const pro = this.proStatus(me, hasLifetime, daysBanked);
    const starter = await this.starterCircle(userId, code);
    const ageMs = me ? Date.now() - new Date(me.created_at).getTime() : Infinity;

    return {
      enabled: true,
      code,
      shareUrl,
      shareMessage: personalShareMessage(shareUrl),
      program: {
        rewardDaysPerFriend: REFERRAL_POLICY.inviterRewardDays,
        qualifyingDays: REFERRAL_POLICY.qualifyingDays,
        qualifyWindowDays: REFERRAL_POLICY.qualifyWindowDays,
        lifetimeThreshold: REFERRAL_POLICY.lifetimeThreshold,
        inviteeRewardDays: inviteeRewardDays(),
        attributionWindowDays: REFERRAL_POLICY.attributionWindowDays,
      },
      stats: {
        invited: referrals.length,
        pending,
        qualified,
        daysEarned,
        daysBanked,
        hasLifetime,
        toLifetime: hasLifetime ? 0 : Math.max(0, REFERRAL_POLICY.lifetimeThreshold - qualified),
      },
      milestones,
      nextMilestone: upcoming ? { ...upcoming, remaining: upcoming.count - qualified } : null,
      invitees: referrals.map((r) => {
        const p = personById.get(r.invitee_id);
        return {
          id: r.id,
          displayName: p?.display_name || p?.username || 'New friend',
          avatarUrl: p?.avatar_url ?? null,
          status: r.status as 'pending' | 'qualified' | 'review' | 'rejected',
          joinedAt: r.attributed_at,
          qualifiedAt: r.qualified_at,
          circleName: r.circle_id ? circleName.get(r.circle_id) ?? null : null,
          nudge: joinedNudgeState(r as ReferralRow & { nudge_count?: number; last_nudged_at?: string | null }),
          progress: this.progressView(r),
        };
      }),
      invites: await ReferralInviteService.listForHub(userId),
      ...ReferralInviteService.messages(firstNameOf(me as ProfileLite | null), code, starter ?? null),
      pendingCircleInvite: await this.pendingCircleInvite(userId, asInvitee),
      pro,
      unseenRewards: rewards
        .filter((r) => !r.seen_at && Date.now() - new Date(r.created_at).getTime() < 30 * DAY_MS)
        .map((r) => {
          const ref = r.referral_id ? referralById.get(r.referral_id) : undefined;
          const otherId = r.kind === 'invitee_welcome' ? ref?.inviter_id : ref?.invitee_id;
          const other = otherId ? personById.get(otherId) : undefined;
          return {
            id: r.id,
            kind: r.kind,
            days: r.days,
            friendName: other ? firstNameOf(other) : null,
            createdAt: r.created_at,
          };
        }),
      starterCircle: starter,
      canClaimCode: !asInvitee && ageMs <= REFERRAL_POLICY.attributionWindowDays * DAY_MS,
      referredBy: asInvitee ? await this.inviterSummary(asInvitee.inviter_id) : null,
      myReward: await this.myRewardView(asInvitee),
      activation: await this.activation(userId, me?.created_at ?? null),
    };
  }

  static async markRewardsSeen(userId: string, ids: string[]): Promise<number> {
    const clean = ids.filter((id) => typeof id === 'string' && id.length > 0).slice(0, 100);
    if (clean.length === 0) return 0;
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('referral_rewards')
      .update({ seen_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('id', clean)
      .is('seen_at', null)
      .select('id');
    if (error) throw new Error(`mark seen failed: ${error.message}`);
    return (data ?? []).length;
  }

  /** Share payload for a circle's invite link (used by the invite-link route). */
  static async circleShare(userId: string, circle: { invite_code: string; name: string }) {
    const code = await this.getOrCreateCode(userId);
    const url = circleInviteUrl(circle.invite_code, code);
    return { referralCode: code, url, message: circleShareMessage(circle.name, url) };
  }

  // ==========================================================================
  // helpers
  // ==========================================================================

  private static proStatus(
    me: {
      subscription_tier: string | null;
      subscription_platform: string | null;
      subscription_product_id: string | null;
      subscription_expires_at: string | null;
    } | null,
    hasLifetime: boolean,
    bankedDays: number
  ): NonNullable<ReferralHub['pro']> {
    const premium = me?.subscription_tier === 'premium' || me?.subscription_tier === 'enterprise';
    const platform = me?.subscription_platform ?? null;
    const source = !premium
      ? 'none'
      : platform === 'promotional'
        ? me?.subscription_product_id === 'referral'
          ? 'referral'
          : 'complimentary'
        : 'store';
    return {
      source,
      expiresAt: premium ? me?.subscription_expires_at ?? null : null,
      // Never-expiring premium = lifetime (referral lifetime grant or a store lifetime purchase).
      lifetime: hasLifetime || (premium && !me?.subscription_expires_at),
      bankedDays,
    };
  }

  private static progressView(r: ReferralRow): { days: number; required: number; deadline: string } {
    const required = REFERRAL_POLICY.qualifyingDays;
    const stored = (r as ReferralRow & { progress_days?: number }).progress_days ?? 0;
    return {
      days: r.status === 'qualified' ? required : Math.min(stored, required),
      required,
      deadline: new Date(new Date(r.attributed_at).getTime() + REFERRAL_POLICY.qualifyWindowDays * DAY_MS).toISOString(),
    };
  }

  /**
   * Activation (north-star input, REFERRALS_SPEC §10.6): within the first 7
   * days — in a circle of 3+, logged on 3+ different days, and got a friend's
   * reaction. Circle size is evaluated live.
   */
  static async activation(userId: string, createdAt: string | null): Promise<NonNullable<ReferralHub['activation']>> {
    const supabase = createAdminSupabase();
    const start = createdAt ? new Date(createdAt) : new Date();
    const windowEnd = new Date(start.getTime() + 7 * DAY_MS);
    const [{ data: memberships }, loggedDays, { data: myMessages }] = await Promise.all([
      supabase.from('fitcircle_members').select('fitcircle_id').eq('user_id', userId).eq('status', 'active'),
      this.activityDays(userId, windowEnd),
      supabase
        .from('circle_messages')
        .select('id')
        .eq('sender_id', userId)
        .lt('created_at', windowEnd.toISOString())
        .limit(200),
    ]);
    const circleIds = ((memberships ?? []) as Array<{ fitcircle_id: string }>).map((m) => m.fitcircle_id);
    let circleOf3 = false;
    if (circleIds.length) {
      const { data: members } = await supabase
        .from('fitcircle_members')
        .select('fitcircle_id')
        .in('fitcircle_id', circleIds)
        .eq('status', 'active');
      const counts = new Map<string, number>();
      for (const m of (members ?? []) as Array<{ fitcircle_id: string }>) counts.set(m.fitcircle_id, (counts.get(m.fitcircle_id) ?? 0) + 1);
      circleOf3 = [...counts.values()].some((n) => n >= 3);
    }
    let reactionReceived = false;
    const messageIds = ((myMessages ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (messageIds.length) {
      const { data: reactions } = await supabase
        .from('circle_message_reactions')
        .select('user_id')
        .in('message_id', messageIds)
        .neq('user_id', userId)
        .lt('created_at', windowEnd.toISOString())
        .limit(1);
      reactionReceived = (reactions ?? []).length > 0;
    }
    const loggedDays3 = loggedDays >= 3;
    return {
      activated: circleOf3 && loggedDays3 && reactionReceived,
      circleOf3,
      loggedDays3,
      reactionReceived,
      windowEndsAt: windowEnd.toISOString(),
    };
  }

  /** The invitee's own path to their free week ("2 of 3 check-ins — 1 more unlocks it"). */
  private static async myRewardView(asInvitee: ReferralRow | null): Promise<ReferralHub['myReward']> {
    if (!asInvitee || (asInvitee.status !== 'pending' && asInvitee.status !== 'qualified')) return null;
    const days = inviteeRewardDays();
    if (days === 0) return null;
    const inviter = await this.profile(asInvitee.inviter_id);
    return {
      ...this.progressView(asInvitee),
      status: asInvitee.status === 'qualified' ? 'unlocked' : 'in_progress',
      rewardDays: days,
      inviterFirstName: firstNameOf(inviter),
    };
  }

  /** An email-matched (or link) invitee who hasn't joined the inviter's circle yet. */
  private static async pendingCircleInvite(
    userId: string,
    asInvitee: ReferralRow | null
  ): Promise<ReferralHub['pendingCircleInvite']> {
    if (!asInvitee?.circle_id || asInvitee.status === 'rejected' || asInvitee.status === 'revoked') return null;
    const supabase = createAdminSupabase();
    const [{ data: member }, { data: circle }] = await Promise.all([
      supabase
        .from('fitcircle_members')
        .select('id')
        .eq('fitcircle_id', asInvitee.circle_id)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle(),
      supabase.from('fitcircles').select('id, name, invite_code, status, end_date').eq('id', asInvitee.circle_id).maybeSingle(),
    ]);
    if (member || !circle?.invite_code || circle.status === 'completed') return null;
    if (circle.end_date && new Date(circle.end_date).getTime() < Date.now()) return null;
    const ref = asInvitee.inviter_id
      ? (await supabase.from('referral_codes').select('code').eq('user_id', asInvitee.inviter_id).maybeSingle()).data?.code ?? null
      : null;
    return { circleId: circle.id, name: circle.name, inviteCode: circle.invite_code, ref };
  }

  private static async starterCircle(userId: string, code: string): Promise<ReferralHub['starterCircle']> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('fitcircles')
      .select('id, name, invite_code, creator_id, type, status, end_date')
      .eq('creator_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    const now = Date.now();
    const circle = ((data ?? []) as CircleLite[]).find(
      (c) => !!c.invite_code && c.status !== 'completed' && c.status !== 'cancelled' && (!c.end_date || new Date(c.end_date).getTime() > now)
    );
    if (!circle) return null;
    const { count } = await this.circleMembers(circle.id, 0);
    const url = circleInviteUrl(circle.invite_code, code);
    return {
      id: circle.id,
      name: circle.name,
      inviteCode: circle.invite_code,
      memberCount: count,
      shareUrl: url,
      shareMessage: circleShareMessage(circle.name, url),
    };
  }

  private static async circleMembers(circleId: string, take: number): Promise<{ members: ProfileLite[]; count: number }> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', circleId)
      .eq('status', 'active')
      .limit(200);
    const ids = ((data ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
    if (take === 0 || ids.length === 0) return { members: [], count: ids.length };
    const { data: people } = await supabase
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .in('id', ids.slice(0, take));
    return { members: (people ?? []) as ProfileLite[], count: ids.length };
  }

  private static async referralFor(inviteeId: string): Promise<ReferralRow | null> {
    const supabase = createAdminSupabase();
    const { data } = await supabase.from('referrals').select('*').eq('invitee_id', inviteeId).maybeSingle();
    return (data as ReferralRow | null) ?? null;
  }

  private static async referralById(id: string): Promise<ReferralRow | null> {
    const supabase = createAdminSupabase();
    const { data } = await supabase.from('referrals').select('*').eq('id', id).maybeSingle();
    return (data as ReferralRow | null) ?? null;
  }

  private static async profile(id: string | null): Promise<ProfileLite | null> {
    if (!id) return null;
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .eq('id', id)
      .maybeSingle();
    return (data as ProfileLite | null) ?? null;
  }

  private static async inviterSummary(id: string | null): Promise<{ firstName: string; avatarUrl: string | null } | null> {
    const p = await this.profile(id);
    return p ? { firstName: firstNameOf(p), avatarUrl: p.avatar_url ?? null } : null;
  }
}
