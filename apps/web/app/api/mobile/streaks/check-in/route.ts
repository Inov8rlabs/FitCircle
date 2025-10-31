import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { z } from 'zod';
import {
  performDailyCheckIn,
  DailyCheckInRequest,
} from '@/lib/services/daily-checkin-service';

// Validation schema
const checkInSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  previousDaySentiment: z.enum(['great', 'ok', 'could_be_better']).optional(),
  mood: z.number().min(1).max(5),
  energy: z.number().min(1).max(5),
  weight: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
});

/**
 * POST /api/mobile/streaks/check-in
 * Perform daily check-in with streak tracking
 *
 * Request Body:
 * {
 *   date?: string,              // ISO date (YYYY-MM-DD), defaults to today
 *   previousDaySentiment?: string,  // 'great' | 'ok' | 'could_be_better'
 *   mood: number,               // 1-5
 *   energy: number,             // 1-5
 *   weight?: number,            // kg
 *   notes?: string
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     newStreak: number,
 *     isFirstCheckInToday: boolean,
 *     milestoneAchieved?: {...},
 *     pointsEarned: number,
 *     totalPoints: number,
 *     freezeApplied?: boolean,
 *     freezeEarned?: boolean,
 *     message: string
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    // Parse and validate request body
    const body = await request.json();
    const validatedData = checkInSchema.parse(body);

    // Perform check-in
    const result = await performDailyCheckIn(user.id, validatedData as DailyCheckInRequest, supabaseAdmin);

    const response = NextResponse.json({
      success: true,
      data: result,
      error: null,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('Daily check-in error:', error);

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
            details: error.errors,
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
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
