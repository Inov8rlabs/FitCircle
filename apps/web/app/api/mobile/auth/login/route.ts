import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { checkIntegrity, recordSessionAttestation, resolveLoginBypass } from '@/lib/integrity/enforcement';
import { enforceAbuseLimits, requestDeviceId } from '@/lib/security/abuse-limits';
import { recordSecurityEvent } from '@/lib/security/security-events';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { toMobileUser } from '@/lib/services/mobile-profile-response';
import { authEmailSchema } from '@/lib/validation/auth-email';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

// Validation schema
const loginSchema = z.object({
  email: authEmailSchema(),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = parseLenient(loginSchema, body);

    // Shared limits: 10 / 15 min per IP, 5 / 15 min per account (canonical email).
    const rateLimitResponse = await enforceAbuseLimits(request, 'login', { email: validatedData.email });
    if (rateLimitResponse) return rateLimitResponse;

    // Android integrity_v1 clients must pass the device check. A failing device is
    // refused whether or not the password is right; only users on
    // integrity_bypass_user_ids or integrity_reviewer_emails get through (resolved after
    // the password check, with the account's own email, never the typed one).
    // A device-environment error (outdated Play Store, ...) is allowed by checkIntegrity.
    const integrity = await checkIntegrity(request, { action: 'login' });
    if (!integrity.allowed && !integrity.bypassEligible) return integrity.response!;

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

    // Blocked device: only a bypass-listed user / reviewer with the right password continues.
    if (!integrity.allowed) {
      const verified = !error && data.user ? data.user : null;
      const bypass = await resolveLoginBypass(request, integrity, { userId: verified?.id ?? null, email: verified?.email ?? null });
      if (!bypass) return integrity.response!;
    }

    if (error || !data.user || !data.session) {
      // Credential-stuffing signal: the account is stored hashed only.
      await recordSecurityEvent(request, {
        kind: 'login_failure',
        result: 'rejected',
        action: 'login',
        reason: error?.message?.toLowerCase().includes('not confirmed') ? 'email_not_confirmed' : 'invalid_credentials',
        email: validatedData.email,
        deviceId: requestDeviceId(request),
      });
    }

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
    await recordSessionAttestation(request, integrity, { userId: data.user.id, accessToken: tokens.access_token });

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
