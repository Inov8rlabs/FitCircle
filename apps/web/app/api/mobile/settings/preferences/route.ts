import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

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
      // Sent by iOS and Android (PrivacyPreferences), read back by both from
      // `preferences.privacy` of the profile responses under these same names.
      allow_team_invites: z.boolean().optional(),
      allow_challenge_invites: z.boolean().optional(),
    })
    .optional(),
  display: z
    .object({
      theme: z.enum(['dark', 'light', 'system']).optional(),
      language: z.string().optional(),
      units: z.enum(['metric', 'imperial']).optional(),
    })
    .optional(),
  security: z
    .object({
      biometric_auth_enabled: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Older web code stored some privacy settings in camelCase, and the profile
 * responses read a camelCase key before its snake_case twin. When a client
 * saves a snake_case key, keep an EXISTING camelCase twin in step so the saved
 * value is the one every reader returns. No new camelCase key is ever created.
 */
const PRIVACY_CAMEL_TWINS: Record<string, string> = {
  profile_visibility: 'profileVisibility',
  show_weight: 'showWeight',
  show_progress: 'showProgress',
  allow_team_invites: 'allowTeamInvites',
  allow_challenge_invites: 'allowChallengeInvites',
};

function mergePrivacy(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...current, ...incoming };
  for (const [key, value] of Object.entries(incoming)) {
    const twin = PRIVACY_CAMEL_TWINS[key];
    if (twin && value !== undefined && twin in current) merged[twin] = value;
  }
  return merged;
}

/**
 * The web app stores the unit system as top-level `unitSystem` (+ `units`), and
 * the auth responses read it before `display.units`. When a client saves
 * `display.units`, keep those EXISTING keys in step. They are never created here.
 */
function syncUnitSystem(
  current: Record<string, any>,
  units: 'metric' | 'imperial' | undefined
): Record<string, unknown> {
  if (!units) return {};
  const synced: Record<string, unknown> = {};
  if ('unitSystem' in current) synced.unitSystem = units;
  if (current.units && typeof current.units === 'object' && !Array.isArray(current.units)) {
    synced.units = {
      ...current.units,
      weight: units === 'imperial' ? 'lbs' : 'kg',
      height: units === 'imperial' ? 'inches' : 'cm',
    };
  }
  return synced;
}

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
        allow_team_invites:
          preferences.privacy?.allow_team_invites ?? preferences.privacy?.allowTeamInvites ?? true,
        allow_challenge_invites:
          preferences.privacy?.allow_challenge_invites ??
          preferences.privacy?.allowChallengeInvites ??
          true,
      },
      display: {
        theme: preferences.display?.theme || 'dark',
        language: preferences.display?.language || 'en',
        units: preferences.display?.units || 'metric',
      },
      security: {
        biometric_auth_enabled: preferences.security?.biometric_auth_enabled ?? false,
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

    // Validate input. parseLenient: an explicit JSON null on an optional field
    // (or section) means "not sent".
    const validatedData = parseLenient(preferencesSchema, body);

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

    // Deep merge preferences. Everything else stored in profiles.preferences
    // (hydration goal, unitSystem, units, ...) is kept: this route owns four
    // sections, not the whole object.
    const currentPreferences = profile?.preferences || {};
    const updatedPreferences = {
      ...currentPreferences,
      ...syncUnitSystem(currentPreferences, validatedData.display?.units),
      notifications: {
        ...(currentPreferences.notifications || {}),
        ...(validatedData.notifications || {}),
      },
      privacy: mergePrivacy(currentPreferences.privacy || {}, validatedData.privacy || {}),
      display: {
        ...(currentPreferences.display || {}),
        ...(validatedData.display || {}),
      },
      security: {
        ...(currentPreferences.security || {}),
        ...(validatedData.security || {}),
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
            message: validationMessage(error),
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
