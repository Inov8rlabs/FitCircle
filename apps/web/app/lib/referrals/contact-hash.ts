/**
 * Salted contact hash (sha256 of `${salt}:${kind}:${value}`) — the one key we
 * store for an email address or phone number that isn't a member's own
 * (referral invites, invite opt-outs, email suppressions). Callers normalise
 * first: emails lower-cased + trimmed, phones E.164.
 *
 * Lives on its own (no imports) so the email layer can use it without pulling
 * in the referral services. `referral-invite-service` re-exports it.
 */
import { createHash } from 'node:crypto';

export function contactHash(kind: 'email' | 'phone', value: string): string {
  const salt = process.env.REFERRAL_DEVICE_SALT || 'fitcircle-referrals';
  return createHash('sha256').update(`${salt}:${kind}:${value}`).digest('hex');
}

/** Hash of an email address for suppression / opt-out lookups (trimmed, lower-cased). */
export function emailAddressHash(address: string): string {
  return contactHash('email', address.trim().toLowerCase());
}
