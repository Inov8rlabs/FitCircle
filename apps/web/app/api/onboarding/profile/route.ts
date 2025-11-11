import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { UpdateProfileSchema } from '@/lib/types/onboarding';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { z } from 'zod';

/**
 * GET /api/onboarding/profile
 * Get current user's profile (for resuming onboarding)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const profile = await MobileAPIService.getUserProfileWithStats(user.id);

    return NextResponse.json({
      success: true,
      data: { profile },
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    console.error('[Onboarding API] Get profile error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get profile',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/onboarding/profile
 * Create/update user profile during onboarding
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const body = await request.json();
    const validatedData = UpdateProfileSchema.parse(body);

    // Build update object
    const updates: any = {};

    if (validatedData.displayName !== undefined) {
      updates.display_name = validatedData.displayName;
    }

    if (validatedData.username !== undefined) {
      updates.username = validatedData.username;
    }

    if (validatedData.avatarUrl !== undefined) {
      updates.avatar_url = validatedData.avatarUrl;
    }

    if (validatedData.bio !== undefined) {
      updates.bio = validatedData.bio;
    }

    if (validatedData.persona !== undefined) {
      updates.persona = validatedData.persona;
    }

    if (validatedData.fitnessLevel !== undefined) {
      updates.fitness_level = validatedData.fitnessLevel;
    }

    if (validatedData.timeCommitment !== undefined) {
      updates.time_commitment = validatedData.timeCommitment;
    }

    // Update profile
    const updatedProfile = await MobileAPIService.updateUserProfile(user.id, updates);

    return NextResponse.json({
      success: true,
      data: { profile: updatedProfile },
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    console.error('[Onboarding API] Update profile error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors.reduce((acc: any, err) => {
              acc[err.path.join('.')] = err.message;
              return acc;
            }, {}),
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // Check for unique constraint violation
    if (error.code === '23505') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'USERNAME_TAKEN',
            message: 'This username is already in use',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update profile',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
