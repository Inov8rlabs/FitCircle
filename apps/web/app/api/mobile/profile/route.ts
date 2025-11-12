import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

// Validation schema for PUT
const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
    .optional(),
  avatarUrl: z.string().url().optional(),
  bio: z.string().max(500).optional(),
});

/**
 * GET /api/mobile/profile
 * Get user profile with stats and goals
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Get profile with stats
    const profile = await MobileAPIService.getUserProfileWithStats(user.id);

    const response = NextResponse.json({
      success: true,
      data: {
        user: profile,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });

    // Add cache headers (5 minutes cache for profile data)
    response.headers.set('Cache-Control', 'private, max-age=300');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Get profile error:', {
      userId: error.userId,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

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
          message: 'An unexpected error occurred',
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
 * PUT /api/mobile/profile
 * Update user profile
 */
export async function PUT(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse and validate request body
    const body = await request.json();
    const validatedData = updateProfileSchema.parse(body);

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

    // Update profile
    const updatedProfile = await MobileAPIService.updateUserProfile(user.id, updates);

    return NextResponse.json({
      success: true,
      data: {
        user: updatedProfile,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Update profile error:', {
      userId: error.userId,
      message: error.message,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

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

    // Check for unique constraint violation (username already taken)
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
          message: 'An unexpected error occurred',
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
 * DELETE /api/mobile/profile
 * Delete user account and all associated data
 *
 * IMPORTANT: This is a permanent, irreversible operation required for App Store compliance.
 * Uses the comprehensive AccountDeletionService which:
 * - Deletes all user personal data
 * - Preserves FitCircles with other members (transfers ownership)
 * - Removes user participation from shared challenges
 * - Deletes all posts, comments, and activities
 * - Recalculates leaderboards for affected challenges
 * - Maintains data integrity for other users
 */
export async function DELETE(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const userId = user.id;

    console.log(`🗑️ [Mobile API] ACCOUNT DELETION requested for user: ${userId}`);
    console.log(`⚠️  [Mobile API] This is a permanent, irreversible operation`);

    // Use the comprehensive AccountDeletionService
    const { AccountDeletionService } = await import('@/lib/services/account-deletion-service');

    const result = await AccountDeletionService.deleteAccount(userId, {
      userEmail: user.email,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    });

    console.log(`✅ [Mobile API] Account deletion completed successfully`);
    console.log(`📊 [Mobile API] Deletion summary:`, {
      challenges_transferred: result.challenges_transferred,
      challenges_deleted: result.challenges_deleted,
      data_deleted: result.data_summary,
    });

    return NextResponse.json({
      success: true,
      data: {
        message: 'Account and all associated data deleted successfully',
        deletedAt: result.deleted_at,
        summary: {
          challengesTransferred: result.challenges_transferred,
          challengesDeleted: result.challenges_deleted,
          dataDeleted: result.data_summary,
        },
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Account deletion FAILED:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

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
          message: 'Failed to delete account',
          details: { error: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
