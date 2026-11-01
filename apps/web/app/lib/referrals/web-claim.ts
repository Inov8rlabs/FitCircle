import { acceptInvite, inviteSettled, type CircleJoinSummary } from './accept-invite';
import { normalizeCode } from './links';
import { type AttributionSource, type ClaimResult, type ReferralErrorCode } from './types';
import { FC_REF_COOKIE, readPendingInviteFromCookieHeader, type PendingInvite } from './web';

export type WebClaimOutcome = (
  | { claimed: true; result: ClaimResult }
  | { claimed: false; reason: ReferralErrorCode | 'NO_INVITE' | 'ERROR' }
) & {
  /** The circle part of a circle invite (null for personal invites / no invite). */
  circleJoin: CircleJoinSummary | null;
  /** Nothing left to retry: the `fc_ref` cookie can go. */
  settled: boolean;
};

/** Key under the auth user's `user_metadata` that carries the invite through signup (email confirmation, other browser). */
export const PENDING_INVITE_METADATA_KEY = 'pending_invite';

/**
 * Picks the invite to claim for a web signup: explicit `{code|ref, circle}` from
 * the form first (query params propagated through /register), else the
 * `fc_ref` cookie set by the landing page, else the invite stored in the auth
 * user's metadata at signup (survives email confirmation in another browser).
 */
export function resolveWebInvite(
  input: { code?: unknown; ref?: unknown; circle?: unknown } | null | undefined,
  cookieHeader: string | null | undefined,
  userMetadata?: Record<string, unknown> | null
): { code: string; ref: string | null } | null {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? normalizeCode(v) : null);
  const fromFields = (fields: { code?: unknown; ref?: unknown; circle?: unknown } | null | undefined) => {
    const circle = str(fields?.circle);
    const ref = str(fields?.ref);
    const code = str(fields?.code);
    if (circle) return { code: circle, ref: ref && ref !== circle ? ref : null };
    if (code) return { code, ref: ref && ref !== code ? ref : null };
    if (ref) return { code: ref, ref: null };
    return null;
  };

  const explicit = fromFields(input);
  if (explicit) return explicit;

  const pending: PendingInvite | null = readPendingInviteFromCookieHeader(cookieHeader);
  if (pending) {
    return { code: pending.code, ref: pending.ref && pending.ref !== pending.code ? pending.ref : null };
  }

  const stored = userMetadata?.[PENDING_INVITE_METADATA_KEY];
  return stored && typeof stored === 'object' ? fromFields(stored as Record<string, unknown>) : null;
}

/**
 * Accept the invite after a web account exists (or an existing account signs
 * in through an invite): referral attribution + circle join. Never throws:
 * ReferralErrors (already attributed, window closed, …) are expected outcomes
 * and never stop the circle join.
 */
export async function claimWebInvite(
  userId: string,
  invite: { code: string; ref: string | null } | null,
  source: Extract<AttributionSource, 'web' | 'typed'> = 'web'
): Promise<WebClaimOutcome> {
  if (!invite) return { claimed: false, reason: 'NO_INVITE', circleJoin: null, settled: true };
  const outcome = await acceptInvite(userId, { code: invite.code, ref: invite.ref, source });
  const settled = inviteSettled(outcome);
  if (outcome.referral.claimed) {
    return { claimed: true, result: outcome.referral.result, circleJoin: outcome.circleJoin, settled };
  }
  return {
    claimed: false,
    reason: outcome.referral.error?.code ?? 'ERROR',
    circleJoin: outcome.circleJoin,
    settled,
  };
}

/** Set-Cookie options that delete `fc_ref`. */
export const CLEAR_FC_REF_COOKIE = { name: FC_REF_COOKIE, value: '', path: '/', maxAge: 0, sameSite: 'lax' as const };
