import { sendEmail } from '../email/email-service';
import { generateGenericNotificationEmail } from '../email/templates';

export interface NotificationPayload {
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
            const html = generateGenericNotificationEmail({
                title: payload.title,
                body: payload.body,
                actionUrl: payload.actionUrl,
                actionText: payload.actionText,
                userName: payload.userName,
                footerText: `You received this email because you have ${payload.type.replace(/_/g, ' ')} notifications enabled.`,
            });

            // Central sender: suppression list + category tag (lib/email/email-service.ts).
            const res = await sendEmail({
                to: payload.userEmail,
                subject: payload.title,
                html,
                category: 'notification',
                tags: { notification_type: payload.type },
            });

            if (!res.success) {
                if (res.errorName !== 'suppressed') console.error('Error sending email notification:', res.error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Exception sending email notification:', error);
            return false;
        }
    }
}
