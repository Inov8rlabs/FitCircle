/**
 * Bounce/complaint suppression is enforced in the central sender, so every
 * FitCircle email stream respects it (docs/EMAIL_QUALITY.md §C). Resend is
 * mocked: nothing is ever sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mail = vi.hoisted(() => ({ sent: [] as any[] }));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (msg: any) => {
        mail.sent.push(msg);
        return { data: { id: `re_${mail.sent.length}` }, error: null };
      },
    };
  },
}));
vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => { throw new Error('not used: memory store'); } }));

import { emailDisposition } from '../../onboarding-nudges/policy';
import { contactHash } from '../../referrals/contact-hash';
import { sendCampaignEmail } from '../../services/campaign-delivery-service';
import { NotificationService } from '../../services/notification-service';
import { sendReferralEmail } from '../../services/referral-invite-service';
import { sendWelcomeOnce } from '../../services/welcome-email-service';
import { sendBatchInvitationEmails, sendEmail, sendInvitationEmail } from '../email-service';
import {
  MemorySuppressionStore,
  findSuppressedAddresses,
  isEmailSuppressed,
  isMissingTableError,
  setSuppressionStoreForTests,
  suppressAddress,
} from '../suppression';

let store: MemorySuppressionStore;
const rendered = { subject: 'S', html: '<p>h</p>', text: 't' };

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test';
  mail.sent.length = 0;
  store = new MemorySuppressionStore();
  setSuppressionStoreForTests(store);
});
afterEach(() => setSuppressionStoreForTests(null));

describe('suppression list', () => {
  it('matches case-insensitively and by the shared salted hash', async () => {
    await suppressAddress({ address: 'Gone@Example.org', reason: 'hard_bounce' });
    expect(await isEmailSuppressed(' gone@example.ORG ')).toBe(true);
    expect(await isEmailSuppressed('other@example.org')).toBe(false);
    expect([...store.rows.keys()]).toEqual([contactHash('email', 'gone@example.org')]);
    expect(store.rows.get(contactHash('email', 'gone@example.org'))).toMatchObject({ reason: 'hard_bounce', domain: 'example.org', event_count: 1 });
  });

  it('a complaint upgrades a bounce, never the other way round; repeats are counted', async () => {
    await suppressAddress({ address: 'a@x.io', reason: 'hard_bounce' });
    await suppressAddress({ address: 'a@x.io', reason: 'complaint' });
    await suppressAddress({ address: 'a@x.io', reason: 'hard_bounce' });
    expect(store.rows.get(contactHash('email', 'a@x.io'))).toMatchObject({ reason: 'complaint', event_count: 3 });
  });

  it('fails OPEN when the table is missing (migration not applied) and logs loudly', async () => {
    store.failWith = { code: 'PGRST205', message: "Could not find the table 'public.email_suppressions' in the schema cache" };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await findSuppressedAddresses(['a@x.io'])).toEqual(new Set());
    const res = await sendEmail({ to: 'a@x.io', ...rendered });
    expect(res.success).toBe(true);
    expect(err.mock.calls.flat().join(' ')).toMatch(/MISSING — apply supabase\/migrations\/127_email_suppressions\.sql/);
    // A webhook write can't be recorded → ok:false so the webhook asks Resend to retry.
    expect(await suppressAddress({ address: 'a@x.io', reason: 'complaint' })).toMatchObject({ ok: false, error: 'table_missing' });
    err.mockRestore();
  });

  it('fails open on any other read error too', async () => {
    store.failWith = new Error('connection reset');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await sendEmail({ to: 'a@x.io', ...rendered })).success).toBe(true);
    err.mockRestore();
  });

  it('recognises missing-table errors', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTableError({ code: '23505' })).toBe(false);
  });
});

describe('sendEmail (the central sender)', () => {
  it('sends nothing when every recipient is suppressed', async () => {
    await suppressAddress({ address: 'gone@example.org', reason: 'hard_bounce' });
    const res = await sendEmail({ to: 'gone@example.org', ...rendered, category: 'campaign' });
    expect(res).toMatchObject({ success: false, errorName: 'suppressed', suppressed: ['gone@example.org'] });
    expect(mail.sent).toHaveLength(0);
  });

  it('drops only the suppressed recipients of a multi-recipient email (ads report)', async () => {
    await suppressAddress({ address: 'b@fitcircle.ai', reason: 'complaint' });
    const res = await sendEmail({ to: ['a@fitcircle.ai', 'b@fitcircle.ai'], ...rendered, category: 'ads_report' });
    expect(res.success).toBe(true);
    expect(mail.sent[0].to).toEqual(['a@fitcircle.ai']);
    expect(mail.sent[0].tags).toEqual([{ name: 'category', value: 'ads_report' }]);
  });

  it('tags + from name', async () => {
    await sendEmail({ to: 'a@x.io', ...rendered, fromName: 'Maya', category: 'referral_invite', tags: { 'bad tag!': 'v@1' } });
    expect(mail.sent[0].from).toBe('Maya via FitCircle <team@fitcircle.ai>');
    expect(mail.sent[0].tags).toEqual([{ name: 'category', value: 'referral_invite' }, { name: 'bad_tag_', value: 'v_1' }]);
  });
});

describe('every sender respects suppression', () => {
  beforeEach(async () => {
    await suppressAddress({ address: 'gone@example.org', reason: 'hard_bounce' });
  });

  it('circle invites (single + batch)', async () => {
    expect(await sendInvitationEmail({ to: 'gone@example.org', invitedByName: 'Maya', circleName: 'C', circleType: 'custom', startDate: '2026-11-01', endDate: '2026-12-01', participantCount: 2, inviteCode: 'FITAB12CD' })).toMatchObject({ success: false, suppressed: true });
    const batch = await sendBatchInvitationEmails(
      ['gone@example.org', 'ok@example.org'].map((to) => ({ to, invitedByName: 'Maya', circleName: 'C', circleType: 'custom' as const, startDate: '2026-11-01', endDate: '2026-12-01', participantCount: 2, inviteCode: 'FITAB12CD' }))
    );
    expect(batch).toMatchObject({ success: 1, failed: 0, suppressed: 1 });
    expect(mail.sent.map((m) => m.to)).toEqual(['ok@example.org']);
  });

  it('referral invites, reminders, rewards', async () => {
    expect(await sendReferralEmail('gone@example.org', rendered, { fromName: 'Maya', category: 'referral_invite' })).toBe(false);
    expect(await sendReferralEmail('gone@example.org', rendered, { category: 'referral_reminder' })).toBe(false);
    expect(await sendReferralEmail('gone@example.org', rendered, { category: 'referral_reward' })).toBe(false);
    expect(mail.sent).toHaveLength(0);
  });

  it('campaign emails', async () => {
    expect(await sendCampaignEmail('gone@example.org', rendered, 'https://www.fitcircle.ai/api/campaigns/unsubscribe?t=x')).toBe(false);
    expect(mail.sent).toHaveLength(0);
  });

  it('notification emails', async () => {
    expect(await NotificationService.sendEmailNotification({ userId: 'u', userEmail: 'gone@example.org', type: 'x', title: 'T', body: 'B' })).toBe(false);
    expect(mail.sent).toHaveLength(0);
  });

  it('onboarding nudges: a suppressed send is final (recorded, never retried)', async () => {
    const res = await sendEmail({ to: 'gone@example.org', ...rendered, category: 'onboarding_nudge' });
    expect(emailDisposition(res)).toEqual({ kind: 'record', record: { status: 'suppressed', reason: 'suppressed' } });
    expect(mail.sent).toHaveLength(0);
  });

  it('welcome email', async () => {
    await suppressAddress({ address: 'gone@outlook.com', reason: 'hard_bounce' });
    const ledger = {
      load: async () => ({ email: 'gone@outlook.com', isAdmin: false, metadata: null }),
      claim: async () => true,
      finish: async () => {},
    };
    expect(await sendWelcomeOnce({ userId: '11111111-1111-4111-8111-111111111111', email: 'gone@outlook.com', method: 'email' }, { ledger, send: sendEmail, env: {} as any })).toBe('suppressed');
    expect(mail.sent).toHaveLength(0);
  });
});
