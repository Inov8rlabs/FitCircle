/**
 * Welcome email (transactional, core — not engagement): sent once when an
 * account is created, on every signup path (web, mobile email, Apple, Google)
 * via lib/services/user-created-hook.ts. One clear first action (snap a meal),
 * then what FitCircle is today. No unsubscribe link: it's account mail.
 */
import { EMAIL_FONT, EMAIL_TOKENS as T, P, cardRow, emailButton, emailShell, esc } from './brand-shell';

export const WELCOME_TEMPLATE = 'welcome@2';

export interface WelcomeEmailInput {
  firstName: string | null;
  /** Decorated "snap a meal" link (UTM + msg params). */
  firstActionUrl: string;
  postalAddress?: string | null;
}

const FEATURES: Array<{ title: string; detail: string; color: string }> = [
  { title: 'Snap a meal, get the macros', detail: 'Take a photo of your plate and FitCircle estimates calories, protein, carbs and fat in seconds.', color: T.orange },
  { title: 'Build a streak', detail: 'Log a meal, a workout or a quick check-in each day. Shields cover the odd missed day.', color: T.violet },
  { title: 'Bring your circle', detail: "Start a small group with friends, see each other's check-ins and keep a shared streak alive.", color: T.green },
  { title: 'Ask Fitzy', detail: 'Your coach in the app. Ask about your meals and get one easy idea to try next.', color: T.cyan },
];

export function welcomeEmail(i: WelcomeEmailInput): { subject: string; html: string; text: string } {
  const name = i.firstName?.trim() || '';
  const subject = name ? `Welcome to FitCircle, ${name}` : 'Welcome to FitCircle';
  const preheader = 'Snap your first meal, start a streak, bring your friends.';
  const features = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${FEATURES.map(
    (f) => `<tr><td width="22" valign="top" style="width:22px;padding-top:7px;"><div style="width:10px;height:10px;border-radius:5px;background:${f.color};font-size:1px;line-height:1px;">&nbsp;</div></td>
<td valign="top" style="padding:0 0 16px 0;font-family:${EMAIL_FONT};"><p style="margin:0 0 2px 0;font-size:16px;line-height:22px;font-weight:700;color:${T.textPrimary};">${esc(f.title)}</p>
<p style="margin:0;font-size:15px;line-height:22px;color:${T.textSecondary};">${esc(f.detail)}</p></td></tr>`
  ).join('')}</table>`;

  const body = [
    cardRow(`<p style="margin:0;font-size:16px;line-height:24px;color:${T.textSecondary};">${esc(name ? `Hi ${name},` : 'Hi there,')}</p>`, '26px 28px 0 28px'),
    cardRow(
      `<p style="margin:0 0 10px 0;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;color:${T.pink};">WELCOME TO FITCIRCLE</p>
<h1 class="h1" style="margin:0 0 12px 0;font-size:30px;line-height:36px;font-weight:800;letter-spacing:-0.6px;color:${T.textPrimary};">You're in. Let's make it stick.</h1>
${P('FitCircle helps you build healthy habits with the people who keep you honest. The best first step takes a few seconds:', T.textSecondary, 17)}`,
      '20px 28px 0 28px'
    ),
    cardRow(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1B1747" style="background:#1B1747;border:1px solid #3B2A78;border-radius:18px;"><tr><td style="padding:22px 22px 24px 22px;text-align:center;font-family:${EMAIL_FONT};">
<p style="margin:0 0 6px 0;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;color:${T.violet};">YOUR FIRST STEP</p>
<p style="margin:0 0 6px 0;font-size:21px;line-height:27px;font-weight:800;color:${T.textPrimary};">Snap your next meal</p>
<p style="margin:0 0 10px 0;font-size:15px;line-height:22px;color:${T.textSecondary};">Point your camera at your plate. That's your day 1, and your streak starts.</p>
${emailButton(i.firstActionUrl, 'Snap my first meal')}</td></tr></table>`,
      '12px 28px 0 28px'
    ),
    cardRow(`<p style="margin:0 0 14px 0;font-size:20px;line-height:26px;font-weight:700;color:${T.textPrimary};">What you can do</p>${features}`, '28px 28px 0 28px'),
    cardRow(P('Questions or ideas? Just reply to this email. A real person on the team reads every one.', T.textSecondary, 15), '4px 28px 28px 28px'),
  ].join('\n');

  const html = emailShell({
    title: subject,
    preheader,
    body,
    footer: { reason: "You're getting this because you just created a FitCircle account.", postalAddress: i.postalAddress },
  });
  const text = [
    name ? `Hi ${name},` : 'Hi there,',
    '',
    "YOU'RE IN. LET'S MAKE IT STICK.",
    'FitCircle helps you build healthy habits with the people who keep you honest.',
    '',
    'YOUR FIRST STEP: snap your next meal. That is your day 1, and your streak starts.',
    `Snap my first meal: ${i.firstActionUrl}`,
    '',
    'WHAT YOU CAN DO',
    ...FEATURES.map((f) => `- ${f.title}: ${f.detail}`),
    '',
    'Questions or ideas? Just reply to this email. A real person on the team reads every one.',
    '',
    '--',
    "You're getting this because you just created a FitCircle account.",
    'FitCircle by Inov8r Labs',
    ...(i.postalAddress ? [i.postalAddress] : []),
  ].join('\n');
  return { subject, html, text };
}
