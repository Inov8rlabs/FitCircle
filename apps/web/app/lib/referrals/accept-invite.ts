import {
  CircleService,
  InviteJoinError,
  type InviteJoinFailureCode,
  type InviteJoinResult,
} from '@/lib/services/circle-service';
import { ensureProfileRow } from '@/lib/services/profile-bootstrap';
import { ReferralService } from '@/lib/services/referral-service';

import { classifyCode, normalizeCode } from './links';
import { ReferralError, type AttributionSource, type ClaimResult } from './types';

/** What happened to the circle part of an invite (null for personal invites). */
export type CircleJoinSummary =
  | {
      status: InviteJoinResult['status'];
      circle: { id: string; name: string; inviteCode: string };
      isCreator: boolean;
    }
  | { status: 'failed'; reason: InviteJoinFailureCode | 'ERROR'; message: string };

export type ReferralClaimOutcome =
  | { claimed: true; result: ClaimResult }
  | { claimed: false; error: ReferralError | null };

export interface AcceptInviteOutcome {
  referral: ReferralClaimOutcome;
  circleJoin: CircleJoinSummary | null;
}

/**
 * Accept an invite for a signed-in account: record the referral AND, for a
 * circle invite, join the circle. The two are independent — an invite that
 * can't be attributed (existing account, already attributed, device reused,
 * program off…) still seats the person in the circle they were invited to.
 *
 * Order: the referral claim first, so it keeps the invite's original source
 * (web / universal_link / play_referrer …), then the join (which would
 * otherwise attribute it as `circle_join`). Never throws.
 */
export async function acceptInvite(
  userId: string,
  input: {
    code: string;
    ref?: string | null;
    source: AttributionSource;
    deviceId?: string | null;
    attestedDeviceId?: string | null;
    integrityClient?: boolean;
    platform?: 'ios' | 'android' | 'web' | null;
  }
): Promise<AcceptInviteOutcome> {
  const code = normalizeCode(input.code);
  const ref = input.ref ? normalizeCode(input.ref) : null;

  // Web signups have no profile row yet; both the claim and the join need one.
  await ensureProfileRow(userId);

  let referral: ReferralClaimOutcome;
  try {
    const result = await ReferralService.claim(userId, {
      code,
      ref,
      source: input.source,
      deviceId: input.deviceId ?? null,
      ...(input.attestedDeviceId ? { attestedDeviceId: input.attestedDeviceId } : {}),
      ...(input.integrityClient ? { integrityClient: true } : {}),
      ...(input.platform ? { platform: input.platform } : {}),
    });
    referral = { claimed: true, result };
  } catch (error) {
    if (error instanceof ReferralError) {
      referral = { claimed: false, error };
    } else {
      console.error('[acceptInvite] referral claim failed', { userId, code, error: (error as Error)?.message });
      referral = { claimed: false, error: null };
    }
  }

  let circleJoin: CircleJoinSummary | null = null;
  if (classifyCode(code) === 'circle') {
    try {
      const joined = await CircleService.joinViaInvite(userId, code, { ref, attribute: false });
      circleJoin = {
        status: joined.status,
        circle: { id: joined.circleId, name: joined.circleName, inviteCode: joined.inviteCode },
        isCreator: joined.isCreator,
      };
    } catch (error) {
      if (error instanceof InviteJoinError) {
        circleJoin = { status: 'failed', reason: error.code, message: error.message };
      } else {
        console.error('[acceptInvite] circle join failed', { userId, code, error: (error as Error)?.message });
        circleJoin = { status: 'failed', reason: 'ERROR', message: "We couldn't join that circle. Please try again." };
      }
    }
  }

  return { referral, circleJoin };
}

/** True when nothing about this invite is worth retrying (cookie / pending code can go). */
export function inviteSettled(outcome: AcceptInviteOutcome): boolean {
  const joinRetryable = outcome.circleJoin?.status === 'failed' && outcome.circleJoin.reason === 'ERROR';
  const claimRetryable = !outcome.referral.claimed && outcome.referral.error === null;
  // A seated circle invite is done even if attribution hit a transient error.
  if (outcome.circleJoin && outcome.circleJoin.status !== 'failed') return true;
  return !joinRetryable && !claimRetryable;
}
