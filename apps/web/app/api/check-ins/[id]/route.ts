/**
 * API Route: /api/check-ins/[id]
 *
 * Handles retrieving, updating, and deleting individual check-ins
 * Part of Progress History & Check-In Detail Enhancement (Phase 1)
 * PRD: /docs/progress-history-checkin-detail-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import {
  getCheckInWithDetails,
  canViewCheckIn,
  deleteCheckIn,
  isUserInChallenge,
} from '@/lib/services/check-in-service';

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
 * GET /api/check-ins/[id]
 *
 * Retrieve a single check-in with full details
 * Includes permission checking based on privacy settings and circle membership
 */
export async function GET(
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
    const supabase = createAdminSupabase();

    // Get check-in with profile details
    const { data: checkIn, error: fetchError } = await getCheckInWithDetails(
      checkInId,
      supabase
    );

    if (fetchError || !checkIn) {
      return NextResponse.json(
        { error: 'Check-in not found' },
        { status: 404 }
      );
    }

    // If it's the user's own check-in, return it immediately
    if (checkIn.user_id === user.id) {
      return NextResponse.json({
        checkIn,
        canEdit: true,
      });
    }

    // For others' check-ins, need to verify permissions
    // Get challenge ID from query params (optional)
    const { searchParams } = new URL(request.url);
    const challengeId = searchParams.get('challengeId');

    let hasPermission = false;
    let challenge = null;

    if (challengeId) {
      // Get challenge details
      const { data: challengeData } = await supabase
        .from('challenges')
        .select('id, type, creator_id, name, description, start_date, end_date')
        .eq('id', challengeId)
        .single();

      if (challengeData) {
        challenge = challengeData;

        // Check if viewer is in the circle
        const isMember = await isUserInChallenge(user.id, challengeId, supabase);

        // Check permission using service layer logic
        hasPermission = canViewCheckIn(checkIn, user, challenge, isMember);
      }
    } else {
      // Require challengeId when viewing others' check-ins
      if (checkIn.user_id !== user.id) {
        return NextResponse.json(
          { error: 'challengeId required to view others\' check-ins' },
          { status: 400 }
        );
      }

      // Owner viewing their own check-in
      hasPermission = true;
    }

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Not authorized to view this check-in' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      checkIn,
      canEdit: false,
    });

  } catch (error) {
    console.error('Get check-in error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/check-ins/[id]
 *
 * Update a check-in (owner only)
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
    const body = await request.json();
    const { weight_kg, steps, notes, mood_score, energy_level } = body;

    // Validate weight if provided
    if (weight_kg !== undefined && weight_kg !== null) {
      if (weight_kg < 30 || weight_kg > 300) {
        return NextResponse.json(
          { error: 'Weight must be between 30-300 kg' },
          { status: 400 }
        );
      }
    }

    const supabase = createAdminSupabase();

    // Verify ownership before updating
    const { data: checkIn } = await supabase
      .from('daily_tracking')
      .select('user_id')
      .eq('id', checkInId)
      .single();

    if (!checkIn) {
      return NextResponse.json(
        { error: 'Check-in not found' },
        { status: 404 }
      );
    }

    // Only the owner can update their check-in
    if (checkIn.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Not authorized to update this check-in' },
        { status: 403 }
      );
    }

    // Build update object
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (weight_kg !== undefined) updateData.weight_kg = weight_kg;
    if (steps !== undefined) updateData.steps = steps;
    if (notes !== undefined) updateData.notes = notes;
    if (mood_score !== undefined) updateData.mood_score = mood_score;
    if (energy_level !== undefined) updateData.energy_level = energy_level;

    // Update the check-in
    const { data, error } = await supabase
      .from('daily_tracking')
      .update(updateData)
      .eq('id', checkInId)
      .eq('user_id', user.id) // Ensure user owns this check-in
      .select()
      .single();

    if (error) {
      console.error('Update error:', error);
      return NextResponse.json(
        { error: 'Failed to update check-in' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Update check-in error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/check-ins/[id]
 *
 * Delete a check-in (owner only)
 */
export async function DELETE(
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
    const supabase = createAdminSupabase();

    // Verify ownership before deleting
    const { data: checkIn } = await supabase
      .from('daily_tracking')
      .select('user_id')
      .eq('id', checkInId)
      .single();

    if (!checkIn) {
      return NextResponse.json(
        { error: 'Check-in not found' },
        { status: 404 }
      );
    }

    // Only the owner can delete their check-in
    if (checkIn.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Not authorized to delete this check-in' },
        { status: 403 }
      );
    }

    // Delete the check-in
    const { success, error: deleteError } = await deleteCheckIn(
      checkInId,
      user.id,
      supabase
    );

    if (!success || deleteError) {
      return NextResponse.json(
        { error: deleteError?.message || 'Failed to delete check-in' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Check-in deleted successfully',
    });

  } catch (error) {
    console.error('Delete check-in error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
