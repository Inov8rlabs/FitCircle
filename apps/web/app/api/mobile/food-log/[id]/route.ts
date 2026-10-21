/**
 * Individual Food Log Entry API Routes
 * GET /api/mobile/food-log/[id] - Get single entry
 * PATCH /api/mobile/food-log/[id] - Update entry
 * DELETE /api/mobile/food-log/[id] - Delete entry
 */

import { resolveEntryDate } from '@/lib/utils/entry-date';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodLogImageService } from '@/lib/services/food-log-image-service';
import { FoodLogService } from '@/lib/services/food-log-service';
import { VitalsService } from '@/lib/services/vitals-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { runAfterResponse } from '@/lib/utils/after-response';
import {
  UpdateFoodLogEntrySchema,
  normalizeFoodLogEntryAliases,
} from '@/lib/validation/food-log-validation';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

function errorResponse(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code, message, details, timestamp: new Date().toISOString() },
      meta: null,
    },
    { status }
  );
}

/** PATCH failure → HTTP status. */
const UPDATE_FAILURE_STATUS = {
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  DATABASE_ERROR: 500,
} as const;

/**
 * GET /api/mobile/food-log/[id]
 * Get single food log entry with images
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

    // Get entry
    const entryResult = await FoodLogService.getEntryById(entryId, user.id, supabase);

    if (entryResult.error) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'NOT_FOUND',
            message: entryResult.error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    // Get images for entry
    const imagesResult = await FoodLogImageService.getImagesForEntry(entryId, supabase);

    // Add API URLs to images
    const imagesWithUrls = FoodLogImageService.addImageUrlsToMany(
      imagesResult.data,
      process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    );

    // Check permissions
    const canEdit = entryResult.data?.user_id === user.id;
    const canShare = canEdit && entryResult.data?.entry_type !== 'supplement';

    return NextResponse.json({
      success: true,
      data: {
        entry: entryResult.data,
        images: imagesWithUrls,
        canEdit,
        canShare,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Get food log entry error:', {
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

/**
 * PATCH /api/mobile/food-log/[id]
 * Update food log entry.
 *
 * 200 → `data` is the updated entry plus `image_urls` (always) / `photo_url`
 * (when any), same shape as GET /food-log. Errors carry `error.code`:
 *  - 400 INVALID_JSON / VALIDATION_ERROR (bad body or a value the DB rejects)
 *  - 404 NOT_FOUND (no such entry, or it was deleted)
 *  - 403 FORBIDDEN (another user's entry)
 *  - 500 DATABASE_ERROR / INTERNAL_SERVER_ERROR
 */
export async function PATCH(
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
    // Tolerant parse: `entry_type: "snack"` means "this is a snack" (meal_type snack
    // unless another meal_type was sent); explicit nulls on optional fields are
    // treated as "not sent".
    let body: any;
    try {
      body = await request.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Request body must be valid JSON', 400);
    }
    const validatedData = parseLenient(
      UpdateFoodLogEntrySchema,
      normalizeFoodLogEntryAliases(body)
    );

    // Re-timing a meal moves it to the day of its new time (local to the person).
    if (validatedData.logged_at && !validatedData.entry_date) {
      validatedData.entry_date = await resolveEntryDate(
        request,
        { logged_at: validatedData.logged_at, timezone: body?.timezone },
        user.id,
        supabase
      );
    }

    // Update entry
    const result = await FoodLogService.updateEntry(entryId, user.id, validatedData, supabase);

    if (result.error || !result.data) {
      const failure = result.failure ?? 'DATABASE_ERROR';
      if (failure === 'DATABASE_ERROR') {
        console.error('[Mobile API] Update food log entry DB error:', { message: result.error?.message });
        return errorResponse('DATABASE_ERROR', 'Could not update the entry', 500);
      }
      return errorResponse(failure, result.error?.message ?? 'Update failed', UPDATE_FAILURE_STATUS[failure]);
    }

    // Photo URLs in the list endpoint's shape, so the client can drop local copies.
    const apiBase = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const [entry] = await FoodLogImageService.withPhotoUrls([result.data], supabase, apiBase, {
      alwaysIncludeList: true,
    });

    return NextResponse.json({
      success: true,
      data: entry,
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Update food log entry error:', {
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
 * DELETE /api/mobile/food-log/[id]
 * Delete food log entry (soft delete, owner only). Idempotent, so an offline
 * outbox can replay it:
 *  - 200 `{ deleted: true, entryId }`  — this call deleted it
 *  - 200 `{ deleted: false, entryId }` — already deleted, or no such id
 *  - 404 NOT_FOUND — another user's entry (never touched)
 *  - 500 DATABASE_ERROR — retry later
 * Used for the Hydration card's Undo: a water entry (deleted now or before) also
 * returns `data.hydration: { todayMl, goalMl, date }` (optional).
 */
export async function DELETE(
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

    // Delete entry (audit row + circle chat tombstone run after the response)
    const result = await FoodLogService.deleteEntry(entryId, user.id, supabase, {
      defer: (task) => runAfterResponse(task, 'food-log delete side effect'),
    });

    if (!result.success) {
      if (result.notFound) return errorResponse('NOT_FOUND', 'Entry not found', 404);
      console.error('[Mobile API] Delete food log entry DB error:', { message: result.error?.message });
      return errorResponse('DATABASE_ERROR', 'Could not delete the entry', 500);
    }

    const hydration =
      result.entryType === 'water'
        ? await VitalsService.hydrationForResponse(user.id, request, user)
        : undefined;

    return NextResponse.json({
      success: true,
      data: { deleted: result.deleted === true, entryId, ...(hydration ? { hydration } : {}) },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Delete food log entry error:', {
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
