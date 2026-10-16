/**
 * Campaign email unsubscribe tokens (docs/CAMPAIGNS_SPEC.md §6):
 * `${userId}.${hmac}` with HMAC-SHA256 keyed by a CRON_SECRET-derived key. No
 * expiry — an unsubscribe link must keep working.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CAMPAIGN_SITE = 'https://www.fitcircle.ai';

function key(): string {
  const base = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fitcircle-campaigns-dev-secret';
  return createHmac('sha256', base).update('campaign-email-unsubscribe:v1').digest('hex');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function campaignUnsubscribeToken(userId: string): string {
  const sig = createHmac('sha256', key()).update(userId).digest('base64url');
  return `${userId}.${sig}`;
}

/** The user id the token was issued for, or null. */
export function verifyCampaignUnsubscribeToken(token: string | null | undefined): string | null {
  const [userId, sig] = (token ?? '').split('.');
  if (!userId || !sig || !UUID.test(userId)) return null;
  const expected = createHmac('sha256', key()).update(userId).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? userId : null;
}

export function campaignUnsubscribeUrl(userId: string): string {
  return `${CAMPAIGN_SITE}/api/campaigns/unsubscribe?t=${encodeURIComponent(campaignUnsubscribeToken(userId))}`;
}

export function campaignPageUrl(slug: string): string {
  return `${CAMPAIGN_SITE}/c/${encodeURIComponent(slug)}`;
}
