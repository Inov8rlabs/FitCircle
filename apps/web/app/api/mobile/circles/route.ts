import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleService } from '@/lib/services/circle-service';

// Validation schema for POST
const createCircleSchema = z.object({
  name: z.string().min(1, 'Circle name is required').max(100),
  description: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  allowLateJoin: z.boolean().optional(),
  lateJoinDeadline: z.number().int().min(1).max(30).optional(),
});

/**
 * GET /api/mobile/circles
 * Get all circles for the authenticated user
 *
 * Query params:
 * - status: filter by status (active, upcoming, completed) - optional
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') as 'active' | 'upcoming' | 'completed' | null;

    // Get user's circles (where they are members)
    const memberCircles = await CircleService.getUserCircles(user.id);

    // Also get circles where user is the creator
    const supabase = await import('@/lib/supabase-admin').then(m => m.createAdminSupabase());
    const { data: createdCircles } = await supabase
      .from('challenges')
      .select('*')
      .eq('creator_id', user.id)
      .order('created_at', { ascending: false });

    // Combine and deduplicate circles
    const allCirclesMap = new Map();

    // Add member circles
    for (const circle of [...memberCircles.active, ...memberCircles.upcoming, ...memberCircles.completed]) {
      allCirclesMap.set(circle.id, circle);
    }

    // Add created circles (if not already in the map)
    for (const circle of createdCircles || []) {
      if (!allCirclesMap.has(circle.id)) {
        allCirclesMap.set(circle.id, circle);
      }
    }

    // Flatten circles into a single array for iOS
    let allCircles = Array.from(allCirclesMap.values());

    // Apply status filter if provided
    if (statusFilter) {
      if (statusFilter === 'active') {
        allCircles = memberCircles.active;
      } else if (statusFilter === 'upcoming') {
        allCircles = memberCircles.upcoming;
      } else if (statusFilter === 'completed') {
        allCircles = memberCircles.completed;
      }
    }

    const response = NextResponse.json({
      success: true,
      data: allCircles, // Return flat array for iOS
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });

    // Add cache headers (2 minutes cache for circles)
    response.headers.set('Cache-Control', 'private, max-age=120');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Get circles error:', {
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
 * POST /api/mobile/circles
 * Create a new circle
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse and validate request body
    const body = await request.json();
    const validatedData = createCircleSchema.parse(body);

    // Validate dates
    const startDate = new Date(validatedData.startDate);
    const endDate = new Date(validatedData.endDate);

    if (endDate <= startDate) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'End date must be after start date',
            details: {
              startDate: validatedData.startDate,
              endDate: validatedData.endDate,
            },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // Create the circle
    const circle = await CircleService.createCircle(user.id, {
      name: validatedData.name,
      description: validatedData.description,
      start_date: validatedData.startDate,
      end_date: validatedData.endDate,
      allow_late_join: validatedData.allowLateJoin,
      late_join_deadline: validatedData.lateJoinDeadline,
    });

    // Get invite code
    const inviteCode = circle.invite_code;

    return NextResponse.json(
      {
        success: true,
        data: {
          circle,
          inviteCode,
        },
        meta: {
          requestTime: Date.now() - startTime,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[Mobile API] Create circle error:', {
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
