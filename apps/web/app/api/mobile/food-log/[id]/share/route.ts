/**
 * Food Log Sharing API Routes
 * POST /api/mobile/food-log/[id]/share - Share entry with user(s) or circle
 *   1.1.5 body `{ circles: [{ circle_id, share }], remember? }` (ENGAGEMENT_115_SPEC §4.4):
 *   share the meal with exactly the chosen circles → 200 { entry_id, is_private, visibility,
 *   shared_circle_ids, posted, retracted }. The legacy `{ share_with, ... }` body is unchanged.
 * GET /api/mobile/food-log/[id]/share - Get shares for entry
 * DELETE /api/mobile/food-log/[id]/share - Revoke specific share
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodLogService } from '@/lib/services/food-log-service';
import { MealShareError, MealShareService } from '@/lib/services/meal-share-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { ShareFoodLogSchema } from '@/lib/validation/food-log-validation';
import { parseLenient, safeParseLenient, validationMessage } from '@/lib/validation/lenient-parse';

const CircleShareSchema = z.object({
  circles: z.array(z.object({ circle_id: z.string().uuid(), share: z.boolean() })).max(100),
  remember: z.boolean().optional(),
});

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function shareError(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message, details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status, headers: NO_STORE }
  );
}

/** The 1.1.5 success-sheet share (ENGAGEMENT_115_SPEC §4.4). Idempotent, retry-safe. */
async function shareToCircles(userId: string, entryId: string, body: unknown, startTime: number) {
  const parsed = safeParseLenient(CircleShareSchema, body);
  if (!parsed.success) return shareError('VALIDATION_ERROR', validationMessage(parsed.error), 400);
  try {
    const data = await MealShareService.shareToCircles(userId, entryId, {
      circles: parsed.data.circles,
      remember: parsed.data.remember ?? true,
    });
    return NextResponse.json({ success: true, error: null, meta: { requestTime: Date.now() - startTime }, data }, { headers: NO_STORE });
  } catch (error: any) {
    if (error instanceof MealShareError) {
      return error.code === 'NOT_FOUND' ? shareError('NOT_FOUND', 'Entry not found', 404) : shareError('UNSHAREABLE', error.message, 400);
    }
    console.error('[Mobile API] Share meal to circles:', error?.message);
    return shareError('INTERNAL_SERVER_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * POST /api/mobile/food-log/[id]/share
 * Share food log entry with user(s) or circle
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const entryId = id;
    const supabase = createAdminSupabase();

    // Parse and validate request body
    const body = await request.json();
    if (body && typeof body === 'object' && 'circles' in body) return shareToCircles(user.id, entryId, body, startTime);
    const validatedData = parseLenient(ShareFoodLogSchema, body);

    // Share entry
    const result = await FoodLogService.shareEntry(entryId, user.id, validatedData, supabase);

    if (result.error) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'SHARE_FAILED',
            message: result.error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          shares: result.shares,
        },
        meta: {
          requestTime: Date.now() - startTime,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[Mobile API] Share food log entry error:', {
      message: error.message,
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

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: validationMessage(error),
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
}

/**
 * GET /api/mobile/food-log/[id]/share
 * Get all shares for an entry
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const entryId = id;
    const supabase = createAdminSupabase();

    // Get shares
    const result = await FoodLogService.getShares(entryId, user.id, supabase);

    if (result.error) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FETCH_FAILED',
            message: result.error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Get food log shares error:', {
      message: error.message,
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
