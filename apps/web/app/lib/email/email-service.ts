/**
 * Email Service using Resend
 *
 * Provides functions to send branded emails for various user actions
 */

import { Resend } from 'resend';

import { generateWelcomeEmail, generateInvitationEmail } from './templates';

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// Email configuration
const FROM_EMAIL = 'FitCircle <team@fitcircle.ai>';
const REPLY_TO = 'team@fitcircle.ai';

export interface SendWelcomeEmailParams {
  to: string;
  userName: string;
}

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
 * Send welcome email to new users
 */
export async function sendWelcomeEmail({
  to,
  userName,
}: SendWelcomeEmailParams): Promise<{ success: boolean; error?: string }> {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY not configured, skipping email send');
      return { success: false, error: 'Email service not configured' };
    }

    const html = generateWelcomeEmail({
      userName,
      userEmail: to,
    });

    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'Email service not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      replyTo: REPLY_TO,
      subject: `Welcome to FitCircle, ${userName}!`,
      html,
    });

    if (error) {
      console.error('Error sending welcome email:', error);
      return { success: false, error: error.message };
    }

    console.log('Welcome email sent successfully:', data);
    return { success: true };
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
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
}: SendInvitationEmailParams): Promise<{ success: boolean; error?: string }> {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY not configured, skipping email send');
      return { success: false, error: 'Email service not configured' };
    }

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

    const resend = getResend();
    if (!resend) {
      return { success: false, error: 'Email service not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      replyTo: REPLY_TO,
      subject: `${invitedByName} invited you to join "${circleName}" on FitCircle`,
      html,
    });

    if (error) {
      console.error('Error sending invitation email:', error);
      return { success: false, error: error.message };
    }

    console.log('Invitation email sent successfully:', data);
    return { success: true };
  } catch (error) {
    console.error('Failed to send invitation email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send batch invitation emails
 * Useful when inviting multiple people to a FitCircle
 */
export async function sendBatchInvitationEmails(
  invitations: SendInvitationEmailParams[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  const results = await Promise.allSettled(
    invitations.map((invitation) => sendInvitationEmail(invitation))
  );

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      success++;
    } else {
      failed++;
      const errorMsg =
        result.status === 'fulfilled'
          ? result.value.error || 'Unknown error'
          : result.reason;
      errors.push(`${invitations[index].to}: ${errorMsg}`);
    }
  });

  return { success, failed, errors };
}

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send a plain transactional / internal email (e.g. the ads report) from the
 * FitCircle sender. Never throws.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<{ success: boolean; id?: string; error?: string }> {
  const resend = getResend();
  if (!resend) {
    console.warn('RESEND_API_KEY not configured, skipping email send');
    return { success: false, error: 'Email service not configured' };
  }
  try {
    const { data, error } = await resend.emails.send({ from: FROM_EMAIL, to, replyTo: REPLY_TO, subject, html, text });
    if (error) return { success: false, error: error.message };
    return { success: true, id: data?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export interface SendTrackedEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend tags: names/values limited to ASCII letters, digits, `_` and `-`. */
  tags?: Record<string, string>;
  headers?: Record<string, string>;
  /** Resend idempotency key (24 h): a retried call never sends twice. */
  idempotencyKey?: string;
}

const TAG_SAFE = /[^A-Za-z0-9_-]+/g;

/** Resend tag list from a map (invalid characters → `_`, values ≤ 256 chars). */
export function resendTags(tags: Record<string, string> = {}): Array<{ name: string; value: string }> {
  return Object.entries(tags)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([name, value]) => ({ name: name.replace(TAG_SAFE, '_').slice(0, 256), value: String(value).replace(TAG_SAFE, '_').slice(0, 256) }));
}

/**
 * Send with tags + headers + idempotency, returning Resend's email id (which
 * the Resend webhook reports back). Used by the welcome email and the
 * lifecycle messaging EmailSender. Never throws.
 */
export async function sendTrackedEmail(p: SendTrackedEmailParams): Promise<{ success: true; id: string | null } | { success: false; error: string }> {
  const resend = getResend();
  if (!resend) return { success: false, error: 'not_configured' };
  try {
    const { data, error } = await resend.emails.send(
      {
        from: FROM_EMAIL,
        to: p.to,
        replyTo: REPLY_TO,
        subject: p.subject,
        html: p.html,
        text: p.text,
        tags: resendTags(p.tags),
        headers: p.headers,
      },
      p.idempotencyKey ? { idempotencyKey: p.idempotencyKey } : undefined
    );
    if (error) return { success: false, error: `${error.name ?? 'error'}: ${error.message}` };
    return { success: true, id: data?.id ?? null };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Re-export NotificationService
export { NotificationService } from '../services/notification-service';
export type { NotificationPayload } from '../services/notification-service';
