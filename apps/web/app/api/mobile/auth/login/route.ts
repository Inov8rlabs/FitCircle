import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { authRateLimiter, getIdentifier, applyRateLimit } from '@/lib/middleware/rate-limit';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { toMobileUser } from '@/lib/services/mobile-profile-response';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

// Validation schema
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting (5 attempts per 15 minutes per IP)
    const identifier = getIdentifier(request);
    const rateLimitResponse = await applyRateLimit(request, authRateLimiter, identifier);
    if (rateLimitResponse) return rateLimitResponse;
    // Parse and validate request body
    const body = await request.json();
    const validatedData = parseLenient(loginSchema, body);

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
      // Distinguish unconfirmed-email from generic invalid-credentials so clients
      // can offer a "Resend confirmation" action. Don't reveal whether the email
      // exists for the wrong-password case.
      const lower = error.message.toLowerCase();
      const isEmailNotConfirmed =
        lower.includes('email not confirmed') || lower.includes('not confirmed');

      return NextResponse.json({
        success: false,
        data: null,
        error: isEmailNotConfirmed
          ? {
              code: 'EMAIL_NOT_CONFIRMED',
              message: "We need to verify your email before you can sign in. Check your inbox for a confirmation link from FitCircle.",
              details: {},
              timestamp: new Date().toISOString(),
            }
          : {
              code: 'INVALID_CREDENTIALS',
              message: "The email or password you entered is incorrect. Try again, or reset your password if you've forgotten it.",
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
          message: "The email or password you entered is incorrect. Try again, or reset your password if you've forgotten it.",
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

    // Return mobile-friendly response matching iOS APIResponse<AuthResponse> format
    const responsePayload = {
      success: true,
      data: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: Math.floor((tokens.expires_at - Date.now() / 1000)),
        user: toMobileUser(profile, { id: data.user.id, email: data.user.email }),
      },
      error: null,
      meta: null,
    };

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Mobile login error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation error',
          message: validationMessage(error),
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
