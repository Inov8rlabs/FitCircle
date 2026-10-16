import { createHash, timingSafeEqual } from 'crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { ReferralError } from './types';

/** Standard mobile envelope helpers for the referral routes. */
export function ok(data: unknown, startTime?: number, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, data, error: null, meta: startTime ? { requestTime: Date.now() - startTime } : null },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function fail(status: number, code: string, message: string, data: unknown = null): NextResponse {
  return NextResponse.json(
    { success: false, data, error: { code, message, details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Map anything a referral route can throw to the envelope. */
export function failFrom(error: unknown, label: string): NextResponse {
  if (error instanceof ReferralError) return fail(error.status, error.code, error.message, error.data);
  if ((error as any)?.message === 'Unauthorized') return fail(401, 'UNAUTHORIZED', 'Invalid or expired token');
  if ((error as any)?.name === 'ZodError') return fail(400, 'VALIDATION_ERROR', 'Invalid request body');
  console.error(`[referrals] ${label} failed:`, (error as any)?.message);
  return fail(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
}

/** `Authorization: Bearer $ADMIN_API_SECRET` (fail-closed: unset → 503). */
export function adminUnauthorized(request: NextRequest): NextResponse | null {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) return NextResponse.json({ error: 'Admin API not configured' }, { status: 503 });
  const provided = request.headers.get('authorization') ?? '';
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(`Bearer ${secret}`).digest();
  if (!timingSafeEqual(a, b)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}

/** Install id header clients send on hub fetches (fraud checks only; hashed server-side). */
export const DEVICE_HEADER = 'x-fitcircle-device';
