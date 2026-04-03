import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { PushService } from '@/lib/services/push-service';
import { z } from 'zod';

const deleteSchema = z.object({
  token: z.string().min(1),
});

/**
 * DELETE /api/mobile/push/token
 * Deactivate a push notification token.
 */
export async function DELETE(request: NextRequest) {
  try {
    await requireMobileAuth(request);
    const body = await request.json();
    const validated = deleteSchema.parse(body);

    await PushService.removeToken(validated.token);

    return NextResponse.json({
      success: true,
      data: { deactivated: true },
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    console.error('[DELETE /api/mobile/push/token] Error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors,
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

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
          message: 'Failed to deactivate push token',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
