/**
 * EmailSender over Resend (via lib/email/email-service, the one Resend client).
 * Adds RFC 8058 one-click List-Unsubscribe headers for engagement email and
 * tags every send so the Resend webhook can find the ledger row.
 */
import { sendTrackedEmail } from '../../email/email-service';

import type { EmailSendRequest, EmailSender, SendResult } from './types';

export class ResendEmailSender implements EmailSender {
  async send(req: EmailSendRequest): Promise<SendResult> {
    const res = await sendTrackedEmail({
      to: req.to,
      subject: req.email.subject,
      html: req.email.html,
      text: req.email.text,
      tags: req.tags,
      idempotencyKey: req.idempotencyKey,
      headers: req.unsubscribeUrl
        ? { 'List-Unsubscribe': `<${req.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
        : undefined,
    });
    return res.success ? { ok: true, providerId: res.id } : { ok: false, error: res.error };
  }
}
