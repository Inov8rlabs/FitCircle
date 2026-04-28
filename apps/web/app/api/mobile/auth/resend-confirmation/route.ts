import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createRateLimiter, getIdentifier, applyRateLimit } from '@/lib/middleware/rate-limit';

const resendConfirmationSchema = z.object({
  email: z.string().email(),
});

const resendRateLimiter = createRateLimiter({
  interval: 15 * 60 * 1000, // 15 minutes
  uniqueTokenPerInterval: 500,
  maxRequests: 3,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = resendConfirmationSchema.parse(body);

    const identifier = getIdentifier(request);
    const rateLimitResponse = await applyRateLimit(request, resendRateLimiter, `resend:${identifier}:${email}`);
    if (rateLimitResponse) return rateLimitResponse;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const redirectUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`
      : undefined;

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: redirectUrl ? { emailRedirectTo: redirectUrl } : undefined,
    });

    if (error) {
      console.error('[Resend Confirmation] Supabase error:', error.message);
    } else {
      console.log('[Resend Confirmation] Confirmation email requested for:', email.replace(/(.{2}).*(@.*)/, '$1***$2'));
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({
      success: true,
      data: {
        message: "If an account with this email exists and isn't confirmed yet, we've sent a new confirmation link.",
      },
      error: null,
      meta: null,
    });
  } catch (error) {
    console.error('[Resend Confirmation] Error:', error);

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
