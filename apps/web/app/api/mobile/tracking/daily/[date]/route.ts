import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';

// Validation schema for PUT
const updateTrackingSchema = z.object({
  weightKg: z.number().positive().optional(),
  steps: z.number().int().min(0).optional(),
  moodScore: z.number().int().min(1).max(10).optional(),
  energyLevel: z.number().int().min(1).max(10).optional(),
  notes: z.string().optional(),
  timezone: z.string().optional(), // For automatic streak claiming
  autoClaimStreak: z.boolean().optional().default(true), // Auto-claim by default
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
    const validatedData = updateTrackingSchema.parse(body);

    // Determine if this is auto-synced data
    const isAutoSync = validatedData.autoClaimStreak === false;

    // Upsert tracking data
    const trackingEntry = await MobileAPIService.upsertDailyTracking(user.id, date, {
      weight_kg: validatedData.weightKg,
      steps: validatedData.steps,
      mood_score: validatedData.moodScore,
      energy_level: validatedData.energyLevel,
      notes: validatedData.notes,
      is_override: !isAutoSync, // Only manual entries are overrides
      skip_streak_tracking: isAutoSync, // Auto-synced data must NOT count toward streaks
    });

    // Automatically claim streak if data was manually entered
    let streakClaimed = false;
    let streakCount: number | undefined;
    if (validatedData.autoClaimStreak !== false) {
      try {
        const timezone = validatedData.timezone || 'America/Los_Angeles'; // Default to PST
        const targetDate = new Date(date);

        // Check if can claim (not already claimed)
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
          message: 'Invalid input data',
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
