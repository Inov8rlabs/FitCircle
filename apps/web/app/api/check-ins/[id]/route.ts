/**
 * API Route: /api/check-ins/[id]
 *
 * Handles retrieving, updating, and deleting individual check-ins
 * Part of Progress History & Check-In Detail Enhancement (Phase 1)
 * PRD: /docs/progress-history-checkin-detail-prd.md
 */

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

import {
  getCheckInWithDetails,
  canViewCheckIn,
  deleteCheckIn,
  isUserInChallenge,
} from '@/lib/services/check-in-service';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

/**
 * PATCH body keys. The web app sends snake_case; the mobile clients send the
 * camelCase names of the mobile tracking contract. Both are accepted; when a request
 * carries both spellings of a field, snake_case (the original contract) wins.
 */
const PATCH_FIELDS = [
  { column: 'weight_kg', alias: 'weightKg' },
  { column: 'steps', alias: 'steps' },
  { column: 'notes', alias: 'notes' },
  { column: 'mood_score', alias: 'moodScore' },
  { column: 'energy_level', alias: 'energyLevel' },
] as const;

function readPatchFields(body: unknown): Record<string, unknown> {
  // A body that is not a JSON object carries no fields (same as `{}`).
  const source: Record<string, unknown> =
    typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const fields: Record<string, unknown> = {};
  for (const { column, alias } of PATCH_FIELDS) {
    if (source[column] !== undefined) fields[column] = source[column];
    else if (source[alias] !== undefined) fields[column] = source[alias];
  }
  return fields;
}

/**
 * Mobile clients call this route with `Authorization: Bearer <mobile access token>`
 * (iOS: check-in edit, per-metric clear, delete). The token is verified exactly as on
 * /api/mobile/* routes (MobileAPIService.authenticateWithToken → signature + expiry +
 * profile lookup). Only consulted when there is no web session cookie, so the web
 * app's behaviour is unchanged.
 */
async function getBearerUser(request: NextRequest): Promise<{ id: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  if (!token) return null;
  try {
    const profile = await MobileAPIService.authenticateWithToken(token);
    return profile?.id ? profile : null;
  } catch {
    return null;
  }
}

// Helper function to get authenticated user (web cookie first, then mobile Bearer)
async function getAuthenticatedUser(request: NextRequest) {
  const cookieUser = await getCookieUser();
  if (cookieUser) return cookieUser;
  return getBearerUser(request);
}

async function getCookieUser() {
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
        // Additive: the mobile envelope ({ success, data }) alongside the web keys.
        success: true,
        data: checkIn,
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
        .from('fitcircles')
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
      // Additive: the mobile envelope ({ success, data }) alongside the web keys.
      success: true,
      data: checkIn,
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
    // snake_case (web) or camelCase (mobile); undefined = leave unchanged, null = clear.
    const { weight_kg, steps, notes, mood_score, energy_level } = readPatchFields(body) as Record<
      string,
      any
    >;

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
