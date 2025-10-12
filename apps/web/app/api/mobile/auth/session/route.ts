import { NextRequest, NextResponse } from 'next/server';
import { verifyMobileAuth } from '@/lib/middleware/mobile-auth';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    // Verify Bearer token
    const user = await verifyMobileAuth(request);

    if (!user) {
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

    // Fetch full user profile from database
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

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('Error fetching profile:', profileError);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'PROFILE_NOT_FOUND',
            message: 'User profile not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    // Transform goals from database format to iOS format
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

    // Transform preferences to match iOS structure
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

    // Return full user profile matching login endpoint format
    const responsePayload = {
      success: true,
      data: {
        id: profile.id,
        username: profile.username || user.email?.split('@')[0] || 'user',
        display_name: profile.display_name || profile.username || 'User',
        email: user.email!,
        avatar_url: profile.avatar_url || null,
        bio: profile.bio || null,
        date_of_birth: formatDateForIOS(profile.date_of_birth),
        height_cm: profile.height_cm || null,
        weight_kg: profile.weight_kg || null,
        timezone: profile.timezone || 'UTC',
        fitness_level: profile.fitness_level || null,
        goals: transformedGoals,
        preferences: transformedPreferences,
        total_points: profile.total_points || 0,
        current_streak: profile.current_streak || 0,
        longest_streak: profile.longest_streak || 0,
        challenges_completed: profile.challenges_completed || 0,
        challenges_won: profile.challenges_won || 0,
        is_active: profile.is_active !== undefined ? profile.is_active : true,
        last_active_at: formatDateForIOS(profile.last_active_at) || new Date().toISOString(),
        created_at: formatDateForIOS(profile.created_at) || new Date().toISOString(),
        updated_at: formatDateForIOS(profile.updated_at) || new Date().toISOString(),
      },
      error: null,
      meta: null,
    };

    // Add cache headers (5 minutes cache for session data)
    const response = NextResponse.json(responsePayload);
    response.headers.set('Cache-Control', 'private, max-age=300');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Session error:', {
      message: error?.message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
