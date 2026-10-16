import { ReferralService } from '@/lib/services/referral-service';

import { normalizeCode } from './links';
import { ReferralError, type AttributionSource, type ClaimResult, type ReferralErrorCode } from './types';
import { FC_REF_COOKIE, readPendingInviteFromCookieHeader, type PendingInvite } from './web';

export type WebClaimOutcome =
  | { claimed: true; result: ClaimResult }
  | { claimed: false; reason: ReferralErrorCode | 'NO_INVITE' | 'ERROR' };

/**
 * Picks the invite to claim for a web signup: explicit `{code|ref, circle}` from
 * the form first (query params propagated through /register), else the
 * `fc_ref` cookie set by the landing page.
 */
export function resolveWebInvite(
  input: { code?: unknown; ref?: unknown; circle?: unknown } | null | undefined,
  cookieHeader: string | null | undefined
): { code: string; ref: string | null } | null {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? normalizeCode(v) : null);
  const circle = str(input?.circle);
  const ref = str(input?.ref);
  const code = str(input?.code);
  if (circle) return { code: circle, ref };
  if (code) return { code, ref: ref && ref !== code ? ref : null };
  if (ref) return { code: ref, ref: null };

  const pending: PendingInvite | null = readPendingInviteFromCookieHeader(cookieHeader);
  if (!pending) return null;
  return { code: pending.code, ref: pending.ref && pending.ref !== pending.code ? pending.ref : null };
}

/**
 * Best-effort attribution after a web account is created. Never throws:
 * ReferralErrors (invalid code, already attributed, window closed, …) are
 * expected outcomes and are swallowed; anything else is logged.
 */
export async function claimWebInvite(
  userId: string,
  invite: { code: string; ref: string | null } | null,
  source: Extract<AttributionSource, 'web' | 'typed'> = 'web'
): Promise<WebClaimOutcome> {
  if (!invite) return { claimed: false, reason: 'NO_INVITE' };
  try {
    const result = await ReferralService.claim(userId, { code: invite.code, ref: invite.ref, source });
    return { claimed: true, result };
  } catch (error) {
    if (error instanceof ReferralError) return { claimed: false, reason: error.code };
    console.error('[referrals] web claim failed', { userId, code: invite.code, error });
    return { claimed: false, reason: 'ERROR' };
  }
}

/** Set-Cookie options that delete `fc_ref`. */
export const CLEAR_FC_REF_COOKIE = { name: FC_REF_COOKIE, value: '', path: '/', maxAge: 0, sameSite: 'lax' as const };
