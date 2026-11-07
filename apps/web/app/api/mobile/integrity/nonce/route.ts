import { NextResponse, type NextRequest } from 'next/server';

import { normalizeDeviceId, INTEGRITY_HEADERS } from '@/lib/integrity/contract';
import { NONCE_TTL_MS, issueNonce } from '@/lib/integrity/nonce';
import { enforceAbuseLimits } from '@/lib/security/abuse-limits';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/mobile/integrity/nonce — a short-lived single-use nonce for the integrity
 * request hash (docs/INTEGRITY_CONTRACT.md). Unauthenticated (sign-up needs one).
 * Requires X-Device-Id; the nonce is bound to it.
 *
 * 200 {success, data: {nonce, expiresAt, expires_at, ttl_seconds}, nonce, expiresAt};
 * 400 MISSING_DEVICE_ID; 429 RATE_LIMIT_EXCEEDED.
 */
export async function GET(request: NextRequest) {
  const deviceId = normalizeDeviceId(request.headers.get(INTEGRITY_HEADERS.deviceId));
  if (!deviceId) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: { code: 'MISSING_DEVICE_ID', message: 'X-Device-Id header is required', details: {}, timestamp: new Date().toISOString() },
        meta: null,
      },
      { status: 400, headers: NO_STORE }
    );
  }
  const limited = await enforceAbuseLimits(request, 'integrity_nonce', { deviceId });
  if (limited) return limited;
  try {
    const { nonce, expiresAt } = issueNonce(deviceId);
    return NextResponse.json(
      {
        success: true,
        data: { nonce, expiresAt, expires_at: expiresAt, ttl_seconds: Math.floor(NONCE_TTL_MS / 1000) },
        // Flat copy: clients may read {nonce, expiresAt} at the top level.
        nonce,
        expiresAt,
        error: null,
        meta: null,
      },
      { headers: NO_STORE }
    );
  } catch (err: any) {
    console.error('[integrity] nonce issue failed:', err?.message ?? err);
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unable to issue a nonce', details: {}, timestamp: new Date().toISOString() },
        meta: null,
      },
      { status: 500, headers: NO_STORE }
    );
  }
}
