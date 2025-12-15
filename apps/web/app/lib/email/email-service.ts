/**
 * Email Service using Resend
 *
 * Provides functions to send branded emails for various user actions
 */

import { Resend } from 'resend';
import { generateWelcomeEmail, generateInvitationEmail } from './templates';

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

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

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      replyTo: REPLY_TO,
      subject: `Welcome to FitCircle, ${userName}! 🎉`,
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

// Re-export NotificationService
export { NotificationService } from '../services/notification-service';
export type { NotificationPayload } from '../services/notification-service';
