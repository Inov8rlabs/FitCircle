import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';

// GET /api/circles/[id]/encouragements - Get encouragements
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get authenticated user
    const supabase = createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is a member of the circle
    const members = await CircleService.getCircleMembers(params.id);
    const isMember = members.some(m => m.user_id === user.id);

    if (!isMember) {
      return NextResponse.json(
        { error: 'You must be a member of this circle to view encouragements' },
        { status: 403 }
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const personalOnly = searchParams.get('personal_only') === 'true';

    // Get encouragements
    const encouragements = await CircleService.getEncouragements(
      params.id,
      personalOnly ? user.id : undefined
    );

    // Filter by type if specified
    const filtered = type
      ? encouragements.filter(e => e.type === type)
      : encouragements;

    // Format milestone messages
    const formatted = filtered.map(e => {
      if (e.type === 'milestone' && e.milestone_type) {
        let message = '';
        const userName = e.from_user?.display_name || 'A member';

        switch (e.milestone_type) {
          case 'progress_25':
            message = `${userName} reached 25% of their goal!`;
            break;
          case 'progress_50':
            message = `${userName} is halfway to their goal!`;
            break;
          case 'progress_75':
            message = `${userName} reached 75% of their goal!`;
            break;
          case 'progress_100':
            message = `${userName} completed their goal! 🎉`;
            break;
          case 'streak_7':
            message = `${userName} has a 7-day streak!`;
            break;
          case 'streak_14':
            message = `${userName} has a 14-day streak!`;
            break;
          case 'streak_30':
            message = `${userName} has an amazing 30-day streak!`;
            break;
        }

        return {
          ...e,
          content: e.content || message,
        };
      }
      return e;
    });

    return NextResponse.json({
      success: true,
      data: {
        encouragements: formatted,
        total_count: formatted.length,
      }
    });
  } catch (error: any) {
    console.error('Get encouragements error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get encouragements' },
      { status: 500 }
    );
  }
}