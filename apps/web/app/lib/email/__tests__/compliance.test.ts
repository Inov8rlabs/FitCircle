/**
 * Marketing / lifecycle email compliance (docs/PRIVACY_COMPLIANCE_SPEC.md §6): postal address
 * (EMAIL_POSTAL_ADDRESS) + working unsubscribe in every marketing email, enforced centrally in
 * sendEmail; missing address → not sent (fail safe) and logged. Resend is mocked.
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
import { campaignEmail } from '../campaign-emails';
import { MARKETING_EMAIL_CATEGORIES, checkMarketingEmail, emailPostalAddress } from '../compliance';
import { sendEmail } from '../email-service';
import { onboardingNudgeEmail } from '../onboarding-nudge-email';
import { inviteEmail, reminderEmail, rewardEmail } from '../referral-emails';
import { MemorySuppressionStore, setSuppressionStoreForTests } from '../suppression';
import { welcomeEmail } from '../welcome-email';

const ADDRESS = 'Inov8r Labs Inc., 100 Example Ave, Suite 5, Austin, TX 78701, USA';
const UNSUB = 'https://fitcircle.ai/api/campaigns/unsubscribe?t=abc';
const listUnsub = { 'List-Unsubscribe': `<${UNSUB}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
const invite = {
  inviterFirstName: 'Maya',
  inviterAvatarUrl: null,
  friendName: 'Sam',
  circle: { name: 'Lunch Club', memberCount: 3 },
  link: 'https://fitcircle.ai/i/ABC',
  rewardDays: 7,
  unsubscribeUrl: 'https://fitcircle.ai/invite/unsubscribe?t=x',
};
const campaign = () =>
  campaignEmail({ subject: 'S', preheader: 'P', heading: 'H', body: 'Body', ctaLabel: 'Go', ctaUrl: 'https://fitcircle.ai/c/x', unsubscribeUrl: UNSUB });

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.EMAIL_POSTAL_ADDRESS;
  process.env.EMAIL_POSTAL_ADDRESS = ADDRESS;
  process.env.RESEND_API_KEY = 'test';
  mail.sent.length = 0;
  setSuppressionStoreForTests(new MemorySuppressionStore());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  if (saved === undefined) delete process.env.EMAIL_POSTAL_ADDRESS;
  else process.env.EMAIL_POSTAL_ADDRESS = saved;
  setSuppressionStoreForTests(null);
});

describe('templates carry the postal address + unsubscribe', () => {
  it('campaign, onboarding nudge, welcome, referral invite + reminder: address in HTML and text', () => {
    const esc = ADDRESS.replace(/&/g, '&amp;');
    const nudge = onboardingNudgeEmail('u1', 1);
    const welcome = welcomeEmail({ firstName: 'Ani', platform: 'ios', unsubscribeUrl: UNSUB, postalAddress: emailPostalAddress() });
    for (const e of [campaign(), nudge, welcome, inviteEmail(invite), reminderEmail(invite)]) {
      expect(e.html).toContain(esc);
      expect(e.text).toContain(ADDRESS);
      expect(e.html).toContain('Inov8r Labs');
      expect(e.html.toLowerCase()).toMatch(/unsubscribe|don't send me fitcircle invites/);
    }
  });

  it('transactional reward note also shows the address (brand shell default) but is not gated', () => {
    expect(MARKETING_EMAIL_CATEGORIES.has('referral_reward')).toBe(false);
    const r = rewardEmail({ recipientFirstName: 'Ani', friendFirstName: 'Sam', days: 7, inviteLink: 'https://fitcircle.ai/i/A' } as any);
    expect(r.html).toContain(ADDRESS);
  });
});

describe('checkMarketingEmail', () => {
  const html = `<p>x</p><p>${ADDRESS}</p>`;
  it('passes a compliant marketing email; ignores transactional streams', () => {
    expect(checkMarketingEmail({ category: 'campaign', html, headers: listUnsub })).toBeNull();
    expect(checkMarketingEmail({ category: 'notification', html: '<p/>' }, {})).toBeNull();
    expect(checkMarketingEmail({ category: 'ads_report', html: '<p/>' }, {})).toBeNull();
  });
  it('missing env → missing_postal_address; body without it → footer_missing_postal_address; no header → missing_unsubscribe', () => {
    expect(checkMarketingEmail({ category: 'campaign', html, headers: listUnsub }, {})).toBe('missing_postal_address');
    expect(checkMarketingEmail({ category: 'welcome', html: '<p>x</p>', headers: listUnsub })).toBe('footer_missing_postal_address');
    expect(checkMarketingEmail({ category: 'onboarding_nudge', html })).toBe('missing_unsubscribe');
    expect(checkMarketingEmail({ category: 'referral_invite', html, headers: { 'list-unsubscribe': 'mailto:x@y' } })).toBe('missing_unsubscribe');
  });
});

describe('sendEmail enforcement (fail safe)', () => {
  it('EMAIL_POSTAL_ADDRESS unset → no marketing email is sent, logged, errorName compliance_blocked', async () => {
    delete process.env.EMAIL_POSTAL_ADDRESS;
    const e = campaign();
    for (const category of [...MARKETING_EMAIL_CATEGORIES] as any[]) {
      const res = await sendEmail({ to: 'a@example.com', ...e, headers: listUnsub, category });
      expect(res).toMatchObject({ success: false, errorName: 'compliance_blocked' });
    }
    expect(mail.sent).toHaveLength(0);
    expect((console.error as any).mock.calls.some((c: any[]) => String(c[0]).includes('[email-compliance]') && String(c[0]).includes('missing_postal_address'))).toBe(true);
  });

  it('transactional mail still goes out without the address', async () => {
    delete process.env.EMAIL_POSTAL_ADDRESS;
    expect((await sendEmail({ to: 'a@example.com', subject: 's', html: '<p>h</p>', category: 'notification' })).success).toBe(true);
    expect(mail.sent).toHaveLength(1);
  });

  it('a compliant campaign email is sent with the address in the body and List-Unsubscribe', async () => {
    const res = await sendEmail({ to: 'a@example.com', ...campaign(), headers: listUnsub, category: 'campaign' });
    expect(res.success).toBe(true);
    expect(mail.sent[0].html).toContain(ADDRESS);
    expect(mail.sent[0].headers['List-Unsubscribe']).toBe(`<${UNSUB}>`);
  });

  it('onboarding nudges retry a compliance block on a later run (not recorded as failed)', () => {
    expect(emailDisposition({ success: false, errorName: 'compliance_blocked' })).toEqual({ kind: 'release', reason: 'compliance_blocked' });
  });
});
