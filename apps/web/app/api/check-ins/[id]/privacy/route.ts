/**
 * API Route: /api/check-ins/[id]/privacy
 *
 * Handles toggling privacy status of check-ins
 * Part of Progress History & Check-In Detail Enhancement (Phase 1)
 * PRD: /docs/progress-history-checkin-detail-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { toggleCheckInPrivacy } from '@/lib/services/check-in-service';

// Validation schema
const privacySchema = z.object({
  isPublic: z.boolean(),
});

// Helper function to get authenticated user
async function getAuthenticatedUser(request: NextRequest) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('sb-access-token')?.value;

  if (!accessToken) {
    return null;
  }

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

  const { data: { user }, error } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    return null;
  }

  return user;
}

// Create admin Supabase client
function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * PATCH /api/check-ins/[id]/privacy
 *
 * Toggle privacy status of a check-in (owner only)
 *
 * Request body:
 * {
 *   "isPublic": true | false
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id: checkInId } = await params;

    // Parse and validate request body
    const body = await request.json();
    let validatedData;

    try {
      validatedData = privacySchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid input', details: error.errors },
          { status: 400 }
        );
      }
      throw error;
    }

    const supabase = createAdminSupabase();

    // Verify ownership
    const { data: checkIn } = await supabase
      .from('daily_tracking')
      .select('user_id, is_public')
      .eq('id', checkInId)
      .single();

    if (!checkIn) {
      return NextResponse.json(
        { error: 'Check-in not found' },
        { status: 404 }
      );
    }

    // Only the owner can modify their check-in
    if (checkIn.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Not authorized to modify this check-in' },
        { status: 403 }
      );
    }

    // Update privacy setting
    const { success, error: updateError } = await toggleCheckInPrivacy(
      checkInId,
      validatedData.isPublic,
      user.id,
      supabase
    );

    if (!success || updateError) {
      return NextResponse.json(
        { error: updateError?.message || 'Failed to update privacy setting' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      isPublic: validatedData.isPublic,
      message: validatedData.isPublic
        ? 'Check-in is now public'
        : 'Check-in is now private',
    });

  } catch (error) {
    console.error('Update privacy error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
