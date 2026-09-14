import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { registerRateLimiter, getIdentifier, applyRateLimit } from '@/lib/middleware/rate-limit';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import {
  USERNAME_PATTERN,
  USERNAME_RULES_MESSAGE,
  deriveUsernameBase,
  ensureUniqueUsername,
} from '@/lib/services/username-service';

// Validation schema
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // Optional: clients that don't collect a username (iOS) omit it and the
  // server derives a valid, unique one from the email. When provided it must
  // satisfy the shared rule in username-service.ts.
  username: z.string().trim().regex(USERNAME_PATTERN, USERNAME_RULES_MESSAGE).optional(),
  displayName: z.string().trim().min(1, 'Display name is required'),
});

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting (3 registrations per day per IP)
    const identifier = getIdentifier(request);
    const rateLimitResponse = await applyRateLimit(request, registerRateLimiter, identifier);
    if (rateLimitResponse) return rateLimitResponse;
    // Parse and validate request body
    const body = await request.json();
    const validatedData = registerSchema.parse(body);

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

    // Resolve the username: honour an explicitly chosen one (409 if taken),
    // otherwise derive a unique one from the email.
    const usernameTaken = async (candidate: string): Promise<boolean> => {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', candidate)
        .limit(1)
        .maybeSingle();
      return !!data;
    };

    let username: string;
    if (validatedData.username) {
      if (await usernameTaken(validatedData.username)) {
        return NextResponse.json(
          {
            error: 'Username taken',
            message: 'This username is already in use',
            code: 'USERNAME_EXISTS',
          },
          { status: 409 }
        );
      }
      username = validatedData.username;
    } else {
      username = await ensureUniqueUsername(deriveUsernameBase(validatedData.email), usernameTaken);
    }

    // Sign up with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: validatedData.email,
      password: validatedData.password,
    });

    if (authError) {
      return NextResponse.json(
        {
          error: authError.message,
          message: authError.message || 'Failed to create account',
          code: 'SIGNUP_FAILED',
        },
        { status: 400 }
      );
    }

    if (!authData.user) {
      return NextResponse.json(
        {
          error: 'Registration failed',
          message: 'Failed to create user account',
          code: 'SIGNUP_FAILED',
        },
        { status: 500 }
      );
    }

    // Create profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        email: validatedData.email,
        username,
        display_name: validatedData.displayName,
        onboarding_completed: false,
      })
      .select()
      .single();

    if (profileError) {
      // Clean up auth user if profile creation fails
      await supabase.auth.admin.deleteUser(authData.user.id);

      return NextResponse.json(
        {
          error: 'Profile creation failed',
          message: profileError.message,
          code: 'PROFILE_CREATE_FAILED',
        },
        { status: 500 }
      );
    }

    // Generate JWT tokens for mobile
    const tokens = await MobileAPIService.generateTokens(authData.user.id, authData.user.email!);

    // Transform preferences to match iOS structure (same as login endpoint)
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
        profile_visibility: dbPreferences.privacy?.profile_visibility || 'public',
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

    // Return mobile-friendly response matching login format
    return NextResponse.json(
      {
        success: true,
        data: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: Math.floor((tokens.expires_at - Date.now() / 1000)),
          user: {
            id: authData.user.id,
            email: authData.user.email,
            ...profile,
            preferences: transformedPreferences,
          },
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Mobile register error:', error);

    if (error instanceof z.ZodError) {
      const first = error.errors[0];
      return NextResponse.json(
        {
          error: 'Validation error',
          message: first?.message ?? 'Invalid input data',
          code: 'VALIDATION_ERROR',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'An unexpected error occurred',
        code: 'INTERNAL_SERVER_ERROR',
      },
      { status: 500 }
    );
  }
}
