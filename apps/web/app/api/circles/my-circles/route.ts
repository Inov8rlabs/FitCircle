import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';

// GET /api/circles/my-circles - Get user's circles
export async function GET(request: NextRequest) {
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

    // Get user's circles
    const circles = await CircleService.getUserCircles(user.id);

    return NextResponse.json({
      success: true,
      data: circles
    });
  } catch (error: any) {
    console.error('Get user circles error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get your circles' },
      { status: 500 }
    );
  }
}