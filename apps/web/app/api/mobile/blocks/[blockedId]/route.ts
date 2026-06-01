import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ChatSafetyService } from '@/lib/services/chat-safety-service';

/**
 * DELETE /api/mobile/blocks/[blockedId]
 * Unblock a previously blocked user. Idempotent.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ blockedId: string }> }
) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const { blockedId } = await params;

    const result = await ChatSafetyService.unblockMember(user.id, blockedId);

    return NextResponse.json({
      success: true,
      data: result,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Delete block error:', {
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
}
