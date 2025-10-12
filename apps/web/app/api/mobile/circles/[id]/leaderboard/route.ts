import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleService } from '@/lib/services/circle-service';

/**
 * Helper function to format dates for iOS (ISO8601 compatible)
 */
const formatDateForIOS = (dateValue: string | Date | null | undefined): string | null => {
  if (!dateValue) return null;

  try {
    const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;

    // Check if valid date
    if (isNaN(date.getTime())) return null;

    // Return ISO8601 string (e.g., 2023-01-15T14:30:00.123Z)
    return date.toISOString();
  } catch (error) {
    console.error('Error formatting date:', dateValue, error);
    return null;
  }
};

/**
 * Validate UUID format
 */
const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * GET /api/mobile/circles/[id]/leaderboard
 * Get leaderboard for a specific circle
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    // Authenticate user
    const user = await requireMobileAuth(request);

    // Await params in Next.js 15
    const { id: circleId } = await params;

    // Validate circleId is a valid UUID
    if (!isValidUUID(circleId)) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_CIRCLE_ID',
            message: 'Invalid circle ID format',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // Check if circle exists
    let circle;
    try {
      circle = await CircleService.getCircle(circleId);
    } catch (error: any) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'CIRCLE_NOT_FOUND',
            message: 'Circle not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    // Verify user is a member of the circle or is the creator
    const members = await CircleService.getCircleMembers(circleId);
    const isMember = members.some((m) => m.user_id === user.id);
    // Check both created_by and creator_id as the field name may vary
    const isCreator = circle.created_by === user.id || (circle as any).creator_id === user.id;

    if (!isMember && !isCreator) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'You must be a member of this circle to view the leaderboard',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // If there are no members yet, return empty leaderboard
    if (members.length === 0) {
      const requestTime = Date.now() - startTime;

      return NextResponse.json(
        {
          success: true,
          data: [],
          error: null,
          meta: {
            requestTime,
          },
        },
        {
          status: 200,
          headers: {
            'Cache-Control': 'private, max-age=60',
          },
        }
      );
    }

    // Get leaderboard data
    const leaderboard = await CircleService.getLeaderboard(circleId);

    // Format dates for iOS compatibility
    const formattedLeaderboard = leaderboard.map((entry) => ({
      rank: entry.rank,
      user_id: entry.user_id,
      display_name: entry.display_name,
      avatar_url: entry.avatar_url || null,
      progress_percentage: entry.progress_percentage,
      streak_days: entry.streak_days,
      last_check_in_at: formatDateForIOS(entry.last_check_in_at),
      checked_in_today: entry.checked_in_today,
      high_fives_received: entry.high_fives_received,
      current_value: entry.current_value || null,
      starting_value: entry.starting_value || null,
      target_value: entry.target_value || null,
      goal_type: entry.goal_type || null,
      goal_unit: entry.goal_unit || null,
    }));

    const requestTime = Date.now() - startTime;

    // Return response with 1-minute cache
    return NextResponse.json(
      {
        success: true,
        data: formattedLeaderboard,
        error: null,
        meta: {
          requestTime,
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'private, max-age=60', // Cache for 1 minute
        },
      }
    );
  } catch (error: any) {
    console.error('[Leaderboard] Error:', error);

    // Handle authentication errors
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

    // Generic error response
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: {
            message: error.message,
          },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
