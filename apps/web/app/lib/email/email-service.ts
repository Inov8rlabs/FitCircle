/**
 * Email Service using Resend — the ONE place FitCircle hands email to Resend.
 *
 * Every sender (welcome, circle + referral invites, reminders, rewards,
 * campaigns, onboarding nudges, notification emails, the internal ads report)
 * goes through `sendEmail`, which:
 *   - drops recipients on the suppression list (hard bounce / spam complaint,
 *     written by /api/webhooks/resend — lib/email/suppression.ts). Fail-open
 *     when the list can't be read;
 *   - tags the message with its `category` so Resend's dashboard and the
 *     webhook can tell the streams apart;
 *   - never throws.
 *
 * Supabase Auth mail (password reset, confirmation) is sent by Supabase via
 * its SMTP settings, not from here (docs/EMAIL_QUALITY.md).
 */

import { Resend } from 'resend';

import { findSuppressedAddresses, normalizeAddress } from './suppression';
import { generateInvitationEmail } from './templates';

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// Email configuration
const FROM_EMAIL = 'FitCircle <team@fitcircle.ai>';
const REPLY_TO = 'team@fitcircle.ai';

export interface SendInvitationEmailParams {
  to: string;
  invitedByName: string;
  circleName: string;
  circleType: 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';
  startDate: string;
  endDate: string;
  participantCount: number;
  inviteCode: string;
}

/**
 * Send invitation email to join a FitCircle
 */
export async function sendInvitationEmail({
  to,
  invitedByName,
  circleName,
  circleType,
  startDate,
  endDate,
  participantCount,
  inviteCode,
}: SendInvitationEmailParams): Promise<{ success: boolean; error?: string; suppressed?: boolean }> {
  const html = generateInvitationEmail({
    invitedByName,
    invitedEmail: to,
    circleName,
    circleType,
    startDate,
    endDate,
    participantCount,
    inviteCode,
  });
  const res = await sendEmail({
    to,
    subject: `${invitedByName} invited you to join "${circleName}" on FitCircle`,
    html,
    category: 'circle_invite',
  });
  if (!res.success) {
    if (res.errorName !== 'suppressed') console.error('Error sending invitation email:', res.error);
    return { success: false, error: res.error, suppressed: res.errorName === 'suppressed' };
  }
  return { success: true };
}

/**
 * Send batch invitation emails
 * Useful when inviting multiple people to a FitCircle
 */
export async function sendBatchInvitationEmails(
  invitations: SendInvitationEmailParams[]
): Promise<{ success: number; failed: number; suppressed: number; errors: string[] }> {
  const results = await Promise.allSettled(
    invitations.map((invitation) => sendInvitationEmail(invitation))
  );

  let success = 0;
  let failed = 0;
  let suppressed = 0;
  const errors: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      success++;
    } else if (result.status === 'fulfilled' && result.value.suppressed) {
      suppressed++;
    } else {
      failed++;
      const errorMsg =
        result.status === 'fulfilled'
          ? result.value.error || 'Unknown error'
          : result.reason;
      errors.push(`${invitations[index].to}: ${errorMsg}`);
    }
  });

  return { success, failed, suppressed, errors };
}

/** Which stream an email belongs to (Resend tag `category`; docs/EMAIL_QUALITY.md). */
export type EmailCategory =
  | 'welcome'
  | 'circle_invite'
  | 'referral_invite'
  | 'referral_reminder'
  | 'referral_reward'
  | 'campaign'
  | 'onboarding_nudge'
  | 'notification'
  | 'ads_report'
  | 'other';

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Extra headers, e.g. List-Unsubscribe / List-Unsubscribe-Post for lifecycle mail. */
  headers?: Record<string, string>;
  /** Resend idempotency key: a retry with the same key within 24 h is not sent twice. */
  idempotencyKey?: string;
  /** Display name: "Maya" → `Maya via FitCircle <team@fitcircle.ai>`. Default `FitCircle`. */
  fromName?: string;
  /** Stream tag (default `other`). */
  category?: EmailCategory;
  /** Extra Resend tags (ASCII letters, digits, `_`, `-`; others become `_`). */
  tags?: Record<string, string | null | undefined>;
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
  /**
   * Resend's error name (e.g. `rate_limit_exceeded`, `validation_error`) so
   * callers can tell a transient failure from a permanent one;
   * `not_configured` without a key; `suppressed` when every recipient is on
   * the bounce/complaint suppression list (nothing was sent).
   */
  errorName?: string;
  /** Recipients dropped because they're suppressed (normalised). */
  suppressed?: string[];
}

const TAG_UNSAFE = /[^A-Za-z0-9_-]+/g;

/** Resend tag list (invalid characters → `_`, ≤ 256 chars; empty values dropped). */
export function resendTags(tags: Record<string, string | null | undefined> = {}): Array<{ name: string; value: string }> {
  return Object.entries(tags)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([name, value]) => ({
      name: name.replace(TAG_UNSAFE, '_').slice(0, 256),
      value: String(value).replace(TAG_UNSAFE, '_').slice(0, 256),
    }));
}

function fromHeader(fromName: string | undefined): string {
  const name = (fromName ?? '').replace(/[<>"\r\n]/g, '').trim().slice(0, 40);
  return !name || name === 'FitCircle' ? FROM_EMAIL : `${name} via FitCircle <team@fitcircle.ai>`;
}

/**
 * Send one email (to one or several recipients) from the FitCircle sender.
 * Suppressed recipients are dropped first; if none remain nothing is sent and
 * `errorName` is `suppressed`. Never throws.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  headers,
  idempotencyKey,
  fromName,
  category = 'other',
  tags,
}: SendEmailParams): Promise<SendEmailResult> {
  const recipients = (Array.isArray(to) ? to : [to]).map((r) => r.trim()).filter(Boolean);
  if (recipients.length === 0) return { success: false, error: 'No recipient', errorName: 'validation_error' };

  const blocked = await findSuppressedAddresses(recipients);
  const allowed = recipients.filter((r) => !blocked.has(normalizeAddress(r)));
  const suppressed = recipients.filter((r) => blocked.has(normalizeAddress(r))).map(normalizeAddress);
  if (suppressed.length > 0) {
    console.warn(`[email] ${category}: skipped ${suppressed.length} suppressed recipient(s) (hard bounce / complaint)`);
  }
  if (allowed.length === 0) {
    return { success: false, error: 'All recipients are suppressed (bounced or complained)', errorName: 'suppressed', suppressed };
  }

  const resend = getResend();
  if (!resend) {
    console.warn('RESEND_API_KEY not configured, skipping email send');
    return { success: false, error: 'Email service not configured', errorName: 'not_configured' };
  }
  try {
    const { data, error } = await resend.emails.send(
      {
        from: fromHeader(fromName),
        to: Array.isArray(to) ? allowed : allowed[0],
        replyTo: REPLY_TO,
        subject,
        html,
        text,
        tags: resendTags({ category, ...(tags ?? {}) }),
        ...(headers ? { headers } : {}),
      },
      idempotencyKey ? { idempotencyKey } : undefined
    );
    if (error) return { success: false, error: error.message, errorName: error.name, ...(suppressed.length ? { suppressed } : {}) };
    return { success: true, id: data?.id, ...(suppressed.length ? { suppressed } : {}) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error', errorName: 'network_error' };
  }
}

// Re-export NotificationService
export { NotificationService } from '../services/notification-service';
export type { NotificationPayload } from '../services/notification-service';
