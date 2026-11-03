import { Resend } from 'resend';
import { deliverLegacyEmail } from '../engage/legacy-email';
import { NotificationPreferencesService, TRANSACTIONAL_TYPES } from './notification-preferences-service';

import { generateGenericNotificationEmail } from '../email/templates';

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const FROM_EMAIL = 'FitCircle <team@fitcircle.ai>';
const REPLY_TO = 'team@fitcircle.ai';

export interface NotificationPayload {
    occurrenceKey?: string;
    userId: string;
    userEmail: string;
    userName?: string;
    type: string;
    title: string;
    body: string;
    actionUrl?: string;
    actionText?: string;
    metadata?: Record<string, any>;
}

export class NotificationService {
    /**
     * Sends an email notification using the generic template
     */
    static async sendEmailNotification(payload: NotificationPayload): Promise<boolean> {
        try {
            if (!process.env.RESEND_API_KEY) {
                console.warn('RESEND_API_KEY is not set. Skipping email notification.');
                return false;
            }

            const html = generateGenericNotificationEmail({
                title: payload.title,
                body: payload.body,
                actionUrl: payload.actionUrl,
                actionText: payload.actionText,
                userName: payload.userName,
                footerText: `You received this email because you have ${payload.type.replace(/_/g, ' ')} notifications enabled.`,
            });
            const {nativeBridgeActive}=await import('../engage/server');
            if (await nativeBridgeActive()) {
                if (!payload.occurrenceKey) throw new Error('Notification email requires a stable occurrence key');
                const category=NotificationPreferencesService.getCategoryForType(payload.type);
                const transactional=TRANSACTIONAL_TYPES.has(payload.type);
                if (!transactional && !category) throw new Error('Unknown notification email category');
                return deliverLegacyEmail(payload.userId,{key:`email:${payload.occurrenceKey}`,category:transactional ? 'transactional':'lifecycle',lifecycle_category:category ?? undefined,counts_global:!transactional,respect_global_caps:!transactional},{to:payload.userEmail,subject:payload.title,html});
            }

            const resend = getResend();
            if (!resend) return false;

            const { data, error } = await resend.emails.send({
                from: FROM_EMAIL,
                to: payload.userEmail,
                replyTo: REPLY_TO,
                subject: payload.title,
                html,
                tags: [
                    { name: 'notification_type', value: payload.type },
                    { name: 'user_id', value: payload.userId },
                ],
            });

            if (error) {
                console.error('Error sending email notification:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Exception sending email notification:', error);
            return false;
        }
    }
}
