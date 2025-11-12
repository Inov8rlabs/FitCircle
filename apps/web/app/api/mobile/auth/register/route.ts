import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { registerRateLimiter, getIdentifier, applyRateLimit } from '@/lib/middleware/rate-limit';

// Validation schema
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be less than 30 characters')
    .regex(/^[a-zA-Z0-9_+]+$/, 'Username can only contain letters, numbers, underscores, and plus signs'),
  displayName: z.string().min(1, 'Display name is required'),
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

    // Check if username already exists
    const { data: existingUsername } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', validatedData.username)
      .single();

    if (existingUsername) {
      return NextResponse.json(
        {
          error: 'Username taken',
          message: 'This username is already in use',
          code: 'USERNAME_EXISTS',
        },
        { status: 409 }
      );
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
          message: 'Failed to create account',
        },
        { status: 400 }
      );
    }

    if (!authData.user) {
      return NextResponse.json(
        {
          error: 'Registration failed',
          message: 'Failed to create user account',
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
        username: validatedData.username,
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
        },
        { status: 500 }
      );
    }

    // Generate JWT tokens for mobile
    const tokens = await MobileAPIService.generateTokens(authData.user.id, authData.user.email!);

    // Return mobile-friendly response
    return NextResponse.json(
      {
        success: true,
        user: {
          id: authData.user.id,
          email: authData.user.email,
          ...profile,
        },
        session: tokens,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Mobile register error:', error);

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
