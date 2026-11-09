import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { parseClientPlatform } from '@/lib/experiments/request-info';
import { isRegionRestricted } from '@/lib/geo/region-restriction';
import { checkIntegrity, recordSessionAttestation, resolveBypass } from '@/lib/integrity/enforcement';
import { enforceAbuseLimits, requestDeviceId } from '@/lib/security/abuse-limits';
import { recordSecurityEvent } from '@/lib/security/security-events';
import { setEmailCanonical } from '@/lib/services/email-signup-service';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { toMobileUser } from '@/lib/services/mobile-profile-response';
import { SocialAuthError, findOrCreateSocialUser } from '@/lib/services/social-auth-service';
import { isTestDeviceRequest, recordTestDeviceSignal } from '@/lib/services/test-device-service';
import { triggerWelcomeEmail } from '@/lib/services/welcome-email-service';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';


const googleAuthSchema = z
  .object({
    googleIdToken: z.string().optional(),
    idToken: z.string().optional(),
  })
  .refine((data) => Boolean(data.googleIdToken || data.idToken), {
    message: 'googleIdToken is required',
    path: ['googleIdToken'],
  });

interface GoogleJWTPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: string | boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
}

/** Google asserts the mailbox is the account's (boolean, or the string "true" in older tokens). */
function isGoogleEmailVerified(payload: GoogleJWTPayload): boolean {
  return payload.email_verified === true || payload.email_verified === 'true';
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleJWTPayload | null> {
  try {
    const { createRemoteJWKSet, jwtVerify } = await import('jose');

    const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
    const jwks = createRemoteJWKSet(GOOGLE_JWKS_URL);

    // A Google ID token's `aud` is the OAuth client ID that requested it, which differs
    // per platform (iOS client id vs the Web/server client id Android uses as its
    // serverClientId). Accept a comma-separated allowlist so one backend serves all
    // platforms. jose verifies the token's aud against any entry in the array.
    const audiences = (process.env.GOOGLE_CLIENT_ID ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (audiences.length === 0) {
      console.warn('[Google Auth] GOOGLE_CLIENT_ID not configured, skipping audience check');
    }

    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      ...(audiences.length > 0 ? { audience: audiences } : {}),
    });

    return payload as unknown as GoogleJWTPayload;
  } catch (error) {
    console.error('[Google Auth] Token verification failed:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceAbuseLimits(request, 'social_login');
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const parsed = parseLenient(googleAuthSchema, body);
    const idToken = parsed.googleIdToken || parsed.idToken!;

    // Android integrity_v1 clients must pass the device check (sign-in and first sign-up).
    // A failing device is refused whether or not the Google token is valid; only an email
    // on integrity_reviewer_emails gets through, and only from a token that verifies with
    // email_verified (resolved before any account is created).
    const integrity = await checkIntegrity(request, { action: 'google' });
    if (!integrity.allowed && !integrity.bypassEligible) return integrity.response!;

    const googleUser = await verifyGoogleIdToken(idToken);

    if (!integrity.allowed) {
      const verifiedEmail = googleUser?.sub && isGoogleEmailVerified(googleUser) ? (googleUser.email ?? null) : null;
      if (!(await resolveBypass(request, integrity, { email: verifiedEmail }, 'google'))) return integrity.response!;
    }

    if (!googleUser || !googleUser.sub) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_GOOGLE_TOKEN',
            message: 'Invalid Google authentication',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    const email = googleUser.email;
    const firstName = googleUser.given_name || '';
    const lastName = googleUser.family_name || '';

    if (!email) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'EMAIL_REQUIRED',
            message: 'Email not provided by Google',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { userId, profile, isNewUser } = await findOrCreateSocialUser(supabase, {
      email,
      firstName,
      lastName,
      provider: 'google',
      // EU/EEA: existing accounts sign in; no new ones (WEB_EU_SIGNUP_BLOCK, lib/geo/region-restriction.ts).
      blockNewAccount: isRegionRestricted(request),
      providerUserId: googleUser.sub,
    });

    await recordTestDeviceSignal(userId, request.headers); // X-Test-Device: 1 (Test Lab robots)
    const tokens = await MobileAPIService.generateTokens(userId, email);
    await recordSessionAttestation(request, integrity, { userId, accessToken: tokens.access_token });
    if (isNewUser) {
      await setEmailCanonical(supabase, userId, email);
      await recordSecurityEvent(request, { kind: 'signup', result: 'pass', action: 'google', reason: 'google', userId, deviceId: requestDeviceId(request) });
    }

    // First sign-in created the account: one welcome email after the response.
    // Returning sign-ins (isNewUser false) never get one; the once-only record in
    // profiles.metadata also stops a second one for a web-then-mobile sign-up.
    if (isNewUser) {
      triggerWelcomeEmail({
        userId,
        email,
        displayName: (profile as { display_name?: string | null } | null)?.display_name ?? null,
        method: 'google',
        platform: parseClientPlatform(request.headers.get('x-app-platform')),
        testDevice: isTestDeviceRequest(request.headers),
      });
    }

    console.log('[Google Auth] Sign-in successful for user:', userId);

    return NextResponse.json({
      success: true,
      data: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: Math.floor(tokens.expires_at - Date.now() / 1000),
        // Same shape as the Apple route (nested preference defaults filled in).
        user: toMobileUser(profile, { id: userId, email }),
        // First sign-in with this Google account: clients route to onboarding.
        is_new_user: isNewUser,
      },
      error: null,
      meta: null,
    });
  } catch (error) {
    console.error('[Google Auth] Error:', error);

    if (error instanceof SocialAuthError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: error.code, message: error.message, details: {}, timestamp: new Date().toISOString() },
          meta: null,
        },
        { status: error.code === 'REGION_NOT_AVAILABLE' ? 403 : 500 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: validationMessage(error),
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
          code: 'AUTH_FAILED',
          message: 'Authentication failed',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
