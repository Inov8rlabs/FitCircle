/**
 * Resend webhooks → ledger + analytics (docs/ENGAGEMENT_MESSAGING.md §8).
 *
 * Resend signs webhooks with Svix: headers svix-id / svix-timestamp /
 * svix-signature ("v1,<base64 sig> v1,<…>"), signature =
 * base64(HMAC-SHA256(base64decode(secret minus "whsec_"), `${id}.${ts}.${rawBody}`)).
 * Verified against the RAW body (never re-serialised JSON), 5-minute
 * timestamp tolerance, constant-time compare. Secret: RESEND_WEBHOOK_SECRET.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AnalyticsSink, ConsentProvider, LedgerStampField, SendLedger } from './adapters/types';
import { ctaIdFromUrl } from './links';

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function svixSignature(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export function verifySvix(secret: string | undefined, h: SvixHeaders, body: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(svixSignature(secret, h.id, h.timestamp, body));
  return h.signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    tags?: Record<string, string> | Array<{ name: string; value: string }>;
    click?: { link?: string; timestamp?: string };
    bounce?: { type?: string; subType?: string; message?: string };
  };
}

/** Resend event type → ledger column + tracking-plan event. Others are acknowledged and ignored. */
export const EVENT_MAP: Record<string, { field: LedgerStampField; event: string }> = {
  'email.delivered': { field: 'delivered_at', event: 'Email Delivered' },
  'email.opened': { field: 'opened_at', event: 'Email Opened' },
  'email.clicked': { field: 'clicked_at', event: 'Email Clicked' },
  'email.bounced': { field: 'bounced_at', event: 'Email Bounced' },
  'email.complained': { field: 'complained_at', event: 'Email Complained' },
};

export function tagsOf(e: ResendEvent): Record<string, string> {
  const t = e.data?.tags;
  if (!t) return {};
  if (Array.isArray(t)) return Object.fromEntries(t.filter((x) => x && x.name).map((x) => [x.name, String(x.value)]));
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)]));
}

/** Transient bounces (mailbox full, …) don't suppress the address. */
export function isHardBounce(e: ResendEvent): boolean {
  const type = (e.data?.bounce?.type ?? '').toLowerCase();
  return type === '' || type === 'permanent' || type === 'hard';
}

export type WebhookResult = { handled: false; reason: string } | { handled: true; event: string; sendId: string; first: boolean };

export async function handleResendEvent(
  e: ResendEvent,
  deps: { ledger: SendLedger; analytics: AnalyticsSink; consent: ConsentProvider }
): Promise<WebhookResult> {
  const map = EVENT_MAP[e.type];
  if (!map) return { handled: false, reason: 'ignored_type' };
  const tags = tagsOf(e);
  const at = e.data?.created_at ?? e.created_at ?? new Date().toISOString();
  const cta = e.type === 'email.clicked' ? ctaIdFromUrl(e.data?.click?.link) : null;
  const row = await deps.ledger.stamp(
    { providerId: e.data?.email_id ?? null, sendId: tags.send_id ?? null },
    map.field,
    at,
    cta ? { last_click: cta } : undefined
  );
  if (!row) return { handled: false, reason: 'unknown_or_repeat' };

  deps.analytics.track(
    row.user_id,
    map.event,
    {
      message_key: row.message_key,
      variant: row.variant ?? '',
      period_key: row.period_key,
      channel: 'email',
      template_version: row.template_version ?? '',
      send_id: row.id,
      ...(cta ? { cta } : {}),
      ...(e.type === 'email.bounced' ? { bounce_type: (e.data?.bounce?.type ?? 'unknown').toLowerCase().slice(0, 20) } : {}),
    },
    `${row.id}:${map.field}`
  );
  if (e.type === 'email.complained') await deps.consent.suppressEmail(row.user_id, 'complained');
  if (e.type === 'email.bounced' && isHardBounce(e)) await deps.consent.suppressEmail(row.user_id, 'bounced');
  return { handled: true, event: map.event, sendId: row.id, first: true };
}
