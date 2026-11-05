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
    expect(html).toMatch(/class="fc-wm">(<span class="fc-gs"><span class="fc-gd">)?FitCircle(<\/span><\/span>)?<\/td>/);
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/Georgia|font-style:\s*italic/i);
    expect(html).not.toMatch(/>\s*[fF]\s*</); // a lone "f"/"F" glyph standing in for the icon
    // No gradient header band (the brand gradient is for CTAs/badges only): the brand row has no background.
    expect(html).not.toMatch(/linear-gradient\([^)]*\)[^"]*"[^>]*>\s*(<span[^>]*>)*\s*FitCircle/);
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

/**
 * Dark-mode hardening (docs/EMAIL_QUALITY.md "Dark mode"): Gmail iOS inverted our
 * dark design and left the primary button label dark-on-purple (2026-11-04).
 */
describe('dark-mode hardening in every dark email', () => {
  const darkSurfaces = ['#070A1A', '#11162A', '#1A2036'];

  it.each(EMAILS)('%s: color-scheme light dark + Gmail blend + Outlook.com overrides', (_n, html) => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(html).toMatch(/<body class="body"/);
    expect(html).toContain('u + .body .fc-gs{background:#000;mix-blend-mode:screen;}');
    expect(html).toContain('u + .body .fc-gd{background:#000;mix-blend-mode:difference;}');
    expect(html).toMatch(/\[data-ogsb\] \.fc-bg\{background-color:#070A1A!important;\}/);
    expect(html).toMatch(/\[data-ogsc\] \.btn,\[data-ogsc\] \.btn2\{color:#FFFFFF!important;\}/);
  });

  it.each(EMAILS)('%s: every dark background-color is gradient-locked (Gmail never inverts background-image)', (_n, html) => {
    for (const c of darkSurfaces) {
      const plain = new RegExp(`background(-color)?:${c};(?!background-image:linear-gradient\\(${c},${c}\\))`, 'gi');
      // In inline styles, a dark background-color must be followed by its locking gradient.
      const inline = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join('\n');
      expect(inline.match(plain) ?? [], c).toEqual([]);
    }
  });

  it.each(EMAILS)('%s: primary button has a locked gradient and a protected white label', (_n, html) => {
    const buttons = [...html.matchAll(/<td align="center" bgcolor="#7C3AED" style="([^"]*)">[\s\S]*?<a [^>]*class="btn"[^>]*>([\s\S]*?)<\/a>/g)];
    for (const [, style, label] of buttons) {
      expect(style).toContain('background-image:linear-gradient(135deg,#7C3AED 0%,#DB2777 100%)');
      expect(label).toMatch(/^<span class="fc-gs"><span class="fc-gd">[^<]+<\/span><\/span>$/);
    }
  });

  it.each(EMAILS)('%s: text colours are neutral (saturated hues don\'t survive the Gmail blend fix)', (_n, html) => {
    const body = html.slice(html.indexOf('<body'));
    for (const c of ['#F472B6', '#A78BFA', '#22C55E', '#22D3EE', '#F97316', '#a78bfa', '#c4b5fd']) expect(body).not.toContain(`;color:${c}`);
  });

  it.each(EMAILS)('%s: no visible text outside a protected run (every p / h1–h3 / button label is wrapped)', (_n, html) => {
    const body = html.slice(html.indexOf('<body'));
    for (const m of body.matchAll(/<(h1|h2|h3|p)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      if (m[2].trim()) expect(m[2].startsWith('<span class="fc-gs">'), m[0].slice(0, 80)).toBe(true);
    }
    for (const m of body.matchAll(/<a\b[^>]*class="btn2?"[^>]*>([\s\S]*?)<\/a>/g)) expect(m[1].startsWith('<span class="fc-gs">')).toBe(true);
    // Nothing visible is left once protected runs, comments (Outlook VML), <head> and the hidden
    // preheader are removed: any leftover text would be inverted to dark-on-dark by Gmail.
    const leftover = body
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<div style="display:none;[\s\S]*?<\/div>/, '')
      .replace(/<span class="fc-gs"><span class="fc-gd">[\s\S]*?<\/span><\/span>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;|&#847;|&zwnj;/g, '')
      .trim();
    expect(leftover).toBe('');
    // No border-top/bottom hairlines that Gmail would flip to white (dividers are locked 1px rows).
    expect(body).not.toMatch(/border-(top|bottom):1px solid/);
  });
});

