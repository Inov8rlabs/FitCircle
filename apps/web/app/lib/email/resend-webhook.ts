/**
 * Resend webhooks → suppression list + engagement log (docs/EMAIL_QUALITY.md §C).
 *
 * Resend signs webhooks with Svix: headers `svix-id`, `svix-timestamp`,
 * `svix-signature` ("v1,<base64> v1,<base64>" during secret rotation),
 * signature = base64(HMAC-SHA256(base64decode(secret without "whsec_"),
 * `${id}.${timestamp}.${rawBody}`)). Verified against the RAW body, with a
 * 5-minute timestamp window (replay protection) and a constant-time compare.
 * Secret: RESEND_WEBHOOK_SECRET.
 *
 * Events:
 *   email.bounced (Permanent) → suppress every `to` address (hard_bounce)
 *   email.complained          → suppress every `to` address (complaint)
 *   email.bounced (Transient / Undetermined), delivered, opened, clicked,
 *   delivery_delayed, sent, failed → logged as one structured line
 *   (`[email-event] {...}`) for engagement metrics, nothing stored.
 *
 * Every write is idempotent (upsert by address hash), so Resend's at-least-
 * once retries are harmless; a duplicate svix-id seen by this instance is
 * acknowledged without re-processing.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { domainOfAddress, suppressAddress, type SuppressionReason, type SuppressionWrite } from './suppression';

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

export type SvixVerdict = 'ok' | 'missing_headers' | 'stale_timestamp' | 'bad_signature';

export function verifySvix(secret: string, h: SvixHeaders, body: string, nowSeconds = Math.floor(Date.now() / 1000)): SvixVerdict {
  if (!h.id || !h.timestamp || !h.signature) return 'missing_headers';
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return 'stale_timestamp';
  const expected = Buffer.from(svixSignature(secret, h.id, h.timestamp, body));
  const match = h.signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return match ? 'ok' : 'bad_signature';
}

export interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    from?: string;
    to?: string[] | string;
    subject?: string;
    tags?: Record<string, string> | Array<{ name: string; value: string }>;
    click?: { link?: string; timestamp?: string };
    bounce?: { type?: string; subType?: string; message?: string };
  };
}

export function tagsOf(e: ResendEvent): Record<string, string> {
  const t = e.data?.tags;
  if (!t) return {};
  if (Array.isArray(t)) return Object.fromEntries(t.filter((x) => x && x.name).map((x) => [x.name, String(x.value)]));
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)]));
}

export function recipientsOf(e: ResendEvent): string[] {
  const to = e.data?.to;
  const list = Array.isArray(to) ? to : typeof to === 'string' ? [to] : [];
  // Resend may send "Name <addr@x.com>"; keep the address.
  return list
    .map((r) => {
      const m = /<([^>]+)>/.exec(r);
      return (m ? m[1] : r).trim();
    })
    .filter((r) => r.includes('@'));
}

/**
 * Hard bounce = Resend/SES bounce type "Permanent" (no such mailbox, domain,
 * or the address is on Resend's own suppression list). "Transient" (mailbox
 * full, greylisting) and "Undetermined" don't suppress.
 */
export function isHardBounce(e: ResendEvent): boolean {
  return (e.data?.bounce?.type ?? '').trim().toLowerCase() === 'permanent';
}

/** Engagement event types we log (and acknowledge). */
export const LOGGED_TYPES = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.opened',
  'email.clicked',
  'email.bounced',
  'email.complained',
  'email.failed',
]);

export type WebhookResult =
  | { handled: false; reason: 'ignored_type' | 'other_sender' }
  | { handled: true; type: string; suppressed: number; suppressFailed: number };

/**
 * The Resend account is shared with other Inov8r Labs apps and webhooks are
 * account-wide, so only events for mail sent from fitcircle.ai (or a
 * subdomain) count. Events without a `from` are kept: we can't tell, and
 * Resend sends it on every email event today.
 */
const OWN_SENDER_DOMAIN = 'fitcircle.ai';

export function isOwnSender(from: string | undefined): boolean {
  if (!from) return true;
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const domain = address.split('@')[1] ?? '';
  return domain === OWN_SENDER_DOMAIN || domain.endsWith(`.${OWN_SENDER_DOMAIN}`);
}

export interface WebhookDeps {
  suppress: (w: SuppressionWrite) => Promise<{ ok: boolean; error?: string }>;
  log: (line: Record<string, unknown>) => void;
}

export const defaultWebhookDeps: WebhookDeps = {
  suppress: suppressAddress,
  log: (line) => console.log('[email-event]', JSON.stringify(line)),
};

/** Strip a clicked link to host + path (query strings can carry tokens). */
function linkPath(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname}`.slice(0, 120);
  } catch {
    return undefined;
  }
}

export async function handleResendEvent(e: ResendEvent, deps: WebhookDeps = defaultWebhookDeps): Promise<WebhookResult> {
  if (!LOGGED_TYPES.has(e.type)) return { handled: false, reason: 'ignored_type' };
  if (!isOwnSender(e.data?.from)) return { handled: false, reason: 'other_sender' };
  const tags = tagsOf(e);
  const recipients = recipientsOf(e);
  const at = e.data?.created_at ?? e.created_at ?? new Date().toISOString();

  let reason: SuppressionReason | null = null;
  if (e.type === 'email.complained') reason = 'complaint';
  else if (e.type === 'email.bounced' && isHardBounce(e)) reason = 'hard_bounce';

  let suppressed = 0;
  let suppressFailed = 0;
  if (reason) {
    for (const address of recipients) {
      const res = await deps.suppress({
        address,
        reason,
        source: 'resend_webhook',
        at,
        providerEmailId: e.data?.email_id ?? null,
        detail: {
          ...(tags.category ? { category: tags.category } : {}),
          ...(e.data?.bounce?.subType ? { bounce_subtype: String(e.data.bounce.subType).slice(0, 40) } : {}),
        },
      });
      if (res.ok) suppressed++;
      else suppressFailed++;
    }
  }

  // One line per event: the engagement metrics (no addresses — domains only).
  deps.log({
    type: e.type.replace(/^email\./, ''),
    category: tags.category ?? null,
    template: tags.template ?? null,
    email_id: e.data?.email_id ?? null,
    domains: [...new Set(recipients.map(domainOfAddress).filter(Boolean))],
    ...(e.type === 'email.bounced' ? { bounce_type: (e.data?.bounce?.type ?? 'unknown').toLowerCase(), bounce_subtype: e.data?.bounce?.subType ?? null } : {}),
    ...(e.type === 'email.clicked' ? { link: linkPath(e.data?.click?.link) ?? null } : {}),
    ...(reason ? { suppression: reason, suppressed, suppress_failed: suppressFailed } : {}),
  });

  return { handled: true, type: e.type, suppressed, suppressFailed };
}

// ---------------------------------------------------------------------------
// Duplicate delivery guard (per instance): Svix retries reuse the svix-id.
// ---------------------------------------------------------------------------

const SEEN_MAX = 2000;
const seen = new Map<string, number>();

/** True the first time an id is seen (and remembers it). */
export function firstDelivery(id: string): boolean {
  if (seen.has(id)) return false;
  if (seen.size >= SEEN_MAX) seen.delete(seen.keys().next().value as string);
  seen.set(id, Date.now());
  return true;
}

/** Forget an id (processing failed → let Resend's retry through). */
export function forgetDelivery(id: string): void {
  seen.delete(id);
}

export function resetWebhookStateForTests(): void {
  seen.clear();
}

/** `RESEND_WEBHOOK_ENABLED=false` → verify, acknowledge, do nothing. Default on. */
export function resendWebhookEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.RESEND_WEBHOOK_ENABLED ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}
