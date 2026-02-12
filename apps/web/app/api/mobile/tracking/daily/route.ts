import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { DailyGoalService } from '@/lib/services/daily-goals';

// Validation schema for POST
const trackingSchema = z.object({
  trackingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional(),
  weightKg: z.number().positive().optional(),
  steps: z.number().int().min(0).optional(),
  moodScore: z.number().int().min(1).max(10).optional(),
  energyLevel: z.number().int().min(1).max(10).optional(),
  notes: z.string().optional(),
  // HealthKit integration fields
  stepsSource: z.enum(['manual', 'healthkit', 'google_fit']).optional(),
  stepsSyncedAt: z.string().datetime().optional(),
  isOverride: z.boolean().optional(),
  // When false, this is auto-synced data that should NOT count toward streaks
  autoClaimStreak: z.boolean().optional().default(true),
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
 *
 * Supports backfilling: can log data for past dates (up to 7 days back)
 * If trackingDate is not provided, uses today in user's timezone
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse and validate request body
    const body = await request.json();
    const validatedData = trackingSchema.parse(body);

    // Import timezone utilities
    const { getUserTimezone, getTodayInTimezone, isWithinLastNDays, normalizeDateString } = await import('@/lib/utils/timezone');
    const { createAdminSupabase } = await import('@/lib/supabase-admin');

    const supabaseAdmin = createAdminSupabase();
    const userTimezone = await getUserTimezone(user.id, supabaseAdmin);

    // Determine target date (default to today in user's timezone)
    const targetDate = validatedData.trackingDate
      ? normalizeDateString(validatedData.trackingDate)
      : getTodayInTimezone(userTimezone);

    // Validate date is within last 7 days (prevent backfilling too far)
    if (!isWithinLastNDays(targetDate, 7, userTimezone)) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_DATE',
            message: 'Can only log data for the last 7 days',
            details: {
              provided_date: targetDate,
              max_days_back: 7,
            },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    console.log(`[Mobile API] Tracking entry for user ${user.id}, date: ${targetDate}, timezone: ${userTimezone}`);

    // Determine if this is auto-synced data (HealthKit/Google Fit)
    // Auto-synced data should NOT count toward maintaining streaks
    // Two signals: explicit autoClaimStreak=false, or stepsSource is healthkit/google_fit
    const isAutoSync = validatedData.autoClaimStreak === false ||
      validatedData.stepsSource === 'healthkit' || validatedData.stepsSource === 'google_fit';

    // Upsert tracking data
    const trackingEntry = await MobileAPIService.upsertDailyTracking(
      user.id,
      targetDate,
      {
        weight_kg: validatedData.weightKg,
        steps: validatedData.steps,
        mood_score: validatedData.moodScore,
        energy_level: validatedData.energyLevel,
        notes: validatedData.notes,
        steps_source: validatedData.stepsSource,
        steps_synced_at: validatedData.stepsSyncedAt,
        is_override: validatedData.isOverride,
        skip_streak_tracking: isAutoSync,
      }
    );

    // Update daily goal completion based on tracking data
    try {
      await DailyGoalService.updateGoalCompletion(
        user.id,
        targetDate,
        {
          steps: validatedData.steps,
          weight_kg: validatedData.weightKg,
          mood_score: validatedData.moodScore,
          energy_level: validatedData.energyLevel,
        }
      );
    } catch (goalError) {
      // Log but don't fail the request if goal update fails
      console.error('[Mobile API] Failed to update goal completion:', goalError);
    }

    // Get updated stats
    const result = await MobileAPIService.getDailyTrackingWithStats(user.id, { limit: 30 });

    // Note: Backfilled entries don't increment streak
    // Only today's check-in increments streak (handled in streak service)
    const isBackfill = targetDate !== getTodayInTimezone(userTimezone);

    return NextResponse.json({
      success: true,
      data: trackingEntry,
      stats: result.stats,
      meta: {
        requestTime: Date.now() - startTime,
        is_backfill: isBackfill,
        tracking_date: targetDate,
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
