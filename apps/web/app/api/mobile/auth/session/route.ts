import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

import { verifyMobileAuth } from '@/lib/middleware/mobile-auth';
import { toMobileUser } from '@/lib/services/mobile-profile-response';

export async function GET(request: NextRequest) {
  try {
    // Verify Bearer token
    const user = await verifyMobileAuth(request);

    if (!user) {
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

    // Fetch full user profile from database
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('Error fetching profile:', profileError);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'PROFILE_NOT_FOUND',
            message: 'User profile not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    const responsePayload = {
      success: true,
      data: toMobileUser(profile, { id: user.id, email: user.email }),
      error: null,
      meta: null,
    };

    // Add cache headers (5 minutes cache for session data)
    const response = NextResponse.json(responsePayload);
    response.headers.set('Cache-Control', 'private, no-store');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Session error:', {
      message: error?.message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });

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
