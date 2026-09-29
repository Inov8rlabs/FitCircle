import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import {
  performDailyCheckIn,
  type DailyCheckInRequest,
} from '@/lib/services/daily-checkin-service';
import { readJsonBody } from '@/lib/streaks/request-body';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

const SENTIMENTS = ['great', 'ok', 'could_be_better'] as const;

// Validation schema
const checkInSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().max(100).optional(),
  previousDaySentiment: z.enum(SENTIMENTS).optional(),
  mood: z.number().min(1).max(5),
  energy: z.number().min(1).max(5),
  weight: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
});

/**
 * iOS sends the sentiment as `previous_day_sentiment`; Android and the web app
 * send `previousDaySentiment`. The snake_case key used to be dropped, so an iOS
 * check-in never stored the sentiment.
 *
 * The camelCase key wins when both are present. A snake_case value outside the
 * enum is ignored rather than rejected: those requests were accepted before
 * (the key was not read at all) and must stay accepted.
 */
function withSentimentAlias(body: Record<string, unknown>): Record<string, unknown> {
  const camel = body.previousDaySentiment;
  if (camel !== undefined && camel !== null) return body;

  const snake = body.previous_day_sentiment;
  if (typeof snake === 'string' && (SENTIMENTS as readonly string[]).includes(snake)) {
    return { ...body, previousDaySentiment: snake };
  }
  return body;
}

/**
 * POST /api/mobile/streaks/check-in
 * Perform daily check-in with streak tracking
 *
 * Request Body:
 * {
 *   date?: string,              // ISO date (YYYY-MM-DD), defaults to today
 *   previousDaySentiment?: string,  // 'great' | 'ok' | 'could_be_better'
 *                                   // (also read from previous_day_sentiment)
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
    const body = await readJsonBody(request);
    const validatedData = parseLenient(checkInSchema, withSentimentAlias(body));

    // Honour the device's local timezone (body wins over header).
    const timezone =
      validatedData.timezone || request.headers.get('x-client-timezone') || undefined;

    // Perform check-in
    const result = await performDailyCheckIn(
      user.id,
      { ...validatedData, timezone } as DailyCheckInRequest,
      supabaseAdmin
    );

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
            message: validationMessage(error),
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
