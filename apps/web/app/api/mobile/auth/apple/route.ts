import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { authRateLimiter, getIdentifier, applyRateLimit } from '@/lib/middleware/rate-limit';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { SocialAuthError, findOrCreateSocialUser } from '@/lib/services/social-auth-service';

import { appleTokenAudiences, parseAppleAuthRequest } from './apple-request';
import { toIosAuthUser } from './ios-auth-user';

interface AppleJWTPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: string | boolean;
}

async function verifyAppleIdentityToken(identityToken: string): Promise<AppleJWTPayload | null> {
  try {
    const { createRemoteJWKSet, jwtVerify } = await import('jose');

    const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
    const jwks = createRemoteJWKSet(APPLE_JWKS_URL);

    const { payload } = await jwtVerify(identityToken, jwks, {
      issuer: 'https://appleid.apple.com',
      audience: appleTokenAudiences(),
    });

    return payload as unknown as AppleJWTPayload;
  } catch (error) {
    console.error('[Apple Auth] Token verification failed:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const identifier = getIdentifier(request);
    const rateLimitResponse = await applyRateLimit(request, authRateLimiter, identifier);
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const { identityToken, userIdentifier, email: requestEmail, firstName, lastName } =
      parseAppleAuthRequest(body);

    const appleUser = await verifyAppleIdentityToken(identityToken);

    if (!appleUser || appleUser.sub !== userIdentifier) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_APPLE_TOKEN',
            message: 'Invalid Apple authentication',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    const tokenEmail = typeof appleUser.email === 'string' ? appleUser.email.trim() : '';
    const email = tokenEmail || requestEmail;

    if (!email) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'EMAIL_REQUIRED',
            message: 'Email not provided by Apple',
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
      provider: 'apple',
      providerUserId: userIdentifier,
    });

    const tokens = await MobileAPIService.generateTokens(userId, email);

    console.log('[Apple Auth] Sign-in successful for user:', userId);

    return NextResponse.json({
      success: true,
      data: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: Math.floor(tokens.expires_at - Date.now() / 1000),
        user: toIosAuthUser(profile, userId, email),
        // First sign-in with this Apple ID: clients route to onboarding.
        is_new_user: isNewUser,
      },
      error: null,
      meta: null,
    });
  } catch (error) {
    console.error('[Apple Auth] Error:', error);

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
