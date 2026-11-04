/**
 * Dispatcher: one MessagePlan → holdout check → consent → ledger claim →
 * render → send → ledger outcome → analytics, per channel. The only place
 * that sends. Mirrors Engage's per-user job (ENGAGE_V2_SPEC §8 step 3): the
 * ledger row is inserted BEFORE the provider call, so a crash or an
 * overlapping run can never double-send.
 */
import type { EmailStream, EngagementAdapters } from './adapters/types';
import { isHoldout } from './config';
import { renderEmail } from './render/email';
import { renderPush } from './render/push';
import { variantString, type Channel, type MessagePlan, type SkipReason } from './types';
import { STREAM_LABEL, unsubscribeUrl } from './unsubscribe';

export type ChannelOutcome = 'sent' | 'would_send' | 'failed' | 'retry' | SkipReason;

export interface DispatchOutcome {
  userId: string;
  messageKey: string;
  periodKey: string;
  variant: string;
  email?: ChannelOutcome;
  push?: ChannelOutcome;
  /** Dry runs: what would go out. */
  preview?: { subject?: string; pushTitle?: string; pushBody?: string };
}

export interface DispatchOptions {
  dryRun: boolean;
  channels: { email: boolean; push: boolean };
  holdoutPct: number;
  stream: EmailStream;
  postalAddress?: string | null;
}

/** Resend errors worth retrying on the next run (everything else is terminal for the period). */
const TRANSIENT = /rate_limit|internal_server_error|application_error|timeout|network|fetch failed|ECONN|ETIMEDOUT|503|502|500/i;

const SKIP_EVENT = 'Lifecycle Message Skipped';

export async function dispatch(a: EngagementAdapters, userId: string, plan: MessagePlan, o: DispatchOptions): Promise<DispatchOutcome> {
  const variant = variantString(plan.variants);
  const out: DispatchOutcome = { userId, messageKey: plan.messageKey, periodKey: plan.periodKey, variant };
  const base = {
    message_key: plan.messageKey,
    variant,
    period_key: plan.periodKey,
    template_version: plan.templateVersion,
    medium: plan.medium,
    ...(plan.meta?.growth_slot ? { growth_slot: String(plan.meta.growth_slot) } : {}),
    ...(plan.meta?.week_type ? { week_type: String(plan.meta.week_type) } : {}),
  };
  const planned: Channel[] = [];
  if (plan.email) planned.push('email');
  if (plan.push) planned.push('push');
  const claimBase = {
    userId,
    messageKey: plan.messageKey,
    periodKey: plan.periodKey,
    variant,
    templateVersion: plan.templateVersion,
    goalKey: plan.goalKey,
    meta: plan.meta,
  };

  const skip = async (channel: Channel, reason: SkipReason, persist: boolean) => {
    out[channel] = reason;
    if (o.dryRun) return;
    let fresh = true;
    if (persist) {
      fresh = (await a.ledger.claim({ ...claimBase, channel, status: reason === 'holdout' ? 'holdout' : 'skipped', meta: { ...plan.meta, reason } })) !== null;
    }
    if (fresh) a.analytics.track(userId, SKIP_EVENT, { ...base, channel, reason });
  };

  // 1. Holdout (sticky control group): recorded, never sent.
  if (isHoldout(userId, plan.messageKey, o.holdoutPct)) {
    for (const ch of planned) await skip(ch, 'holdout', true);
    return out;
  }

  // 2. Email
  if (plan.email) {
    if (!o.channels.email) {
      out.email = 'flag_off';
    } else {
      const consent = await a.consent.emailAllowed(userId, o.stream);
      if (!consent.allowed) {
        await skip('email', consent.reason, true);
      } else if (o.dryRun) {
        out.email = 'would_send';
        out.preview = { ...out.preview, subject: plan.email.subject };
      } else {
        const sendId = await a.ledger.claim({ ...claimBase, channel: 'email' });
        if (!sendId) {
          out.email = 'already_sent';
        } else {
          const unsub = unsubscribeUrl(userId, o.stream, sendId);
          const rendered = renderEmail(plan.email, {
            messageKey: plan.messageKey,
            medium: plan.medium,
            sendId,
            content: plan.variants.hero ?? plan.variants.subject ?? undefined,
            postalAddress: o.postalAddress,
            footerLinks: [
              { label: `Unsubscribe from ${STREAM_LABEL[o.stream]}`, url: unsub },
              { label: 'Unsubscribe from all', url: unsubscribeUrl(userId, 'all', sendId) },
            ],
          });
          const res = await a.email.send({
            to: consent.email,
            email: rendered,
            unsubscribeUrl: unsub,
            idempotencyKey: `engagement/${sendId}`,
            tags: {
              message_key: plan.messageKey,
              period_key: plan.periodKey.replace(/[^A-Za-z0-9_-]/g, '_'),
              variant: variant.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200),
              medium: plan.medium,
              send_id: sendId,
            },
          });
          if (res.ok) {
            await a.ledger.complete(sendId, { status: 'sent', providerId: res.providerId });
            out.email = 'sent';
            a.analytics.track(userId, 'Email Sent', { ...base, channel: 'email', send_id: sendId }, `${sendId}:sent`);
            if (plan.messageKey === 'weekly_report') {
              a.analytics.track(
                userId,
                'Weekly Report Sent',
                {
                  ...base,
                  send_id: sendId,
                  stat_count: Number(plan.meta?.stat_count ?? 0),
                  active_days: Number(plan.meta?.active_days ?? 0),
                },
                `${sendId}:weekly`
              );
            }
          } else if (TRANSIENT.test(res.error)) {
            await a.ledger.release(sendId);
            out.email = 'retry';
          } else {
            await a.ledger.complete(sendId, { status: 'failed', meta: { error: res.error.slice(0, 120) } });
            out.email = 'failed';
          }
        }
      }
    }
  }

  // 3. Push (NotificationOrchestrator applies category toggle, caps, quiet hours, dedupe)
  if (plan.push) {
    const rendered = renderPush(plan.push, plan.messageKey, plan.periodKey);
    if (!o.channels.push) {
      out.push = 'flag_off';
    } else if (o.dryRun) {
      out.push = 'would_send';
      out.preview = { ...out.preview, pushTitle: rendered.data.title, pushBody: rendered.data.body };
    } else {
      const sendId = await a.ledger.claim({ ...claimBase, channel: 'push' });
      if (!sendId) {
        out.push = 'already_sent';
      } else {
        const res = await a.push.send(userId, rendered);
        if (res.sent) {
          await a.ledger.complete(sendId, { status: 'sent' });
          out.push = 'sent';
          a.analytics.track(userId, 'Push Sent', { ...base, channel: 'push', send_id: sendId, notification_type: rendered.type }, `${sendId}:sent`);
        } else {
          await a.ledger.complete(sendId, { status: 'suppressed', meta: { reason: res.reason } });
          out.push = 'push_suppressed';
          a.analytics.track(userId, SKIP_EVENT, { ...base, channel: 'push', reason: 'push_suppressed', detail: res.reason.slice(0, 40) });
        }
      }
    }
  }
  return out;
}
