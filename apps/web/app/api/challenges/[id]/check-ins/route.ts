/**
 * API Route: /api/challenges/[id]/check-ins
 *
 * Retrieves filtered check-ins for a specific challenge
 * Filters based on challenge type and applies privacy rules
 * Part of Progress History & Check-In Detail Enhancement (Phase 1)
 * PRD: /docs/progress-history-checkin-detail-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { z } from 'zod';
import {
  getFilteredCheckIns,
  isUserInChallenge,
  type ChallengeType,
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

// Query parameter validation schema
const querySchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  offset: z.coerce
    .number()
    .int('Offset must be an integer')
    .min(0, 'Offset cannot be negative')
    .default(0),
});

/**
 * GET /api/challenges/[id]/check-ins
 *
 * Query parameters:
 * - userId: User whose check-ins to retrieve (required)
 * - limit: Max number of check-ins to return (default: 20)
 * - offset: Number of check-ins to skip for pagination (default: 0)
 *
 * Returns check-ins filtered by challenge type:
 * - weight_loss: Only check-ins with weight data
 * - step_count/workout_frequency: Only check-ins with steps data
 * - custom: All check-ins
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

    const { id: challengeId } = await params;
    const { searchParams } = new URL(request.url);

    // Validate query parameters
    let userId: string;
    let limit: number;
    let offset: number;

    try {
      const validated = querySchema.parse({
        userId: searchParams.get('userId'),
        limit: searchParams.get('limit'),
        offset: searchParams.get('offset'),
      });
      userId = validated.userId;
      limit = validated.limit;
      offset = validated.offset;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid query parameters', details: error.errors },
          { status: 400 }
        );
      }
      throw error;
    }

    const supabase = createAdminSupabase();

    // Get challenge details to determine type
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('id, type, creator_id, name')
      .eq('id', challengeId)
      .single();

    if (challengeError || !challenge) {
      return NextResponse.json(
        { error: 'Challenge not found' },
        { status: 404 }
      );
    }

    // Verify viewer is a member of the challenge
    const isMember = await isUserInChallenge(user.id, challengeId, supabase);

    if (!isMember && challenge.creator_id !== user.id) {
      return NextResponse.json(
        { error: 'Not authorized to view this challenge' },
        { status: 403 }
      );
    }

    // Get filtered check-ins based on challenge type
    const challengeType = challenge.type as ChallengeType;
    const { data: checkIns, error: fetchError, hasMore } = await getFilteredCheckIns(
      userId,
      challengeType,
      supabase,
      limit,
      offset
    );

    if (fetchError) {
      return NextResponse.json(
        { error: fetchError.message },
        { status: 500 }
      );
    }

    // If viewing others' check-ins, filter out private ones unless viewer is creator
    let filteredCheckIns = checkIns;
    if (userId !== user.id && challenge.creator_id !== user.id) {
      filteredCheckIns = checkIns.filter(checkIn => checkIn.is_public);
    }

    return NextResponse.json({
      checkIns: filteredCheckIns,
      hasMore,
      challengeType,
      total: filteredCheckIns.length,
      metadata: {
        challengeId,
        challengeName: challenge.name,
        userId: userId,
        limit,
        offset,
      },
    });

  } catch (error) {
    console.error('Get challenge check-ins error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
