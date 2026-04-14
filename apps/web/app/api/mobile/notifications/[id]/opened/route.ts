import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * POST /api/mobile/notifications/[id]/opened
 * Mark a notification as opened (for analytics tracking).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('notification_log')
      .update({ opened_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, opened_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: 'NOT_FOUND',
              message: 'Notification not found',
              details: {},
              timestamp: new Date().toISOString(),
            },
            meta: null,
          },
          { status: 404 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      data,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    console.error('[POST /api/mobile/notifications/[id]/opened] Error:', error);

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
          message: 'Failed to mark notification as opened',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
