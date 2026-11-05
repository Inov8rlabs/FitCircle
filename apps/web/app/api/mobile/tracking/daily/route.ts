import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ChallengeStepsSyncService } from '@/lib/services/challenge-steps-sync-service';
import { DailyGoalService } from '@/lib/services/daily-goals';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { runAfterResponse } from '@/lib/utils/after-response';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';
import { stepsSourceSchema } from '@/lib/validators/steps-source';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FORMAT_MESSAGE = 'Invalid date format (YYYY-MM-DD)';

// Validation schema for POST
const trackingSchema = z.object({
  trackingDate: z.string().regex(DATE_ONLY, DATE_FORMAT_MESSAGE).optional(),
  // Alias for trackingDate. Every shipped iOS build since Jan 2026 (61d4e55) encodes
  // DailyTrackingCreate.trackingDate under the JSON key "date". zod used to strip it,
  // so past-day iOS entries (manual backfills AND the HealthKit weight sync) were saved
  // to today. Validated (same format) only when it is the key actually used: see
  // resolveRequestedDate. trackingDate wins when both are present.
  date: z.string().optional(),
  weightKg: z.number().positive().optional(),
  steps: z.number().int().min(0).optional(),
  moodScore: z.number().int().min(1).max(10).optional(),
  energyLevel: z.number().int().min(1).max(10).optional(),
  notes: z.string().optional(),
  // HealthKit integration fields
  // Also accepts the aliases apple_health (→ healthkit) and health_connect (→ google_fit).
  stepsSource: stepsSourceSchema.optional(),
  stepsSyncedAt: z.string().datetime().optional(),
  isOverride: z.boolean().optional(),
  // When false, this is auto-synced data that should NOT count toward streaks
  autoClaimStreak: z.boolean().optional().default(true),
  // Privacy flag: true = visible to circle members, false = private (owner only)
  isPublic: z.boolean().optional(),
});

type DateKey = 'trackingDate' | 'date' | 'none';

/**
 * The day the client asked for, and which key carried it.
 * `trackingDate` (Android, web, iOS builds after 1.1.2) wins; `date` is the shipped-iOS alias.
 * A malformed alias is a 400 (same rule as trackingDate), never a silent "today".
 */
function resolveRequestedDate(data: { trackingDate?: string; date?: string }): {
  requested?: string;
  key: DateKey;
} {
  if (data.trackingDate) return { requested: data.trackingDate, key: 'trackingDate' };
  if (data.date !== undefined) {
    if (!DATE_ONLY.test(data.date)) {
      throw new z.ZodError([
        { code: z.ZodIssueCode.invalid_string, validation: 'regex', path: ['date'], message: DATE_FORMAT_MESSAGE },
      ]);
    }
    return { requested: data.date, key: 'date' };
  }
  return { requested: undefined, key: 'none' };
}

/** YYYY-MM-DD + n days (calendar arithmetic in UTC, no timezone involved). */
function addDaysToDateString(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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
    response.headers.set('Cache-Control', 'private, no-store');

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
 *
 * Date key: `trackingDate` (YYYY-MM-DD). `date` is accepted as an alias (shipped iOS
 * 1.0.x–1.1.2 send it); `trackingDate` wins when both are present. Alias dates obey the
 * same 7-day window (older → 400 INVALID_DATE, which iOS shows as the server message),
 * except that an alias exactly one day after the profile-timezone today is saved to
 * today, as those builds always were (see the comment at the clamp).
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse and validate request body
    const body = await request.json();
    const validatedData = parseLenient(trackingSchema, body);

    // Import timezone utilities
    const { getUserTimezone, getTodayInTimezone, isWithinLastNDays, normalizeDateString } = await import('@/lib/utils/timezone');
    const { createAdminSupabase } = await import('@/lib/supabase-admin');

    const supabaseAdmin = createAdminSupabase();
    const userTimezone = await getUserTimezone(user.id, supabaseAdmin);

    // Determine target date (default to today in user's timezone)
    const { requested, key: dateKey } = resolveRequestedDate(validatedData);
    const todayInUserTz = getTodayInTimezone(userTimezone);
    let targetDate = requested ? normalizeDateString(requested) : todayInUserTz;

    // Shipped iOS sends its LOCAL calendar day; the profile timezone is often stale
    // (most profiles are still 'UTC'), so a member east of it sees "today" as the
    // server's tomorrow. Those builds always had that entry saved to the server's
    // today; keep doing exactly that rather than turning a normal "log today" into a
    // 400. Only for the alias: trackingDate behaviour is unchanged.
    if (dateKey === 'date' && targetDate === addDaysToDateString(todayInUserTz, 1)) {
      targetDate = todayInUserTz;
    }

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

    console.log(
      `[Mobile API] Tracking entry for user ${user.id}, date: ${targetDate}, timezone: ${userTimezone}, dateKey: ${dateKey}`
    );

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
        is_public: validatedData.isPublic,
      }
    );

    // Steps circle challenges count synced steps (after the response; never throws).
    if (validatedData.steps !== undefined) runAfterResponse(() => ChallengeStepsSyncService.syncUser(user.id), 'challenge-steps-sync');

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
    const isBackfill = targetDate !== todayInUserTz;

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
