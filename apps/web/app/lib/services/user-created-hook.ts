/**
 * onUserCreated — the one transactional hook every signup path calls when an
 * account is NEWLY created (web register, mobile register, first Apple / Google
 * sign-in). Never on a returning login.
 *
 * Today it sends the welcome email. Idempotent: the send is claimed in
 * engagement_sends ('welcome', 'once', 'email') before Resend is called, so a
 * retried request or a double-tap can't send twice. Before migration 119 is
 * applied the claim fails and the email is still sent (the call sites only run
 * on creation, so the guard is a backstop, not the main protection).
 *
 * Fire-and-forget: `triggerUserCreated` runs after the response and never
 * throws; failures are logged. Kill switch: WELCOME_EMAIL_ENABLED=false.
 */
import { sendTrackedEmail } from '../email/email-service';
import { WELCOME_TEMPLATE, welcomeEmail } from '../email/welcome-email';
import { firstNameOf } from '../engagement/adapters/fitcircle-facts';
import { AmplitudeAnalyticsSink } from '../engagement/adapters/amplitude-analytics';
import { SupabaseSendLedger } from '../engagement/adapters/supabase-ledger';
import type { AnalyticsSink, SendLedger } from '../engagement/adapters/types';
import { engagementFlags } from '../engagement/config';
import { appScreenUrl, trackedUrl } from '../engagement/links';
import { runAfterResponse } from '../utils/after-response';

export type SignupMethod = 'email' | 'apple' | 'google';

export interface NewUser {
  userId: string;
  email: string | null | undefined;
  displayName?: string | null;
  method: SignupMethod;
  /** 'web' | 'ios' | 'android' when known. */
  platform?: string | null;
}

export interface UserCreatedDeps {
  ledger: SendLedger;
  analytics: AnalyticsSink;
  send: typeof sendTrackedEmail;
}

export type WelcomeOutcome = 'sent' | 'disabled' | 'no_email' | 'already_sent' | 'failed';

export async function sendWelcome(u: NewUser, deps: UserCreatedDeps): Promise<WelcomeOutcome> {
  if (!engagementFlags().welcomeEmail) return 'disabled';
  const email = (u.email ?? '').trim();
  if (!email || !email.includes('@')) return 'no_email';

  let sendId: string | null = null;
  try {
    sendId = await deps.ledger.claim({
      userId: u.userId,
      messageKey: 'welcome',
      periodKey: 'once',
      channel: 'email',
      variant: `method:${u.method}`,
      templateVersion: WELCOME_TEMPLATE,
      goalKey: 'meal_logged',
      meta: { method: u.method, ...(u.platform ? { platform: u.platform } : {}) },
    });
    if (!sendId) return 'already_sent';
  } catch (err: any) {
    console.warn('[onUserCreated] welcome ledger unavailable, sending without it:', err?.message);
  }

  const firstAction = trackedUrl(appScreenUrl('food_log'), {
    messageKey: 'welcome',
    medium: 'transactional',
    content: u.method,
    ctaId: 'primary',
    sendId,
  });
  const rendered = welcomeEmail({
    firstName: firstNameOf(u.displayName, null) || null,
    firstActionUrl: firstAction,
    postalAddress: process.env.EMAIL_POSTAL_ADDRESS || null,
  });
  const res = await deps.send({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: { message_key: 'welcome', medium: 'transactional', period_key: 'once', ...(sendId ? { send_id: sendId } : {}) },
    idempotencyKey: `welcome/${u.userId}`,
  });
  if (!res.success) {
    console.error('[onUserCreated] welcome email failed:', res.error);
    if (sendId) {
      if (/rate_limit|internal_server_error|application_error|network|fetch failed/i.test(res.error)) await deps.ledger.release(sendId);
      else await deps.ledger.complete(sendId, { status: 'failed', meta: { error: res.error.slice(0, 120) } });
    }
    return 'failed';
  }
  if (sendId) await deps.ledger.complete(sendId, { status: 'sent', providerId: res.id });
  deps.analytics.track(
    u.userId,
    'Email Sent',
    {
      message_key: 'welcome',
      variant: `method:${u.method}`,
      period_key: 'once',
      channel: 'email',
      template_version: WELCOME_TEMPLATE,
      medium: 'transactional',
      ...(sendId ? { send_id: sendId } : {}),
    },
    `welcome:${u.userId}`
  );
  return 'sent';
}

/** Run the new-account side effects after the response. Never throws. */
export function triggerUserCreated(u: NewUser): void {
  runAfterResponse(
    () =>
      sendWelcome(u, { ledger: new SupabaseSendLedger(), analytics: new AmplitudeAnalyticsSink(), send: sendTrackedEmail }).then((outcome) => {
        if (outcome !== 'sent') console.log(`[onUserCreated] welcome email ${outcome} for ${u.userId}`);
      }),
    'onUserCreated'
  );
}
