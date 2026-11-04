/**
 * Welcome email: sent once when an account is created, on every sign-up path
 * (web, mobile email, first Apple / Google sign-in) by
 * lib/services/welcome-email-service.ts. docs/EMAIL_QUALITY.md §B.
 *
 * Content rules: three real next steps that exist in the product today (log a
 * meal, join or start a circle, meet Fitzy), each with a working link; no
 * numbers, testimonials or promises we can't back (DESIGN_LANGUAGE.md: no
 * emoji as icons; no fake data).
 *
 * Links depend on where the person signed up:
 *  - app (iOS / Android / unknown mobile): https://fitcircle.ai/open — the iOS
 *    app claims it as a universal link and opens; elsewhere it forwards to
 *    /get, which sends phones to the right store listing ("Open" when the app
 *    is installed) and desktops to the download page;
 *  - web: the web app's own pages (www.fitcircle.ai/food-log, /fitcircles);
 *    Fitzy lives in the apps, so that step links to /get.
 *
 * Classification: transactional / relationship (it confirms the account the
 * person just created). It still carries a one-click unsubscribe for our
 * marketing emails (List-Unsubscribe + footer link → the same opt-out campaign
 * emails honour, profiles.preferences.marketingEmails = false).
 */
import { APEX_HOST, getAppHref, openPath, type Utm } from '../app-links';
import { INVITE_HOST } from '../referrals/links';

import { EMAIL_FONT, EMAIL_TOKENS as T, P, cardRow, emailButton, emailButtonSecondary, emailShell, emailStepBadge, esc } from './brand-shell';

export const WELCOME_TEMPLATE = 'welcome@4';

export type WelcomePlatform = 'web' | 'ios' | 'android' | null;

export interface WelcomeLinks {
  /** The one primary CTA: open the app (app sign-ups) / the web dashboard (web sign-ups). */
  open: string;
  logMeal: string;
  circles: string;
  fitzy: string;
  /** "Get the app" (web sign-ups only). */
  getApp: string | null;
}

export interface WelcomeEmailInput {
  firstName: string | null;
  platform: WelcomePlatform;
  /** One-click marketing unsubscribe (campaign unsubscribe URL); omitted in previews. */
  unsubscribeUrl?: string | null;
  postalAddress?: string | null;
}

export interface RenderedWelcome {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  links: WelcomeLinks;
}

const utm = (content: string): Utm => ({
  utm_source: 'email',
  utm_medium: 'transactional',
  utm_campaign: 'welcome',
  utm_content: content,
});

function webUrl(path: string, content: string): string {
  const qs = new URLSearchParams(utm(content) as Record<string, string>);
  return `${INVITE_HOST}${path}?${qs.toString()}`;
}

/** Destinations per sign-up platform (see header). */
export function welcomeLinks(platform: WelcomePlatform): WelcomeLinks {
  if (platform === 'web') {
    return {
      open: webUrl('/dashboard', 'primary'),
      logMeal: webUrl('/food-log', 'log_meal'),
      circles: webUrl('/fitcircles', 'circles'),
      fitzy: `${INVITE_HOST}${getAppHref({ placement: 'welcome_email', utm: utm('fitzy') })}`,
      getApp: `${INVITE_HOST}${getAppHref({ placement: 'welcome_email', utm: utm('get_app') })}`,
    };
  }
  return {
    open: `${APEX_HOST}${openPath({ utm: utm('primary') })}`,
    logMeal: `${APEX_HOST}${openPath({ utm: utm('log_meal') })}`,
    circles: `${APEX_HOST}${openPath({ utm: utm('circles') })}`,
    fitzy: `${APEX_HOST}${openPath({ utm: utm('fitzy') })}`,
    getApp: null,
  };
}

interface Step {
  n: number;
  title: string;
  body: string;
  linkLabel: string;
  url: string;
}

/** Short, benefit-first, true to the product (1–2 lines at 390 px). */
function steps(links: WelcomeLinks, platform: WelcomePlatform): Step[] {
  return [
    {
      n: 1,
      title: 'Log your first meal',
      body: "Snap a photo and we'll estimate calories and macros. Your first log starts your streak.",
      linkLabel: 'Log a meal',
      url: links.logMeal,
    },
    {
      n: 2,
      title: 'Join or start a circle',
      body: 'Check in with a few friends and keep a streak going together.',
      linkLabel: 'Find a circle',
      url: links.circles,
    },
    {
      n: 3,
      title: 'Meet Fitzy',
      body: platform === 'web' ? 'Your AI coach in the FitCircle app. Ask about a meal or what to eat next.' : 'Your AI coach. Ask about a meal or what to eat next.',
      linkLabel: platform === 'web' ? 'Get the app' : 'Chat with Fitzy',
      url: links.fitzy,
    },
  ];
}

/** One flat row per step (no card-in-card): badge on the title line, short body, secondary button. */
function stepRow(s: Step): string {
  return `<tr><td class="px" style="padding:20px 28px;border-top:1px solid ${T.border};font-family:${EMAIL_FONT};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding:0 10px 0 0;">${emailStepBadge(s.n)}</td>
<td valign="middle" style="font-family:${EMAIL_FONT};font-size:18px;line-height:24px;font-weight:600;color:${T.textPrimary};">${esc(s.title)}</td>
</tr></table>
<p style="margin:8px 0 14px 0;font-size:15px;line-height:22px;color:${T.textSecondary};">${esc(s.body)}</p>
${emailButtonSecondary(s.url, s.linkLabel)}
</td></tr>`;
}

export function welcomeEmail(i: WelcomeEmailInput): RenderedWelcome {
  const name = (i.firstName ?? '').replace(/[\r\n<>]/g, '').trim().slice(0, 40);
  const subject = name ? `Welcome to FitCircle, ${name}` : 'Welcome to FitCircle';
  const preheader = 'Three easy ways to start: log a meal, bring a friend, meet Fitzy.';
  const links = welcomeLinks(i.platform);
  const list = steps(links, i.platform);
  const primaryLabel = i.platform === 'web' ? 'Go to FitCircle' : 'Open FitCircle';

  const body = [
    cardRow(
      `<p style="margin:0 0 8px 0;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;color:${T.pink};">WELCOME TO FITCIRCLE</p>
<h1 class="h1" style="margin:0 0 8px 0;font-size:28px;line-height:34px;font-weight:800;letter-spacing:-0.5px;color:${T.textPrimary};">${esc(name ? `You're in, ${name}.` : "You're in.")}</h1>
${P('Healthy habits stick better with friends. Here are three easy ways to start this week.', T.textSecondary, 16)}`,
      '28px 28px 0 28px'
    ),
    cardRow(emailButton(links.open, primaryLabel), '4px 28px 24px 28px'),
    ...list.map(stepRow),
    `<tr><td class="px" style="padding:20px 28px 24px 28px;border-top:1px solid ${T.border};font-family:${EMAIL_FONT};">${P('Questions or ideas? Just reply to this email. A real person on the team reads every one.', T.textTertiary, 14).replace('margin:0 0 14px 0', 'margin:0')}</td></tr>`,
  ].join('\n');

  const footerLinks = i.unsubscribeUrl ? [{ label: 'Unsubscribe from FitCircle tips and updates', url: i.unsubscribeUrl }] : [];
  const reason = "You're getting this because you just created a FitCircle account with this email address.";
  const html = emailShell({
    title: subject,
    preheader,
    body,
    footer: { reason, links: footerLinks, postalAddress: i.postalAddress },
  });

  const text = [
    name ? `Hi ${name},` : 'Hi there,',
    '',
    "You're in. Healthy habits stick better with friends. Here are three easy ways to start this week.",
    '',
    `${primaryLabel}: ${links.open}`,
    '',
    ...list.flatMap((s) => [`${s.n}. ${s.title}`, s.body, `${s.linkLabel}: ${s.url}`, '']),
    'Questions or ideas? Just reply to this email. A real person on the team reads every one.',
    '',
    '--',
    reason,
    ...(i.unsubscribeUrl ? [`Unsubscribe from FitCircle tips and updates: ${i.unsubscribeUrl}`] : []),
    'FitCircle by Inov8r Labs',
    ...(i.postalAddress ? [i.postalAddress] : []),
  ].join('\n');

  return { subject, preheader, html, text, links };
}
