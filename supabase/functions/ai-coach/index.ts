import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CoachRequest {
  userId: string;
  message: string;
  context?: {
    challengeId?: string;
    teamId?: string;
    conversationId?: string;
  };
  stream?: boolean;
}

interface UserContext {
  profile: any;
  recentCheckIns: any[];
  currentChallenges: any[];
  achievements: any[];
  metrics: {
    currentWeight?: number;
    weightChange?: number;
    averageSteps?: number;
    currentStreak?: number;
    completionRate?: number;
  };
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

    const request: CoachRequest = await req.json();

    if (!request.userId || !request.message) {
      throw new Error('userId and message are required');
    }

    // Get user context for personalized coaching
    const userContext = await getUserContext(supabase, request.userId, request.context?.challengeId);

    // Get conversation history if conversationId provided
    let conversationHistory: any[] = [];
    if (request.context?.conversationId) {
      const { data: messages } = await supabase
        .from('ai_conversations')
        .select('role, content')
        .eq('conversation_id', request.context.conversationId)
        .eq('user_id', request.userId)
        .order('created_at', { ascending: true })
        .limit(10);

      conversationHistory = messages || [];
    }

    // Build the AI prompt with context
    const systemPrompt = buildSystemPrompt(userContext);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: request.message },
    ];

    // Generate AI response
    if (request.stream) {
      // Return streaming response
      const stream = await createStream(messages, openAiKey);

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // Return complete response
      const response = await generateResponse(messages, openAiKey);

      // Store conversation
      const conversationId = request.context?.conversationId || crypto.randomUUID();
      await storeConversation(supabase, {
        conversationId,
        userId: request.userId,
        userMessage: request.message,
        aiResponse: response,
        context: request.context,
      });

      // Check for actionable items in response
      const actions = extractActions(response);
      if (actions.length > 0) {
        await processActions(supabase, request.userId, actions);
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            message: response,
            conversationId,
            actions,
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }
  } catch (error) {
    console.error('Error in AI coach:', error);
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

async function getUserContext(
  supabase: any,
  userId: string,
  challengeId?: string
): Promise<UserContext> {
  // Get user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  // Get recent check-ins (last 7 days)
  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('*')
    .eq('user_id', userId)
    .gte('check_in_date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('check_in_date', { ascending: false })
    .limit(7);

  // Get current challenges
  const { data: challenges } = await supabase
    .from('challenge_participants')
    .select(`
      challenge_id,
      total_points,
      streak_days,
      rank,
      challenges (
        name,
        type,
        end_date
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'active');

  // Get recent achievements
  const { data: achievements } = await supabase
    .from('achievements')
    .select('*')
    .eq('user_id', userId)
    .order('unlocked_at', { ascending: false })
    .limit(5);

  // Calculate metrics
  const metrics: UserContext['metrics'] = {};

  if (checkIns && checkIns.length > 0) {
    const weights = checkIns.filter(c => c.weight_kg).map(c => c.weight_kg);
    if (weights.length > 0) {
      metrics.currentWeight = weights[0];
      if (weights.length > 1) {
        metrics.weightChange = weights[0] - weights[weights.length - 1];
      }
    }

    const steps = checkIns.filter(c => c.steps).map(c => c.steps);
    if (steps.length > 0) {
      metrics.averageSteps = Math.round(steps.reduce((a, b) => a + b, 0) / steps.length);
    }

    metrics.completionRate = (checkIns.length / 7) * 100;
  }

  if (challenges && challenges.length > 0) {
    const activeChallenge = challengeId
      ? challenges.find(c => c.challenge_id === challengeId)
      : challenges[0];

    if (activeChallenge) {
      metrics.currentStreak = activeChallenge.streak_days;
    }
  }

  return {
    profile,
    recentCheckIns: checkIns || [],
    currentChallenges: challenges || [],
    achievements: achievements || [],
    metrics,
  };
}

function buildSystemPrompt(context: UserContext): string {
  const { profile, metrics, currentChallenges } = context;

  return `You are Fitzy, an enthusiastic and knowledgeable AI fitness coach for FitCircle.
Your personality is supportive, motivating, and science-based, with a touch of friendly humor.

User Profile:
- Name: ${profile.display_name}
- Fitness Level: ${profile.fitness_level || 'Not specified'}
- Goals: ${JSON.stringify(profile.goals || [])}
- Current Weight: ${metrics.currentWeight ? `${metrics.currentWeight}kg` : 'Not tracked'}
- Recent Weight Change: ${metrics.weightChange ? `${metrics.weightChange > 0 ? '+' : ''}${metrics.weightChange}kg` : 'No data'}
- Average Daily Steps: ${metrics.averageSteps || 'Not tracked'}
- Current Streak: ${metrics.currentStreak || 0} days
- Check-in Consistency: ${metrics.completionRate ? `${Math.round(metrics.completionRate)}%` : 'No data'}

Active Challenges: ${currentChallenges.length}
${currentChallenges.map(c => `- ${c.challenges.name} (Rank #${c.rank || 'N/A'})`).join('\n')}

Recent Achievements: ${context.achievements.length}
${context.achievements.slice(0, 3).map(a => `- ${a.name}`).join('\n')}

Guidelines:
1. Be encouraging and positive, but also honest and constructive
2. Provide specific, actionable advice based on the user's data
3. Reference their progress and achievements when relevant
4. Keep responses concise (2-3 paragraphs max unless asked for details)
5. Use data to personalize recommendations
6. Suggest specific exercises, nutrition tips, or habit changes
7. If the user is struggling, be extra supportive and offer smaller, achievable goals
8. Use emojis sparingly for emphasis (max 2-3 per response)
9. Never provide medical advice - suggest consulting healthcare providers for medical concerns
10. Encourage community engagement and team participation when appropriate

Remember: You're not just providing information, you're being a supportive coach who cares about the user's success.`;
}

async function generateResponse(messages: any[], openAiKey: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4-turbo-preview',
      messages,
      temperature: 0.8,
      max_tokens: 500,
      presence_penalty: 0.1,
      frequency_penalty: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error('OpenAI API request failed');
  }

  const result = await response.json();
  return result.choices[0].message.content;
}

async function createStream(messages: any[], openAiKey: string): Promise<ReadableStream> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4-turbo-preview',
      messages,
      temperature: 0.8,
      max_tokens: 500,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error('OpenAI API request failed');
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader();
      if (!reader) return;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices[0]?.delta?.content || '';
                if (content) {
                  const event = `data: ${JSON.stringify({ content })}\n\n`;
                  controller.enqueue(encoder.encode(event));
                }
              } catch (e) {
                console.error('Error parsing stream data:', e);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

async function storeConversation(
  supabase: any,
  params: {
    conversationId: string;
    userId: string;
    userMessage: string;
    aiResponse: string;
    context?: any;
  }
): Promise<void> {
  try {
    // Store user message
    await supabase.from('ai_conversations').insert({
      conversation_id: params.conversationId,
      user_id: params.userId,
      role: 'user',
      content: params.userMessage,
      context: params.context,
    });

    // Store AI response
    await supabase.from('ai_conversations').insert({
      conversation_id: params.conversationId,
      user_id: params.userId,
      role: 'assistant',
      content: params.aiResponse,
      context: params.context,
    });
  } catch (error) {
    console.error('Error storing conversation:', error);
  }
}

function extractActions(response: string): string[] {
  const actions: string[] = [];

  // Look for common action patterns in the response
  const actionPatterns = [
    /set a goal to (.+)/gi,
    /try to (.+)/gi,
    /aim for (.+)/gi,
    /schedule (.+)/gi,
    /add (.+) to your routine/gi,
    /increase your (.+)/gi,
    /decrease your (.+)/gi,
  ];

  for (const pattern of actionPatterns) {
    const matches = response.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        actions.push(match[1].trim());
      }
    }
  }

  return actions.slice(0, 3); // Limit to 3 actions
}

async function processActions(
  supabase: any,
  userId: string,
  actions: string[]
): Promise<void> {
  try {
    // Store suggested actions for user to review
    const actionItems = actions.map(action => ({
      user_id: userId,
      action_type: 'ai_suggestion',
      description: action,
      status: 'pending',
      created_by: 'ai_coach',
    }));

    await supabase.from('user_actions').insert(actionItems);
  } catch (error) {
    console.error('Error processing actions:', error);
  }
}