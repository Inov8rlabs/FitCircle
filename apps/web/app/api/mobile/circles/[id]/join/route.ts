import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleService } from '@/lib/services/circle-service';

const idSchema = z.string().uuid();

const bodySchema = z
  .object({
    inviteCode: z.string().min(1).optional().nullable(),
    invite_code: z.string().min(1).optional().nullable(),
  })
  .partial();

/**
 * POST /api/mobile/circles/[id]/join
 * Join a circle by ID.
 *
 * - If the circle is public: no invite code needed.
 * - If the circle is private/invite_only: caller must include the matching
 *   invite code in the body. (Goal collection happens later via the
 *   circle's set-personal-goal flow rather than at join time, so v1 of
 *   this endpoint is goal-less.)
 *
 * Body: { inviteCode?: string }
 * Response: { success: true, data: <FitCircle> } on success.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const circleId = idSchema.parse(id);

    // Body is optional — null/empty for public joins.
    let inviteCode: string | undefined;
    try {
      const text = await request.text();
      if (text) {
        const parsed = bodySchema.parse(JSON.parse(text));
        inviteCode = parsed.inviteCode ?? parsed.invite_code ?? undefined;
      }
    } catch {
      // No body or unparseable body — treat as a public-join attempt.
    }

    if (inviteCode) {
      // Existing invite-code path lives in the legacy /circles/join handler;
      // delegate to the same service method so behaviour stays consistent.
      // We don't have goal info at this entry point, so this path currently
      // requires the caller to set a goal afterwards.
      throw new Error('Invite-code joins must POST to /api/mobile/circles/join with the goal payload.');
    }

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
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.errors } },
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
        msg === 'You are already a member of this circle' ||
        msg.startsWith('Invite-code joins must POST')
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
