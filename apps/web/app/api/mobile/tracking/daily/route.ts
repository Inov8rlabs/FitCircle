import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

// Validation schema for POST
const trackingSchema = z.object({
  trackingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  weightKg: z.number().positive().optional(),
  steps: z.number().int().min(0).optional(),
  moodScore: z.number().int().min(1).max(10).optional(),
  energyLevel: z.number().int().min(1).max(10).optional(),
  notes: z.string().optional(),
  // HealthKit integration fields
  stepsSource: z.enum(['manual', 'healthkit', 'google_fit']).optional(),
  stepsSyncedAt: z.string().datetime().optional(),
  isOverride: z.boolean().optional(),
});

/**
 * GET /api/mobile/tracking/daily
 * Get daily tracking data with stats
 *
 * Query params:
 * - startDate: YYYY-MM-DD (optional)
 * - endDate: YYYY-MM-DD (optional)
 * - limit: number (default: 30, max: 100)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const requestedLimit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 30;

    // Cap limit at 100 for performance
    const limit = Math.min(requestedLimit, 100);

    // Get tracking data with stats
    const result = await MobileAPIService.getDailyTrackingWithStats(user.id, {
      startDate,
      endDate,
      limit,
    });

    const response = NextResponse.json({
      success: true,
      data: result.data,
      stats: result.stats,
      meta: {
        count: result.data.length,
        limit,
        hasMore: result.data.length === limit,
        requestTime: Date.now() - startTime,
      },
      error: null,
    });

    // Add cache headers (1 minute cache for tracking data)
    response.headers.set('Cache-Control', 'private, max-age=60');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Get daily tracking error:', {
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

/**
 * POST /api/mobile/tracking/daily
 * Create or update daily tracking entry
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse and validate request body
    const body = await request.json();
    const validatedData = trackingSchema.parse(body);

    // Upsert tracking data
    const trackingEntry = await MobileAPIService.upsertDailyTracking(
      user.id,
      validatedData.trackingDate,
      {
        weight_kg: validatedData.weightKg,
        steps: validatedData.steps,
        mood_score: validatedData.moodScore,
        energy_level: validatedData.energyLevel,
        notes: validatedData.notes,
        steps_source: validatedData.stepsSource,
        steps_synced_at: validatedData.stepsSyncedAt,
        is_override: validatedData.isOverride,
      }
    );

    // Get updated stats
    const result = await MobileAPIService.getDailyTrackingWithStats(user.id, { limit: 30 });

    return NextResponse.json({
      success: true,
      data: trackingEntry,
      stats: result.stats,
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Create daily tracking error:', {
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
}
