import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAppleToken } from '@/lib/auth/apple';
import { generateTokens } from '@/lib/auth/jwt';
import { createUser, getUserByEmail } from '@/lib/db/users';
import { logger } from '@/lib/utils/logger';

const appleAuthSchema = z.object({
  identityToken: z.string(),
  authorizationCode: z.string(),
  user: z.object({
    email: z.string().email().optional(),
    name: z.object({
      firstName: z.string(),
      lastName: z.string(),
    }).optional(),
  }).optional(),
  userIdentifier: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { identityToken, authorizationCode, user, userIdentifier } = appleAuthSchema.parse(body);

    // Verify Apple identity token
    const appleUser = await verifyAppleToken(identityToken);
    
    if (!appleUser || appleUser.sub !== userIdentifier) {
      return NextResponse.json(
        { error: 'Invalid Apple authentication' },
        { status: 401 }
      );
    }

    let email = appleUser.email;
    let firstName = '';
    let lastName = '';

    // Apple only provides user details on first sign-in
    if (user) {
      email = user.email || email;
      firstName = user.name?.firstName || '';
      lastName = user.name?.lastName || '';
    }

    if (!email) {
      return NextResponse.json(
        { error: 'Email not provided by Apple' },
        { status: 400 }
      );
    }

    // Check if user exists
    let existingUser = await getUserByEmail(email);

    if (!existingUser) {
      // Create new user with Apple ID
      existingUser = await createUser({
        email,
        firstName,
        lastName,
        appleIdentifier: userIdentifier,
        isEmailVerified: true, // Apple emails are pre-verified
      });
    } else if (!existingUser.appleIdentifier) {
      // Link Apple ID to existing user
      // Update user with Apple identifier
      // This would need a separate update function
    }

    // Generate JWT tokens
    const { accessToken, refreshToken } = await generateTokens({
      userId: existingUser.id,
      email: existingUser.email,
    });

    logger.info('Apple Sign-In successful', { userId: existingUser.id });

    return NextResponse.json({
      success: true,
      user: {
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
      },
      accessToken,
      refreshToken,
    });

  } catch (error) {
    logger.error('Apple Sign-In error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}