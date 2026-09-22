import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { authRateLimiter, getIdentifier, applyRateLimit } from '@/lib/middleware/rate-limit';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

/** Native Sign in with Apple identity tokens use the iOS bundle id as `aud`. */
export const APPLE_NATIVE_BUNDLE_ID = 'com.inov8rlabs.apps.fitcircle';

const optionalText = z.string().nullish();

const appleAuthSchema = z.object({
  identityToken: optionalText,
  identity_token: optionalText,
  authorizationCode: optionalText,
  authorization_code: optionalText,
  userIdentifier: optionalText,
  user_identifier: optionalText,
  email: optionalText,
  full_name: z
    .object({
      given_name: optionalText,
      family_name: optionalText,
    })
    .nullish(),
  fullName: z
    .object({
      givenName: optionalText,
      familyName: optionalText,
    })
    .nullish(),
  user: z
    .object({
      email: optionalText,
      name: z
        .object({
          firstName: optionalText,
          lastName: optionalText,
        })
        .nullish(),
    })
    .nullish(),
});

export interface AppleAuthRequest {
  identityToken: string;
  userIdentifier: string;
  /** Present only when the client sent one. The identity token's email wins. */
  email?: string;
  firstName: string;
  lastName: string;
}

function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Audiences accepted for an Apple identity token.
 * The native bundle id is always included so a stale Services ID or the
 * pre-migration bundle id in the environment cannot reject the iOS app.
 */
export function appleTokenAudiences(): string[] {
  const configured = [process.env.APPLE_CLIENT_ID, process.env.APPLE_BUNDLE_ID]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set([APPLE_NATIVE_BUNDLE_ID, ...configured]));
}

/** Accept the iOS snake_case body and the older camelCase body. */
export function parseAppleAuthRequest(body: unknown): AppleAuthRequest {
  const parsed = appleAuthSchema.parse(body);
  const identityToken = text(parsed.identity_token) ?? text(parsed.identityToken);
  const userIdentifier = text(parsed.user_identifier) ?? text(parsed.userIdentifier);

  if (!identityToken || !userIdentifier) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: [identityToken ? 'user_identifier' : 'identity_token'],
        message: identityToken ? 'user_identifier is required' : 'identity_token is required',
      },
    ]);
  }

  const email = text(parsed.email) ?? text(parsed.user?.email);
  const firstName =
    text(parsed.full_name?.given_name) ??
    text(parsed.fullName?.givenName) ??
    text(parsed.user?.name?.firstName) ??
    '';
  const lastName =
    text(parsed.full_name?.family_name) ??
    text(parsed.fullName?.familyName) ??
    text(parsed.user?.name?.lastName) ??
    '';

  return {
    identityToken,
    userIdentifier,
    email: email && z.string().email().safeParse(email).success ? email : undefined,
    firstName,
    lastName,
  };
}

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

    // Check if user exists in Supabase Auth
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingAuthUser = existingUsers?.users?.find(u => u.email === email);

    let userId: string;

    if (existingAuthUser) {
      userId = existingAuthUser.id;
    } else {
      // Create user in Supabase Auth with a random password (Apple-only auth)
      const crypto = await import('crypto');
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomBytes(32).toString('hex'),
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
          apple_identifier: userIdentifier,
          provider: 'apple',
        },
      });

      if (createError || !newUser.user) {
        console.error('[Apple Auth] Failed to create user:', createError);
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: 'USER_CREATION_FAILED',
              message: 'Failed to create user account',
              details: {},
              timestamp: new Date().toISOString(),
            },
            meta: null,
          },
          { status: 500 }
        );
      }

      userId = newUser.user.id;

      // Create profile
      await supabase.from('profiles').upsert({
        id: userId,
        email,
        display_name: [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0],
        username: email.split('@')[0],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // Fetch profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    const tokens = await MobileAPIService.generateTokens(userId, email);

    console.log('[Apple Auth] Sign-in successful for user:', userId);

    return NextResponse.json({
      success: true,
      data: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: Math.floor(tokens.expires_at - Date.now() / 1000),
        user: {
          id: userId,
          username: profile?.username || email.split('@')[0],
          display_name: profile?.display_name || email.split('@')[0],
          email,
          avatar_url: profile?.avatar_url || null,
          bio: profile?.bio || null,
          date_of_birth: profile?.date_of_birth || null,
          height_cm: profile?.height_cm || null,
          weight_kg: profile?.weight_kg || null,
          timezone: profile?.timezone || 'UTC',
          fitness_level: profile?.fitness_level || null,
          goals: profile?.goals || [],
          preferences: profile?.preferences || {},
          total_points: profile?.total_points || 0,
          current_streak: profile?.current_streak || 0,
          longest_streak: profile?.longest_streak || 0,
          challenges_completed: profile?.challenges_completed || 0,
          challenges_won: profile?.challenges_won || 0,
          is_active: profile?.is_active !== undefined ? profile.is_active : true,
          last_active_at: profile?.last_active_at || new Date().toISOString(),
          created_at: profile?.created_at || new Date().toISOString(),
          updated_at: profile?.updated_at || new Date().toISOString(),
        },
      },
      error: null,
      meta: null,
    });
  } catch (error) {
    console.error('[Apple Auth] Error:', error);

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
