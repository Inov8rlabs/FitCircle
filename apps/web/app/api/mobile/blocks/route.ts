import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ChatSafetyService } from '@/lib/services/chat-safety-service';

// Validation schema for POST
const blockSchema = z.object({
  blockedId: z.string().uuid('blockedId must be a valid user id'),
});

/**
 * GET /api/mobile/blocks
 * List the users the authenticated caller has blocked.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const blocked = await ChatSafetyService.listBlocked(user.id);

    return NextResponse.json({
      success: true,
      data: { blocked },
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    return mapError(error, 'List blocks');
  }
}

/**
 * POST /api/mobile/blocks { blockedId }
 * Block a user app-wide. Idempotent.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const body = await request.json();
    const { blockedId } = blockSchema.parse(body);

    const result = await ChatSafetyService.blockMember(user.id, blockedId);

    return NextResponse.json(
      {
        success: true,
        data: result,
        meta: { requestTime: Date.now() - startTime },
        error: null,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return mapError(error, 'Create block');
  }
}

// Shared error -> HTTP envelope mapping (mirrors circles/route.ts contract).
function mapError(error: any, label: string): NextResponse {
  console.error(`[Mobile API] ${label} error:`, {
    userId: error.userId,
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
  });

  if (error.message === 'Unauthorized') {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 401 }
    );
  }

  if (error.message === 'Forbidden') {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'FORBIDDEN',
          message: 'You cannot block this user',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 403 }
    );
  }

  if (error.message === 'NotFound') {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'NOT_FOUND',
          message: 'Not found',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 404 }
    );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: error.errors.reduce((acc: any, err) => {
            acc[err.path.join('.')] = err.message;
            return acc;
          }, {}),
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      success: false,
      data: null,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        details: {},
        timestamp: new Date().toISOString(),
      },
      meta: null,
    },
    { status: 500 }
  );
}
