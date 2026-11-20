/**
 * "Your FitCircle trial ends {day}" email (docs/ENGAGEMENT_115_SPEC.md §14.1): the fallback
 * for the trial-ending reminder push when the push cannot be delivered
 * (lib/services/trial-reminder-service.ts). Transactional (a billing notice the paywall
 * promised), so no marketing unsubscribe; the suppression list still applies in sendEmail.
 *
 * Content rules: the end date in the user's timezone, the plan when known, the price ONLY
 * when the caller knows it (never guessed: store prices vary by territory and the trial
 * event itself carries price 0), and how to cancel on the store that bills the trial.
 * Pure: no I/O.
 */
import type { TrialPlan } from '../trials/types';

import { EMAIL_FONT, EMAIL_TOKENS as T, P, cardRow, dividerRow, emailButton, emailShell, esc } from './brand-shell';

export const TRIAL_REMINDER_EMAIL_TEMPLATE = 'trial_reminder@1';

/** profiles.subscription_platform values (SubscriptionService.mapStore). */
export type TrialStore = 'app_store' | 'play_store' | 'stripe' | null;

export interface TrialReminderEmailInput {
  trialEndsAt: Date;
  /** IANA zone the end date is shown in. */
  timezone: string;
  /** 'tomorrow' | 'on Friday' | … (pro-lifecycle endsPhrase, as the push). */
  endsPhrase: string;
  store: TrialStore;
  plan: TrialPlan | null;
  /** Store-formatted post-trial price, e.g. "$29.99". Omitted when unknown — never guessed. */
  price?: string | null;
  postalAddress?: string | null;
}

export interface RenderedTrialReminderEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

export const MANAGE_SUBSCRIPTION_URLS = {
  app_store: 'https://apps.apple.com/account/subscriptions',
  play_store: 'https://play.google.com/store/account/subscriptions',
  stripe: 'https://www.fitcircle.ai/settings/billing',
} as const;

const PERIOD: Partial<Record<TrialPlan, string>> = { annual: 'year', monthly: 'month', weekly: 'week' };
const PLAN_NAME: Partial<Record<TrialPlan, string>> = { annual: 'annual', monthly: 'monthly', weekly: 'weekly' };

/** "Friday, November 20 at 2:05 PM EST" in `timezone`. */
export function formatTrialEnd(at: Date, timezone: string): string {
  const date = at.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: timezone });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: timezone });
  return `${date} at ${time}`;
}

/** Cancel steps for the store that bills the trial (both app stores when unknown). */
export function cancelSteps(store: TrialStore): Array<{ heading: string; steps: string; url: string; label: string }> {
  const apple = {
    heading: 'iPhone or iPad (App Store)',
    steps: 'Open Settings → tap your name (Apple ID) → Subscriptions → FitCircle → Cancel Subscription.',
    url: MANAGE_SUBSCRIPTION_URLS.app_store,
    label: 'Manage on the App Store',
  };
  const google = {
    heading: 'Android (Google Play)',
    steps: 'Open the Play Store → tap your profile icon → Payments & subscriptions → Subscriptions → FitCircle → Cancel subscription.',
    url: MANAGE_SUBSCRIPTION_URLS.play_store,
    label: 'Manage on Google Play',
  };
  const web = {
    heading: 'On the web',
    steps: 'Sign in at fitcircle.ai → Settings → Billing → Manage subscription → Cancel.',
    url: MANAGE_SUBSCRIPTION_URLS.stripe,
    label: 'Manage billing',
  };
  if (store === 'app_store') return [apple];
  if (store === 'play_store') return [google];
  if (store === 'stripe') return [web];
  return [apple, google];
}

export function trialReminderEmail(i: TrialReminderEmailInput): RenderedTrialReminderEmail {
  const day = i.endsPhrase || 'soon';
  const subject = `Your FitCircle trial ends ${day}`;
  const endText = formatTrialEnd(i.trialEndsAt, i.timezone);
  const planName = i.plan ? PLAN_NAME[i.plan] : undefined;
  const period = i.plan ? PERIOD[i.plan] : undefined;
  const price = typeof i.price === 'string' && i.price.trim() ? i.price.trim() : null;

  const planLine = planName
    ? price && period
      ? `After that, your ${planName} plan starts at ${price}/${period} and renews automatically.`
      : `After that, your ${planName} plan starts and renews automatically.`
    : 'After that, your FitCircle Pro subscription starts and renews automatically.';
  const keepLine = 'Want to keep Pro? You don\'t need to do anything. Not for you? Cancel any time before the trial ends and you won\'t be charged.';
  const preheader = `Your free trial of FitCircle Pro ends ${endText}. Cancel any time before then.`;
  const steps = cancelSteps(i.store);

  const stepsHtml = steps
    .map(
      (s) =>
        cardRow(
          `<p style="margin:0 0 6px 0;font-size:15px;line-height:22px;font-weight:700;color:${T.textPrimary};">${esc(s.heading)}</p>
${P(esc(s.steps), T.textSecondary, 15)}
${emailButton(s.url, s.label)}`,
          '16px 28px 8px 28px'
        )
    )
    .join('\n');

  const body = [
    cardRow(
      `<p style="margin:0 0 8px 0;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;color:${T.textSecondary};">TRIAL REMINDER</p>
<h1 class="h1" style="margin:0 0 8px 0;font-size:26px;line-height:32px;font-weight:800;letter-spacing:-0.5px;color:${T.textPrimary};">${esc(`Your trial ends ${day}`)}</h1>
${P(esc(`Your free trial of FitCircle Pro ends ${endText}.`), T.textSecondary, 16)}
${P(esc(planLine), T.textSecondary, 16)}
${P(esc(keepLine), T.textSecondary, 16)}`,
      '28px 28px 4px 28px'
    ),
    dividerRow(),
    cardRow(`<p style="margin:0;font-size:16px;line-height:22px;font-weight:700;color:${T.textPrimary};">How to cancel</p>`, '20px 28px 0 28px'),
    stepsHtml,
    `${dividerRow()}<tr><td class="px" style="padding:20px 28px 24px 28px;font-family:${EMAIL_FONT};">${P('Questions? Just reply to this email.', T.textTertiary, 14).replace('margin:0 0 14px 0', 'margin:0')}</td></tr>`,
  ].join('\n');

  const reason = 'You\'re getting this because you started a FitCircle Pro free trial and we promised to remind you before it ends.';
  const html = emailShell({ title: subject, preheader, body, footer: { reason, postalAddress: i.postalAddress } });

  const text = [
    `Your trial ends ${day}`,
    '',
    `Your free trial of FitCircle Pro ends ${endText}.`,
    planLine,
    keepLine,
    '',
    'How to cancel',
    ...steps.flatMap((s) => [`${s.heading}: ${s.steps}`, `${s.label}: ${s.url}`, '']),
    'Questions? Just reply to this email.',
    '',
    '--',
    reason,
    'FitCircle by Inov8r Labs',
    ...(i.postalAddress ? [i.postalAddress] : []),
  ].join('\n');

  return { subject, preheader, html, text };
}
