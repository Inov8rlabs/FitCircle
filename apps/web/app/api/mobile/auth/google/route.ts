import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { authRateLimiter, getIdentifier, applyRateLimit } from '@/lib/middleware/rate-limit';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { SocialAuthError, findOrCreateSocialUser } from '@/lib/services/social-auth-service';

import { toIosAuthUser } from '../apple/ios-auth-user';

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
    const identifier = getIdentifier(request);
    const rateLimitResponse = await applyRateLimit(request, authRateLimiter, identifier);
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const parsed = googleAuthSchema.parse(body);
    const idToken = parsed.googleIdToken || parsed.idToken!;

    const googleUser = await verifyGoogleIdToken(idToken);

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
      providerUserId: googleUser.sub,
    });

    const tokens = await MobileAPIService.generateTokens(userId, email);

    console.log('[Google Auth] Sign-in successful for user:', userId);

    return NextResponse.json({
      success: true,
      data: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: Math.floor(tokens.expires_at - Date.now() / 1000),
        // Same shape as the Apple route (nested preference defaults filled in).
        user: toIosAuthUser(profile, userId, email),
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
        { status: 500 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
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
