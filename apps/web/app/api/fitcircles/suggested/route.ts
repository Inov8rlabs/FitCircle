import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/fitcircles/suggested
 * Get suggested FitCircles to join based on user's persona and goals
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const supabaseAdmin = createAdminSupabase();

    // Get user's persona and fitness level
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('persona, fitness_level')
      .eq('id', user.id)
      .single();

    console.log('[FitCircles API] Getting suggested FitCircles for user:', user.id, profile?.persona);

    // Get challenges that:
    // 1. Are public or invite_only
    // 2. Are upcoming or active
    // 3. User is not already a member of
    // 4. Match user's interests (based on persona)
    let query = supabaseAdmin
      .from('challenges')
      .select(`
        id,
        name,
        description,
        type,
        status,
        visibility,
        start_date,
        end_date,
        participant_count,
        max_participants,
        entry_fee,
        prize_pool,
        cover_image_url,
        tags
      `)
      .in('status', ['upcoming', 'active'])
      .in('visibility', ['public', 'invite_only'])
      .order('participant_count', { ascending: false })
      .limit(20);

    const { data: challenges, error } = await query;

    if (error) {
      console.error('[FitCircles API] Error fetching challenges:', error);
      throw error;
    }

    // Filter out challenges user is already in
    const { data: userParticipations } = await supabaseAdmin
      .from('challenge_participants')
      .select('challenge_id')
      .eq('user_id', user.id);

    const userChallengeIds = new Set(userParticipations?.map(p => p.challenge_id) || []);

    const availableChallenges = (challenges || []).filter(
      c => !userChallengeIds.has(c.id)
    );

    // Score challenges based on persona match
    const scoredChallenges = availableChallenges.map(challenge => {
      let score = 0;
      let recommendationReason = null;

      // Persona-based scoring
      if (profile?.persona === 'casey') {
        // Casey likes competitive challenges
        if (challenge.entry_fee > 0) score += 3;
        if (challenge.prize_pool > 0) score += 3;
        if (challenge.type === 'weight_loss' || challenge.type === 'step_count') score += 2;
        recommendationReason = 'Competitive challenge with prizes';
      } else if (profile?.persona === 'sarah') {
        // Sarah likes social, team-based challenges
        if (challenge.visibility === 'invite_only') score += 2;
        if (challenge.participant_count > 5) score += 3;
        recommendationReason = 'Popular with other members';
      } else if (profile?.persona === 'mike') {
        // Mike likes structured, beginner-friendly challenges
        if (challenge.entry_fee === 0) score += 2;
        if (challenge.participant_count < 10) score += 2;
        recommendationReason = 'Great for getting started';
      } else if (profile?.persona === 'fiona') {
        // Fiona likes intense challenges
        if (challenge.type === 'workout_minutes') score += 3;
        if (challenge.participant_count > 10) score += 2;
        recommendationReason = 'Intense workout challenge';
      }

      // General scoring
      if (challenge.participant_count > 0) score += 1;
      if (challenge.status === 'active') score += 1;

      return {
        ...challenge,
        score,
        recommendationReason,
        isRecommended: score >= 4,
      };
    });

    // Sort by score
    scoredChallenges.sort((a, b) => b.score - a.score);

    // Take top 10
    const suggested = scoredChallenges.slice(0, 10);

    console.log('[FitCircles API] Returning', suggested.length, 'suggested FitCircles');

    return NextResponse.json({
      success: true,
      data: {
        fitCircles: suggested.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          type: c.type,
          status: c.status,
          participantCount: c.participant_count,
          maxParticipants: c.max_participants,
          entryFee: c.entry_fee,
          prizePool: c.prize_pool,
          startDate: c.start_date,
          endDate: c.end_date,
          coverImageUrl: c.cover_image_url,
          tags: c.tags,
          isRecommended: c.isRecommended,
          recommendationReason: c.recommendationReason,
        })),
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[FitCircles API] Get suggested FitCircles error:', error);

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
          message: 'Failed to get suggested FitCircles',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
