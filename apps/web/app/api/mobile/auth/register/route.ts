import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { parseClientPlatform } from '@/lib/experiments/request-info';
import { isRegionRestricted, regionNotAvailableBody } from '@/lib/geo/region-restriction';
import { checkIntegrity, recordSessionAttestation } from '@/lib/integrity/enforcement';
import { enforceAbuseLimits, requestDeviceId } from '@/lib/security/abuse-limits';
import { recordSecurityEvent } from '@/lib/security/security-events';
import {
  createEmailAccount,
  sendSignupConfirmation,
  setEmailCanonical,
  signupRequiresConfirmation,
} from '@/lib/services/email-signup-service';
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
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from '@/lib/validation/disposable-email';
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
    // Shared limits: 3/h + 10/day per IP, 3/day per device (lib/security/abuse-limits.ts).
    const rateLimitResponse = await enforceAbuseLimits(request, 'register');
    if (rateLimitResponse) return rateLimitResponse;
    // Parse and validate request body
    const body = await request.json();
    const validatedData = parseLenient(registerSchema, body);

    if (isDisposableEmail(validatedData.email)) {
      await recordSecurityEvent(request, { kind: 'signup_block', result: 'block', reason: 'disposable_email', action: 'register', deviceId: requestDeviceId(request) });
      return NextResponse.json(
        { error: 'Validation error', message: DISPOSABLE_EMAIL_MESSAGE, code: 'VALIDATION_ERROR', details: [{ reason: 'disposable_email' }] },
        { status: 400 }
      );
    }

    // Android integrity_v1 clients must pass the device check (lib/integrity/enforcement.ts).
    const integrity = await checkIntegrity(request, { action: 'register' });
    if (!integrity.allowed) return integrity.response!;

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

    // Create the account with the Auth admin API (public sign-up can stay off).
    const requireConfirmation = signupRequiresConfirmation();
    const created = await createEmailAccount(supabase, {
      email: validatedData.email,
      password: validatedData.password,
      requireConfirmation,
    });

    if (!created.ok) {
      const { failure } = created;
      return NextResponse.json(
        failure.kind === 'error'
          ? { error: 'Registration failed', message: 'Failed to create user account', code: 'SIGNUP_FAILED' }
          : { error: failure.message, message: failure.message, code: 'SIGNUP_FAILED' },
        { status: failure.kind === 'error' ? 500 : 400 }
      );
    }
    const authData = { user: created.user };

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

    await setEmailCanonical(supabase, authData.user.id, validatedData.email);
    if (requireConfirmation) {
      await sendSignupConfirmation(supabase, { email: validatedData.email, password: validatedData.password, userId: authData.user.id });
    }

    // Generate JWT tokens for mobile
    const tokens = await MobileAPIService.generateTokens(authData.user.id, authData.user.email!);
    await recordSessionAttestation(request, integrity, { userId: authData.user.id, accessToken: tokens.access_token });
    await recordSecurityEvent(request, { kind: 'signup', result: 'pass', action: 'register', reason: 'email', userId: authData.user.id, deviceId: requestDeviceId(request) });

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
