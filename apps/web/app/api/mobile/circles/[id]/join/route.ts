import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleJoinError, CircleService } from '@/lib/services/circle-service';
import { safeParseLenient, validationMessage } from '@/lib/validation/lenient-parse';

const idSchema = z.string().uuid();

const bodySchema = z
  .object({
    inviteCode: z.string().min(1).optional().nullable(),
    invite_code: z.string().min(1).optional().nullable(),
  })
  .partial();

/**
 * POST /api/mobile/circles/[id]/join
 *
 * Two ways to join through this route:
 *
 * 1. Public join (no invite code in the body): the path id is the circle.
 *    The circle must be public.
 *
 * 2. Invite-code join (`invite_code` or `inviteCode` in the body): the circle is
 *    found from the CODE. iOS 1.0 posts the code here with a random uuid in the
 *    path (CirclesListFeature.joinWithCode -> joinFitCircle(UUID(), request)), so
 *    a path id that names no circle is ignored. A path id that names a real
 *    circle must be the circle the code belongs to.
 *
 * Goal collection happens later via the circle's set-personal-goal flow, so
 * neither way takes a goal. `POST /api/mobile/circles/join` (code + optional
 * goal, used by Android) is a separate route and is not affected.
 *
 * Body: { invite_code?: string } | { inviteCode?: string }
 * Response: { success: true, data: <FitCircle> } (201) on success.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;

    // Body is optional — null/empty for public joins.
    let inviteCode: string | undefined;
    try {
      const text = await request.text();
      if (text) {
        const parsed = safeParseLenient(bodySchema, JSON.parse(text));
        if (parsed.success) {
          const candidate = parsed.data.inviteCode ?? parsed.data.invite_code ?? undefined;
          inviteCode = candidate?.trim() ? candidate : undefined;
        }
      }
    } catch {
      // No body or unparseable body — treat as a public-join attempt.
    }

    if (inviteCode) {
      const circle = await CircleService.joinByInviteCode(user.id, inviteCode, {
        pathCircleId: id,
      });

      return NextResponse.json(
        { success: true, data: circle, error: null },
        { status: 201 }
      );
    }

    const circleId = idSchema.parse(id);

    await CircleService.joinPublicCircle(user.id, circleId);
    const circle = await CircleService.getCircle(circleId);

    return NextResponse.json(
      { success: true, data: circle, error: null },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: validationMessage(error), details: error.errors } },
        { status: 400 }
      );
    }

    if (error instanceof CircleJoinError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'INVALID_JOIN', message: error.message } },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      const msg = error.message;
      if (msg === 'Circle not found') {
        return NextResponse.json(
          { success: false, data: null, error: { code: 'NOT_FOUND', message: msg } },
          { status: 404 }
        );
      }
      if (
        msg === 'Circle is not public — invite code required' ||
        msg === 'Circle is no longer joinable' ||
        msg === 'You are already a member of this circle'
      ) {
        return NextResponse.json(
          { success: false, data: null, error: { code: 'INVALID_JOIN', message: msg } },
          { status: 400 }
        );
      }
    }

    console.error('[POST /api/mobile/circles/[id]/join] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
