/**
 * "Finish setting up" email (OnboardingNudgeService). Same dark shell as the
 * campaign emails (incl. the marketing unsubscribe footer). The button opens
 * https://fitcircle.ai/open, which iOS hands to the installed app (AASA) and
 * which otherwise forwards to /get (the right store; Play shows "Open" when
 * installed). The app resumes onboarding at the saved step.
 */
import { APEX_HOST, openPath } from '../app-links';
import { campaignUnsubscribeUrl } from '../campaigns/unsubscribe';

import { campaignEmail } from './campaign-emails';
import type { RenderedEmail } from './referral-emails';

export function onboardingNudgeLink(touch: 1 | 2): string {
  return `${APEX_HOST}${openPath({
    utm: { utm_source: 'email', utm_medium: 'lifecycle', utm_campaign: 'finish_setup', utm_content: `touch_${touch}` },
  })}`;
}

const COPY: Record<1 | 2, { subject: string; preheader: string; heading: string; body: string }> = {
  1: {
    subject: 'Your plan is almost ready',
    preheader: '2 minutes left to finish setting up FitCircle.',
    heading: 'Your plan is almost ready',
    body: "You're about 2 minutes from your personal FitCircle plan.\n\nEverything you've entered so far is saved, so you'll pick up right where you left off.",
  },
  2: {
    subject: 'Your FitCircle plan is still waiting',
    preheader: '2 minutes left to finish setting up FitCircle.',
    heading: 'Your plan is still waiting',
    body: "2 minutes left to finish setting up FitCircle.\n\nYour answers are saved. Open the app and you'll pick up right where you left off.",
  },
};

export function onboardingNudgeEmail(userId: string, touch: 1 | 2): RenderedEmail & { unsubscribeUrl: string } {
  const c = COPY[touch];
  const unsubscribeUrl = campaignUnsubscribeUrl(userId);
  const rendered = campaignEmail({
    subject: c.subject,
    preheader: c.preheader,
    heading: c.heading,
    body: c.body,
    ctaLabel: 'Finish setting up',
    ctaUrl: onboardingNudgeLink(touch),
    unsubscribeUrl,
  });
  return { ...rendered, unsubscribeUrl };
}
