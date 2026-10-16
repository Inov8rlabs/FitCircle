import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralFakeDb, getReferralDb, setReferralDb } from './referral-fake-db';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
const flags = vi.hoisted(() => ({ referrals: true, subscriptions: true }));
vi.mock('../feature-flag-service', () => ({
  FeatureFlagService: {
    isFeatureEnabled: async (name: 'referrals' | 'subscriptions') => ({ enabled: flags[name] }),
  },
}));
const sent = vi.hoisted(() => [] as Array<{ userId: string; type: string; data: any }>);
vi.mock('../notification-orchestrator', () => ({
  NotificationOrchestrator: {
    send: async (userId: string, type: string, data: any) => {
      sent.push({ userId, type, data });
      return { sent: true };
    },
  },
}));

import { ComplimentaryGrantService } from '../complimentary-grant-service';
import { ReferralRewardService } from '../referral-reward-service';
import { ReferralService } from '../referral-service';
import { ReferralError } from '../../referrals/types';

const DAY = 24 * 60 * 60 * 1000;
const MAYA = '11111111-1111-4111-8111-111111111111';
const SAM = '22222222-2222-4222-8222-222222222222';
const JO = '33333333-3333-4333-8333-333333333333';
const CIRCLE = '44444444-4444-4444-8444-444444444444';

let db: ReferralFakeDb;

const flush = () => new Promise((r) => setTimeout(r, 0));

function referralOf(inviteeId: string) {
  return db.rows('referrals').find((r) => r.invitee_id === inviteeId)!;
}
function grantsOf(userId: string) {
  return db.rows('complimentary_grants').filter((g) => g.user_id === userId && !g.revoked_at);
}
function daysLeft(iso: string) {
  return Math.round((new Date(iso).getTime() - Date.now()) / DAY);
}
function logActivity(userId: string, method = 'manual_entry') {
  db.rows('streak_claims').push({ id: `c-${Math.random()}`, user_id: userId, claim_method: method });
}
async function claimPersonal(inviteeId: string, extra: Partial<{ deviceId: string }> = {}) {
  const code = await ReferralService.getOrCreateCode(MAYA);
  return ReferralService.claim(inviteeId, { code, source: 'typed', ...extra });
}

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  sent.length = 0;
  flags.referrals = true;
  flags.subscriptions = true;
  db.addProfile({ id: MAYA, display_name: 'Maya Rao', created_at: new Date(Date.now() - 90 * DAY).toISOString() });
  db.addProfile({ id: SAM, display_name: 'Sam Lee', onboarding_completed: false });
  db.addProfile({ id: JO, display_name: 'Jo', created_at: new Date(Date.now() - 60 * DAY).toISOString() });
  db.rows('fitcircles').push({
    id: CIRCLE,
    name: 'Morning Movers',
    invite_code: 'FITAB12CD',
    creator_id: JO,
    type: 'step_count',
    status: 'active',
    end_date: null,
    created_at: new Date().toISOString(),
  });
  db.rows('fitcircle_members').push({ fitcircle_id: CIRCLE, user_id: JO, status: 'active' });
});

describe('codes', () => {
  it('creates one stable code per user from the first name', async () => {
    const a = await ReferralService.getOrCreateCode(MAYA);
    const b = await ReferralService.getOrCreateCode(MAYA);
    expect(a).toBe(b);
    expect(a).toMatch(/^MAYA[A-Z0-9]{3}$/);
    expect(db.rows('referral_codes')).toHaveLength(1);
  });
});

describe('preview', () => {
  it('resolves a personal code', async () => {
    const code = await ReferralService.getOrCreateCode(MAYA);
    const p = await ReferralService.preview(code.toLowerCase());
    expect(p).toMatchObject({ valid: true, kind: 'personal', inviter: { firstName: 'Maya' }, circle: null, inviteeRewardDays: 7 });
  });

  it('resolves a circle code with and without a member ref', async () => {
    const noRef = await ReferralService.preview('fit-ab12cd');
    expect(noRef).toMatchObject({ valid: true, kind: 'circle', inviter: { firstName: 'Jo' }, circle: { name: 'Morning Movers', memberCount: 1 } });
    const code = await ReferralService.getOrCreateCode(MAYA);
    const withRef = await ReferralService.preview('FITAB12CD', code);
    expect(withRef.inviter?.firstName).toBe('Maya');
  });

  it('answers valid:false for unknown or malformed codes', async () => {
    expect(await ReferralService.preview('NOPE99')).toEqual({ valid: false });
    expect(await ReferralService.preview('!!')).toEqual({ valid: false });
  });
});

describe('claim (attribution)', () => {
  it('attributes a new account and pings the inviter', async () => {
    const result = await claimPersonal(SAM);
    expect(result).toMatchObject({ status: 'pending', inviter: { firstName: 'Maya' }, circle: null, inviteeRewardDays: 7 });
    expect(referralOf(SAM)).toMatchObject({ inviter_id: MAYA, status: 'pending', source: 'typed' });
    await flush();
    expect(sent).toContainEqual({ userId: MAYA, type: 'referral_friend_joined', data: { friendName: 'Sam' } });
  });

  it('attributes circle codes to the creator, or to the sharing member via ref', async () => {
    await ReferralService.claim(SAM, { code: 'FITAB12CD', source: 'universal_link' });
    expect(referralOf(SAM)).toMatchObject({ inviter_id: JO, circle_id: CIRCLE });

    const other = '55555555-5555-4555-8555-555555555555';
    db.addProfile({ id: other, display_name: 'Ana' });
    const ref = await ReferralService.getOrCreateCode(MAYA);
    const r = await ReferralService.claim(other, { code: 'FITAB12CD', ref, source: 'universal_link' });
    expect(referralOf(other)).toMatchObject({ inviter_id: MAYA, circle_id: CIRCLE });
    expect(r.circle).toMatchObject({ id: CIRCLE, name: 'Morning Movers' });
  });

  it('rejects self-referral, duplicates, old accounts and bad codes', async () => {
    const code = await ReferralService.getOrCreateCode(MAYA);
    await expect(ReferralService.claim(MAYA, { code, source: 'typed' })).rejects.toMatchObject({ code: 'SELF_REFERRAL', status: 400 });
    await expect(ReferralService.claim(SAM, { code: 'ZZZZ999', source: 'typed' })).rejects.toMatchObject({ code: 'INVALID_CODE', status: 404 });
    await expect(ReferralService.claim(JO, { code, source: 'typed' })).rejects.toMatchObject({ code: 'WINDOW_CLOSED', status: 422 });
    await ReferralService.claim(SAM, { code, source: 'typed' });
    const dup = await ReferralService.claim(SAM, { code, source: 'typed' }).catch((e) => e);
    expect(dup).toBeInstanceOf(ReferralError);
    expect(dup).toMatchObject({ code: 'ALREADY_ATTRIBUTED', status: 409, data: { firstName: 'Maya' } });
  });

  it('blocks A↔B cycles', async () => {
    const samCode = await ReferralService.getOrCreateCode(SAM);
    const fresh = '66666666-6666-4666-8666-666666666666';
    db.addProfile({ id: fresh, display_name: 'Lee' });
    // fresh invited SAM…
    db.rows('referrals').push({ id: 'r-x', invitee_id: SAM, inviter_id: fresh, status: 'pending', attributed_at: new Date().toISOString() });
    // …so SAM's code can't attribute fresh.
    await expect(ReferralService.claim(fresh, { code: samCode, source: 'typed' })).rejects.toMatchObject({ code: 'SELF_REFERRAL' });
  });

  it('rejects the inviter’s own phone and records it so retries are no-ops', async () => {
    await ReferralService.recordDevice(MAYA, 'IDFV-AAAA-BBBB');
    await expect(claimPersonal(SAM, { deviceId: 'idfv-aaaa-bbbb' })).rejects.toMatchObject({ code: 'DEVICE_INELIGIBLE' });
    expect(referralOf(SAM)).toMatchObject({ status: 'rejected', status_reason: 'device_matches_inviter' });
    await expect(claimPersonal(SAM)).rejects.toMatchObject({ code: 'ALREADY_ATTRIBUTED' });
    await flush();
    expect(sent.filter((s) => s.type === 'referral_friend_joined')).toHaveLength(0);
  });

  it('rejects a phone already used by an older account', async () => {
    await ReferralService.recordDevice(JO, 'device-123456');
    await expect(claimPersonal(SAM, { deviceId: 'device-123456' })).rejects.toMatchObject({ code: 'DEVICE_INELIGIBLE' });
    expect(referralOf(SAM).status_reason).toBe('device_reused');
  });

  it('is unavailable when the program switch is off', async () => {
    flags.referrals = false;
    await expect(claimPersonal(SAM)).rejects.toMatchObject({ code: 'PROGRAM_DISABLED', status: 403 });
    expect(await ReferralService.getHub(MAYA)).toEqual({ enabled: false });
  });

  it('circle-join attribution never throws', async () => {
    await expect(ReferralService.attributeCircleJoin(MAYA, 'FITAB12CD', null)).resolves.toBeUndefined(); // old account
    await ReferralService.attributeCircleJoin(SAM, 'FITAB12CD', null);
    expect(referralOf(SAM)).toMatchObject({ source: 'circle_join', inviter_id: JO });
  });
});

describe('qualification + rewards', () => {
  it('stays pending until onboarding is done AND a first activity is logged', async () => {
    await claimPersonal(SAM);
    logActivity(SAM);
    await ReferralService.onActivity(SAM);
    expect(referralOf(SAM).status).toBe('pending'); // onboarding not finished
    logActivity(SAM, 'freeze');
    db.profile(SAM)!.onboarding_completed = true;
    db.rows('streak_claims').splice(0); // only a shield freeze → not activity
    logActivity(SAM, 'freeze');
    await ReferralService.onActivity(SAM);
    expect(referralOf(SAM).status).toBe('pending');
  });

  it('pays both sides a week and celebrates', async () => {
    await claimPersonal(SAM);
    db.profile(SAM)!.onboarding_completed = true;
    logActivity(SAM);
    await ReferralService.onActivity(SAM);

    expect(referralOf(SAM)).toMatchObject({ status: 'qualified' });
    const [mayaGrant] = grantsOf(MAYA);
    expect(mayaGrant).toMatchObject({ granted_by: 'referral-program' });
    expect(daysLeft(mayaGrant.expires_at)).toBe(7);
    expect(daysLeft(grantsOf(SAM)[0].expires_at)).toBe(7);
    expect(db.profile(MAYA)).toMatchObject({
      subscription_tier: 'premium',
      subscription_platform: 'promotional',
      subscription_product_id: 'referral',
    });
    await flush();
    expect(sent.map((s) => s.type)).toEqual(
      expect.arrayContaining(['referral_reward_earned', 'referral_invitee_welcome'])
    );

    // Replays are no-ops.
    await ReferralService.evaluate({ ...referralOf(SAM), status: "pending" } as any);
    await ReferralService.onActivity(SAM);
    expect(db.rows('referral_rewards')).toHaveLength(2);
    expect(daysLeft(grantsOf(MAYA)[0].expires_at)).toBe(7);
  });

  it('stacks weeks on one grant', async () => {
    const friends = ['a', 'b', 'c'].map((s, i) => {
      const id = `7777777${i}-7777-4777-8777-77777777777${i}`;
      db.addProfile({ id, display_name: `Friend ${s}` });
      return id;
    });
    for (const id of friends) {
      await claimPersonal(id);
      logActivity(id);
      await ReferralService.onActivity(id);
    }
    const mayaGrants = grantsOf(MAYA);
    expect(mayaGrants).toHaveLength(1);
    expect(daysLeft(mayaGrants[0].expires_at)).toBe(21);
  });

  it('banks weeks while the inviter pays through a store, applies them when it ends', async () => {
    const storeExpiry = new Date(Date.now() + 20 * DAY).toISOString();
    Object.assign(db.profile(MAYA)!, {
      subscription_tier: 'premium',
      subscription_platform: 'app_store',
      subscription_product_id: 'com.inov8rlabs.fitcircle.pro.monthly',
      subscription_expires_at: storeExpiry,
    });
    await claimPersonal(SAM);
    db.profile(SAM)!.onboarding_completed = true;
    logActivity(SAM);
    await ReferralService.onActivity(SAM);

    expect(grantsOf(MAYA)).toHaveLength(0);
    expect(db.profile(MAYA)).toMatchObject({ subscription_platform: 'app_store', subscription_expires_at: storeExpiry });
    expect(db.rows('referral_rewards').find((r) => r.user_id === MAYA)).toMatchObject({ status: 'banked', days: 7 });
    await flush();
    expect(sent.find((s) => s.userId === MAYA && s.type.startsWith('referral_reward'))?.type).toBe('referral_reward_banked');

    const hub = await ReferralService.getHub(MAYA);
    expect(hub.pro).toMatchObject({ source: 'store', bankedDays: 7 });

    // Store subscription lapses → every downgrade path calls holdIfGranted.
    const held = await ComplimentaryGrantService.holdIfGranted(MAYA);
    expect(held).toBe(true);
    expect(daysLeft(grantsOf(MAYA)[0].expires_at)).toBe(7);
    expect(db.profile(MAYA)).toMatchObject({ subscription_platform: 'promotional', subscription_product_id: 'referral' });
    expect(db.rows('referral_rewards').find((r) => r.user_id === MAYA)).toMatchObject({ status: 'applied' });
  });

  it('unlocks Lifetime Pro at 100 qualified friends — once', async () => {
    for (let i = 0; i < 99; i++) {
      db.rows('referrals').push({
        id: `seed-${i}`,
        invitee_id: `seed-user-${i}`,
        inviter_id: MAYA,
        status: 'qualified',
        attributed_at: new Date(Date.now() - 40 * DAY).toISOString(),
        qualified_at: new Date(Date.now() - 35 * DAY).toISOString(),
      });
    }
    await claimPersonal(SAM);
    db.profile(SAM)!.onboarding_completed = true;
    logActivity(SAM);
    await ReferralService.onActivity(SAM);

    const lifetime = grantsOf(MAYA).find((g) => g.granted_by === 'referral-lifetime');
    expect(lifetime).toBeDefined();
    expect(lifetime!.expires_at).toBeNull();
    expect(db.profile(MAYA)).toMatchObject({ subscription_tier: 'premium', subscription_expires_at: null });
    await flush();
    expect(sent.filter((s) => s.type === 'referral_lifetime')).toHaveLength(1);

    const hub = await ReferralService.getHub(MAYA);
    expect(hub.stats).toMatchObject({ qualified: 100, hasLifetime: true, toLifetime: 0 });
    expect(hub.pro).toMatchObject({ lifetime: true });
    expect(hub.nextMilestone).toBeNull();
  });

  it('holds a burst of qualifications for review, then pays on approval', async () => {
    for (let i = 0; i < 10; i++) {
      db.rows('referrals').push({
        id: `burst-${i}`,
        invitee_id: `burst-user-${i}`,
        inviter_id: MAYA,
        status: 'qualified',
        attributed_at: new Date().toISOString(),
        qualified_at: new Date(Date.now() - 60_000).toISOString(),
      });
    }
    await claimPersonal(SAM);
    db.profile(SAM)!.onboarding_completed = true;
    logActivity(SAM);
    await ReferralService.onActivity(SAM);
    expect(referralOf(SAM)).toMatchObject({ status: 'review', status_reason: 'velocity' });
    expect(grantsOf(MAYA)).toHaveLength(0);

    expect(await ReferralService.approve(referralOf(SAM).id, 'admin')).toBe(true);
    expect(referralOf(SAM).status).toBe('qualified');
    expect(daysLeft(grantsOf(MAYA)[0].expires_at)).toBe(7);
    expect(await ReferralService.approve(referralOf(SAM).id, 'admin')).toBe(false);
  });

  it('rejects disposable inboxes and expired windows', async () => {
    db.profile(SAM)!.email = 'sam@mailinator.com';
    await claimPersonal(SAM);
    db.profile(SAM)!.onboarding_completed = true;
    logActivity(SAM);
    await ReferralService.onActivity(SAM);
    expect(referralOf(SAM)).toMatchObject({ status: 'rejected', status_reason: 'disposable_email' });

    const late = '88888888-8888-4888-8888-888888888888';
    db.addProfile({ id: late, display_name: 'Late', onboarding_completed: false });
    db.rows('referrals').push({
      id: 'late-1',
      invitee_id: late,
      inviter_id: MAYA,
      code: 'X',
      status: 'pending',
      attributed_at: new Date(Date.now() - 31 * DAY).toISOString(),
      qualified_at: null,
    });
    const result = await ReferralService.evaluatePending();
    expect(result.rejected).toBe(1);
    expect(referralOf(late)).toMatchObject({ status: 'rejected', status_reason: 'qualify_window_expired' });
  });

  it('revoke claws back the applied week', async () => {
    await claimPersonal(SAM);
    db.profile(SAM)!.onboarding_completed = true;
    logActivity(SAM);
    await ReferralService.onActivity(SAM);
    expect(daysLeft(grantsOf(MAYA)[0].expires_at)).toBe(7);

    expect(await ReferralService.revoke(referralOf(SAM).id, 'admin', 'farm')).toBe(true);
    expect(referralOf(SAM).status).toBe('revoked');
    expect(daysLeft(grantsOf(MAYA)[0].expires_at)).toBe(0);
    expect(db.rows('referral_rewards').every((r) => r.status === 'revoked')).toBe(true);
  });

  it('does not double-count when two applications race', async () => {
    db.rows('referral_rewards').push(
      { id: 'w1', user_id: MAYA, referral_id: 'r1', kind: 'inviter_week', days: 7, status: 'banked', seen_at: null },
      { id: 'w2', user_id: MAYA, referral_id: 'r2', kind: 'inviter_week', days: 7, status: 'banked', seen_at: null }
    );
    await Promise.all([ReferralRewardService.applyBanked(MAYA), ReferralRewardService.applyBanked(MAYA)]);
    expect(daysLeft(grantsOf(MAYA)[0].expires_at)).toBe(14);
  });
});

describe('hub', () => {
  it('summarises progress, friends, unseen rewards and the starter circle', async () => {
    db.rows('fitcircles').push({
      id: 'c-maya',
      name: "Maya's Crew",
      invite_code: 'FITZZ9999',
      creator_id: MAYA,
      type: 'step_count',
      status: 'active',
      end_date: null,
      created_at: new Date().toISOString(),
    });
    db.rows('fitcircle_members').push(
      { fitcircle_id: 'c-maya', user_id: MAYA, status: 'active' },
      { fitcircle_id: 'c-maya', user_id: SAM, status: 'active' }
    );
    await claimPersonal(SAM);
    db.profile(SAM)!.onboarding_completed = true;
    logActivity(SAM);
    await ReferralService.onActivity(SAM);

    const hub = await ReferralService.getHub(MAYA);
    expect(hub.enabled).toBe(true);
    expect(hub.shareUrl).toBe(`https://www.fitcircle.ai/i/${hub.code}`);
    expect(hub.shareMessage).toContain(hub.shareUrl!);
    expect(hub.stats).toMatchObject({ invited: 1, pending: 0, qualified: 1, daysEarned: 7, daysBanked: 0, hasLifetime: false, toLifetime: 99 });
    expect(hub.milestones?.find((m) => m.key === 'first_friend')?.reached).toBe(true);
    expect(hub.nextMilestone).toMatchObject({ key: 'crew', remaining: 2 });
    expect(hub.invitees).toEqual([
      expect.objectContaining({ displayName: 'Sam Lee', status: 'qualified', qualifiedAt: expect.any(String) }),
    ]);
    expect(hub.pro).toMatchObject({ source: 'referral', lifetime: false });
    expect(hub.unseenRewards).toEqual([expect.objectContaining({ kind: 'inviter_week', days: 7, friendName: 'Sam' })]);
    expect(hub.starterCircle).toMatchObject({
      name: "Maya's Crew",
      memberCount: 2,
      shareUrl: `https://www.fitcircle.ai/join/FITZZ9999?ref=${hub.code}`,
    });
    expect(hub.canClaimCode).toBe(false); // 90-day-old account

    const samHub = await ReferralService.getHub(SAM);
    expect(samHub.referredBy).toEqual({ firstName: 'Maya', avatarUrl: null });
    expect(samHub.unseenRewards).toEqual([expect.objectContaining({ kind: 'invitee_welcome', friendName: 'Maya' })]);
    expect(samHub.canClaimCode).toBe(false); // already attributed

    const seen = await ReferralService.markRewardsSeen(MAYA, hub.unseenRewards!.map((r) => r.id));
    expect(seen).toBe(1);
    expect((await ReferralService.getHub(MAYA)).unseenRewards).toEqual([]);
    expect(await ReferralService.markRewardsSeen(MAYA, hub.unseenRewards!.map((r) => r.id))).toBe(0);
  });

  it('lets a brand-new unattributed account enter a code', async () => {
    const hub = await ReferralService.getHub(SAM);
    expect(hub.canClaimCode).toBe(true);
    expect(hub.starterCircle).toBeNull();
    expect(hub.nextMilestone).toMatchObject({ key: 'first_friend', remaining: 1 });
  });
});

describe('entitlement source', () => {
  it('labels where premium comes from', async () => {
    const { subscriptionSource } = await import('../entitlement-service');
    expect(subscriptionSource('premium', 'promotional', 'referral')).toBe('referral');
    expect(subscriptionSource('premium', 'promotional', 'complimentary')).toBe('complimentary');
    expect(subscriptionSource('premium', 'app_store', 'pro.monthly')).toBe('store');
    expect(subscriptionSource('free', 'app_store', 'pro.monthly')).toBeNull();
  });

  it('pins the profile to the best grant: lifetime beats a time-boxed admin grant', async () => {
    db.rows('complimentary_grants').push(
      { id: 'g1', user_id: MAYA, granted_by: 'ani', expires_at: new Date(Date.now() + 5 * DAY).toISOString(), revoked_at: null, created_at: new Date().toISOString() },
      { id: 'g2', user_id: MAYA, granted_by: 'referral-lifetime', expires_at: null, revoked_at: null, created_at: new Date(Date.now() - DAY).toISOString() }
    );
    expect((await ComplimentaryGrantService.activeGrant(MAYA))?.id).toBe('g2');
  });
});
