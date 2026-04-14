import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BoostService } from '@/lib/services/boost-service';

/**
 * GET /api/mobile/circles/[id]/boost/history?days=7
 * Get boost history for past N days
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;
    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get('days') || '7'), 90);

    // Verify user is a member of this circle
    const { createAdminSupabase } = await import('@/lib/supabase-admin');
    const supabaseAdmin = createAdminSupabase();
    const { data: membership } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', circleId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'You are not a member of this circle',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    const history = await BoostService.getBoostHistory(circleId, days);

    const response = NextResponse.json({
      success: true,
      data: history,
      error: null,
      meta: { days },
    });

    response.headers.set('Cache-Control', 'private, max-age=120');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/circles/[id]/boost/history] Error:', error);
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
        meta: null,
      },
      { status: 500 }
    );
  }
}
