import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InsightRequest {
  userId: string;
  challengeId?: string;
  period?: 'week' | 'month' | 'challenge';
  includeRecommendations?: boolean;
}

interface UserMetrics {
  checkInsCount: number;
  averageWeight: number;
  weightChange: number;
  totalSteps: number;
  averageSteps: number;
  totalMinutes: number;
  averageMinutes: number;
  streakDays: number;
  completionRate: number;
  rank?: number;
  rankChange?: number;
  achievements: any[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openAiKey = Deno.env.get('OPENAI_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userId, challengeId, period = 'week', includeRecommendations = true }: InsightRequest = await req.json();

    if (!userId) {
      throw new Error('userId is required');
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    if (period === 'week') {
      startDate.setDate(endDate.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(endDate.getMonth() - 1);
    }

    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!profile) {
      throw new Error('User not found');
    }

    // Get user's check-ins for the period
    let checkInsQuery = supabase
      .from('check_ins')
      .select('*')
      .eq('user_id', userId)
      .gte('check_in_date', startDate.toISOString())
      .lte('check_in_date', endDate.toISOString())
      .order('check_in_date', { ascending: true });

    if (challengeId) {
      checkInsQuery = checkInsQuery.eq('challenge_id', challengeId);
    }

    const { data: checkIns } = await checkInsQuery;

    // Get challenge participant data if challengeId is provided
    let participantData = null;
    let challengeData = null;
    if (challengeId) {
      const { data: participant } = await supabase
        .from('challenge_participants')
        .select('*')
        .eq('user_id', userId)
        .eq('challenge_id', challengeId)
        .single();

      participantData = participant;

      const { data: challenge } = await supabase
        .from('challenges')
        .select('*')
        .eq('id', challengeId)
        .single();

      challengeData = challenge;
    }

    // Get achievements for the period
    const { data: achievements } = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', userId)
      .gte('unlocked_at', startDate.toISOString())
      .lte('unlocked_at', endDate.toISOString());

    // Calculate metrics
    const metrics = calculateMetrics(checkIns || [], participantData, period);

    // Generate AI insights
    const insights = await generateAIInsights({
      profile,
      metrics,
      checkIns: checkIns || [],
      achievements: achievements || [],
      challenge: challengeData,
      period,
      openAiKey,
    });

    // Generate recommendations if requested
    let recommendations = [];
    if (includeRecommendations) {
      recommendations = await generateRecommendations({
        profile,
        metrics,
        checkIns: checkIns || [],
        openAiKey,
      });
    }

    // Store insights in database
    const { error: insertError } = await supabase
      .from('user_insights')
      .insert({
        user_id: userId,
        challenge_id: challengeId,
        period,
        metrics,
        insights,
        recommendations,
        generated_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error('Error storing insights:', insertError);
    }

    // Send notification if significant insights
    if (insights.significant) {
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'achievement',
        title: 'New Insights Available!',
        body: insights.summary,
        related_challenge_id: challengeId,
        action_data: { insights_id: insights.id },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          period,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          metrics,
          insights,
          recommendations,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error generating insights:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});

function calculateMetrics(
  checkIns: any[],
  participantData: any,
  period: string
): UserMetrics {
  if (checkIns.length === 0) {
    return {
      checkInsCount: 0,
      averageWeight: 0,
      weightChange: 0,
      totalSteps: 0,
      averageSteps: 0,
      totalMinutes: 0,
      averageMinutes: 0,
      streakDays: participantData?.streak_days || 0,
      completionRate: 0,
      rank: participantData?.rank,
      rankChange: 0,
      achievements: [],
    };
  }

  // Weight metrics
  const weights = checkIns.filter(c => c.weight_kg).map(c => c.weight_kg);
  const averageWeight = weights.length > 0
    ? weights.reduce((a, b) => a + b, 0) / weights.length
    : 0;

  const weightChange = weights.length >= 2
    ? weights[weights.length - 1] - weights[0]
    : 0;

  // Activity metrics
  const steps = checkIns.map(c => c.steps || 0);
  const totalSteps = steps.reduce((a, b) => a + b, 0);
  const averageSteps = Math.round(totalSteps / checkIns.length);

  const minutes = checkIns.map(c => c.active_minutes || 0);
  const totalMinutes = minutes.reduce((a, b) => a + b, 0);
  const averageMinutes = Math.round(totalMinutes / checkIns.length);

  // Completion rate
  const expectedDays = period === 'week' ? 7 : period === 'month' ? 30 : 1;
  const completionRate = (checkIns.length / expectedDays) * 100;

  return {
    checkInsCount: checkIns.length,
    averageWeight: Math.round(averageWeight * 10) / 10,
    weightChange: Math.round(weightChange * 10) / 10,
    totalSteps,
    averageSteps,
    totalMinutes,
    averageMinutes,
    streakDays: participantData?.streak_days || 0,
    completionRate: Math.min(100, Math.round(completionRate)),
    rank: participantData?.rank,
    rankChange: 0, // Would need historical data
    achievements: [],
  };
}

async function generateAIInsights(params: {
  profile: any;
  metrics: UserMetrics;
  checkIns: any[];
  achievements: any[];
  challenge: any;
  period: string;
  openAiKey: string;
}): Promise<any> {
  const { profile, metrics, checkIns, achievements, challenge, period, openAiKey } = params;

  // Prepare context for AI
  const context = {
    userName: profile.display_name,
    fitnessLevel: profile.fitness_level,
    goals: profile.goals,
    period,
    metrics,
    recentCheckIns: checkIns.slice(-5),
    achievements: achievements.map(a => ({ name: a.name, type: a.type })),
    challengeType: challenge?.type,
    challengeName: challenge?.name,
  };

  const prompt = `
    You are a fitness coach analyzing user data for ${context.userName}.

    User Profile:
    - Fitness Level: ${context.fitnessLevel}
    - Goals: ${JSON.stringify(context.goals)}

    Performance Metrics (${period}):
    - Check-ins: ${metrics.checkInsCount}
    - Weight Change: ${metrics.weightChange}kg
    - Average Steps: ${metrics.averageSteps}/day
    - Average Active Minutes: ${metrics.averageMinutes}/day
    - Current Streak: ${metrics.streakDays} days
    - Completion Rate: ${metrics.completionRate}%
    ${metrics.rank ? `- Current Rank: #${metrics.rank}` : ''}

    Recent Achievements: ${JSON.stringify(context.achievements)}

    Generate a personalized insight summary that:
    1. Highlights key accomplishments
    2. Identifies trends (positive or areas for improvement)
    3. Provides motivation
    4. Is concise (2-3 sentences max)

    Format as JSON with:
    {
      "summary": "brief insight summary",
      "highlights": ["key point 1", "key point 2"],
      "trend": "improving|steady|declining",
      "significant": true/false,
      "motivationalQuote": "relevant quote"
    }
  `;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: 'You are a supportive fitness coach providing data-driven insights. Be encouraging and constructive.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API request failed');
    }

    const result = await response.json();
    const insights = JSON.parse(result.choices[0].message.content);

    return {
      ...insights,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error generating AI insights:', error);

    // Fallback insights
    return {
      summary: generateFallbackSummary(metrics, period),
      highlights: generateFallbackHighlights(metrics),
      trend: determineTrend(metrics),
      significant: metrics.completionRate > 80 || metrics.streakDays >= 7,
      motivationalQuote: getRandomMotivationalQuote(),
      generatedAt: new Date().toISOString(),
    };
  }
}

async function generateRecommendations(params: {
  profile: any;
  metrics: UserMetrics;
  checkIns: any[];
  openAiKey: string;
}): Promise<string[]> {
  const { profile, metrics, checkIns, openAiKey } = params;

  const prompt = `
    Based on the user's fitness data:
    - Completion Rate: ${metrics.completionRate}%
    - Average Steps: ${metrics.averageSteps}/day
    - Average Active Minutes: ${metrics.averageMinutes}/day
    - Weight Change: ${metrics.weightChange}kg
    - Current Streak: ${metrics.streakDays} days

    Provide 3 specific, actionable recommendations to improve their performance.
    Format as JSON array of strings.
  `;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: 'You are a fitness coach providing actionable recommendations.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API request failed');
    }

    const result = await response.json();
    const { recommendations } = JSON.parse(result.choices[0].message.content);
    return recommendations;
  } catch (error) {
    console.error('Error generating recommendations:', error);

    // Fallback recommendations
    return generateFallbackRecommendations(metrics);
  }
}

function generateFallbackSummary(metrics: UserMetrics, period: string): string {
  if (metrics.completionRate >= 80) {
    return `Excellent consistency this ${period}! You completed ${metrics.checkInsCount} check-ins with a ${metrics.streakDays}-day streak.`;
  } else if (metrics.completionRate >= 50) {
    return `Good progress this ${period} with ${metrics.checkInsCount} check-ins. Let's aim for more consistency to maximize results!`;
  } else {
    return `You've made a start this ${period}. Small steps lead to big changes - let's build momentum together!`;
  }
}

function generateFallbackHighlights(metrics: UserMetrics): string[] {
  const highlights = [];

  if (metrics.streakDays >= 7) {
    highlights.push(`${metrics.streakDays}-day streak!`);
  }

  if (metrics.averageSteps >= 10000) {
    highlights.push(`Averaging ${metrics.averageSteps.toLocaleString()} steps daily`);
  }

  if (metrics.weightChange < 0) {
    highlights.push(`Lost ${Math.abs(metrics.weightChange)}kg`);
  }

  if (metrics.completionRate >= 80) {
    highlights.push(`${metrics.completionRate}% completion rate`);
  }

  return highlights.length > 0 ? highlights : ['Keep building consistency'];
}

function generateFallbackRecommendations(metrics: UserMetrics): string[] {
  const recommendations = [];

  if (metrics.completionRate < 70) {
    recommendations.push('Set a daily reminder for check-ins to build consistency');
  }

  if (metrics.averageSteps < 8000) {
    recommendations.push(`Increase daily steps by 1000 - try a 10-minute walk after lunch`);
  }

  if (metrics.averageMinutes < 30) {
    recommendations.push('Aim for 30 minutes of activity daily - start with 15 minutes and build up');
  }

  if (metrics.streakDays < 3) {
    recommendations.push('Focus on building a 3-day streak to create momentum');
  }

  return recommendations.slice(0, 3);
}

function determineTrend(metrics: UserMetrics): 'improving' | 'steady' | 'declining' {
  if (metrics.completionRate >= 80 && metrics.streakDays >= 7) {
    return 'improving';
  } else if (metrics.completionRate < 50 || metrics.streakDays === 0) {
    return 'declining';
  }
  return 'steady';
}

function getRandomMotivationalQuote(): string {
  const quotes = [
    'Every step forward is progress, no matter how small.',
    'Consistency beats perfection every time.',
    'Your only competition is who you were yesterday.',
    'Success is the sum of small efforts repeated daily.',
    'The journey of a thousand miles begins with a single step.',
    'Progress, not perfection.',
    'You are stronger than you think.',
    'Champions are made one day at a time.',
  ];

  return quotes[Math.floor(Math.random() * quotes.length)];
}