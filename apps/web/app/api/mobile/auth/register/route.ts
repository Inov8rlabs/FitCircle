import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { parseClientPlatform } from '@/lib/experiments/request-info';
import { isRegionRestricted, regionNotAvailableBody } from '@/lib/geo/region-restriction';
import { registerRateLimiter, getIdentifier, applyRateLimit } from '@/lib/middleware/rate-limit';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { toMobileUser } from '@/lib/services/mobile-profile-response';
import { isTestDeviceRequest, recordTestDeviceSignal } from '@/lib/services/test-device-service';
import {
  USERNAME_PATTERN,
  USERNAME_RULES_MESSAGE,
  deriveUsernameBase,
  ensureUniqueUsername,
} from '@/lib/services/username-service';
import { triggerWelcomeEmail } from '@/lib/services/welcome-email-service';
import { authEmailSchema } from '@/lib/validation/auth-email';
import { coerceDisplayName } from '@/lib/validation/display-name';
import { parseLenient } from '@/lib/validation/lenient-parse';

// Validation schema
const registerSchema = z.object({
  email: authEmailSchema(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // Optional: clients that don't collect a username (iOS) omit it and the
  // server derives a valid, unique one from the email. When provided it must
  // satisfy the shared rule in username-service.ts.
  username: z.string().trim().regex(USERNAME_PATTERN, USERNAME_RULES_MESSAGE).optional(),
  displayName: z.string().trim().min(1, 'Display name is required'),
});

export async function POST(request: NextRequest) {
  // EU/EEA: no new accounts (WEB_EU_SIGNUP_BLOCK, default on; lib/geo/region-restriction.ts).
  if (isRegionRestricted(request)) return NextResponse.json(regionNotAvailableBody(), { status: 403 });
  try {
    // Apply rate limiting (3 registrations per day per IP)
    const identifier = getIdentifier(request);
    const rateLimitResponse = await applyRateLimit(request, registerRateLimiter, identifier);
    if (rateLimitResponse) return rateLimitResponse;
    // Parse and validate request body
    const body = await request.json();
    const validatedData = parseLenient(registerSchema, body);

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
        display_name: coerceDisplayName(validatedData.displayName, username),
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

    // Firebase Test Lab / Play pre-launch robots send X-Test-Device: 1 (excluded from lifecycle nudges).
    await recordTestDeviceSignal(authData.user.id, request.headers);

    // Generate JWT tokens for mobile
    const tokens = await MobileAPIService.generateTokens(authData.user.id, authData.user.email!);

    // New account: one welcome email, after the response (never fails registration).
    triggerWelcomeEmail({
      userId: authData.user.id,
      email: authData.user.email ?? validatedData.email,
      displayName: profile?.display_name ?? validatedData.displayName,
      method: 'email',
      platform: parseClientPlatform(request.headers.get('x-app-platform')),
      testDevice: isTestDeviceRequest(request.headers),
    });

    // Return mobile-friendly response matching login format
    return NextResponse.json(
      {
        success: true,
        data: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: Math.floor((tokens.expires_at - Date.now() / 1000)),
          user: toMobileUser(profile, { id: authData.user.id, email: authData.user.email }),
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
