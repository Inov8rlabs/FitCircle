import { type NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual, createHash } from 'crypto';
import { z } from 'zod';

import { ComplimentaryGrantService, GrantError } from '@/lib/services/complimentary-grant-service';

export const dynamic = 'force-dynamic';

/**
 * Admin API — complimentary Pro grants (friends, testers, support).
 *
 * Auth: `Authorization: Bearer $ADMIN_API_SECRET` (fail-closed: unset → 503).
 *
 *   GET    /api/admin/subscriptions/grants                      → active grants
 *   POST   /api/admin/subscriptions/grants  { email | userId, days? | expiresAt?, note? }
 *   DELETE /api/admin/subscriptions/grants  { email | userId }  → revoke
 *
 * Examples:
 *   curl -X POST https://www.fitcircle.ai/api/admin/subscriptions/grants \
 *     -H "Authorization: Bearer $ADMIN_API_SECRET" -H "Content-Type: application/json" \
 *     -d '{"email":"friend@example.com","note":"beta tester"}'          # until revoked
 *   ... -d '{"email":"friend@example.com","days":90,"note":"90-day trial"}'
 */
function authorized(request: NextRequest): NextResponse | null {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) return NextResponse.json({ error: 'Admin API not configured' }, { status: 503 });
  const provided = request.headers.get('authorization') ?? '';
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(`Bearer ${secret}`).digest();
  if (!timingSafeEqual(a, b)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}

const target = {
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
};
const grantSchema = z
  .object({
    ...target,
    days: z.number().int().min(1).max(3650).optional(),
    expiresAt: z.string().datetime().optional(),
    note: z.string().max(200).optional(),
    grantedBy: z.string().max(100).optional(),
  })
  .refine((b) => b.userId || b.email, { message: 'userId or email is required' });
const revokeSchema = z.object({ ...target, revokedBy: z.string().max(100).optional() }).refine((b) => b.userId || b.email, {
  message: 'userId or email is required',
});

function grantErrorResponse(err: unknown): NextResponse {
  if (err instanceof GrantError) {
    const status = err.code === 'USER_NOT_FOUND' || err.code === 'NOT_FOUND' ? 404 : err.code === 'ALREADY_ACTIVE' ? 409 : 400;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[admin grants] failed:', (err as any)?.message);
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const denied = authorized(request);
  if (denied) return denied;
  try {
    const grants = await ComplimentaryGrantService.list();
    return NextResponse.json({ count: grants.length, grants });
  } catch (err) {
    return grantErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const denied = authorized(request);
  if (denied) return denied;
  try {
    const body = grantSchema.parse(await request.json());
    const expiresAt =
      body.expiresAt ?? (body.days ? new Date(Date.now() + body.days * 86_400_000).toISOString() : null);
    const result = await ComplimentaryGrantService.grant({
      userId: body.userId,
      email: body.email,
      expiresAt,
      note: body.note,
      grantedBy: body.grantedBy ?? 'admin-api',
    });
    return NextResponse.json({ granted: true, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors[0]?.message ?? 'Invalid body' }, { status: 400 });
    return grantErrorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = authorized(request);
  if (denied) return denied;
  try {
    const body = revokeSchema.parse(await request.json());
    const result = await ComplimentaryGrantService.revoke({
      userId: body.userId,
      email: body.email,
      revokedBy: body.revokedBy ?? 'admin-api',
    });
    return NextResponse.json({ revoked: true, ...result });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors[0]?.message ?? 'Invalid body' }, { status: 400 });
    return grantErrorResponse(err);
  }
}
