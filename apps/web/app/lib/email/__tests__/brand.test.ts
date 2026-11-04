/**
 * Every email we send carries the real FitCircle brand mark: the hosted app
 * icon (public/email/fitcircle-icon-40@2x.png, 2x, fixed size, alt text) next
 * to the live "FitCircle" wordmark. Never an inline SVG, a CSS-drawn logo or a
 * serif "f" glyph (the old invented mark).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { authEmailTemplates } from '../auth-templates';
import { EMAIL_LOGO_ALT, EMAIL_LOGO_PX, EMAIL_LOGO_URL } from '../brand-shell';
import { campaignEmail } from '../campaign-emails';
import { onboardingNudgeEmail } from '../onboarding-nudge-email';
import { inviteEmail, reminderEmail, rewardEmail } from '../referral-emails';
import { generateGenericNotificationEmail, generateInvitationEmail } from '../templates';
import { welcomeEmail } from '../welcome-email';

const WEB = path.resolve(__dirname, '../../../..');
const inviteInput = { inviterFirstName: 'Maya', inviterAvatarUrl: null, friendName: 'Sam', circle: { name: 'Morning Movers', memberCount: 3 }, link: 'https://www.fitcircle.ai/join/FITAB12CD?ref=MAYA', rewardDays: 7, unsubscribeUrl: 'https://www.fitcircle.ai/invite/unsubscribe?t=x' };

const EMAILS: Array<[string, string]> = [
  ['welcome (app)', welcomeEmail({ firstName: 'Maya', platform: 'ios' }).html],
  ['welcome (web)', welcomeEmail({ firstName: 'Maya', platform: 'web' }).html],
  ['circle invite', generateInvitationEmail({ invitedByName: 'Maya', invitedEmail: 'sam@x.io', circleName: 'Morning Movers', circleType: 'step_count', startDate: '2026-11-10', endDate: '2026-12-10', participantCount: 3, inviteCode: 'FITAB12CD' })],
  ['notification', generateGenericNotificationEmail({ title: 'T', body: 'B', actionUrl: 'https://www.fitcircle.ai/x', userName: 'Maya' })],
  ['referral invite', inviteEmail(inviteInput).html],
  ['referral reminder', reminderEmail(inviteInput).html],
  ['referral reward', rewardEmail({ recipientFirstName: 'Maya', friendFirstName: 'Sam', days: 7, role: 'inviter', banked: false, inviteLink: 'https://www.fitcircle.ai/i/MAYA' }).html],
  ['campaign', campaignEmail({ subject: 'S', preheader: 'P', heading: 'H', body: 'B', ctaLabel: 'Go', ctaUrl: 'https://www.fitcircle.ai/c/hold-the-line', unsubscribeUrl: 'https://www.fitcircle.ai/api/campaigns/unsubscribe?t=x' }).html],
  ['onboarding nudge 1', onboardingNudgeEmail('11111111-1111-4111-8111-111111111111', 1).html],
  ['onboarding nudge 2', onboardingNudgeEmail('11111111-1111-4111-8111-111111111111', 2).html],
  ...authEmailTemplates().map((t) => [`supabase auth: ${t.key}`, t.html] as [string, string]),
];

describe('brand mark in every email', () => {
  it.each(EMAILS)('%s uses the hosted app icon (2x PNG, fixed size, alt) + live wordmark, and no invented mark', (_name, html) => {
    const img = new RegExp(`<img src="${EMAIL_LOGO_URL.replace(/[.?]/g, '\\$&')}" width="${EMAIL_LOGO_PX}" height="${EMAIL_LOGO_PX}" alt="${EMAIL_LOGO_ALT}"`);
    expect(html).toMatch(img);
    expect(html).toMatch(/>FitCircle<\/td>/);
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/Georgia|font-style:\s*italic/i);
    expect(html).not.toMatch(/>\s*[fF]\s*</); // a lone "f"/"F" glyph standing in for the icon
    expect(html).not.toMatch(/linear-gradient\([^)]*\)[^"]*"[^>]*>\s*<span/); // gradient header band with a drawn mark
    expect(html).not.toContain('icons/icon-96x96.png');
  });

  it('the logo is an absolute https URL on www.fitcircle.ai, served from public/email at 2x', () => {
    expect(EMAIL_LOGO_URL).toBe('https://www.fitcircle.ai/email/fitcircle-icon-40@2x.png');
    const png = readFileSync(path.join(WEB, 'public/email/fitcircle-icon-40@2x.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([EMAIL_LOGO_PX * 2, EMAIL_LOGO_PX * 2]);
  });

  it('no email source draws its own logo (source guard)', () => {
    const files = [
      ...readdirSync(path.join(WEB, 'app/lib/email')).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => path.join(WEB, 'app/lib/email', f)),
      path.join(WEB, 'app/lib/ads/email-report.ts'),
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/<svg|Georgia|logo-f|icons\/icon-96x96/);
    }
  });
});
