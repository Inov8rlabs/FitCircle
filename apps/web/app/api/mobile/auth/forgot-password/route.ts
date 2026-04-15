import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createRateLimiter, getIdentifier, applyRateLimit } from '@/lib/middleware/rate-limit';

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const forgotPasswordRateLimiter = createRateLimiter({
  interval: 15 * 60 * 1000, // 15 minutes
  uniqueTokenPerInterval: 500,
  maxRequests: 3,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);

    const identifier = getIdentifier(request);
    const rateLimitResponse = await applyRateLimit(request, forgotPasswordRateLimiter, `forgot:${identifier}:${email}`);
    if (rateLimitResponse) return rateLimitResponse;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Supabase handles token generation, storage, and email delivery.
    // It returns success even if the email doesn't exist (prevents enumeration).
    const redirectUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`
      : undefined;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });

    if (error) {
      console.error('[Forgot Password] Supabase error:', error.message);
    } else {
      console.log('[Forgot Password] Reset email requested for:', email.replace(/(.{2}).*(@.*)/, '$1***$2'));
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({
      success: true,
      data: {
        message: 'If an account with this email exists, a password reset link has been sent.',
      },
      error: null,
      meta: null,
    });
  } catch (error) {
    console.error('[Forgot Password] Error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid email address',
            details: error.errors,
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Unable to process request',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
