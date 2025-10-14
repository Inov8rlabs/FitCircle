import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { z } from 'zod';

/**
 * Preferences Schema - matches iOS UserPreferences structure
 */
const preferencesSchema = z.object({
  notifications: z
    .object({
      push: z.boolean().optional(),
      email: z.boolean().optional(),
      challenge_invite: z.boolean().optional(),
      check_in_reminder: z.boolean().optional(),
    })
    .optional(),
  privacy: z
    .object({
      profile_visibility: z.enum(['public', 'friends', 'private']).optional(),
      show_weight: z.boolean().optional(),
      show_progress: z.boolean().optional(),
    })
    .optional(),
  display: z
    .object({
      theme: z.enum(['dark', 'light', 'system']).optional(),
      language: z.string().optional(),
      units: z.enum(['metric', 'imperial']).optional(),
    })
    .optional(),
});

/**
 * GET /api/mobile/settings/preferences
 * Get user preferences
 *
 * Response:
 * - 200: Preferences object
 * - 401: Unauthorized
 * - 500: Internal server error
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    // Get user profile with preferences
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('preferences')
      .eq('id', user.id)
      .single();

    if (error) {
      throw error;
    }

    // Return preferences with defaults
    const preferences = profile?.preferences || {};
    const response = {
      notifications: {
        push: preferences.notifications?.push ?? true,
        email: preferences.notifications?.email ?? true,
        challenge_invite: preferences.notifications?.challenge_invite ?? true,
        check_in_reminder: preferences.notifications?.check_in_reminder ?? true,
      },
      privacy: {
        profile_visibility: preferences.privacy?.profile_visibility || 'public',
        show_weight: preferences.privacy?.show_weight ?? true,
        show_progress: preferences.privacy?.show_progress ?? true,
      },
      display: {
        theme: preferences.display?.theme || 'dark',
        language: preferences.display?.language || 'en',
        units: preferences.display?.units || 'metric',
      },
    };

    const apiResponse = NextResponse.json({
      success: true,
      data: response,
      error: null,
      meta: null,
    });

    // Add auto-refresh headers if token expiring soon
    return await addAutoRefreshHeaders(request, apiResponse, user);
  } catch (error: any) {
    console.error('Get preferences error:', error);

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
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/mobile/settings/preferences
 * Update user preferences (deep merge)
 *
 * Body: Partial preferences object
 * {
 *   "notifications": { "push": false },
 *   "privacy": { "profile_visibility": "private" }
 * }
 *
 * Response:
 * - 200: Updated preferences
 * - 400: Validation error
 * - 401: Unauthorized
 * - 500: Internal server error
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();

    // Validate input
    const validatedData = preferencesSchema.parse(body);

    const supabaseAdmin = createAdminSupabase();

    // Get current preferences
    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('preferences')
      .eq('id', user.id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    // Deep merge preferences
    const currentPreferences = profile?.preferences || {};
    const updatedPreferences = {
      notifications: {
        ...(currentPreferences.notifications || {}),
        ...(validatedData.notifications || {}),
      },
      privacy: {
        ...(currentPreferences.privacy || {}),
        ...(validatedData.privacy || {}),
      },
      display: {
        ...(currentPreferences.display || {}),
        ...(validatedData.display || {}),
      },
    };

    // Update preferences
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        preferences: updatedPreferences,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select('preferences')
      .single();

    if (updateError) {
      throw updateError;
    }

    console.log(`[Preferences] Updated for user ${user.id}`);

    const apiResponse = NextResponse.json({
      success: true,
      data: updated.preferences,
      error: null,
      meta: null,
    });

    // Add auto-refresh headers if token expiring soon
    return await addAutoRefreshHeaders(request, apiResponse, user);
  } catch (error: any) {
    console.error('Update preferences error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors,
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

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
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
