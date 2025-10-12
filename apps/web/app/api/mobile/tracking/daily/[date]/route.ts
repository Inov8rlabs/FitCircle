import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

// Validation schema for PUT
const updateTrackingSchema = z.object({
  weightKg: z.number().positive().optional(),
  steps: z.number().int().min(0).optional(),
  moodScore: z.number().int().min(1).max(10).optional(),
  energyLevel: z.number().int().min(1).max(10).optional(),
  notes: z.string().optional(),
});

/**
 * GET /api/mobile/tracking/daily/[date]
 * Get tracking data for a specific date
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { date: string } }
) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    const date = params.date;

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
  { params }: { params: { date: string } }
) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    const date = params.date;

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

    // Upsert tracking data
    const trackingEntry = await MobileAPIService.upsertDailyTracking(user.id, date, {
      weight_kg: validatedData.weightKg,
      steps: validatedData.steps,
      mood_score: validatedData.moodScore,
      energy_level: validatedData.energyLevel,
      notes: validatedData.notes,
    });

    return NextResponse.json({
      success: true,
      data: trackingEntry,
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
  { params }: { params: { date: string } }
) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    const date = params.date;

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
