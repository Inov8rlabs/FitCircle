import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralFakeDb, getReferralDb, setReferralDb } from './referral-fake-db';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
vi.mock('../feature-flag-service', () => ({
  FeatureFlagService: { isFeatureEnabled: async () => ({ enabled: true }) },
}));
const push = vi.hoisted(() => ({
  sent: [] as Array<{ userId: string; type: string; data: any }>,
  outcome: { sent: true } as { sent: boolean; reason?: string },
}));
vi.mock('../notification-orchestrator', () => ({
  NotificationOrchestrator: {
    send: async (userId: string, type: string, data: any) => {
      push.sent.push({ userId, type, data });
      return push.outcome;
    },
  },
}));
const mail = vi.hoisted(() => ({ sent: [] as Array<any>, fail: false }));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (msg: any) => {
        if (mail.fail) return { error: { message: 'boom' } };
        mail.sent.push(msg);
        return { data: { id: 'm' }, error: null };
      },
    };
  },
}));

import {
  ReferralInviteService,
  contactHash,
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizePhone,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from '../referral-invite-service';
import { ReferralService } from '../referral-service';

const DAY = 86_400_000;
const MAYA = '11111111-1111-4111-8111-111111111111';
const SAM = '22222222-2222-4222-8222-222222222222';
const CIRCLE = '44444444-4444-4444-8444-444444444444';
let db: ReferralFakeDb;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test';
  db = new ReferralFakeDb();
  setReferralDb(db);
  push.sent.length = 0;
  push.outcome = { sent: true };
  mail.sent.length = 0;
  mail.fail = false;
  db.addProfile({ id: MAYA, display_name: 'Maya Rao', email: 'maya@example.com', created_at: new Date(Date.now() - 90 * DAY).toISOString() });
  db.rows('fitcircles').push({ id: CIRCLE, name: 'Morning Movers', invite_code: 'FITAB12CD', creator_id: MAYA, type: 'step_count', status: 'active', end_date: null, created_at: new Date().toISOString() });
  db.rows('fitcircle_members').push({ id: 'm1', fitcircle_id: CIRCLE, user_id: MAYA, status: 'active' });
});

describe('contact helpers', () => {
  it('normalizes and masks', () => {
    expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com');
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizePhone('(416) 555-0123')).toBe('+14165550123');
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
    expect(normalizePhone('12')).toBeNull();
    expect(maskEmail('sam@example.com')).toBe('sa•••@example.com');
    expect(maskPhone('+14165550123')).toBe('•••• 0123');
  });

  it('signs unsubscribe tokens', () => {
    const hash = contactHash('email', 'sam@example.com');
    expect(verifyUnsubscribeToken(unsubscribeToken(hash))).toBe(hash);
    expect(verifyUnsubscribeToken(`${hash}.forged`)).toBeNull();
    expect(verifyUnsubscribeToken('garbage')).toBeNull();
  });
});

describe('inviteContacts', () => {
  it('emails a friend from the inviter, with circle, reward line and unsubscribe', async () => {
    const out = await ReferralService.inviteContacts(MAYA, { contacts: [{ email: 'Sam@Example.com', name: 'Sam' }] });
    expect(out).toMatchObject({ sentCount: 1, results: [{ contact: 'sa•••@example.com', channel: 'email', name: 'Sam', status: 'sent' }] });
    expect(mail.sent).toHaveLength(1);
    const msg = mail.sent[0];
    expect(msg.to).toBe('sam@example.com');
    expect(msg.from).toBe('Maya via FitCircle <team@fitcircle.ai>');
    expect(msg.subject).toBe('Maya saved you a seat in “Morning Movers” 💪');
    expect(msg.html).toContain('Hey Sam,');
    expect(msg.html).toContain('free week of FitCircle Pro');
    expect(msg.html).toContain('https://www.fitcircle.ai/join/FITAB12CD?ref=MAYA');
    expect(msg.headers['List-Unsubscribe']).toMatch(/\/api\/referrals\/unsubscribe\?t=/);
    expect(db.rows('referral_invites')[0]).toMatchObject({ channel: 'email', email: 'sam@example.com', status: 'invited', circle_id: CIRCLE });
  });

  it('records texts without storing the number', async () => {
    const out = await ReferralService.inviteContacts(MAYA, { contacts: [{ phone: '416-555-0123', name: 'Jo', channel: 'sms' }] });
    expect(out.results[0]).toMatchObject({ channel: 'sms', status: 'sent', contact: '•••• 0123' });
    const row = db.rows('referral_invites')[0];
    expect(row.email).toBeNull();
    expect(JSON.stringify(row)).not.toContain('5550123');
    expect(mail.sent).toHaveLength(0);
  });

  it('skips self, members, opt-outs, duplicates and garbage', async () => {
    db.addProfile({ id: SAM, email: 'sam@example.com' });
    db.rows('referral_email_optouts').push({ email_hash: contactHash('email', 'gone@example.com') });
    await ReferralService.inviteContacts(MAYA, { contacts: [{ email: 'lee@example.com' }] });
    const out = await ReferralService.inviteContacts(MAYA, {
      contacts: [
        { email: 'maya@example.com' },
        { email: 'SAM@example.com' },
        { email: 'gone@example.com' },
        { email: 'lee@example.com' },
        { email: 'not-an-email' },
      ],
    });
    expect(out.results.map((r) => r.status)).toEqual(['self', 'already_member', 'opted_out', 'already_invited', 'invalid']);
    expect(out.sentCount).toBe(0);
  });

  it('enforces the daily email cap', async () => {
    for (let i = 0; i < 25; i++) {
      db.rows('referral_invites').push({ id: `x${i}`, inviter_id: MAYA, channel: 'email', contact_hash: `h${i}`, status: 'invited', sent_at: new Date().toISOString() });
    }
    const out = await ReferralService.inviteContacts(MAYA, { contacts: [{ email: 'new@example.com' }] });
    expect(out.results[0].status).toBe('rate_limited');
  });

  it('frees the slot when the email provider rejects the send', async () => {
    mail.fail = true;
    const out = await ReferralService.inviteContacts(MAYA, { contacts: [{ email: 'sam@example.com' }] });
    expect(out.results[0].status).toBe('failed');
    expect(db.rows('referral_invites')).toHaveLength(0);
  });
});

describe('nudges', () => {
  it('lets an email invite be reminded twice, 72h apart', async () => {
    await ReferralService.inviteContacts(MAYA, { contacts: [{ email: 'sam@example.com', name: 'Sam' }] });
    const invite = db.rows('referral_invites')[0];
    expect(await ReferralService.nudge(MAYA, { inviteId: invite.id })).toMatchObject({ status: 'too_soon', remaining: 2 });

    invite.sent_at = new Date(Date.now() - 73 * 3600_000).toISOString();
    const first = await ReferralService.nudge(MAYA, { inviteId: invite.id });
    expect(first).toMatchObject({ status: 'sent', remaining: 1 });
    expect(mail.sent.at(-1).subject).toBe('Maya is still saving your seat 💜');

    expect((await ReferralService.nudge(MAYA, { inviteId: invite.id })).status).toBe('too_soon');
    invite.last_nudged_at = new Date(Date.now() - 73 * 3600_000).toISOString();
    expect((await ReferralService.nudge(MAYA, { inviteId: invite.id })).status).toBe('sent');
    invite.last_nudged_at = new Date(Date.now() - 73 * 3600_000).toISOString();
    expect(await ReferralService.nudge(MAYA, { inviteId: invite.id })).toMatchObject({ status: 'limit_reached', remaining: 0 });
  });

  it('returns composer text for a text invite and never nudges someone else’s invite', async () => {
    await ReferralService.inviteContacts(MAYA, { contacts: [{ phone: '+14165550123', channel: 'sms' }] });
    const invite = db.rows('referral_invites')[0];
    invite.sent_at = new Date(Date.now() - 80 * 3600_000).toISOString();
    expect(await ReferralService.nudge(SAM, { inviteId: invite.id })).toMatchObject({ status: 'not_nudgeable' });
    const out = await ReferralService.nudge(MAYA, { inviteId: invite.id });
    expect(out.status).toBe('sent');
    expect(out.smsBody).toContain('Still saving you a seat in "Morning Movers"');
    expect(out.smsBody).toContain('https://www.fitcircle.ai/join/FITAB12CD?ref=');
  });

  it('pushes a joined friend at most every 48h, 3 times', async () => {
    db.addProfile({ id: SAM, display_name: 'Sam', onboarding_completed: false });
    const code = await ReferralService.getOrCreateCode(MAYA);
    await ReferralService.claim(SAM, { code, source: 'typed' });
    const referral = db.rows('referrals')[0];

    expect(await ReferralService.nudge(MAYA, { referralId: referral.id })).toMatchObject({ status: 'sent', remaining: 2 });
    await flush();
    expect(push.sent.find((p) => p.type === 'referral_nudge')).toMatchObject({ userId: SAM, data: { inviterName: 'Maya' } });
    expect((await ReferralService.nudge(MAYA, { referralId: referral.id })).status).toBe('too_soon');
    referral.last_nudged_at = new Date(Date.now() - 49 * 3600_000).toISOString();
    expect((await ReferralService.nudge(MAYA, { referralId: referral.id })).status).toBe('sent');
    referral.last_nudged_at = new Date(Date.now() - 49 * 3600_000).toISOString();
    expect((await ReferralService.nudge(MAYA, { referralId: referral.id })).status).toBe('sent');
    referral.last_nudged_at = new Date(Date.now() - 49 * 3600_000).toISOString();
    expect((await ReferralService.nudge(MAYA, { referralId: referral.id })).status).toBe('limit_reached');
  });
});

describe('unsubscribe', () => {
  it('blocks future invites and stops reminders', async () => {
    await ReferralService.inviteContacts(MAYA, { contacts: [{ email: 'sam@example.com' }] });
    const token = unsubscribeToken(contactHash('email', 'sam@example.com'));
    expect(await ReferralInviteService.unsubscribe(token)).toBe(true);
    expect(await ReferralInviteService.unsubscribe(token)).toBe(true); // idempotent
    expect(await ReferralInviteService.unsubscribe('bad.token')).toBe(false);
    expect(db.rows('referral_invites')[0]).toMatchObject({ email: null, nudge_count: 2 });

    const other = '33333333-3333-4333-8333-333333333333';
    db.addProfile({ id: other, display_name: 'Lee', created_at: new Date(Date.now() - 50 * DAY).toISOString() });
    const out = await ReferralService.inviteContacts(other, { contacts: [{ email: 'sam@example.com' }] });
    expect(out.results[0].status).toBe('opted_out');
  });
});

describe('email-matched signup + delivery to both sides', () => {
  async function inviteThenSignUp() {
    await ReferralService.inviteContacts(MAYA, { contacts: [{ email: 'sam@example.com', name: 'Sam' }] });
    db.addProfile({ id: SAM, display_name: 'Sam Lee', email: 'Sam@Example.com', onboarding_completed: true });
    return ReferralService.getHub(SAM);
  }

  it('attributes a signup to the earliest inviter of that email and offers their circle', async () => {
    const hub = await inviteThenSignUp();
    const referral = db.rows('referrals')[0];
    expect(referral).toMatchObject({ invitee_id: SAM, inviter_id: MAYA, source: 'email_invite', circle_id: CIRCLE });
    expect(db.rows('referral_invites')[0]).toMatchObject({ status: 'joined', referral_id: referral.id, email: null });
    expect(hub.referredBy).toMatchObject({ firstName: 'Maya' });
    expect(hub.pendingCircleInvite).toMatchObject({ name: 'Morning Movers', inviteCode: 'FITAB12CD' });
    await flush();
    expect(push.sent.find((p) => p.type === 'referral_friend_joined')).toMatchObject({ userId: MAYA, data: { friendName: 'Sam' } });
    await flush();
    expect(referral.inviter_notified_at).toEqual(expect.any(String));
  });

  it('on first check-in: pushes + emails both people, marks the invite qualified', async () => {
    await inviteThenSignUp();
    for (let i = 0; i < 3; i++) {
      db.rows('streak_claims').push({ id: `c${i}`, user_id: SAM, claim_method: 'manual_entry', claim_date: new Date(Date.now() - i * DAY).toISOString().slice(0, 10) });
    }
    await ReferralService.onActivity(SAM);

    const types = push.sent.map((p) => `${p.userId === MAYA ? 'maya' : 'sam'}:${p.type}`);
    expect(types).toEqual(expect.arrayContaining(['maya:referral_reward_earned', 'sam:referral_invitee_welcome']));
    const rewards = db.rows('referral_rewards');
    expect(rewards.every((r) => r.notified_at && r.emailed_at)).toBe(true);
    const rewardMails = mail.sent.filter((m) => m.subject.includes('each earned a free week'));
    expect(rewardMails.map((m) => m.to).sort()).toEqual(['maya@example.com', 'sam@example.com']);
    expect(rewardMails.find((m) => m.to === 'sam@example.com').subject).toBe('You and Maya each earned a free week of Pro 🎉');
    expect(db.rows('referral_invites')[0].status).toBe('qualified');
  });

  it('retries pushes suppressed by quiet hours until delivered', async () => {
    push.outcome = { sent: false, reason: 'quiet_hours' };
    await inviteThenSignUp();
    for (let i = 0; i < 3; i++) {
      db.rows('streak_claims').push({ id: `c${i}`, user_id: SAM, claim_method: 'manual_entry', claim_date: new Date(Date.now() - i * DAY).toISOString().slice(0, 10) });
    }
    await ReferralService.onActivity(SAM);
    await flush();
    expect(db.rows('referral_rewards').every((r) => r.notified_at === null)).toBe(true);
    expect(db.rows('referrals')[0].inviter_notified_at).toBeNull();

    push.outcome = { sent: true };
    push.sent.length = 0;
    const out = await ReferralService.retryUndeliveredPushes();
    await flush();
    expect(out).toEqual({ rewards: 2, joins: 1 });
    expect(push.sent.map((p) => p.type).sort()).toEqual(['referral_friend_joined', 'referral_invitee_welcome', 'referral_reward_earned']);
    expect(db.rows('referral_rewards').every((r) => r.notified_at)).toBe(true);
    expect(await ReferralService.retryUndeliveredPushes()).toEqual({ rewards: 0, joins: 0 });
  });

  it('treats a switched-off category as handled (no retry spam)', async () => {
    push.outcome = { sent: false, reason: 'category_disabled' };
    await inviteThenSignUp();
    await flush();
    expect(db.rows('referrals')[0].inviter_notified_at).toEqual(expect.any(String));
  });
});

describe('hub v2 fields', () => {
  it('lists pending invites with nudge state, composer text and email preview', async () => {
    await ReferralService.inviteContacts(MAYA, { contacts: [{ email: 'sam@example.com', name: 'Sam' }, { phone: '+14165550123', channel: 'sms' }] });
    const hub = await ReferralService.getHub(MAYA);
    expect(hub.invites).toHaveLength(2);
    expect(hub.invites![0]).toMatchObject({ status: 'invited', nudge: { available: false, remaining: 2, nextAt: expect.any(String) } });
    expect(hub.smsBody).toContain('Join my circle "Morning Movers"');
    expect(hub.emailPreview).toMatchObject({ subject: 'Maya saved you a seat in “Morning Movers” 💪' });
    expect(hub.pendingCircleInvite).toBeNull();
  });
});
