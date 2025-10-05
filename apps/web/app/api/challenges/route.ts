import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { z } from 'zod';

// Validation schemas
const createChallengeSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().optional(),
  type: z.enum(['weight_loss', 'step_count', 'workout_minutes', 'custom']),
  visibility: z.enum(['public', 'private', 'invite_only']).optional(),
  rules: z.object({}).passthrough().optional(),
  scoring_system: z.object({}).passthrough().optional(),
  start_date: z.string(),
  end_date: z.string(),
  registration_deadline: z.string(),
  entry_fee: z.number().min(0).optional(),
  prize_pool: z.number().min(0).optional(),
  min_participants: z.number().min(1).optional(),
  max_participants: z.number().min(1).optional(),
  min_team_size: z.number().min(1).optional(),
  max_team_size: z.number().min(1).optional(),
  allow_late_join: z.boolean().optional(),
  cover_image_url: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
});

const challengeFiltersSchema = z.object({
  status: z.enum(['draft', 'upcoming', 'active', 'completed', 'cancelled']).optional(),
  visibility: z.enum(['public', 'private', 'invite_only']).optional(),
  creator_id: z.string().uuid().optional(),
  type: z.enum(['weight_loss', 'step_count', 'workout_minutes', 'custom']).optional(),
  featured: z.boolean().optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional(),
});

// Helper to get auth token
async function getAuthToken() {
  const cookieStore = cookies();
  return cookieStore.get('sb-access-token')?.value;
}

// GET /api/challenges - Get challenges with filters
export async function GET(request: NextRequest) {
  try {
    const db = new DatabaseService();
    const searchParams = request.nextUrl.searchParams;

    // Parse filters
    const filters = challengeFiltersSchema.parse({
      status: searchParams.get('status') || undefined,
      visibility: searchParams.get('visibility') || undefined,
      creator_id: searchParams.get('creator_id') || undefined,
      type: searchParams.get('type') || undefined,
      featured: searchParams.get('featured') === 'true' ? true : undefined,
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
    });

    // Get challenges
    const challenges = await db.getChallenges(filters);

    // Get user's participation status if authenticated
    const token = await getAuthToken();
    let userParticipations = [];

    if (token) {
      const { getAuthUser } = await import('@fitcircle/database/client');
      const user = await getAuthUser(token);

      if (user) {
        // Get user's participations
        const participations = await db.client
          .from('challenge_participants')
          .select('challenge_id, status')
          .eq('user_id', user.id);

        userParticipations = participations.data || [];
      }
    }

    // Enhance challenges with user participation status
    const enhancedChallenges = challenges.map(challenge => ({
      ...challenge,
      isJoined: userParticipations.some(p => p.challenge_id === challenge.id),
      userStatus: userParticipations.find(p => p.challenge_id === challenge.id)?.status,
    }));

    return NextResponse.json({
      challenges: enhancedChallenges,
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total: challenges.length,
      }
    });

  } catch (error) {
    console.error('GET challenges error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof DatabaseError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch challenges' },
      { status: 500 }
    );
  }
}

// POST /api/challenges - Create a new challenge
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const token = await getAuthToken();
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { getAuthUser } = await import('@fitcircle/database/client');
    const user = await getAuthUser(token);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = createChallengeSchema.parse(body);

    // Validate dates
    const startDate = new Date(validatedData.start_date);
    const endDate = new Date(validatedData.end_date);
    const registrationDeadline = new Date(validatedData.registration_deadline);

    if (endDate <= startDate) {
      return NextResponse.json(
        { error: 'End date must be after start date' },
        { status: 400 }
      );
    }

    if (registrationDeadline > startDate) {
      return NextResponse.json(
        { error: 'Registration deadline must be before or on start date' },
        { status: 400 }
      );
    }

    // Create challenge
    const db = new DatabaseService();
    const challenge = await db.createChallenge({
      ...validatedData,
      creator_id: user.id,
      status: 'draft',
      participant_count: 0,
      team_count: 0,
      total_check_ins: 0,
      avg_progress: 0,
      completion_rate: 0,
      engagement_score: 0,
    });

    // Auto-join creator as first participant
    await db.joinChallenge(challenge.id, user.id);

    // Create notification for followers (if public)
    if (validatedData.visibility === 'public') {
      // In a real implementation, you'd notify followers
      // This is a placeholder for the notification system
      await db.createNotification({
        user_id: user.id,
        type: 'challenge_invite',
        channel: 'in_app',
        title: 'New Challenge Created',
        body: `You created "${challenge.name}". Share it with others to get started!`,
        related_challenge_id: challenge.id,
        action_url: `/challenges/${challenge.id}`,
      });
    }

    return NextResponse.json({
      challenge,
      message: 'Challenge created successfully!',
    }, { status: 201 });

  } catch (error) {
    console.error('POST challenge error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof DatabaseError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create challenge' },
      { status: 500 }
    );
  }
}

// PATCH /api/challenges/[id] - Update challenge
export async function PATCH(request: NextRequest) {
  try {
    // Extract challenge ID from URL
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const challengeId = pathParts[pathParts.length - 1];

    if (!challengeId) {
      return NextResponse.json(
        { error: 'Challenge ID required' },
        { status: 400 }
      );
    }

    // Check authentication
    const token = await getAuthToken();
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { getAuthUser } = await import('@fitcircle/database/client');
    const user = await getAuthUser(token);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const db = new DatabaseService();

    // Check if user is the creator
    const challenge = await db.getChallenge(challengeId);

    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge not found' },
        { status: 404 }
      );
    }

    if (challenge.creator_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the creator can update this challenge' },
        { status: 403 }
      );
    }

    // Parse request body (partial update)
    const body = await request.json();

    // Update challenge
    const updatedChallenge = await db.updateChallenge(challengeId, body);

    return NextResponse.json({
      challenge: updatedChallenge,
      message: 'Challenge updated successfully!',
    });

  } catch (error) {
    console.error('PATCH challenge error:', error);

    if (error instanceof DatabaseError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update challenge' },
      { status: 500 }
    );
  }
}