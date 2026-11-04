/**
 * Engagement email unsubscribe tokens: `${userId}.${scope}.${hmac}` with
 * HMAC-SHA256 keyed by a CRON_SECRET-derived key (same scheme as the campaign
 * tokens, different purpose label). No expiry: an unsubscribe link must keep
 * working. `s=<send id>` is unsigned attribution only (which email it came from).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { EmailStream } from './adapters/types';
import { SITE } from './links';

export type UnsubscribeScope = EmailStream | 'all';
export const UNSUBSCRIBE_SCOPES: readonly UnsubscribeScope[] = ['weekly_report', 'tips', 'all'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function key(): string {
  const base = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fitcircle-engagement-dev-secret';
  return createHmac('sha256', base).update('engagement-email-unsubscribe:v1').digest('hex');
}

const sign = (userId: string, scope: string) => createHmac('sha256', key()).update(`${userId}.${scope}`).digest('base64url');

export function unsubscribeToken(userId: string, scope: UnsubscribeScope): string {
  return `${userId}.${scope}.${sign(userId, scope)}`;
}

export function verifyUnsubscribeToken(token: string | null | undefined): { userId: string; scope: UnsubscribeScope } | null {
  const [userId, scope, sig] = (token ?? '').split('.');
  if (!userId || !scope || !sig || !UUID.test(userId)) return null;
  if (!(UNSUBSCRIBE_SCOPES as readonly string[]).includes(scope)) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(userId, scope));
  return a.length === b.length && timingSafeEqual(a, b) ? { userId, scope: scope as UnsubscribeScope } : null;
}

export function unsubscribeUrl(userId: string, scope: UnsubscribeScope, sendId?: string | null): string {
  const qs = new URLSearchParams({ t: unsubscribeToken(userId, scope) });
  if (sendId && UUID.test(sendId)) qs.set('s', sendId);
  return `${SITE}/api/engagement/unsubscribe?${qs.toString()}`;
}

export const STREAM_LABEL: Record<UnsubscribeScope, string> = {
  weekly_report: 'weekly recaps',
  tips: 'tips and reminders',
  all: 'all FitCircle tips and updates',
};
