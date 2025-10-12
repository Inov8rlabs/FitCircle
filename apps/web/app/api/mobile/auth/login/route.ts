import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

// Validation schema
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = loginSchema.parse(body);

    // Create Supabase client
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

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email: validatedData.email,
      password: validatedData.password,
    });

    if (error) {
      return NextResponse.json({
        success: false,
        data: null,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: error.message,
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      }, { status: 401 });
    }

    if (!data.user || !data.session) {
      return NextResponse.json({
        success: false,
        data: null,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      }, { status: 401 });
    }

    // Fetch user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    // Generate JWT tokens for mobile
    const tokens = await MobileAPIService.generateTokens(data.user.id, data.user.email!);

    console.log('🔐 [LOGIN] Generating response for user:', data.user.id);
    console.log('📊 [LOGIN] Profile data:', JSON.stringify(profile, null, 2));

    // Transform goals from database format to iOS format
    // iOS expects array of Goal objects with type, targetWeightKg, startingWeightKg, dailyStepsTarget
    // Filter out string goals and only keep valid Goal objects
    const transformedGoals = Array.isArray(profile?.goals)
      ? profile.goals
          .filter((goal: any) => typeof goal === 'object' && goal !== null)
          .filter((goal: any) => ['weight', 'steps', 'workout_minutes'].includes(goal.type))
          .map((goal: any) => ({
            type: goal.type,
            target_weight_kg: goal.target_weight_kg || goal.targetWeightKg || null,
            starting_weight_kg: goal.starting_weight_kg || goal.startingWeightKg || null,
            daily_steps_target: goal.daily_steps_target || goal.dailyStepsTarget || null,
          }))
      : [];

    console.log('🎯 [LOGIN] Transformed goals:', JSON.stringify(transformedGoals, null, 2));

    // Transform preferences to match iOS structure
    // iOS expects: {notifications: {...}, privacy: {...}, display: {...}}
    const dbPreferences = profile?.preferences || {};
    const transformedPreferences = {
      notifications: {
        push: dbPreferences.notifications?.push ?? true,
        email: dbPreferences.notifications?.email ?? true,
        sms: dbPreferences.notifications?.sms ?? false,
        challenge_invite: dbPreferences.notifications?.challenge_invite ?? true,
        team_invite: dbPreferences.notifications?.team_invite ?? true,
        check_in_reminder: dbPreferences.notifications?.check_in_reminder ?? true,
        achievement: dbPreferences.notifications?.achievement ?? true,
        comment: dbPreferences.notifications?.comment ?? true,
        reaction: dbPreferences.notifications?.reaction ?? true,
        leaderboard_update: dbPreferences.notifications?.leaderboard_update ?? true,
        weekly_insights: dbPreferences.notifications?.weekly_insights ?? true,
      },
      privacy: {
        profile_visibility: dbPreferences.privacy?.profile_visibility || dbPreferences.privacy?.profileVisibility || 'public',
        show_weight: dbPreferences.privacy?.show_weight ?? true,
        show_progress: dbPreferences.privacy?.show_progress ?? true,
        allow_team_invites: dbPreferences.privacy?.allow_team_invites ?? true,
        allow_challenge_invites: dbPreferences.privacy?.allow_challenge_invites ?? true,
      },
      display: {
        theme: dbPreferences.display?.theme || 'dark',
        language: dbPreferences.display?.language || 'en',
        units: dbPreferences.unitSystem || dbPreferences.display?.units || 'metric',
      },
    };

    console.log('⚙️ [LOGIN] Transformed preferences:', JSON.stringify(transformedPreferences, null, 2));

    // Helper function to format dates for iOS (ISO8601 compatible)
    const formatDateForIOS = (dateValue: string | Date | null | undefined): string | null => {
      if (!dateValue) return null;

      try {
        const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;

        // Check if valid date
        if (isNaN(date.getTime())) return null;

        // Return ISO8601 string without microseconds (only milliseconds)
        // Format: 2023-01-15T14:30:00.123Z
        return date.toISOString();
      } catch (error) {
        console.error('Error formatting date:', dateValue, error);
        return null;
      }
    };

    // Return mobile-friendly response matching iOS APIResponse<AuthResponse> format
    const responsePayload = {
      success: true,
      data: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: Math.floor((tokens.expires_at - Date.now() / 1000)),
        user: {
          id: data.user.id,
          username: profile?.username || data.user.email?.split('@')[0] || 'user',
          display_name: profile?.display_name || profile?.username || 'User',
          email: data.user.email!,
          avatar_url: profile?.avatar_url || null,
          bio: profile?.bio || null,
          date_of_birth: formatDateForIOS(profile?.date_of_birth),
          height_cm: profile?.height_cm || null,
          weight_kg: profile?.weight_kg || null,
          timezone: profile?.timezone || 'UTC',
          fitness_level: profile?.fitness_level || null,
          goals: transformedGoals,
          preferences: transformedPreferences,
          total_points: profile?.total_points || 0,
          current_streak: profile?.current_streak || 0,
          longest_streak: profile?.longest_streak || 0,
          challenges_completed: profile?.challenges_completed || 0,
          challenges_won: profile?.challenges_won || 0,
          is_active: profile?.is_active !== undefined ? profile.is_active : true,
          last_active_at: formatDateForIOS(profile?.last_active_at) || new Date().toISOString(),
          created_at: formatDateForIOS(profile?.created_at) || formatDateForIOS(data.user.created_at) || new Date().toISOString(),
          updated_at: formatDateForIOS(profile?.updated_at) || new Date().toISOString(),
        },
      },
      error: null,
      meta: null,
    };

    console.log('✅ [LOGIN] Sending response:', JSON.stringify(responsePayload, null, 2));

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Mobile login error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation error',
          message: 'Invalid input data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
