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
 * Deletes ALL user data including:
 * - Profile information
 * - Daily tracking entries
 * - Food log entries and photos
 * - Daily and weekly goals
 * - Engagement streaks and activities
 * - Challenge participations
 * - Circle memberships
 * - Uploaded files (avatars, photos)
 * - Authentication account
 */
export async function DELETE(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const userId = user.id;

    console.log(`🗑️ [Mobile API] ACCOUNT DELETION requested for user: ${userId}`);
    console.log(`⚠️  [Mobile API] This is a permanent, irreversible operation`);

    const { createAdminSupabase } = await import('@/lib/supabase-admin');
    const supabase = createAdminSupabase();

    // Track deletion progress for logging
    const deletionLog: { [key: string]: number } = {};

    // 1. Delete food log photos from storage
    console.log('🗑️  [1/10] Deleting food log photos from storage...');
    const { data: foodLogs } = await supabase
      .from('food_log')
      .select('photo_url')
      .eq('user_id', userId);

    if (foodLogs && foodLogs.length > 0) {
      const photoUrls = foodLogs
        .map((log) => log.photo_url)
        .filter((url): url is string => Boolean(url));

      for (const photoUrl of photoUrls) {
        try {
          // Extract path from URL and delete from storage
          const urlParts = photoUrl.split('/storage/v1/object/public/food-log/');
          if (urlParts[1]) {
            await supabase.storage.from('food-log').remove([urlParts[1]]);
          }
        } catch (storageError) {
          console.error('Failed to delete photo:', photoUrl, storageError);
        }
      }
      deletionLog.foodLogPhotos = photoUrls.length;
    }

    // 2. Delete food log entries
    console.log('🗑️  [2/10] Deleting food log entries...');
    const { error: foodLogError, count: foodLogCount } = await supabase
      .from('food_log')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    if (foodLogError) throw foodLogError;
    deletionLog.foodLogEntries = foodLogCount || 0;

    // 3. Delete daily tracking entries
    console.log('🗑️  [3/10] Deleting daily tracking entries...');
    const { error: trackingError, count: trackingCount } = await supabase
      .from('daily_tracking')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    if (trackingError) throw trackingError;
    deletionLog.dailyTracking = trackingCount || 0;

    // 4. Delete daily goals
    console.log('🗑️  [4/10] Deleting daily goals...');
    const { error: dailyGoalsError, count: dailyGoalsCount } = await supabase
      .from('daily_goals')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    if (dailyGoalsError) throw dailyGoalsError;
    deletionLog.dailyGoals = dailyGoalsCount || 0;

    // 5. Delete weekly goals
    console.log('🗑️  [5/10] Deleting weekly goals...');
    const { error: weeklyGoalsError, count: weeklyGoalsCount } = await supabase
      .from('weekly_goals')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    if (weeklyGoalsError) throw weeklyGoalsError;
    deletionLog.weeklyGoals = weeklyGoalsCount || 0;

    // 6. Delete engagement activities
    console.log('🗑️  [6/10] Deleting engagement activities...');
    const { error: engagementError, count: engagementCount } = await supabase
      .from('engagement_activities')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    if (engagementError) throw engagementError;
    deletionLog.engagementActivities = engagementCount || 0;

    // 7. Delete metric streaks
    console.log('🗑️  [7/10] Deleting metric streaks...');
    const { error: metricStreaksError, count: metricStreaksCount } = await supabase
      .from('metric_streaks')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    if (metricStreaksError) throw metricStreaksError;
    deletionLog.metricStreaks = metricStreaksCount || 0;

    // 8. Delete challenge participations
    console.log('🗑️  [8/10] Deleting challenge participations...');
    const { error: challengeError, count: challengeCount } = await supabase
      .from('challenge_participants')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    if (challengeError) throw challengeError;
    deletionLog.challengeParticipations = challengeCount || 0;

    // 9. Delete token blacklist entries
    console.log('🗑️  [9/10] Deleting token blacklist entries...');
    const { error: tokenError, count: tokenCount } = await supabase
      .from('token_blacklist')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    if (tokenError) throw tokenError;
    deletionLog.tokenBlacklist = tokenCount || 0;

    // 10. Delete profile (this will cascade delete circle memberships and other related data)
    console.log('🗑️  [10/10] Deleting user profile...');
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);
    if (profileError) throw profileError;
    deletionLog.profile = 1;

    // 11. Finally, delete from Supabase Auth
    console.log('🗑️  [AUTH] Deleting authentication account...');
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    if (authError) {
      console.error('[Mobile API] Failed to delete user from auth:', authError);
      throw authError;
    }

    console.log(`✅ [Mobile API] Account deletion completed successfully`);
    console.log(`📊 [Mobile API] Deletion summary:`, deletionLog);

    return NextResponse.json({
      success: true,
      data: {
        message: 'Account and all associated data deleted successfully',
        deletedItems: deletionLog,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Account deletion FAILED:', {
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
