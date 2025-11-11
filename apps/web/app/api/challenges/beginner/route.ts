import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/challenges/beginner
 * Get beginner-friendly challenges (Casey persona flow)
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

    console.log('[Challenges API] Getting beginner challenges for user:', user.id);

    // Get beginner-friendly challenges:
    // 1. Low or no entry fee
    // 2. Shorter duration (2-4 weeks)
    // 3. Not too many participants yet
    // 4. Clear, simple goals
    const { data: challenges, error } = await supabaseAdmin
      .from('challenges')
      .select(`
        id,
        name,
        description,
        type,
        status,
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
      .or('entry_fee.lte.10,entry_fee.is.null')
      .order('participant_count', { ascending: true })
      .limit(20);

    if (error) {
      console.error('[Challenges API] Error fetching challenges:', error);
      throw error;
    }

    // Filter and score challenges
    const now = new Date();

    const beginnerChallenges = (challenges || [])
      .map(challenge => {
        const startDate = new Date(challenge.start_date);
        const endDate = new Date(challenge.end_date);
        const durationDays = Math.ceil(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        let difficulty: 'beginner' | 'intermediate' | 'advanced' = 'intermediate';
        let score = 0;
        let recommendationReason = null;

        // Determine difficulty
        if (
          challenge.entry_fee <= 5 &&
          durationDays <= 30 &&
          challenge.participant_count < 50
        ) {
          difficulty = 'beginner';
          score += 3;
        } else if (challenge.entry_fee <= 20 && durationDays <= 60) {
          difficulty = 'intermediate';
          score += 1;
        } else {
          difficulty = 'advanced';
        }

        // Persona-based scoring
        if (profile?.persona === 'casey') {
          if (challenge.prize_pool > 0) score += 2;
          if (challenge.type === 'weight_loss') score += 1;
          recommendationReason = 'Great first challenge with prizes';
        } else if (profile?.persona === 'mike') {
          if (challenge.entry_fee === 0) score += 2;
          if (durationDays <= 14) score += 1;
          recommendationReason = 'Quick start, no commitment';
        }

        // General beginner-friendly factors
        if (challenge.participant_count > 0 && challenge.participant_count < 20) {
          score += 2;
        }
        if (difficulty === 'beginner') {
          score += 2;
        }

        return {
          id: challenge.id,
          name: challenge.name,
          description: challenge.description,
          type: challenge.type,
          difficulty,
          duration: durationDays,
          participantCount: challenge.participant_count,
          entryFee: challenge.entry_fee,
          prizePool: challenge.prize_pool,
          startDate: challenge.start_date,
          coverImageUrl: challenge.cover_image_url,
          tags: challenge.tags,
          isRecommended: score >= 5,
          recommendationReason:
            recommendationReason || (difficulty === 'beginner' ? 'Perfect for beginners' : null),
          score,
        };
      })
      .filter(c => c.difficulty === 'beginner' || c.difficulty === 'intermediate')
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    console.log('[Challenges API] Returning', beginnerChallenges.length, 'beginner challenges');

    return NextResponse.json({
      success: true,
      data: {
        challenges: beginnerChallenges,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Challenges API] Get beginner challenges error:', error);

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
          message: 'Failed to get beginner challenges',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
