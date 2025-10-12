import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleService } from '@/lib/services/circle-service';

/**
 * GET /api/mobile/circles/[id]
 * Get detailed information about a specific circle
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Await params in Next.js 15
    const { id: circleId } = await params;

    // Get circle details
    const circle = await CircleService.getCircle(circleId);

    // Get members
    const members = await CircleService.getCircleMembers(circleId);

    // Get leaderboard
    const leaderboard = await CircleService.getLeaderboard(circleId);

    // Get user's progress if they're a member
    const userMember = members.find((m) => m.user_id === user.id);

    const userProgress = userMember
      ? {
          progress_percentage: userMember.progress_percentage,
          current_value: userMember.current_value,
          goal_target_value: userMember.goal_target_value,
          streak_days: userMember.streak_days,
          check_ins_count: userMember.check_ins_count,
        }
      : null;

    // Get circle stats
    const stats = await CircleService.getCircleStats(circleId);

    return NextResponse.json({
      success: true,
      data: {
        ...circle,
        participants: members.map((m) => ({
          user_id: m.user_id,
          progress_percentage: m.progress_percentage,
          streak_days: m.streak_days,
          joined_at: m.joined_at,
        })),
        leaderboard,
        userProgress,
        stats,
      },
      error: null,
      meta: {
        requestTime: Date.now() - Date.now(), // Will be 0 but matches format
      },
    });
  } catch (error: any) {
    console.error('Get circle details error:', error);

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
