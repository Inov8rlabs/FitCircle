import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DailyTrackingClearService, splitTrackingClears } from '@/lib/services/daily-tracking-clear';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

// Validation schema for PUT.
// The five metrics are `.nullable()`: an explicit JSON null means "clear this value
// from the day"; an absent key means "leave it unchanged". Every other field is
// merely optional, so a null there is ignored (parseLenient).
const updateTrackingSchema = z.object({
  weightKg: z.number().positive().nullable().optional(),
  steps: z.number().int().min(0).nullable().optional(),
  moodScore: z.number().int().min(1).max(10).nullable().optional(),
  energyLevel: z.number().int().min(1).max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
  timezone: z.string().optional(), // For automatic streak claiming
  autoClaimStreak: z.boolean().optional().default(true), // Auto-claim by default
  // Privacy flag: true = visible to circle members, false = private (owner only)
  isPublic: z.boolean().optional(),
});

/**
 * GET /api/mobile/tracking/daily/[date]
 * Get tracking data for a specific date
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ date: string }> }
) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    const { date } = await context.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        {
          error: 'Invalid date format',
          message: 'Date must be in YYYY-MM-DD format',
        },
        { status: 400 }
      );
    }

    // Get tracking data for specific date
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('daily_tracking')
      .select('*')
      .eq('user_id', user.id)
      .eq('tracking_date', date)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = not found
      throw error;
    }

    if (!data) {
      return NextResponse.json(
        {
          success: true,
          data: null,
          message: 'No tracking data for this date',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('Get tracking by date error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/mobile/tracking/daily/[date]
 * Update tracking data for a specific date
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ date: string }> }
) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    const { date } = await context.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        {
          error: 'Invalid date format',
          message: 'Date must be in YYYY-MM-DD format',
        },
        { status: 400 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = parseLenient(updateTrackingSchema, body);

    // Explicit nulls are clears. A request that ONLY clears is not a log: it must not
    // create a row, record activity or claim a streak day.
    const { clears, hasValues } = splitTrackingClears(validatedData);
    const isClearOnly = clears.length > 0 && !hasValues && validatedData.isPublic === undefined;

    if (isClearOnly) {
      const cleared = await DailyTrackingClearService.clearMetrics(
        createAdminSupabase(),
        user.id,
        date,
        clears
      );
      if (!cleared) {
        return NextResponse.json(
          {
            success: false,
            data: null,
            // New response (nulls used to be a 400), so it uses the standard mobile
            // envelope both clients can decode.
            error: { code: 'NOT_FOUND', message: 'No tracking data for this date' },
            message: 'No tracking data for this date',
          },
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        data: cleared,
        streak: { claimed: false },
        cleared: clears,
      });
    }

    // Determine if this is auto-synced data
    const isAutoSync = validatedData.autoClaimStreak === false;

    // Upsert tracking data (values only — nulls are applied as clears afterwards)
    let trackingEntry = await MobileAPIService.upsertDailyTracking(user.id, date, {
      weight_kg: validatedData.weightKg ?? undefined,
      steps: validatedData.steps ?? undefined,
      mood_score: validatedData.moodScore ?? undefined,
      energy_level: validatedData.energyLevel ?? undefined,
      notes: validatedData.notes ?? undefined,
      is_override: !isAutoSync, // Only manual entries are overrides
      skip_streak_tracking: isAutoSync, // Auto-synced data must NOT count toward streaks
      is_public: validatedData.isPublic, // Only changes when explicitly provided
      timezone: validatedData.timezone || request.headers.get('x-client-timezone') || undefined,
    });

    if (clears.length > 0) {
      const cleared = await DailyTrackingClearService.clearMetrics(
        createAdminSupabase(),
        user.id,
        date,
        clears
      );
      if (cleared) trackingEntry = cleared;
    }

    // Automatically claim streak if data was manually entered
    let streakClaimed = false;
    let streakCount: number | undefined;
    if (validatedData.autoClaimStreak !== false) {
      try {
        const timezone =
          validatedData.timezone || request.headers.get('x-client-timezone') || 'UTC';
        const targetDate = new Date(date);

        // upsertDailyTracking already claims manual-entry days through the
        // canonical path; this is a fallback for payloads that carried no
        // trackable metrics, plus the response's claimed/count report.
        const canClaim = await StreakClaimingService.canClaimStreak(user.id, targetDate, timezone);

        if (canClaim.canClaim && !canClaim.alreadyClaimed) {
          const claimResult = await StreakClaimingService.claimStreak(
            user.id,
            targetDate,
            timezone,
            'manual_entry'
          );
          streakClaimed = true;
          streakCount = claimResult.streakCount;
          console.log(`[PUT /api/mobile/tracking/daily/${date}] Auto-claimed streak for user ${user.id}`);
        } else if (canClaim.alreadyClaimed) {
          streakClaimed = true;
          streakCount = await StreakClaimingService.calculateCurrentStreak(user.id, timezone);
        }
      } catch (error) {
        // Don't fail the entire request if streak claiming fails
        console.error('[PUT /api/mobile/tracking/daily/[date]] Streak claiming error:', error);
      }
    }

    return NextResponse.json({
      success: true,
      data: trackingEntry,
      streak: {
        claimed: streakClaimed,
        count: streakCount,
      },
      ...(clears.length > 0 ? { cleared: clears } : {}),
    });
  } catch (error: any) {
    console.error('Update tracking by date error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation error',
          message: validationMessage(error),
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/mobile/tracking/daily/[date]
 * Delete tracking data for a specific date
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ date: string }> }
) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    const { date } = await context.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        {
          error: 'Invalid date format',
          message: 'Date must be in YYYY-MM-DD format',
        },
        { status: 400 }
      );
    }

    // Delete tracking data
    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('daily_tracking')
      .delete()
      .eq('user_id', user.id)
      .eq('tracking_date', date);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Tracking data deleted successfully',
    });
  } catch (error: any) {
    console.error('Delete tracking by date error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
